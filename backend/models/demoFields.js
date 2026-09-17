module.exports = schema => schema.add({
  isDemo: { type: Boolean, default: false },
  demoProvenance: require("mongoose").Schema.Types.Mixed,
});
