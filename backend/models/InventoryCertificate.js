const mongoose = require("mongoose");

const InventoryCertificateSchema = new mongoose.Schema(
  {
    certificateId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    batchId: {
      type: String,
      required: true,
      index: true,
    },
    vaccineType: String,
    manufacturer: String,
    predictedDemand: {
      type: Number,
      default: 0,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    certificateUri: String,
    txHash: String,
    sourceSeries: [Number],
    releaseVisibleToExternal: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InventoryCertificate", InventoryCertificateSchema);
