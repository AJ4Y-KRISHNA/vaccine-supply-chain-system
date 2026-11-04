const mongoose = require("mongoose");
const TemperatureLog = require("../models/TemperatureLog");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const ColdChainAudit = require("../models/ColdChainAudit");
const { ingestTelemetryPayload } = require("./temperatureController");
const logger = require("../services/structuredLogger");

const actorId = req => String(req.user?.id || req.user?._id || "");
const fail = (status, message) => Object.assign(new Error(message), { status });

// Small RFC-4180-compatible parser for the fixed, documented telemetry CSV template.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw fail(400, "CSV contains an unterminated quoted field");
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) throw fail(400, "CSV file is empty");
  const headers = rows.shift().map(value => value.trim().replace(/^\uFEFF/, "").toLowerCase());
  return rows.map((values, index) => Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]).concat([["__row", index + 2]])));
}

function csvReading(row, enteredBy) {
  return {
    batchId: row.batchid,
    shipmentId: row.shipmentid || "",
    deviceId: row.deviceid || `csv-${enteredBy}`,
    vehicleId: row.vehicleid,
    temperature: row.temperature,
    humidity: row.humidity,
    batteryLevel: row.battery ?? row.batterylevel,
    latitude: row.lat ?? row.latitude,
    longitude: row.lon ?? row.lng ?? row.longitude,
    recordedAt: row.timestamp || row.recordedat,
    note: row.note,
  };
}

async function checkAndPrepare(input, req, source = "manual") {
  const note = String(input.note || "").trim();
  if (!note) throw fail(400, "A note is required for manual readings");
  const parsedDate = new Date(input.recordedAt || input.timestamp);
  if (!Number.isFinite(parsedDate.getTime())) throw fail(400, "A valid timestamp is required");
  if (parsedDate > new Date()) throw fail(400, "Manual reading timestamps cannot be in the future");
  const batchId = String(input.batchId || "").trim();
  if (!batchId || !(await Batch.exists({ batchId }))) throw fail(400, "A known batchId is required");
  const vehicleId = String(input.vehicleId || "").trim();
  if (!vehicleId) throw fail(400, "vehicleId is required");
  const lat = Number(input.latitude ?? input.lat), lon = Number(input.longitude ?? input.lon);
  const reading = {
    batchId, shipmentId: String(input.shipmentId || ""), vehicleId,
    deviceId: String(input.deviceId || `manual-${actorId(req)}`),
    temperature: Number(input.temperature), humidity: Number(input.humidity), batteryLevel: Number(input.batteryLevel ?? input.battery),
    recordedAt: parsedDate, location: { lat, lng: lon }, source, enteredBy: actorId(req), note,
  };
  const prior = await TemperatureLog.findOne({ batchId, recordedAt: { $lt: parsedDate } }).sort({ recordedAt: -1, _id: -1 }).select("temperature recordedAt").lean();
  if (prior) {
    const minutes = (parsedDate.getTime() - new Date(prior.recordedAt).getTime()) / 60000;
    if (minutes > 0 && Math.abs(reading.temperature - Number(prior.temperature)) / minutes > 8) reading.needsReview = true;
  }
  return reading;
}

async function audit(req, reading, action, snapshot = {}) {
  await ColdChainAudit.create({ batchId: reading.batchId, correlationId: req.correlationId,
    action, actorId: actorId(req), reason: reading.note || action, eventTime: reading.recordedAt || new Date(),
    snapshot: { source: reading.source, enteredBy: actorId(req), note: reading.note || "", ...snapshot } });
}

async function publish(req, reading, action) {
  const [receipt] = await ingestTelemetryPayload(reading, { correlationId: req.correlationId, transport: "manual-http" });
  await audit(req, reading, action, { eventId: receipt.eventId || "", temperature: reading.temperature, needsReview: Boolean(reading.needsReview) });
  logger.info("manual.reading.accepted", { correlationId: req.correlationId, actorId: actorId(req), batchId: reading.batchId, source: reading.source });
  return receipt;
}

exports.createManualReading = async (req, res) => {
  try {
    const reading = await checkAndPrepare({ ...req.body, recordedAt: req.body.timestamp }, req, "manual");
    res.status(202).json({ reading: await publish(req, reading, "Manual reading created"), needsReview: Boolean(reading.needsReview), processingStatus: "QUEUED" });
  } catch (error) {
    const batchId = String(req.body?.batchId || "").trim();
    if (batchId) try { await ColdChainAudit.create({ batchId, correlationId: req.correlationId,
      action: "Manual reading rejected", actorId: actorId(req), reason: String(error.message || "Manual reading rejected"),
      eventTime: new Date(), snapshot: { source: "manual", enteredBy: actorId(req), note: String(req.body?.note || "").slice(0, 1000) } }); }
    catch (_) { /* Preserve the request's validation error if the audit store is unavailable. */ }
    res.status(error.status || 500).json({ error: error.message });
  }
};

exports.importReadings = async (req, res) => {
  try {
    let text = "";
    if (req.is("text/csv") || req.is("application/csv")) text = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
    else if (req.is("multipart/form-data")) {
      const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers["content-type"] || "");
      if (!boundary || !Buffer.isBuffer(req.body)) throw fail(400, "Upload a CSV file using multipart/form-data");
      const body = req.body.toString("latin1"), parts = body.split(`--${boundary[1] || boundary[2]}`);
      const file = parts.find(part => /filename="[^"]+\.csv"/i.test(part));
      if (!file) throw fail(400, "A .csv file is required");
      const separator = file.indexOf("\r\n\r\n");
      text = Buffer.from(file.slice(separator + 4).replace(/\r\n$/, ""), "latin1").toString("utf8");
    } else throw fail(415, "Send a CSV file as text/csv or multipart/form-data");
    const rows = parseCsv(text);
    if (rows.length > 5000) throw fail(413, "CSV upload is limited to 5,000 data rows");
    const report = [];
    const valid = [];
    for (const row of rows) {
      try { valid.push({ rowNumber: row.__row, reading: await checkAndPrepare(csvReading(row, actorId(req)), req, "csv") }); }
      catch (error) { report.push({ row: row.__row, status: "rejected", reason: error.message }); }
    }
    valid.sort((a, b) => a.reading.recordedAt - b.reading.recordedAt || a.rowNumber - b.rowNumber);
    for (const item of valid) {
      try {
        const receipt = await publish(req, item.reading, "CSV reading imported");
        report.push({ row: item.rowNumber, status: "accepted", readingId: receipt._id, eventId: receipt.eventId,
          source: "csv", needsReview: Boolean(item.reading.needsReview) });
      } catch (error) { report.push({ row: item.rowNumber, status: "rejected", reason: error.message }); }
    }
    report.sort((a, b) => a.row - b.row);
    const accepted = report.filter(item => item.status === "accepted").length;
    const rejected = report.length - accepted;
    await ColdChainAudit.create({ batchId: valid[0]?.reading.batchId || `CSV-IMPORT-${Date.now()}`,
      correlationId: req.correlationId, action: "CSV telemetry import submitted", actorId: actorId(req),
      reason: `CSV upload processed: ${accepted} accepted, ${rejected} rejected`, eventTime: new Date(),
      snapshot: { source: "csv", enteredBy: actorId(req), rowCount: report.length, accepted, rejected } });
    res.status(200).json({ accepted, rejected, results: report });
  } catch (error) {
    try { await ColdChainAudit.create({ batchId: `CSV-IMPORT-${Date.now()}`, correlationId: req.correlationId,
      action: "CSV telemetry import rejected", actorId: actorId(req), reason: String(error.message || "CSV import failed"),
      eventTime: new Date(), snapshot: { source: "csv", enteredBy: actorId(req), rejectedBeforeRowProcessing: true } }); }
    catch (_) { /* Preserve the request's validation error if the audit store is unavailable. */ }
    res.status(error.status || 500).json({ error: error.message });
  }
};

exports.correctReading = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw fail(404, "Reading not found");
    const original = await TemperatureLog.findById(req.params.id).lean();
    if (!original) throw fail(404, "Reading not found");
    const correction = await checkAndPrepare({ ...original, ...req.body, recordedAt: req.body.timestamp || original.recordedAt,
      lat: req.body.lat ?? req.body.latitude ?? original.location?.lat,
      lon: req.body.lon ?? req.body.longitude ?? original.location?.lng,
      note: req.body.note }, req, "manual");
    correction.supersedes = String(original._id);
    const receipt = await publish(req, correction, "Manual reading corrected (supersedes original)");
    res.status(202).json({ reading: receipt, supersedes: String(original._id), originalPreserved: true, needsReview: Boolean(correction.needsReview) });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
};

exports._test = { parseCsv, checkAndPrepare, csvReading };
