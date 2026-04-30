function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function daylightFactor(hour) {
  if (hour < 5 || hour > 19) return 0;
  return Math.sin(((hour - 5) / 14) * Math.PI);
}

// Produces realistic demo data for both first-run use and Flask outage fallback.
function generateMonitoringSeries(points = 48) {
  const now = new Date();
  const data = [];

  for (let index = points - 1; index >= 0; index -= 1) {
    const timestamp = new Date(now.getTime() - index * 30 * 60 * 1000);
    const hour = timestamp.getHours() + timestamp.getMinutes() / 60;
    const solarBase = daylightFactor(hour) * 7.5;
    const cloudNoise = 0.75 + Math.random() * 0.35;
    const eveningDemand = hour >= 18 && hour <= 23 ? 1.8 : 0;
    const workdayDemand = hour >= 8 && hour <= 18 ? 1.2 : 0.4;

    const solarGeneration = round(Math.max(0, solarBase * cloudNoise));
    const consumption = round(2.4 + workdayDemand + eveningDemand + Math.random() * 1.1);
    const voltage = round(228 + Math.random() * 12, 1);
    const current = round((consumption * 1000) / voltage, 2);

    data.push({
      timestamp: timestamp.toISOString(),
      solarGeneration,
      consumption,
      voltage,
      current,
      netEnergy: round(solarGeneration - consumption)
    });
  }

  return data;
}

function toForecastInput(series) {
  return series.map((point) => ({
    ds: point.timestamp,
    solar: point.solarGeneration,
    load: point.consumption
  }));
}

function dummyForecast(series, periods = 12) {
  const last = series[series.length - 1] || { timestamp: new Date().toISOString(), solarGeneration: 3, consumption: 4 };
  const start = new Date(last.timestamp);
  const predictions = [];

  for (let index = 1; index <= periods; index += 1) {
    const timestamp = new Date(start.getTime() + index * 60 * 60 * 1000);
    const hour = timestamp.getHours() + timestamp.getMinutes() / 60;
    const solar = round(daylightFactor(hour) * 7.2 * (0.9 + Math.random() * 0.15));
    const load = round(3.1 + (hour >= 18 && hour <= 23 ? 1.9 : 0.6) + Math.random() * 0.7);

    predictions.push({
      timestamp: timestamp.toISOString(),
      solarForecast: solar,
      loadForecast: load,
      netForecast: round(solar - load)
    });
  }

  return predictions;
}

module.exports = {
  generateMonitoringSeries,
  toForecastInput,
  dummyForecast,
  daylightFactor,
  round
};
