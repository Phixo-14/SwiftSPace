const mongoose = require('mongoose');

const SystemLogSchema = new mongoose.Schema(
  {
    level: { type: String, enum: ['info', 'warn', 'error'], required: true },
    source: { type: String, enum: ['request', 'system'], required: true },
    method: { type: String, default: null },
    route: { type: String, default: null },
    statusCode: { type: Number, default: null },
    durationMs: { type: Number, default: null },
    message: { type: String, required: true, maxlength: 240 },
  },
  { timestamps: true }
);

SystemLogSchema.index({ createdAt: -1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('SystemLog', SystemLogSchema);