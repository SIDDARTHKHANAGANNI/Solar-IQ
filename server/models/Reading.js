const mongoose = require("mongoose");

const readingSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true, index: true },
    solarGeneration: { type: Number, required: true },
    consumption: { type: Number, required: true },
    voltage: { type: Number, required: true },
    current: { type: Number, required: true },
    netEnergy: { type: Number, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Reading", readingSchema);
