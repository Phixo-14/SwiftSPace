const mongoose = require('mongoose');

const ProjectFolderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    normalizedName: { type: String, required: true },
  },
  { timestamps: true }
);

ProjectFolderSchema.index({ userId: 1, normalizedName: 1 }, { unique: true });

module.exports = mongoose.model('ProjectFolder', ProjectFolderSchema);