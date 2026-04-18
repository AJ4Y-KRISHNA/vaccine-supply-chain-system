/**
 * Seed Mongo with real-world CSVs.
 * Env:
 *  - WHO_MI4A_CSV: demand CSV with columns (date/month, doses/quantity)
 *  - UNICEF_SHIPMENTS_CSV: shipments CSV with columns (batchId, destination, quantity, status)
 *  - TEMP_LOG_CSV: optional temperature CSV with (batchId, temperature, status)
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const TemperatureLog = require("../models/TemperatureLog");

const mongo = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/vaccineDB";

function readCSV(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const rows = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  const [header, ...lines] = rows;
  const cols = header.split(",");
  return lines.map((line) => {
    const vals = line.split(",");
    const obj = {};
    cols.forEach((c, i) => {
      obj[c.trim()] = vals[i]?.trim();
    });
    return obj;
  });
}

async function seed() {
  await mongoose.connect(mongo);
  console.log("Mongo connected");

  // Shipments
  const shipmentPath = process.env.UNICEF_SHIPMENTS_CSV;
  const shipmentRows = readCSV(shipmentPath);
  if (shipmentRows.length) {
    await Shipment.deleteMany({});
    await Shipment.insertMany(
      shipmentRows.slice(0, 200).map((r, idx) => ({
        shipmentId: r.shipmentId || `SHP${idx}`,
        batchId: r.batchId || r.BatchId || `BATCH${idx}`,
        distributor: r.distributor || "UNICEF",
        destination: r.destination || r.Destination || "Unknown",
        status: r.status || "Pending",
        txHash: r.txHash || "",
      }))
    );
    console.log(`Seeded ${shipmentRows.length} shipments`);
  } else {
    console.log("No UNICEF_SHIPMENTS_CSV provided; skipping shipments.");
  }

  // Demand data -> batches (approx)
  const demandPath = process.env.WHO_MI4A_CSV;
  const demandRows = readCSV(demandPath);
  if (demandRows.length) {
    await Batch.deleteMany({});
    await Batch.insertMany(
      demandRows.slice(0, 100).map((r, idx) => ({
        batchId: r.batchId || `BATCH${idx}`,
        vaccineType: r.vaccineType || "Mixed",
        quantity: Number(r.doses || r.quantity || r.volume || 0),
        manufacturer: r.manufacturer || "Unknown",
        txHash: "",
      }))
    );
    console.log(`Seeded ${demandRows.length} demand-derived batches`);
  } else {
    console.log("No WHO_MI4A_CSV provided; skipping batches.");
  }

  // Temperature logs
  const tempPath = process.env.TEMP_LOG_CSV;
  const tempRows = readCSV(tempPath);
  if (tempRows.length) {
    await TemperatureLog.deleteMany({});
    await TemperatureLog.insertMany(
      tempRows.slice(0, 200).map((r) => ({
        shipmentId: r.shipmentId || "",
        batchId: r.batchId || "",
        sensorId: r.sensorId || "",
        temperature: Number(r.temperature || r.temp || 0),
        status: r.status || "Normal",
      }))
    );
    console.log(`Seeded ${tempRows.length} temperature logs`);
  } else {
    console.log("No TEMP_LOG_CSV provided; skipping temperature logs.");
  }

  await mongoose.disconnect();
  console.log("Done.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
