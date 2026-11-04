const Joi = require("joi");

// Keep optional legacy workflow fields optional; the new UI supplies all of them.
const schema = Joi.object({
  batchId: Joi.string().trim().min(1).max(120).required(),
  vaccineType: Joi.string().trim().min(1).max(200).required(),
  quantity: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).required(),
  manufacturer: Joi.string().trim().min(1).max(200),
  supplier: Joi.string().trim().min(1).max(200),
  materialType: Joi.string().trim().min(1).max(200),
  materialQuantity: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER),
  unit: Joi.string().trim().min(1).max(40),
  expiresAt: Joi.date().iso().greater("now"),
  remarks: Joi.string().trim().allow("").max(2000),
}).unknown(true);

module.exports = { validateManufacturingInput: body => schema.validate(body, { abortEarly: false }) };
