const mongoose = require("mongoose");

const ShipmentSchema = new mongoose.Schema({
  shipmentId: String,
  batchId: String,
  coldChainHoldAlertIds: { type: [String], default: undefined },
  coldChainStatus: String,
  vaccineType: String,
  quantity: Number,
  source: String,
  distributor: String,
  destination: String,
  status: String,
  txHash: String,
  currentTemperature: Number,
  hospitalConfirmed: {
    type: Boolean,
    default: false,
  },
  hospitalConfirmedAt: Date,
  hospitalConfirmationNote: String,
  confirmedBy: String,
  idealTemperatureRange: {
    type: String,
    default: "2C - 8C"
  },
  lastUpdatedAt: {
    type: Date,
    default: Date.now
  },
  statusHistory: [
    {
      status: String,
      timestamp: { type: Date, default: Date.now },
      txHash: String,
    }
  ],

  createdAt: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.model("Shipment", ShipmentSchema);
