const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Vaccination = require("../models/Vaccination");
const Distribution = require("../models/Distribution");
const TemperatureLog = require("../models/TemperatureLog");
const RawMaterial = require("../models/RawMaterial");
const Production = require("../models/Production");
const BatchReport = require("../models/BatchReport");
const User = require("../models/user");
const Order = require("../models/Order");
const InventoryCertificate = require("../models/InventoryCertificate");
const { getForecast, getSentiment } = require("../services/aiService");

function isSameDay(value, day) {
  return new Date(value).toDateString() === day.toDateString();
}

function buildSevenDaySeries(items, dateField, valueField) {
  const labels = [];
  const values = [];

  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    labels.push(day.toLocaleDateString("en-US", { weekday: "short" }));
    values.push(
      items
        .filter((item) => item[dateField] && isSameDay(item[dateField], day))
        .reduce((sum, item) => sum + (Number(item[valueField]) || 0), 0)
    );
  }

  return { labels, values };
}

function buildShipmentActivitySeries(shipments) {
  const labels = [];
  const values = [];

  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    labels.push(day.toLocaleDateString("en-US", { weekday: "short" }));

    let count = 0;
    shipments.forEach((shipment) => {
      const history = Array.isArray(shipment.statusHistory) && shipment.statusHistory.length
        ? shipment.statusHistory
        : [{ status: shipment.status, timestamp: shipment.lastUpdatedAt || shipment.createdAt }];

      history.forEach((entry) => {
        const ts = entry?.timestamp ? new Date(entry.timestamp) : null;
        if (ts && ts >= day && ts < nextDay) {
          count += 1;
        }
      });
    });

    values.push(count);
  }

  return { labels, values };
}

function computeHealthcareInventory(vaccinations) {
  const receiptBuckets = new Map();
  const usageByVaccine = new Map();

  vaccinations.forEach((entry) => {
    const vaccineType = entry.vaccineType || "Mixed";
    const receiptKey =
      entry.shipmentId ||
      entry.batchId ||
      `${vaccineType}-${entry.centerId || entry.hospital || "center"}-${entry._id}`;
    const received = Number(entry.receivedDoses || 0);
    const isInventoryEvent =
      received > 0 &&
      (
        entry.workflowStage === "1.2 Stock Management" ||
        entry.eventType === "Delivery Confirmation" ||
        entry.eventType === "Inventory Update" ||
        entry.inventoryStatus === "Updated" ||
        entry.inventoryStatus === "Delivery Confirmed"
      );

    if (isInventoryEvent) {
      const current = receiptBuckets.get(receiptKey);
      if (!current || received > current.receivedDoses) {
        receiptBuckets.set(receiptKey, {
          vaccineType,
          receivedDoses: received,
        });
      }
    }

    const used = Number(entry.dosesUsed || 0);
    const isAdministrationEvent =
      used > 0 &&
      (
        entry.workflowStage === "1.3 Administer Vaccines" ||
        entry.eventType === "Vaccination" ||
        entry.administrationStatus === "Administered"
      );

    if (isAdministrationEvent) {
      usageByVaccine.set(vaccineType, (usageByVaccine.get(vaccineType) || 0) + used);
    }
  });

  const receivedByVaccine = new Map();
  receiptBuckets.forEach((entry) => {
    receivedByVaccine.set(
      entry.vaccineType,
      (receivedByVaccine.get(entry.vaccineType) || 0) + entry.receivedDoses
    );
  });

  const vaccineTypes = new Set([
    ...Array.from(receivedByVaccine.keys()),
    ...Array.from(usageByVaccine.keys()),
  ]);

  const stockBreakdown = {};
  const stockDetails = Array.from(vaccineTypes)
    .map((vaccineType) => {
      const received = receivedByVaccine.get(vaccineType) || 0;
      const used = usageByVaccine.get(vaccineType) || 0;
      const available = Math.max(0, received - used);
      stockBreakdown[vaccineType] = available;
      return {
        vaccineType,
        received,
        used,
        available,
      };
    })
    .sort((a, b) => b.available - a.available);

  return {
    stockBreakdown,
    stockDetails,
    vaccinesAvailable: stockDetails.reduce((sum, entry) => sum + entry.available, 0),
    vaccinatedToday: vaccinations
      .filter((entry) => isSameDay(entry.date, new Date()))
      .reduce((sum, entry) => {
        const used = Number(entry.dosesUsed || 0);
        const isAdministrationEvent =
          entry.workflowStage === "1.3 Administer Vaccines" ||
          entry.eventType === "Vaccination" ||
          entry.administrationStatus === "Administered";
        return sum + (isAdministrationEvent ? used : 0);
      }, 0),
    lowAlerts: stockDetails.filter((entry) => entry.available > 0 && entry.available < 250).length,
  };
}

const manufacturerHeatmapRegions = {
  "North America": { x: 17, y: 26 },
  "South America": { x: 26, y: 66 },
  Europe: { x: 49, y: 24 },
  Africa: { x: 52, y: 56 },
  "Middle East": { x: 60, y: 34 },
  India: { x: 66, y: 42 },
  "South Asia": { x: 71, y: 48 },
  "Southeast Asia": { x: 76, y: 56 },
  "East Asia": { x: 83, y: 34 },
  Oceania: { x: 87, y: 78 },
  "Northeast Region": { x: 68, y: 44 },
  Kochi: { x: 64, y: 57 },
  Pattimatom: { x: 65, y: 56 },
};

function stableRegionPoint(region) {
  const key = String(region || "Global Hub").trim();
  if (manufacturerHeatmapRegions[key]) return manufacturerHeatmapRegions[key];
  let total = 0;
  for (const char of key) total += char.charCodeAt(0);
  return {
    x: 12 + (total % 72),
    y: 18 + ((total * 7) % 58),
  };
}

async function buildManufacturerHeatmapData(orders) {
  const grouped = new Map();

  orders.forEach((order) => {
    const region = order.region || order.hospital || "Global Hub";
    const vaccineType = order.vaccineType || "Mixed";
    const groupKey = `${region}::${vaccineType}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        region,
        vaccineType,
        history: [],
        lastRequested: 0,
      });
    }
    const bucket = grouped.get(groupKey);
    const requested = Number(order.requestedDoses || 0);
    if (requested > 0) {
      bucket.history.push(requested);
      bucket.lastRequested = requested;
    }
  });

  const rawEntries = await Promise.all(
    Array.from(grouped.values()).map(async (entry) => {
      let forecastValue = 0;
      if (entry.history.length >= 4) {
        try {
          const forecast = await getForecast({ vaccination_data: entry.history.slice(-12) });
          forecastValue = Number(forecast.predicted_demand || 0);
        } catch (_error) {
          forecastValue = entry.lastRequested;
        }
      } else {
        forecastValue = entry.lastRequested;
      }

      return {
        ...entry,
        forecastValue,
      };
    })
  );

  const regional = new Map();
  rawEntries.forEach((entry) => {
    if (!regional.has(entry.region)) {
      regional.set(entry.region, {
        region: entry.region,
        totalForecast: 0,
        vaccineBreakdown: [],
      });
    }
    const regionBucket = regional.get(entry.region);
    regionBucket.totalForecast += entry.forecastValue;
    regionBucket.vaccineBreakdown.push({
      vaccineType: entry.vaccineType,
      forecastValue: entry.forecastValue,
    });
  });

  return Array.from(regional.values())
    .map((entry) => {
      const top = [...entry.vaccineBreakdown].sort((a, b) => b.forecastValue - a.forecastValue)[0];
      const point = stableRegionPoint(entry.region);
      return {
        region: entry.region,
        forecastValue: entry.totalForecast,
        priorityVaccine: top?.vaccineType || "Mixed",
        vaccineBreakdown: entry.vaccineBreakdown.sort((a, b) => b.forecastValue - a.forecastValue),
        intensity: Math.min(1, entry.totalForecast / 5000),
        x: point.x,
        y: point.y,
      };
    })
    .sort((a, b) => b.forecastValue - a.forecastValue);
}

exports.getDistributorDashboard = async (_req, res) => {
  try {
    const shipments = await Shipment.find(_req.scope.shipment).sort({ createdAt: -1 }).lean();
    const temperatureLogs = await TemperatureLog.find(_req.scope.telemetry).sort({ recordedAt: -1 }).limit(10).lean();

    const inTransit = shipments.filter((s) => s.status?.toLowerCase().includes("transit")).length;
    const delivered = shipments.filter((s) => {
      const status = String(s.status || "").toLowerCase();
      return status.includes("delivered") || status.includes("supplied") || status.includes("confirmed");
    }).length;
    const pending = shipments.filter((s) => s.status?.toLowerCase().includes("pending")).length;

    const deliveryHistory = buildShipmentActivitySeries(shipments);

    res.json({
      identity: { distributor: _req.user?.distributor || _req.user?.email || "" },
      totals: {
        totalShipments: shipments.length,
        inTransit,
        delivered,
        pending,
        tempAlerts: temperatureLogs.filter((t) => t.status === "Alert").length,
      },
      shipments,
      tempLogs: temperatureLogs.map((log) => ({
        id: log.batchId,
        range: `${log.temperature}C`,
        status: log.status,
        recordedAt: log.recordedAt,
      })),
      deliveryHistory,
      confirmedDeliveries: shipments
        .filter((shipment) => shipment.hospitalConfirmed || String(shipment.status || "").toLowerCase().includes("confirmed"))
        .slice(0, 8)
        .map((shipment) => ({
          shipmentId: shipment.shipmentId,
          batchId: shipment.batchId,
          vaccineType: shipment.vaccineType || "Mixed",
          quantity: shipment.quantity || 0,
          destination: shipment.destination,
          confirmedAt: shipment.hospitalConfirmedAt || shipment.lastUpdatedAt || shipment.createdAt,
          confirmationNote: shipment.hospitalConfirmationNote || "Hospital confirmed receipt.",
          confirmedBy: shipment.confirmedBy || "Hospital",
          txHash: shipment.txHash || "",
          status: shipment.status,
        })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getManufacturerDashboard = async (_req, res) => {
  try {
    const batches = await Batch.find(_req.scope.batch).sort({ createdAt: -1 }).lean();
    const productions = await Production.find(_req.scope.relatedBatch).sort({ producedAt: -1 }).lean();
    const rawMaterials = await RawMaterial.find(_req.scope.relatedBatch).sort({ receivedAt: -1 }).lean();
    const reports = await BatchReport.find(_req.scope.relatedBatch).sort({ createdAt: -1 }).lean();
    const certificates = await InventoryCertificate.find(_req.scope.relatedBatch).sort({ issuedAt: -1 }).lean();
    const orders = await Order.find({ $and: [_req.scope.order, { status: { $in: ["Pending", "Approved"] } }] }).sort({ createdAt: -1 }).lean();
    const heatmap = await buildManufacturerHeatmapData(orders);

    const totalQuantity = batches.reduce((sum, batch) => sum + (batch.quantity || 0), 0);
    const pendingShipments = batches.filter((batch) => !batch.releaseVisibleToExternal).length;

    res.json({
      identity: { manufacturer: _req.user?.manufacturer || _req.user?.email || "" },
      cards: {
        totalBatches: batches.length,
        pendingShipments,
        totalDistributed: totalQuantity,
        lowAlerts: reports.filter((report) => (report.wastageRate || 0) > 10).length,
        certificatesMinted: certificates.length,
        releasedBatches: batches.filter((batch) => batch.releaseVisibleToExternal).length,
      },
      processSummary: {
        rawMaterialsReceived: rawMaterials.length,
        vaccinesProduced: productions.length,
        batchesCreated: batches.length,
        reportsGenerated: reports.length,
      },
      batches: batches.slice(0, 5).map((batch) => ({
        batchId: batch.batchId,
        vaccineType: batch.vaccineType,
        quantity: batch.quantity,
        expiresAt: batch.expiresAt,
        status: batch.status || "Manufactured",
        coldChainStatus: batch.coldChainStatus || "",
        txHash: batch.txHash,
        baselineDemandForecast: batch.baselineDemandForecast || 0,
        certificateMinted: Boolean(batch.certificateMinted),
        certificateId: batch.certificateId || "",
        releaseVisibleToExternal: Boolean(batch.releaseVisibleToExternal),
        releaseStage: batch.releaseStage || "Awaiting Production Sign-Off",
        productionApproved: Boolean(batch.productionApproved),
        labApproved: Boolean(batch.labApproved),
      })),
      distributionSeries: reports.slice(0, 8).reverse().map((report, index) => ({
        label: `M${index + 1}`,
        value: report.quantity || 0,
      })),
      txHistory: batches
        .filter((batch) => batch.txHash)
        .slice(0, 5)
        .map((batch) => ({
          batchId: batch.batchId,
          hash: batch.txHash,
          timestamp: batch.createdAt,
        })),
      reports: reports.slice(0, 5),
      certificates: certificates.slice(0, 6).map((certificate) => ({
        certificateId: certificate.certificateId,
        batchId: certificate.batchId,
        vaccineType: certificate.vaccineType,
        predictedDemand: certificate.predictedDemand || 0,
        issuedAt: certificate.issuedAt,
        txHash: certificate.txHash || "",
        releaseVisibleToExternal: Boolean(certificate.releaseVisibleToExternal),
      })),
      demandHeatmap: heatmap,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getHealthcareDashboard = async (_req, res) => {
  try {
    const vaccinations = await Vaccination.find(_req.scope.vaccination).sort({ date: -1 }).lean();
    const shipments = await Shipment.find(_req.scope.shipment).sort({ lastUpdatedAt: -1 }).lean();
    const administrations = vaccinations.filter(entry => entry.workflowStage === "1.3 Administer Vaccines" || entry.eventType === "Vaccination" || entry.administrationStatus === "Administered");
    const dailyProgress = buildSevenDaySeries(administrations, "date", "dosesUsed");
    const inventory = computeHealthcareInventory(vaccinations);

    res.json({
      cards: {
        vaccinesAvailable: inventory.vaccinesAvailable,
        todaysAppointments: 0,
        vaccinatedToday: inventory.vaccinatedToday,
        lowAlerts: inventory.lowAlerts,
      },
      identity: { hospital: _req.user?.hospital || _req.user?.email || "" },
      stockBreakdown: inventory.stockBreakdown,
      stockDetails: inventory.stockDetails,
      usageLogs: vaccinations.slice(0, 5),
      appointments: [],
      dailyProgress: dailyProgress.values,
      dailyLabels: dailyProgress.labels,
      recentConfirmedDeliveries: vaccinations
        .filter((entry) => entry.eventType === "Delivery Confirmation")
        .slice(0, 6)
        .map((entry) => ({
          id: entry._id,
          batchId: entry.batchId,
          shipmentId: entry.shipmentId,
          hospital: entry.hospital || entry.centerId,
          vaccineType: entry.vaccineType || "Mixed",
          receivedDoses: entry.receivedDoses || 0,
          stockBefore: entry.stockBefore || 0,
          stockAfter: entry.stockAfter || 0,
          notes: entry.notes || "",
          txHash: entry.txHash || "",
          date: entry.date,
        })),
      incomingDeliveries: shipments
        .filter((shipment) => {
          const status = String(shipment.status || "").toLowerCase();
          return (
            !shipment.hospitalConfirmed &&
            (status.includes("supplied") || status.includes("delivered"))
          );
        })
        .slice(0, 8)
        .map((shipment) => ({
          shipmentId: shipment.shipmentId,
          batchId: shipment.batchId,
          vaccineType: shipment.vaccineType || "Mixed",
          quantity: shipment.quantity || 0,
          destination: shipment.destination || "Vaccination Center",
          status: shipment.status || "Pending",
          coldChainStatus: shipment.coldChainStatus || "",
          txHash: shipment.txHash || "",
        })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAdminDashboard = async (_req, res) => {
  try {
    const distributions = await Distribution.find().sort({ timestamp: -1 }).lean();
    const batches = await Batch.find({
      $or: [{ releaseVisibleToExternal: true }, { releaseVisibleToExternal: { $exists: false } }],
    }).sort({ createdAt: -1 }).lean();
    const shipments = await Shipment.find().sort({ lastUpdatedAt: -1 }).lean();
    const temperatureLogs = await TemperatureLog.find().sort({ recordedAt: -1 }).lean();
    const vaccinations = await Vaccination.find().sort({ date: -1 }).lean();
    const users = await User.find().sort({ email: 1 }).lean();

    const totalProduced = batches.reduce((sum, batch) => sum + (batch.quantity || 0), 0);
    const totalDistributed = distributions.reduce((sum, entry) => sum + (entry.demand || 0), 0);
    const totalAdministered = vaccinations.reduce((sum, entry) => sum + (entry.dosesUsed || 0), 0);
    const wastageRate = totalProduced > 0
      ? Number((((totalProduced - totalAdministered) / totalProduced) * 100).toFixed(1))
      : 0;

    const vaccineHistory = vaccinations.slice(0, 12).reverse().map((entry) => entry.dosesUsed || 0);
    let forecastValue = 0;
    if (vaccineHistory.length >= 4) {
      try {
        const forecast = await getForecast({ vaccination_data: vaccineHistory });
        forecastValue = Number(forecast.predicted_demand || 0);
      } catch (err) {
        forecastValue = 0;
      }
    }

    const sentimentBreakdown = {
      positive: distributions.filter((entry) => (entry.sentimentScore || 0) >= 0.67).length,
      neutral: distributions.filter((entry) => (entry.sentimentScore || 0) >= 0.4 && (entry.sentimentScore || 0) < 0.67).length,
      negative: distributions.filter((entry) => (entry.sentimentScore || 0) < 0.4).length,
    };

    const sentimentText = distributions
      .map((entry) => entry.socialText)
      .filter(Boolean)
      .slice(0, 5)
      .join(". ");

    if (sentimentText) {
      try {
        const sentiment = await getSentiment(sentimentText);
        const label = String(sentiment.sentiment || "").toLowerCase();
        if (label.includes("positive")) sentimentBreakdown.positive += 1;
        else if (label.includes("negative")) sentimentBreakdown.negative += 1;
        else sentimentBreakdown.neutral += 1;
      } catch (err) {
        // Keep DB-derived counts if AI sentiment endpoint is unavailable.
      }
    }

    const blockchainRecords = [...batches, ...shipments, ...distributions]
      .filter((entry) => entry.txHash)
      .slice(0, 8);

    const alerts = [
      ...temperatureLogs
        .filter((log) => log.status === "Alert")
        .slice(0, 3)
        .map((log) => ({
          title: `Temperature alert for ${log.batchId}`,
          severity: "high",
          time: new Date(log.recordedAt).toLocaleString(),
        })),
      ...shipments
        .filter((shipment) => !shipment.txHash)
        .slice(0, 2)
        .map((shipment) => ({
          title: `Blockchain hash missing for ${shipment.batchId}`,
          severity: "medium",
          time: new Date(shipment.lastUpdatedAt || shipment.createdAt).toLocaleString(),
        })),
    ];

    const demandForecast = distributions
      .slice(0, 6)
      .reverse()
      .map((entry) => entry.forecastDemand || entry.demand || 0);

    if (forecastValue) {
      demandForecast.push(forecastValue);
    }

    res.json({
      metrics: {
        totalProduced,
        totalDistributed,
        totalAdministered,
        wastageRate,
        activeBlockchain: blockchainRecords.length,
      },
      userManagement: users.slice(0, 6).map((user) => ({
        userId: `${String(user.role || "USR").slice(0, 3).toUpperCase()}-${String(user.email || "user")
          .split("@")[0]
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 6)
          .toUpperCase()}`,
        role: user.role || "operator",
        status: "Active",
        action: user.role === "admin" ? "Manage" : "Review",
      })),
      records: blockchainRecords.map((entry) => ({
        blockHash: entry.txHash,
        batchId: entry.batchId,
        vaccineType: entry.vaccineType || "Mixed",
        timestamp: entry.timestamp || entry.createdAt || entry.lastUpdatedAt,
      })),
      demandForecast,
      sentiment: sentimentBreakdown,
      alerts,
      activity: distributions.slice(0, 5).map((entry) => ({
        message: `Batch ${entry.batchId} tx ${entry.txHash || "pending"}`,
        time: entry.timestamp,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
