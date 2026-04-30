const express = require("express");
const mongoose = require("mongoose");
const Reading = require("../models/Reading");
const { generateMonitoringSeries, toForecastInput } = require("../services/sampleData");
const { getForecast, getVvceMonthlyForecast } = require("../services/aiClient");
const {
  getRealSolarAnalysis,
  getMonitoringSeriesWithFallback,
  getNasaRangeEnergy,
  getNasaPredictiveEnergy,
  scanBestPanelArea,
  getCarbonByDateRange,
  vvceElectricalSummaryForDate
} = require("../services/realSolarApi");
const {
  estimateSolarPotential,
  suggestPanelPlacement,
  estimateBuildings,
  calculateCarbonCredits,
  buildOptimizationInsights
} = require("../services/analyticsService");

const router = express.Router();

router.get("/monitoring", async (req, res) => {
  const monitoring = await getMonitoringSeriesWithFallback();
  const series = monitoring.series;
  const latest = monitoring.latest;

  // Persist readings only when MongoDB is connected; otherwise demo mode stays
  // fully functional without a database dependency.
  if (mongoose.connection.readyState === 1) {
    Reading.create({
      timestamp: latest.timestamp,
      solarGeneration: latest.solarGeneration,
      consumption: latest.consumption,
      voltage: latest.voltage,
      current: latest.current,
      netEnergy: latest.netEnergy
    }).catch((error) => console.warn("Reading persistence failed:", error.message));
  }

  res.json({
    mode: mongoose.connection.readyState === 1 ? `${monitoring.mode}+mongo` : monitoring.mode,
    source: monitoring.source,
    latest,
    series
  });
});

router.post("/forecast", async (req, res) => {
  const incomingSeries = Array.isArray(req.body.series) ? req.body.series : null;
  const monitoring = incomingSeries || toForecastInput(generateMonitoringSeries(48));
  const forecast = await getForecast(monitoring, Number(req.body.periods) || 12);

  res.json(forecast);
});

router.get("/vvce/monthly-forecast", async (req, res) => {
  const forecast = await getVvceMonthlyForecast(Number(req.query.periods) || 6);
  res.json(forecast);
});

router.get("/vvce/today-summary", (req, res) => {
  res.json(vvceElectricalSummaryForDate(req.query.date));
});

router.get("/nasa/monitoring", async (req, res) => {
  try {
    res.json(await getNasaRangeEnergy(req.query));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

router.get("/nasa/predictive", async (req, res) => {
  try {
    res.json(await getNasaPredictiveEnergy(req.query));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

router.post("/solar-analysis", async (req, res) => {
  try {
    res.json(await getRealSolarAnalysis(req.body));
  } catch (error) {
    res.status(502).json({ error: `Real solar APIs unavailable: ${error.message}` });
  }
});

router.post("/panel-placement", (req, res) => {
  scanBestPanelArea(req.body)
    .then((result) => res.json(result))
    .catch((error) => res.status(502).json({ error: error.message }));
});

router.post("/carbon-date-range", async (req, res) => {
  try {
    res.json(await getCarbonByDateRange(req.body));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

router.post("/building-estimation", (req, res) => {
  res.json(estimateBuildings(req.body));
});

router.post("/carbon-credits", (req, res) => {
  res.json(calculateCarbonCredits(req.body));
});

router.post("/insights", (req, res) => {
  res.json({
    insights: buildOptimizationInsights(req.body)
  });
});

module.exports = router;

