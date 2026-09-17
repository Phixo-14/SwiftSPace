const Joi = require('joi');

// Central place for every Joi schema used across the API. Controllers call
// `schema.validate(req.body)` directly so this stays framework-agnostic.

const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(72).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const placedItemSchema = Joi.object({
  catalogItemId: Joi.string().hex().length(24).required(),
  gridX: Joi.number().integer().min(0).required(),
  gridY: Joi.number().integer().min(0).required(),
  rotation: Joi.number().valid(0, 90, 180, 270).default(0),
  customColor: Joi.string()
    .pattern(/^#[0-9A-Fa-f]{6}$/)
    .allow(null)
    .default(null),
});

// Shared by both create (POST) and update (PUT) — coordinates are re-checked
// against the room's own width/length in the controller, since Joi alone
// can't know the sibling dimensions value of each array item.
const roomSchema = Joi.object({
  roomName: Joi.string().trim().min(1).max(60).required(),
  dimensions: Joi.object({
    width: Joi.number().integer().min(1).max(50).required(),
    length: Joi.number().integer().min(1).max(50).required(),
  }).required(),
  floorColor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#BCA17A'),
  gridColor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#8C7455'),
  placedItems: Joi.array().items(placedItemSchema).default([]),
});

function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        message: 'Validation failed.',
        details: error.details.map((d) => d.message),
      });
    }
    req.body = value;
    next();
  };
}

module.exports = { registerSchema, loginSchema, roomSchema, validateBody };
