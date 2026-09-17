const mongoose = require("mongoose");
const schema = new mongoose.Schema({ createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now }, inputs: mongoose.Schema.Types.Mixed, result: mongoose.Schema.Types.Mixed });
require("./appendOnly")(schema);
module.exports = mongoose.model("SupplyPlan", schema);
