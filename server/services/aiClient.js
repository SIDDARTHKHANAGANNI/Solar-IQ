const axios = require("axios");
const { dummyForecast } = require("./sampleData");

const aiBaseUrl = process.env.FLASK_AI_URL || "http://127.0.0.1:5001";

async function getForecast(series, periods = 12) {
  try {
    const response = await axios.post(
      `${aiBaseUrl}/forecast`,
      { series, periods },
      { timeout: 2500 }
    );

    return {
      source: response.data.source || "flask-prophet",
      predictions: response.data.predictions
    };
  } catch (error) {
    return {
      source: "node-fallback",
      warning: `Flask AI unavailable: ${error.message}`,
      predictions: dummyForecast(
        series.map((point) => ({
          timestamp: point.ds,
          solarGeneration: point.solar,
          consumption: point.load
        })),
        periods
      )
    };
  }
}

function fallbackVvceMonthly(periods = 6) {
  const monthIndex = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11
  };
  const toUtcMonthStart = (label) => {
    const [month, year] = label.split("-");
    return new Date(Date.UTC(2000 + Number(year), monthIndex[month], 1)).toISOString();
  };
  const history = [
    ["Mar-24", 58380, 14719, 73099, 79.86429363, 20.13570637],
    ["Apr-24", 61460, 14371, 75831, 81.04864765, 18.95135235],
    ["May-24", 63340, 12198, 75538, 83.85183616, 16.14816384],
    ["Jun-24", 54200, 12052, 66252, 81.80885105, 18.19114895],
    ["Jul-24", 56240, 9362, 65602, 85.72909363, 14.27090637],
    ["Aug-24", 60960, 10775, 71735, 84.97943821, 15.02056179],
    ["Sep-24", 60000, 11745, 71745, 83.62952122, 16.37047878],
    ["Oct-24", 65600, 10702, 76302, 85.97415533, 14.02584467],
    ["Nov-24", 60960, 10612, 71572, 85.17297267, 14.82702733],
    ["Dec-24", 57860, 10757, 68617, 84.32312692, 15.67687308],
    ["Jan-25", 56760, 13121, 69881, 81.22379474, 18.77620526],
    ["Feb-25", 63040, 14050, 77090, 81.77545923, 18.22454077]
  ].map(([month, ebKwh, solarKwh, totalKwh, ebPercent, solarPercent]) => ({
    month,
    timestamp: toUtcMonthStart(month),
    ebKwh,
    solarKwh,
    totalKwh,
    ebPercent,
    solarPercent
  }));

  const ebTotal = history.reduce((sum, row) => sum + row.ebKwh, 0);
  const solarTotal = history.reduce((sum, row) => sum + row.solarKwh, 0);
  const combinedTotal = history.reduce((sum, row) => sum + row.totalKwh, 0);
  const monthNames = ["Mar-25", "Apr-25", "May-25", "Jun-25", "Jul-25", "Aug-25"];
  const ebBase = history.slice(-6).reduce((sum, row) => sum + row.ebKwh, 0) / 6;
  const solarBase = history.slice(-6).reduce((sum, row) => sum + row.solarKwh, 0) / 6;
  const predictions = monthNames.slice(0, periods).map((month, index) => {
    const solarForecastKwh = Number((solarBase * (1 + index * 0.015)).toFixed(2));
    const ebForecastKwh = Number((ebBase * (1 + index * 0.01)).toFixed(2));
    const totalForecastKwh = Number((ebForecastKwh + solarForecastKwh).toFixed(2));
    const solarPercent = Number(((solarForecastKwh / totalForecastKwh) * 100).toFixed(8));

    return {
      month,
      timestamp: toUtcMonthStart(month),
      ebForecastKwh,
      solarForecastKwh,
      totalForecastKwh,
      solarPercent,
      gridDependencyPercent: Number((100 - solarPercent).toFixed(8))
    };
  });

  return {
    source: "node-vvce-fallback",
    site: "VVCE A, B, C and D Block Solar",
    capacityKw: 170,
    history,
    summary: {
      ebTotalKwh: ebTotal,
      solarTotalKwh: solarTotal,
      combinedTotalKwh: combinedTotal,
      solarSharePercent: Number(((solarTotal / combinedTotal) * 100).toFixed(8)),
      gridDependencyPercent: Number(((ebTotal / combinedTotal) * 100).toFixed(8)),
      months: history.length
    },
    predictions
  };
}

async function getVvceMonthlyForecast(periods = 6) {
  try {
    const response = await axios.get(`${aiBaseUrl}/forecast/vvce/monthly`, {
      params: { periods },
      timeout: 4000
    });
    return response.data;
  } catch (error) {
    return {
      ...fallbackVvceMonthly(periods),
      warning: `Flask VVCE model unavailable: ${error.message}`
    };
  }
}

module.exports = { getForecast, getVvceMonthlyForecast };
