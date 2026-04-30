let monitoringChart;
let forecastChart;
let latestPredictiveData = null;
let latestMonitoringData = null;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

function toQuery(form) {
  const params = new URLSearchParams(new FormData(form));
  return params.toString();
}

function inclusiveDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function defaultPastRange(days = 7) {
  const end = new Date();
  end.setDate(end.getDate() - 2);
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function defaultFutureRange(days = 7) {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + days - 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return response.json();
}

const chartTextColor = "#cbd5e1";
const chartGridColor = "rgba(148,163,184,0.18)";

function chartBaseOptions(yTitle) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom", labels: { color: chartTextColor } } },
    scales: {
      x: { ticks: { color: chartTextColor }, grid: { color: chartGridColor } },
      y: { ticks: { color: chartTextColor }, grid: { color: chartGridColor }, title: { display: true, text: yTitle, color: chartTextColor } }
    }
  };
}

function renderEnergyChart(canvasId, chartRef, points) {
  const canvas = byId(canvasId);
  if (!canvas) return chartRef;

  if (chartRef) chartRef.destroy();
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((point) => point.date),
      datasets: [
        { label: "Solar Energy kWh", data: points.map((point) => point.solarEnergyKwh), borderColor: "#22d3ee", backgroundColor: "rgba(34,211,238,0.14)", tension: 0.3, fill: true },
        { label: "Load Demand kWh", data: points.map((point) => point.loadDemandKwh), borderColor: "#fb7185", backgroundColor: "rgba(251,113,133,0.1)", tension: 0.3, fill: true },
        { label: "Net Energy kWh", data: points.map((point) => point.netEnergyKwh), borderColor: "#a855f7", backgroundColor: "rgba(168,85,247,0.1)", tension: 0.3, fill: true, borderWidth: 2, pointRadius: 4 }
      ]
    },
    options: chartBaseOptions("kWh")
  });
}

async function updateTodaySummary() {
  const data = await fetch("/api/vvce/today-summary").then((response) => response.json());
  setText("peakCurrent", `${data.peakCurrent} A`);
  setText("peakVoltage", `${data.peakVoltage} V`);
  setText("todaySolar", `${data.solarEnergyGeneratedTodayKwh} kWh`);
  setText("todayLoad", `${data.loadDemandTodayKwh} kWh`);
  setText("todayBasis", `Based on ${data.basisMonth} monthly records; current derived over ${data.peakOperatingHours} peak hours`);
}

async function loadMonitoringRange(form) {
  const data = await fetch(`/api/nasa/monitoring?${toQuery(form)}`).then((response) => response.json());
  if (data.error) throw new Error(data.error);
  setText("dataMode", data.source);
  monitoringChart = renderEnergyChart("monitoringChart", monitoringChart, data.points);
  setText("solarMetric", `${data.summary.solarEnergyKwh} kWh`);
  setText("loadMetric", `${data.summary.electricalEnergyKwh} kWh`);
  setText("netMetric", `${data.summary.solarConsumedKwh} kWh`);
  const days = inclusiveDays(data.startDate, data.endDate);
  setText("monitoringSavings", `Yayyy! You saved ${rupees.format(data.summary.estimatedSavingsInr)} in ${days} days using 85% solar utilization.`);
  latestMonitoringData = data;
  checkEnergyExcessNotification(data.points, false);
  await updateTodaySummary();
}

async function loadPredictiveRange(form) {
  const selected = byId("predictiveAnalysisForm")?.locationType?.value || "institutions";
  const params = new URLSearchParams(new FormData(form));
  params.set("locationType", selected);
  const tariff = { house: "5.8", institutions: "6.3", industries: "7.5" }[selected] || "6.3";
  params.set("tariffPerKwh", tariff);

  const data = await fetch(`/api/nasa/predictive?${params.toString()}`).then((response) => response.json());
  if (data.error) throw new Error(data.error);
  latestPredictiveData = data;
  setText("aiSource", data.source);
  forecastChart = renderEnergyChart("forecastChart", forecastChart, data.points);
  checkEnergyExcessNotification(data.points, true);
  updatePredictiveAnalysis();
}

function updatePredictiveAnalysis() {
  if (!latestPredictiveData) return;
  setText("paElectrical", `${latestPredictiveData.summary.electricalEnergyKwh} kWh`);
  setText("paSolarConsumed", `${latestPredictiveData.summary.solarConsumedKwh} kWh`);
  setText("paSavings", rupees.format(latestPredictiveData.summary.estimatedSavingsInr));
}

function attachHome() {
  const monitoringForm = byId("monitoringRangeForm");
  const predictiveForm = byId("predictiveRangeForm");
  if (!monitoringForm || !predictiveForm) return;

  const past = defaultPastRange(7);
  monitoringForm.startDate.value = past.start;
  monitoringForm.endDate.value = past.end;
  const future = defaultFutureRange(7);
  predictiveForm.startDate.value = future.start;
  predictiveForm.endDate.value = future.end;

  monitoringForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadMonitoringRange(monitoringForm);
  });
  predictiveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadPredictiveRange(predictiveForm);
  });
  byId("predictiveAnalysisForm")?.locationType?.addEventListener("change", () => loadPredictiveRange(predictiveForm));

  loadMonitoringRange(monitoringForm).catch(console.error);
  loadPredictiveRange(predictiveForm).catch(console.error);
}

function attachAiEnergy() {
  const form = byId("aiEnergyForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    const result = await postJson("/api/solar-analysis", payload);
    byId("aiEnergyResult").innerHTML = `
      <h2 class="text-lg font-bold text-cyan-300">NASA POWER Result</h2>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <p><strong>Source:</strong> ${result.source}</p>
        <p><strong>Formula:</strong> Energy = Capacity x Sun Hours x PR</p>
        <p><strong>Capacity:</strong> ${result.capacityKw} kW</p>
        <p><strong>Sun hours used:</strong> ${result.averageSunHours}</p>
        <p><strong>Performance ratio:</strong> ${result.performanceRatio}</p>
        <p><strong>Daily estimate:</strong> ${result.dailyEnergyKwh} kWh</p>
        <p><strong>Monthly estimate:</strong> ${result.monthlyEnergyKwh} kWh</p>
        <p><strong>Annual estimate:</strong> ${result.annualEnergyKwh} kWh</p>
      </div>
    `;
  });
}

function attachPlanning() {
  const form = byId("placementForm");
  if (!form) return;
  setupCampusMap(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    byId("placementResult").textContent = "Scanning nearby NASA POWER coordinate grid...";
    const payload = Object.fromEntries(new FormData(form).entries());
    const result = await postJson("/api/panel-placement", payload);
    if (result.error) {
      byId("placementResult").innerHTML = `<p class="font-bold text-rose-300">${result.error}</p>`;
      return;
    }
    const fit = result.demandFit
      ? `<p><strong>Building demand:</strong> ${result.requiredBuildings} buildings x ${result.averageBuildingConsumptionKwh} kWh/day = ${result.demandFit.requiredDailyKwh} kWh/day | ${result.demandFit.canMeetRequirement ? "Can meet" : "Cannot fully meet"} requirement</p>`
      : "";
    const warning = result.areaWarning ? `<p class="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3 font-bold text-amber-200">${result.areaWarning}</p>` : "";
    byId("placementResult").innerHTML = `
      <h2 class="text-lg font-bold text-cyan-300">Best Sunlight Area</h2>
      <div class="mt-4 grid gap-3">
        <p><strong>API source:</strong> ${result.source}</p>
        <p><strong>Formula:</strong> Energy = Capacity x Sun Hours x PR (${result.performanceRatio})</p>
        <p><strong>Best coordinates:</strong> ${result.best.latitude}, ${result.best.longitude}</p>
        <p><strong>Campus radius:</strong> ${result.campusRadiusMeters} m from selected campus center</p>
        <p><strong>Panel area required:</strong> ${result.requiredPanelAreaM2} m2 | <strong>Available roof:</strong> ${result.availableRoofAreaM2 || "--"} m2</p>
        ${warning}
        <p><strong>Average sunlight:</strong> ${result.best.averageSunHours} kWh/m2/day</p>
        <p><strong>Estimated daily generation:</strong> ${result.best.estimatedDailyEnergyKwh} kWh</p>
        ${fit}
        <p>${result.recommendation}</p>
      </div>
    `;
  });
}

function setupCampusMap(form) {
  const mapElement = byId("campusMap");
  const googleLink = byId("googleMapsLink");
  if (!mapElement) return;

  const latInput = form.latitude;
  const lonInput = form.longitude;
  const radiusInput = form.campusRadiusMeters;

  function syncMap() {
    const lat = Number(latInput.value);
    const lon = Number(lonInput.value);
    const radius = Number(radiusInput.value) || 500;
    const query = `${lat},${lon}`;
    mapElement.src = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=17&output=embed`;
    if (googleLink) {
      googleLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
      googleLink.textContent = `Open selected campus in Google Maps (${radius} m radius)`;
    }
  }

  [latInput, lonInput, radiusInput].forEach((input) => input.addEventListener("input", syncMap));
  syncMap();
}

function attachCarbon() {
  const form = byId("carbonForm");
  if (!form) return;

  const range = defaultPastRange(30);
  form.startDate.value = range.start;
  form.endDate.value = range.end;

  async function calculate() {
    const payload = Object.fromEntries(new FormData(form).entries());
    const result = await postJson("/api/carbon-date-range", payload);
    if (result.error) throw new Error(result.error);
    setText("carbonSolar", `${result.carbon.generatedEnergyKwh} kWh`);
    setText("carbonCo2", `${result.carbon.co2ReductionKg} kg`);
    setText("carbonCredits", result.carbon.carbonCredits);
    setText("carbonUtilized", `${result.carbon.utilizedSolarKwh} kWh`);
    setText("amountSaved", `${rupees.format(result.carbon.totalRevenueInr)} | ${result.carbon.usageAssumption}`);
    setText("carbonNote", `${result.carbon.rule}. ${result.carbon.verificationNote}`);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await calculate();
  });
  calculate().catch(console.error);
}

function checkEnergyExcessNotification(points, isForecast = false) {
  const notificationText = isForecast ? byId("forecastNotificationText") : byId("energyNotificationText");
  if (!notificationText) return;

  if (!points || points.length < 3) {
    notificationText.textContent = "Select a date range with at least 3 days to see notifications.";
    return;
  }

  // Get net energy values from the last few points
  const netEnergies = points.slice(-5).map((p) => p.netEnergyKwh || 0);
  
  // Check if net energy is increasing for 3+ consecutive days
  let increasingCount = 0;
  for (let i = 1; i < netEnergies.length; i++) {
    if (netEnergies[i] > netEnergies[i - 1]) {
      increasingCount++;
    }
  }

  // Check if there's excess energy (positive net energy)
  const recentNetEnergy = netEnergies[netEnergies.length - 1];
  const avgNetEnergy = netEnergies.reduce((a, b) => a + b, 0) / netEnergies.length;
  const hasExcessEnergy = recentNetEnergy > 0 || avgNetEnergy > 0;

  // Show message
  if (increasingCount >= 2 && hasExcessEnergy) {
    const excessKwh = Math.max(recentNetEnergy, avgNetEnergy);
    notificationText.textContent = `Net energy increasing (${increasingCount} consecutive). Excess: ${Math.round(excessKwh)} kWh. Consider: Charge heavy machines / Transfer to grid / Store in batteries`;
  } else if (recentNetEnergy < 0 && Math.abs(recentNetEnergy) > avgNetEnergy) {
    notificationText.textContent = `Net energy deficit: ${Math.round(recentNetEnergy)} kWh. Consider reducing load or drawing from grid.`;
  } else {
    notificationText.textContent = "Energy flow is balanced. No action needed.";
  }
}

function boot() {
  attachHome();
  attachAiEnergy();
  attachPlanning();
  attachCarbon();
}

boot();
