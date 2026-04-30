const axios = require("axios");
const { generateMonitoringSeries, round } = require("./sampleData");

const DEFAULT_SITE = {
  latitude: 12.9666,
  longitude: 77.7118,
  capacityKw: 170,
  roofArea: 680,
  tilt: 20,
  azimuth: 180
};

const VVCE_ANNUAL_EB_KWH = 718800;
const PERFORMANCE_RATIO = 0.75;
const UTILIZATION_FACTOR = 0.85;
const GRID_EMISSION_FACTOR_KG_PER_KWH = 0.65;
const VVCE_MONTHLY_DATA = [
  { month: 2, label: "Mar", ebKwh: 58380, solarKwh: 14719, days: 31 },
  { month: 3, label: "Apr", ebKwh: 61460, solarKwh: 14371, days: 30 },
  { month: 4, label: "May", ebKwh: 63340, solarKwh: 12198, days: 31 },
  { month: 5, label: "Jun", ebKwh: 54200, solarKwh: 12052, days: 30 },
  { month: 6, label: "Jul", ebKwh: 56240, solarKwh: 9362, days: 31 },
  { month: 7, label: "Aug", ebKwh: 60960, solarKwh: 10775, days: 31 },
  { month: 8, label: "Sep", ebKwh: 60000, solarKwh: 11745, days: 30 },
  { month: 9, label: "Oct", ebKwh: 65600, solarKwh: 10702, days: 31 },
  { month: 10, label: "Nov", ebKwh: 60960, solarKwh: 10612, days: 30 },
  { month: 11, label: "Dec", ebKwh: 57860, solarKwh: 10757, days: 31 },
  { month: 0, label: "Jan", ebKwh: 56760, solarKwh: 13121, days: 31 },
  { month: 1, label: "Feb", ebKwh: 63040, solarKwh: 14050, days: 28 }
];

function validateCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Latitude must be a number between -90 and 90.");
  }

  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error("Longitude must be a number between -180 and 180.");
  }

  return { lat, lon };
}

function yyyymmdd(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseDateInput(value, fallback) {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function vvceMonthForDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const month = parsed.getUTCMonth();
  return VVCE_MONTHLY_DATA.find((row) => row.month === month) || VVCE_MONTHLY_DATA[0];
}

function vvceDailyDemandForDate(date) {
  const row = vvceMonthForDate(date);
  return round(row.ebKwh / row.days);
}

function vvceDailySolarForDate(date) {
  const row = vvceMonthForDate(date);
  return round(row.solarKwh / row.days);
}

function vvceElectricalSummaryForDate(date) {
  if (!date) {
    date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }
  const row = vvceMonthForDate(date);
  const loadDemandKwh = round(row.ebKwh / row.days);
  const solarGeneratedKwh = round(row.solarKwh / row.days);
  const nominalVoltage = 433;
  const powerFactor = 0.9;
  const peakOperatingHours = 8;
  const peakPowerKw = loadDemandKwh / peakOperatingHours;
  const peakCurrent = round((peakPowerKw * 1000) / (Math.sqrt(3) * nominalVoltage * powerFactor), 2);

  return {
    source: "vvce-monthly-electrical-records",
    basisMonth: row.label,
    date,
    peakVoltage: nominalVoltage,
    peakCurrent,
    peakOperatingHours,
    solarEnergyGeneratedTodayKwh: solarGeneratedKwh,
    loadDemandTodayKwh: loadDemandKwh
  };
}

function clampNasaEnd(date) {
  const max = new Date();
  max.setUTCDate(max.getUTCDate() - 2);
  if (date > max) return max;
  return date;
}

function dateKeyFromLocalIso(value) {
  return String(value).slice(0, 10);
}

function closestPastIndex(times) {
  const now = Date.now();
  let selected = 0;

  times.forEach((time, index) => {
    const current = new Date(time).getTime();
    if (current <= now) selected = index;
  });

  return selected;
}

function estimateKwhFromIrradiance(irradianceWm2, { capacityKw, roofArea, panelEfficiency }) {
  const irradianceFactor = Math.max(0, Number(irradianceWm2) || 0) / 1000;

  if (Number(capacityKw) > 0) {
    return round(Number(capacityKw) * irradianceFactor * PERFORMANCE_RATIO);
  }

  return round(Number(roofArea) * Number(panelEfficiency || 0.1553) * irradianceFactor * PERFORMANCE_RATIO);
}

async function fetchOpenMeteoSolar(options) {
  const { lat, lon } = validateCoordinates(options.latitude, options.longitude);
  const params = {
    latitude: lat,
    longitude: lon,
    hourly: [
      "shortwave_radiation",
      "direct_radiation",
      "diffuse_radiation",
      "direct_normal_irradiance",
      "global_tilted_irradiance",
      "temperature_2m",
      "cloud_cover"
    ].join(","),
    timezone: "auto",
    past_days: 1,
    forecast_days: 2,
    tilt: Number(options.tilt) || DEFAULT_SITE.tilt,
    azimuth: Number(options.azimuth) || DEFAULT_SITE.azimuth
  };

  const response = await axios.get("https://api.open-meteo.com/v1/forecast", {
    params,
    timeout: 7000
  });
  const hourly = response.data.hourly;
  const times = hourly.time || [];
  const latestIndex = closestPastIndex(times);
  const today = dateKeyFromLocalIso(times[latestIndex] || new Date().toISOString());
  const capacityKw = Number(options.capacityKw) || 0;
  const roofArea = Number(options.roofArea) || DEFAULT_SITE.roofArea;
  const panelEfficiency = Number(options.panelEfficiency) || 0.1553;

  const points = times.map((time, index) => {
    const irradiance = hourly.global_tilted_irradiance?.[index] ?? hourly.shortwave_radiation?.[index] ?? 0;
    return {
      timestamp: time,
      irradianceWm2: round(irradiance),
      shortwaveWm2: round(hourly.shortwave_radiation?.[index] ?? 0),
      directWm2: round(hourly.direct_radiation?.[index] ?? 0),
      diffuseWm2: round(hourly.diffuse_radiation?.[index] ?? 0),
      dniWm2: round(hourly.direct_normal_irradiance?.[index] ?? 0),
      temperatureC: round(hourly.temperature_2m?.[index] ?? 0, 1),
      cloudCoverPercent: round(hourly.cloud_cover?.[index] ?? 0),
      estimatedEnergyKwh: estimateKwhFromIrradiance(irradiance, { capacityKw, roofArea, panelEfficiency })
    };
  });

  const todayPoints = points.filter((point) => dateKeyFromLocalIso(point.timestamp) === today);
  const next24 = points.slice(latestIndex, latestIndex + 24);
  const latest = points[latestIndex] || points[0];
  const dailyIrradianceKwhM2 = todayPoints.reduce((sum, point) => sum + point.irradianceWm2 / 1000, 0);
  const dailyEnergyKwh = todayPoints.reduce((sum, point) => sum + point.estimatedEnergyKwh, 0);
  const next24EnergyKwh = next24.reduce((sum, point) => sum + point.estimatedEnergyKwh, 0);

  return {
    source: "open-meteo",
    latitude: lat,
    longitude: lon,
    timezone: response.data.timezone,
    latestIndex,
    latest,
    dailyIrradianceKwhM2: round(dailyIrradianceKwhM2),
    dailyEnergyKwh: round(dailyEnergyKwh),
    next24EnergyKwh: round(next24EnergyKwh),
    hourly: points
  };
}

async function fetchNasaPowerRecent(latitude, longitude) {
  const { lat, lon } = validateCoordinates(latitude, longitude);
  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() - 2);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 30);

  const response = await axios.get("https://power.larc.nasa.gov/api/temporal/daily/point", {
    params: {
      parameters: "ALLSKY_SFC_SW_DWN",
      community: "SB",
      longitude: lon,
      latitude: lat,
      start: yyyymmdd(startDate),
      end: yyyymmdd(endDate),
      format: "JSON"
    },
    timeout: 8000
  });

  const values = response.data.properties?.parameter?.ALLSKY_SFC_SW_DWN || {};
  const validValues = Object.values(values).map(Number).filter((value) => Number.isFinite(value) && value >= 0);
  const average = validValues.length ? validValues.reduce((sum, value) => sum + value, 0) / validValues.length : 0;
  // POWER commonly represents this daily value as kWh/m2/day, but some
  // responses can be interpreted as mean W/m2. Normalize large values.
  const normalizedAverage = average > 25 ? (average * 24) / 1000 : average;

  return {
    source: "nasa-power",
    parameter: "ALLSKY_SFC_SW_DWN",
    unit: "kWh/m2/day",
    days: validValues.length,
    recentAverageDailyIrradianceKwhM2: round(normalizedAverage),
    rawAverage: round(average),
    start: yyyymmdd(startDate),
    end: yyyymmdd(endDate)
  };
}

async function fetchNasaPowerDaily(latitude, longitude, startDate, endDate) {
  const { lat, lon } = validateCoordinates(latitude, longitude);
  const response = await axios.get("https://power.larc.nasa.gov/api/temporal/daily/point", {
    params: {
      parameters: "ALLSKY_SFC_SW_DWN,T2M",
      community: "RE",
      longitude: lon,
      latitude: lat,
      start: yyyymmdd(startDate),
      end: yyyymmdd(endDate),
      format: "JSON",
      "time-standard": "LST"
    },
    timeout: 10000
  });

  const parameters = response.data.properties?.parameter || {};
  const radiation = parameters.ALLSKY_SFC_SW_DWN || {};
  const temperature = parameters.T2M || {};

  return Object.keys(radiation)
    .sort()
    .map((key) => {
      const raw = Number(radiation[key]);
      const irradiance = raw > 25 ? (raw * 24) / 1000 : raw;
      return {
        date: `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`,
        irradianceKwhM2: Number.isFinite(irradiance) && irradiance > 0
  ? round(irradiance)
  : null,
        temperatureC: round(Number(temperature[key]) || 0, 1)
      };
    })
    .filter((point) => Number.isFinite(point.irradianceKwhM2));
}

function energyFromSunHours(sunHours, options = {}) {
  const capacityKw = Number(options.capacityKw) || DEFAULT_SITE.capacityKw;
  const numberOfPanels = Number(options.numberOfPanels) || 0;
  const panelWatt = Number(options.panelWatt) || 250;
  const derivedCapacityKw = numberOfPanels > 0 ? (numberOfPanels * panelWatt) / 1000 : capacityKw;

  return round(derivedCapacityKw * sunHours * PERFORMANCE_RATIO);
}
//hereeeeeeeee
function dailyLoadForDate(date, locationType = "institutions") {
  const base = vvceDailyDemandForDate(date);

  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday

  // Weekend lower usage
  const weekendFactor = (day === 0 || day === 6) ? 0.85 : 1;

  // Random variation (±8%)
  const randomFactor = 0.92 + Math.random() * 0.16;

  // Seasonal slight variation (simulate weather impact)
  const month = d.getMonth();
  const seasonalFactor = [1.05, 1.03, 1.02, 1.0, 0.98, 0.95, 0.94, 0.96, 0.99, 1.01, 1.03, 1.04][month];

  return round(base * weekendFactor * randomFactor * seasonalFactor);
}

function summarizeEnergy(points) {
  const electricalEnergyKwh = round(points.reduce((sum, point) => sum + point.loadDemandKwh, 0));
  const solarEnergyKwh = round(points.reduce((sum, point) => sum + point.solarEnergyKwh, 0));
  const utilizedSolarKwh = round(points.reduce((sum, point) => sum + point.utilizedSolarKwh, 0));
  const solarConsumedKwh = round(points.reduce((sum, point) => sum + Math.min(point.utilizedSolarKwh, point.loadDemandKwh), 0));
  return {
    electricalEnergyKwh,
    solarEnergyKwh,
    utilizedSolarKwh,
    solarConsumedKwh,
    netGridKwh: round(Math.max(0, electricalEnergyKwh - solarConsumedKwh)),
    surplusSolarKwh: round(Math.max(0, solarEnergyKwh - solarConsumedKwh))
  };
}

async function getNasaRangeEnergy(input) {
  const now = new Date();
  const defaultEnd = clampNasaEnd(now);
  const defaultStart = new Date(defaultEnd);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 6);
  const start = parseDateInput(input.startDate, defaultStart);
  const end = clampNasaEnd(parseDateInput(input.endDate, defaultEnd));
  const locationType = input.locationType || "institutions";
  const tariff = Number(input.tariffPerKwh) || ({ house: 5.8, institutions: 6.3, industries: 7.5 }[locationType] || 6.3);
  const rows = await fetchNasaPowerDaily(input.latitude || DEFAULT_SITE.latitude, input.longitude || DEFAULT_SITE.longitude, start, end);
  const points = rows.map((row) => {
    const solarEnergyKwh = row.irradianceKwhM2
      ? energyFromSunHours(row.irradianceKwhM2, input)
      : 0;
    const loadDemandKwh = dailyLoadForDate(row.date, locationType);
    const utilizedSolarKwh = Math.min(solarEnergyKwh, loadDemandKwh);
    const solarConsumedKwh = Math.min(utilizedSolarKwh, loadDemandKwh);
    return {
      ...row,
      solarEnergyKwh,
      utilizedSolarKwh,
      loadDemandKwh,
      solarConsumedKwh,
      savingsInr: round(solarConsumedKwh * tariff),
      netEnergyKwh: round(solarEnergyKwh - loadDemandKwh)
    };
  });
  const summary = summarizeEnergy(points);

  return {
    source: "nasa-power",
    loadDemandSource: "vvce-monthly-average",
    latitude: Number(input.latitude || DEFAULT_SITE.latitude),
    longitude: Number(input.longitude || DEFAULT_SITE.longitude),
    startDate: isoDate(start),
    endDate: isoDate(end),
    locationType,
    tariffPerKwh: tariff,
    performanceRatio: PERFORMANCE_RATIO,
    utilizationFactor: UTILIZATION_FACTOR,
    summary: {
      ...summary,
      estimatedSavingsInr: round(summary.solarConsumedKwh * tariff)
    },
    points
  };
}

async function getNasaPredictiveEnergy(input) {
  const start = parseDateInput(input.startDate, new Date());
  const end = parseDateInput(input.endDate, new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000));
  const trainingEnd = clampNasaEnd(new Date());
  const trainingStart = new Date(trainingEnd);
  trainingStart.setUTCDate(trainingStart.getUTCDate() - 365);
  const history = await fetchNasaPowerDaily(input.latitude || DEFAULT_SITE.latitude, input.longitude || DEFAULT_SITE.longitude, trainingStart, trainingEnd);
  const byMonth = new Map();

  history.forEach((point) => {
    const month = point.date.slice(5, 7);
    const list = byMonth.get(month) || [];
    list.push(point.irradianceKwhM2);
    byMonth.set(month, list);
  });

  const points = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const values = byMonth.get(month) || history.map((point) => point.irradianceKwhM2);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const date = isoDate(cursor);
    const solarEnergyKwh = energyFromSunHours(average, input);
    const utilizedSolarKwh = round(solarEnergyKwh * UTILIZATION_FACTOR);
    const locationType = input.locationType || "institutions";
    const loadDemandKwh = dailyLoadForDate(date, locationType);

    points.push({
      date,
      irradianceKwhM2: round(average),
      solarEnergyKwh,
      utilizedSolarKwh,
      loadDemandKwh,
      solarConsumedKwh: Math.min(utilizedSolarKwh, loadDemandKwh),
      netEnergyKwh: round(solarEnergyKwh - loadDemandKwh)
    });
  }

  const tariff = Number(input.tariffPerKwh) || ({ house: 5.8, institutions: 6.3, industries: 7.5 }[input.locationType] || 6.3);
  const summary = summarizeEnergy(points);

  return {
    source: "nasa-power-seasonal-ai",
    solarEnergySource: "NASA POWER seasonal average by month",
    loadDemandSource: "VVCE monthly average EB demand",
    startDate: isoDate(start),
    endDate: isoDate(end),
    tariffPerKwh: tariff,
    performanceRatio: PERFORMANCE_RATIO,
    utilizationFactor: UTILIZATION_FACTOR,
    summary: {
      ...summary,
      estimatedSavingsInr: round(summary.solarConsumedKwh * tariff)
    },
    points
  };
}

async function scanBestPanelArea(input) {
  const { lat, lon } = validateCoordinates(input.latitude, input.longitude);
  const now = new Date();
  const end = clampNasaEnd(now);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  const campusRadiusKm = Math.max(0.05, Number(input.campusRadiusMeters || 500) / 1000);
  const latDelta = campusRadiusKm / 111;
  const lonDelta = campusRadiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const offsets = [-1, 0, 1];
  const candidates = [];

  for (const latMultiplier of offsets) {
    for (const lonMultiplier of offsets) {
      const candidateLat = lat + latDelta * latMultiplier;
      const candidateLon = lon + lonDelta * lonMultiplier;
      const rows = await fetchNasaPowerDaily(candidateLat, candidateLon, start, end);
      const averageSun = rows.reduce((sum, row) => sum + row.irradianceKwhM2, 0) / rows.length;
      candidates.push({
        latitude: round(candidateLat, 6),
        longitude: round(candidateLon, 6),
        averageSunHours: round(averageSun),
        estimatedDailyEnergyKwh: energyFromSunHours(averageSun, input)
      });
    }
  }

  candidates.sort((a, b) => b.averageSunHours - a.averageSunHours);
  const best = candidates[0];
  const panels = Number(input.numberOfPanels) || 0;
  const requiredBuildings = Number(input.requiredBuildings) || 0;
  const averageConsumptionKwh = Number(input.averageBuildingConsumptionKwh) || 30;
  const buildingDemandKwh = requiredBuildings > 0 ? requiredBuildings * averageConsumptionKwh : 0;
  const panelAreaM2 = Number(input.panelAreaM2) || 1.65;
  const availableRoofAreaM2 = Number(input.availableRoofAreaM2) || 0;
  const requiredPanelAreaM2 = round(panels * panelAreaM2);
  const areaWarning = availableRoofAreaM2 > 0 && requiredPanelAreaM2 > availableRoofAreaM2
    ? `Warning: panel area ${requiredPanelAreaM2} m2 exceeds available roof area ${availableRoofAreaM2} m2.`
    : null;

  return {
    source: "nasa-power-grid-scan",
    scannedArea: "3x3 coordinate grid around selected site",
    campusCenter: { latitude: lat, longitude: lon },
    campusRadiusMeters: Math.round(campusRadiusKm * 1000),
    numberOfPanels: panels,
    requiredBuildings,
    averageBuildingConsumptionKwh: averageConsumptionKwh,
    panelAreaM2,
    requiredPanelAreaM2,
    availableRoofAreaM2,
    areaWarning,
    performanceRatio: PERFORMANCE_RATIO,
    best,
    candidates,
recommendation: `Install panels inside the ${Math.round(campusRadiusKm * 1000)}m campus radius near ${best.latitude}, ${best.longitude}; this point within your campus has the highest recent NASA POWER solar resource.`,
    demandFit: requiredBuildings > 0
      ? {
          requiredDailyKwh: buildingDemandKwh,
          estimatedDailyEnergyKwh: best.estimatedDailyEnergyKwh,
          canMeetRequirement: best.estimatedDailyEnergyKwh >= buildingDemandKwh
        }
      : null
  };
}

async function getCarbonByDateRange(input) {
  const data = await getNasaRangeEnergy(input);
  const generatedEnergyKwh = data.summary.solarEnergyKwh;
  const utilizedSolarKwh = round(generatedEnergyKwh * UTILIZATION_FACTOR);
  const co2ReductionKg = utilizedSolarKwh * GRID_EMISSION_FACTOR_KG_PER_KWH;
  const carbonCredits = co2ReductionKg / 1000;
  const tariff = Number(input.tariffPerKwh) || data.tariffPerKwh || 6.3;

  return {
    ...data,
    carbon: {
      generatedEnergyKwh,
      utilizedSolarKwh,
      co2ReductionKg: round(co2ReductionKg),
      carbonCredits: round(carbonCredits, 4),
      gridSavingsInr: round(utilizedSolarKwh * tariff),
      totalRevenueInr: round(utilizedSolarKwh * tariff),
      tariffPerKwh: tariff,
      emissionFactorKgPerKwh: GRID_EMISSION_FACTOR_KG_PER_KWH,
      utilizationFactor: UTILIZATION_FACTOR,
      rule: "1000 kg CO2e reduction = 1 estimated potential carbon credit",
      usageAssumption: "85% of NASA POWER estimated solar electricity is assumed usable after mismatch and system losses",
      verificationNote: "Estimated potential carbon credits are subject to verification. Actual credits require certification under standards like Verra or Gold Standard."
    }
  };
}

async function getRealSolarAnalysis(input) {
  const capacityKw = Number(input.capacityKw) || 0;
  const openMeteo = await fetchOpenMeteoSolar({
    ...input,
    capacityKw
  });

  let nasa = null;
  try {
    nasa = await fetchNasaPowerRecent(input.latitude, input.longitude);
  } catch (error) {
    nasa = { source: "nasa-power-unavailable", warning: error.message };
  }

  // Fetch last 30 days NASA data
const end = new Date();
end.setUTCDate(end.getUTCDate() - 2);

const start = new Date(end);
start.setUTCDate(start.getUTCDate() - 30);

const nasaDaily = await fetchNasaPowerDaily(
  input.latitude,
  input.longitude,
  start,
  end
);

// Compute realistic daily energy
const dailyValues = nasaDaily.map(day => {
  const pr = 0.70 + Math.random() * 0.1; // dynamic PR (0.70–0.80)

  const energy = capacityKw * day.irradianceKwhM2 * pr;

  return energy;
});
//hereeeeeeeee
// Average daily energy
const avgDaily = dailyValues.reduce((sum, val) => sum + val, 0) / dailyValues.length;

const dailyEnergyKwh = round(avgDaily);
const monthlyEnergyKwh = round(avgDaily * 30);
const annualEnergyKwh = round(avgDaily * 365);

//till here
  return {
    source: "open-meteo+nasa-power",
    latitude: openMeteo.latitude,
    longitude: openMeteo.longitude,
    capacityKw,
    performanceRatio: PERFORMANCE_RATIO,
    currentIrradianceWm2: openMeteo.latest.irradianceWm2,
    currentTemperatureC: openMeteo.latest.temperatureC,
    currentCloudCoverPercent: openMeteo.latest.cloudCoverPercent,
    todayEstimatedEnergyKwh: openMeteo.dailyEnergyKwh,
    next24EstimatedEnergyKwh: openMeteo.next24EnergyKwh,
    //hereeee
    averageIrradiance: round(
  nasaDaily.reduce((sum, d) => sum + d.irradianceKwhM2, 0) / nasaDaily.length
),
//till here
    dailyEnergyKwh: round(dailyEnergyKwh),
    monthlyEnergyKwh: round(dailyEnergyKwh * 30),
    annualEnergyKwh: round(dailyEnergyKwh * 365),
    nasa,
    openMeteo
  };
}

function estimateVvceConsumptionKwh(timestamp) {
  const date = new Date(timestamp);
  const hour = date.getHours();
  const annualEbKwh = 718800;
  const averageHourly = annualEbKwh / 365 / 24;
  const workdayBoost = hour >= 8 && hour <= 17 ? 1.35 : 0.55;
  const eveningBoost = hour >= 18 && hour <= 21 ? 0.9 : 1;
  return round(averageHourly * workdayBoost * eveningBoost);
}

async function generateApiMonitoringSeries() {
  const solar = await fetchOpenMeteoSolar(DEFAULT_SITE);
  const start = Math.max(0, solar.latestIndex - 47);
  const hourly = solar.hourly.slice(start, solar.latestIndex + 1);
  const series = hourly.map((point) => {
    const consumption = estimateVvceConsumptionKwh(point.timestamp);
    const voltage = round(228 + Math.min(12, point.irradianceWm2 / 100), 1);
    const current = round((consumption * 1000) / voltage, 2);

    return {
      timestamp: new Date(point.timestamp).toISOString(),
      solarGeneration: point.estimatedEnergyKwh,
      consumption,
      voltage,
      current,
      netEnergy: round(point.estimatedEnergyKwh - consumption),
      irradianceWm2: point.irradianceWm2,
      cloudCoverPercent: point.cloudCoverPercent,
      temperatureC: point.temperatureC
    };
  });

  return {
    mode: "api-estimated",
    source: "Open-Meteo irradiance + VVCE load profile",
    latest: series[series.length - 1],
    series
  };
}

async function getMonitoringSeriesWithFallback() {
  try {
    return await generateApiMonitoringSeries();
  } catch (error) {
    const series = generateMonitoringSeries(48);
    return {
      mode: "fallback",
      source: `API unavailable: ${error.message}`,
      latest: series[series.length - 1],
      series
    };
  }
}

module.exports = {
  getRealSolarAnalysis,
  getMonitoringSeriesWithFallback,
  getNasaRangeEnergy,
  getNasaPredictiveEnergy,
  scanBestPanelArea,
  getCarbonByDateRange,
  vvceElectricalSummaryForDate,
  fetchOpenMeteoSolar,
  fetchNasaPowerRecent
};
