const mongoose = require("mongoose");

const vaccinationSchema = new mongoose.Schema({
  hospital: String,
  centerId: String,
  shipmentId: String,
  batchId: String,
  vaccineType: String,
  patientName: String,
  requestedDoses: Number,
  receivedDoses: Number,
  dosesUsed: Number,
  stockBefore: Number,
  stockAfter: Number,
  requestStatus: {
    type: String,
    default: "Pending",
  },
  inventoryStatus: {
    type: String,
    default: "Pending",
  },
  administrationStatus: {
    type: String,
    default: "Pending",
  },
  recordStatus: {
    type: String,
    default: "Pending",
  },
  blockchainStatus: {
    type: String,
    default: "Pending",
  },
  workflowStage: String,
  eventType: String,
  txHash: String,
  healthAuthority: String,
  notes: String,
  source: { type: String, enum: ["simulator", "manual", "csv"], default: "simulator" },
  enteredBy: String,
  note: String,
  operationId: String,
  operationFingerprint: String,
  operationStatus: { type: String, enum: ["pending", "complete"] },
  operationResult: mongoose.Schema.Types.Mixed,
  date: {
    type: Date,
    default: Date.now
  }
});

vaccinationSchema.index({ hospital: 1, operationId: 1 }, { unique: true, partialFilterExpression: { operationId: { $type: "string" } } });
require("./demoFields")(vaccinationSchema);

module.exports = mongoose.model("Vaccination",vaccinationSchema);
