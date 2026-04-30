# SolarIQ - Solar Intelligence Platform

SolarIQ is an AI-powered dashboard that analyzes solar energy generation, consumption, and efficiency for institutions , industries.etc.
It provides insights on cost savings, carbon emission reduction, and optimal energy utilization using real-time and historical data.
The system also leverages AI to predict sunlight availability and improve solar energy planning across campuses.
## Project Structure

```text
solariq/
  package.json
  .env.example
  server/
    app.js
    routes/api.js
    services/analyticsService.js
    services/aiClient.js
    services/sampleData.js
    models/Reading.js
    public/js/dashboard.js
    views/index.ejs
  ai-service/
    app.py
    requirements.txt
```

## Features

- Real-time solar generation and consumption monitoring
- Historical and live Chart.js visualizations
- Flask AI service that uses Prophet for solar/load forecasts
- Node-to-Flask REST integration with fallback data if AI is unavailable
- Latitude/longitude solar potential analysis
- Rule-based smart panel placement suggestions
- Building power estimation
- Carbon reduction, carbon credit, and value calculations
- Energy optimization recommendations
- Optional MongoDB persistence

## Run Locally

### 1. Start the Flask AI service

```bash
cd solariq/ai-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

The AI service runs on `http://127.0.0.1:5001`.

Prophet can take a little while to install. If it is missing, the Flask API still starts and uses a deterministic fallback forecaster.

### 2. Start the Node.js web app

Open a second terminal:

```bash
cd solariq
copy .env.example .env
npm install
npm run dev
```

The web app runs on `http://localhost:3000`.

### 3. Optional MongoDB

If MongoDB is running at `mongodb://127.0.0.1:27017/solariq`, readings are saved automatically. If MongoDB is unavailable, SolarIQ continues in in-memory/demo mode.

## API Endpoints

- `GET /api/monitoring` - latest generated monitoring data
- `GET /api/monitoring` now prefers Open-Meteo live irradiance for VVCE coordinates and falls back to generated data if the API is unavailable
- `POST /api/forecast` - sends time-series data to Flask AI service
- `GET /api/vvce/monthly-forecast?periods=6` - returns VVCE historical monthly EB/solar data and trained monthly forecast
- `POST /api/solar-analysis` - estimates solar potential from latitude/longitude using Open-Meteo and NASA POWER, with formula fallback
- `GET /api/nasa/monitoring` - NASA POWER date-range solar/load monitoring data
- `GET /api/nasa/predictive` - future date-range prediction using NASA POWER seasonal history
- `POST /api/panel-placement` - scans a 3x3 nearby coordinate grid using NASA POWER to recommend the highest sunlight area
- `POST /api/carbon-date-range` - calculates solar generation, CO2e reduction, carbon credits, credit value, and revenue for a date range
- `POST /api/building-estimation` - estimates buildings powered by generated energy
- `POST /api/carbon-credits` - calculates CO2 reduction and carbon credit value
- `POST /api/insights` - returns energy optimization recommendations

## Login

SolarIQ now shows `/signin` before the dashboard. Create an account at `/signup`; user records are stored locally by the Node app in `server/data/users.json`.

## Calculation Assumptions

- Solar energy uses `Energy = Capacity x Sun Hours x Performance Ratio`.
- Default performance ratio is `0.75`.
- Savings assume `85%` usable solar energy after mismatch/system losses.
- Carbon calculations use `0.65 kg CO2e/kWh`.
- `1000 kg CO2e reduction = 1 estimated potential carbon credit`.
- Actual carbon credits require certification under standards like Verra or Gold Standard.

## VVCE Training Data

The VVCE monthly dataset is stored in `ai-service/data/vvce_monthly.csv`.

- EB total: `718800 kWh`
- Solar total: `144464 kWh`
- Combined total: `863264 kWh`
- Solar share: `16.73462579%`

The Flask endpoint `GET /forecast/vvce/monthly?periods=6` trains monthly EB and solar forecasts with Prophet when available. If Prophet is unavailable, it returns a seasonal fallback forecast from the same VVCE CSV.
