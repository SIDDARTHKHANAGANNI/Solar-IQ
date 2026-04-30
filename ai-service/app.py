import math
from pathlib import Path
from datetime import timedelta

import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS

try:
    from prophet import Prophet
except Exception:  # Prophet has compiled dependencies, so keep the API usable.
    Prophet = None


app = Flask(__name__)
CORS(app)

BASE_DIR = Path(__file__).resolve().parent
VVCE_MONTHLY_PATH = BASE_DIR / "data" / "vvce_monthly.csv"


def _round(value, digits=2):
    return round(float(value), digits)


def _normalize_series(raw_series):
    """Convert API input into Prophet-friendly ds/y columns for both targets."""
    frame = pd.DataFrame(raw_series or [])
    if frame.empty:
        raise ValueError("series must contain time-series rows")

    required = {"ds", "solar", "load"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"series missing fields: {', '.join(sorted(missing))}")

    frame["ds"] = pd.to_datetime(frame["ds"], utc=True).dt.tz_localize(None)
    frame["solar"] = pd.to_numeric(frame["solar"], errors="coerce").fillna(0)
    frame["load"] = pd.to_numeric(frame["load"], errors="coerce").fillna(0)
    return frame.sort_values("ds")


def _prophet_forecast(frame, column, periods):
    """Fit Prophet on one metric and return hourly future predictions."""
    model_frame = frame[["ds", column]].rename(columns={column: "y"})
    model = Prophet(daily_seasonality=True, weekly_seasonality=False, yearly_seasonality=False)
    model.fit(model_frame)
    future = model.make_future_dataframe(periods=periods, freq="h", include_history=False)
    forecast = model.predict(future)
    return forecast[["ds", "yhat"]]


def _prophet_monthly_forecast(frame, column, periods):
    """Fit Prophet on one monthly VVCE metric and return monthly predictions."""
    model_frame = frame[["ds", column]].rename(columns={column: "y"})
    model = Prophet(daily_seasonality=False, weekly_seasonality=False, yearly_seasonality=False)
    model.fit(model_frame)
    future = model.make_future_dataframe(periods=periods, freq="MS", include_history=False)
    forecast = model.predict(future)
    return forecast[["ds", "yhat"]]


def _fallback_forecast(frame, periods):
    """Deterministic fallback when Prophet is not installed or cannot fit."""
    last_time = frame["ds"].max()
    solar_mean = frame["solar"].tail(8).mean()
    load_mean = frame["load"].tail(8).mean()
    predictions = []

    for index in range(1, periods + 1):
        timestamp = last_time + timedelta(hours=index)
        hour = timestamp.hour + timestamp.minute / 60
        daylight = 0 if hour < 5 or hour > 19 else max(0, math.sin(((hour - 5) / 14) * math.pi))
        solar = max(0, solar_mean * 0.35 + daylight * 5.6)
        load = max(0, load_mean + (1.0 if 18 <= hour <= 23 else 0.15))
        predictions.append(
            {
                "timestamp": timestamp.isoformat(),
                "solarForecast": _round(solar),
                "loadForecast": _round(load),
                "netForecast": _round(solar - load),
            }
        )

    return predictions


def _load_vvce_monthly():
    """Load manually verified VVCE monthly EB and solar data from CSV."""
    frame = pd.read_csv(VVCE_MONTHLY_PATH)
    frame = frame[frame["Month"].str.lower() != "total"].copy()
    frame["ds"] = pd.to_datetime(frame["Month"], format="%b-%y")
    numeric_columns = ["EB_kWh", "Solar_kWh", "Total_kWh", "EB_Percent", "Solar_Percent"]
    for column in numeric_columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0)
    return frame.sort_values("ds")


def _vvce_summary(frame):
    eb_total = frame["EB_kWh"].sum()
    solar_total = frame["Solar_kWh"].sum()
    combined_total = frame["Total_kWh"].sum()
    solar_share = (solar_total / combined_total) * 100 if combined_total else 0
    grid_dependency = (eb_total / combined_total) * 100 if combined_total else 0

    return {
        "ebTotalKwh": _round(eb_total),
        "solarTotalKwh": _round(solar_total),
        "combinedTotalKwh": _round(combined_total),
        "solarSharePercent": _round(solar_share, 8),
        "gridDependencyPercent": _round(grid_dependency, 8),
        "months": int(len(frame)),
    }


def _vvce_history(frame):
    return [
        {
            "month": row.Month,
            "timestamp": row.ds.isoformat(),
            "ebKwh": _round(row.EB_kWh),
            "solarKwh": _round(row.Solar_kWh),
            "totalKwh": _round(row.Total_kWh),
            "ebPercent": _round(row.EB_Percent, 8),
            "solarPercent": _round(row.Solar_Percent, 8),
        }
        for row in frame.itertuples(index=False)
    ]


def _vvce_fallback_monthly(frame, periods):
    """Seasonal fallback when Prophet is unavailable or has too little data."""
    eb_recent = frame["EB_kWh"].tail(6).mean()
    solar_recent = frame["Solar_kWh"].tail(6).mean()
    last_time = frame["ds"].max()
    predictions = []

    for index in range(1, periods + 1):
        timestamp = last_time + pd.DateOffset(months=index)
        month = timestamp.month
        solar_season = 1.0 + (0.18 if month in [1, 2, 3, 4] else -0.12 if month in [7, 8, 9, 10] else 0.03)
        eb_season = 1.0 + (0.08 if month in [4, 5, 10] else -0.06 if month in [6, 7, 12, 1] else 0.02)
        solar = max(0, solar_recent * solar_season)
        eb = max(0, eb_recent * eb_season)
        total = eb + solar
        solar_percent = (solar / total) * 100 if total else 0

        predictions.append(
            {
                "month": timestamp.strftime("%b-%y"),
                "timestamp": timestamp.isoformat(),
                "ebForecastKwh": _round(eb),
                "solarForecastKwh": _round(solar),
                "totalForecastKwh": _round(total),
                "solarPercent": _round(solar_percent, 8),
                "gridDependencyPercent": _round(100 - solar_percent, 8),
            }
        )

    return predictions


def _vvce_prophet_monthly(frame, periods):
    eb_forecast = _prophet_monthly_forecast(frame, "EB_kWh", periods)
    solar_forecast = _prophet_monthly_forecast(frame, "Solar_kWh", periods)
    merged = eb_forecast.merge(solar_forecast, on="ds", suffixes=("Eb", "Solar"))
    predictions = []

    for row in merged.itertuples(index=False):
        eb = max(0, row.yhatEb)
        solar = max(0, row.yhatSolar)
        total = eb + solar
        solar_percent = (solar / total) * 100 if total else 0
        predictions.append(
            {
                "month": row.ds.strftime("%b-%y"),
                "timestamp": row.ds.isoformat(),
                "ebForecastKwh": _round(eb),
                "solarForecastKwh": _round(solar),
                "totalForecastKwh": _round(total),
                "solarPercent": _round(solar_percent, 8),
                "gridDependencyPercent": _round(100 - solar_percent, 8),
            }
        )

    return predictions


@app.get("/health")
def health():
    return jsonify({"status": "ok", "prophetAvailable": Prophet is not None})


@app.get("/forecast/vvce/monthly")
def vvce_monthly_forecast():
    try:
        periods = int(request.args.get("periods", 6))
        frame = _load_vvce_monthly()

        try:
            if Prophet is None or len(frame) < 12:
                raise RuntimeError("Prophet unavailable or insufficient monthly history")
            predictions = _vvce_prophet_monthly(frame, periods)
            source = "vvce-prophet"
        except Exception:
            predictions = _vvce_fallback_monthly(frame, periods)
            source = "vvce-fallback"

        return jsonify(
            {
                "source": source,
                "site": "VVCE A, B, C and D Block Solar",
                "capacityKw": 170,
                "history": _vvce_history(frame),
                "summary": _vvce_summary(frame),
                "predictions": predictions,
            }
        )
    except Exception as error:
        return jsonify({"error": str(error)}), 400


@app.post("/forecast")
def forecast():
    try:
        payload = request.get_json(force=True)
        periods = int(payload.get("periods", 12))
        frame = _normalize_series(payload.get("series"))

        if Prophet is None or len(frame) < 8:
            return jsonify({"source": "flask-fallback", "predictions": _fallback_forecast(frame, periods)})

        try:
            solar = _prophet_forecast(frame, "solar", periods)
            load = _prophet_forecast(frame, "load", periods)
            merged = solar.merge(load, on="ds", suffixes=("Solar", "Load"))
            predictions = [
                {
                    "timestamp": row.ds.isoformat(),
                    "solarForecast": _round(max(0, row.yhatSolar)),
                    "loadForecast": _round(max(0, row.yhatLoad)),
                    "netForecast": _round(max(0, row.yhatSolar) - max(0, row.yhatLoad)),
                }
                for row in merged.itertuples(index=False)
            ]
            return jsonify({"source": "flask-prophet", "predictions": predictions})
        except Exception:
            return jsonify({"source": "flask-fallback", "predictions": _fallback_forecast(frame, periods)})
    except Exception as error:
        return jsonify({"error": str(error)}), 400


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)
