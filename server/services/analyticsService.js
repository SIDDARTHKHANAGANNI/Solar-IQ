const { round } = require("./sampleData");

function estimateSolarPotential({ latitude, longitude, roofArea = 100, panelEfficiency = 0.2 }) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const area = Number(roofArea);
  const efficiency = Number(panelEfficiency);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Latitude and longitude are required numbers.");
  }

  // Simple clear-sky approximation: equatorial locations receive more annual
  // irradiance, with a small regional adjustment from longitude.
  const latitudePenalty = Math.min(Math.abs(lat) / 90, 1);
  const averageSunHours = 5.8 - latitudePenalty * 2.1;
  const longitudeAdjustment = 1 + Math.sin((lon * Math.PI) / 180) * 0.04;
  const irradianceKwPerM2 = 1;
  const dailyEnergyKwh = area * efficiency * irradianceKwPerM2 * averageSunHours * longitudeAdjustment;
  const monthlyEnergyKwh = dailyEnergyKwh * 30;
  const annualEnergyKwh = dailyEnergyKwh * 365;

  return {
    latitude: lat,
    longitude: lon,
    roofArea,
    panelEfficiency,
    averageSunHours: round(averageSunHours),
    dailyEnergyKwh: round(dailyEnergyKwh),
    monthlyEnergyKwh: round(monthlyEnergyKwh),
    annualEnergyKwh: round(annualEnergyKwh)
  };
}

function suggestPanelPlacement({ roofOrientation = "south", shadingLevel = "low", roofTilt = 20, availableArea = 100 }) {
  const orientationScore = { south: 40, southwest: 34, southeast: 34, west: 25, east: 25, north: 10 };
  const shadingScore = { low: 35, medium: 20, high: 7 };
  const tilt = Number(roofTilt);
  const area = Number(availableArea);

  const tiltScore = Math.max(0, 15 - Math.abs(tilt - 25) * 0.45);
  const areaScore = Math.min(10, area / 15);
  const score = round((orientationScore[roofOrientation] || 22) + (shadingScore[shadingLevel] || 18) + tiltScore + areaScore, 1);

  let recommendation = "Good candidate for solar installation.";
  if (score >= 82) recommendation = "Excellent placement. Prioritize this rooftop section for panels.";
  if (score < 58) recommendation = "Needs mitigation. Reduce shading or consider an alternate area.";

  return {
    score,
    bestArea: score >= 75 ? `${roofOrientation} roof plane` : "least-shaded elevated rooftop area",
    recommendation,
    actions: [
      "Keep panels away from parapet shadows and HVAC equipment.",
      "Use the highest score area for the first installation phase.",
      "Reserve a battery/inverter location close to the main electrical room."
    ]
  };
}

function estimateBuildings({ generatedEnergyKwh, averageBuildingConsumptionKwh = 30 }) {
  const generated = Number(generatedEnergyKwh);
  const average = Number(averageBuildingConsumptionKwh);
  const buildingsPowered = Math.floor(generated / average);

  return {
    generatedEnergyKwh: round(generated),
    averageBuildingConsumptionKwh: round(average),
    buildingsPowered,
    surplusKwh: round(Math.max(0, generated - buildingsPowered * average))
  };
}

function calculateCarbonCredits({ generatedEnergyKwh, creditPriceUsd = process.env.CARBON_CREDIT_PRICE_USD || 12 }) {
  const generated = Number(generatedEnergyKwh);
  const price = Number(creditPriceUsd);
  const gridEmissionFactorKgPerKwh = 0.708;
  const co2ReductionKg = generated * gridEmissionFactorKgPerKwh;
  const carbonCredits = co2ReductionKg / 1000;

  return {
    generatedEnergyKwh: round(generated),
    co2ReductionKg: round(co2ReductionKg),
    carbonCredits: round(carbonCredits, 4),
    estimatedValueUsd: round(carbonCredits * price),
    creditPriceUsd: price
  };
}

function buildOptimizationInsights({ latest, forecast = [] }) {
  const latestNet = latest ? latest.netEnergy : 0;
  const peakDeficit = forecast.reduce((min, point) => Math.min(min, point.netForecast || 0), 0);
  const peakSurplus = forecast.reduce((max, point) => Math.max(max, point.netForecast || 0), 0);
  const insights = [];

  if (latestNet > 1) {
    insights.push("Shift flexible loads like pumps, EV charging, and HVAC pre-cooling into the current surplus window.");
  } else {
    insights.push("Current generation is below demand. Defer flexible loads until the next forecast surplus period.");
  }

  if (peakSurplus > 2) {
    insights.push("Forecast surplus is strong enough for battery charging or exporting to the grid.");
  }

  if (peakDeficit < -2) {
    insights.push("A battery discharge schedule can reduce evening grid import during predicted demand peaks.");
  }

  insights.push("Clean panels monthly and compare voltage/current drift to detect panel or inverter issues early.");

  return insights;
}

module.exports = {
  estimateSolarPotential,
  suggestPanelPlacement,
  estimateBuildings,
  calculateCarbonCredits,
  buildOptimizationInsights
};
