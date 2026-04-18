const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  email: String,
  password: String,
  role: String // admin, manufacturer, distributor, healthcare
});

module.exports = mongoose.model("User", userSchema);