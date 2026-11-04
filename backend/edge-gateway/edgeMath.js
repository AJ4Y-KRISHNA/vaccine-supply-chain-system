const DEFAULTS = Object.freeze({ alpha: 0.3, windowSeconds: 1800, windowSize: 10, minimumTemperature: 2, maximumTemperature: 8 });

function gpsPlausibility(reading, previous, timestamp, maxSpeedKmh) {
  const valid = row => [row.latitude, row.longitude].every(v => typeof v === "number" && Number.isFinite(v)) && Math.abs(row.latitude) <= 90 && Math.abs(row.longitude) <= 180;
  const elapsed = (timestamp - previous.timestamp) / 1000;
  if (!valid(reading) || !valid(previous) || !(elapsed > 0)) return { flagged: false, impliedSpeedKmh: null, maxSpeedKmh,
    reason: "GPS speed needs two valid fixes with strictly increasing timestamps." };
  const rad = x => x * Math.PI / 180;
  const h = Math.sin(rad(reading.latitude - previous.latitude) / 2) ** 2 +
    Math.cos(rad(previous.latitude)) * Math.cos(rad(reading.latitude)) * Math.sin(rad(reading.longitude - previous.longitude) / 2) ** 2;
  const speed = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3600 / elapsed;
  return { flagged: speed > maxSpeedKmh, impliedSpeedKmh: speed, maxSpeedKmh,
    reason: `GPS implies ${speed.toFixed(2)} km/h between consecutive fixes; ${speed > maxSpeedKmh ? "exceeds" : "within"} the physical ${maxSpeedKmh} km/h limit.` };
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function evaluateEdgeReading(reading, previous = {}, options = {}) {
  // Simulator math receives raw latitude/longitude; authenticated deployed
  // ingestion uses the shared canonical location.lat/location.lng schema.
  reading = { ...reading, latitude: reading.latitude ?? reading.location?.lat,
    longitude: reading.longitude ?? reading.location?.lng };
  const temperature = finite(reading.temperature, "temperature");
  const timestamp = new Date(reading.recordedAt || reading.timestamp || Date.now()).getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError("timestamp must be valid");
  const alpha = Number(options.alpha ?? DEFAULTS.alpha);
  const windowSize = Number(options.windowSize ?? DEFAULTS.windowSize);
  if (!(alpha > 0 && alpha <= 1) || !Number.isInteger(windowSize) || windowSize < 2) throw new TypeError("Invalid edge math configuration");

  const windowSeconds = Number(options.windowSeconds ?? DEFAULTS.windowSeconds);
  const maxSpeedKmh = Number(options.maxSpeedKmh ?? process.env.MAX_SPEED_KMH ?? 120);
  if (!(windowSeconds > 0) || !Number.isFinite(windowSeconds) || !(maxSpeedKmh > 0) || !Number.isFinite(maxSpeedKmh)) throw new TypeError("Invalid edge time/speed configuration");
  const points = (previous.points || []).filter(p => p.timestamp < timestamp && timestamp - p.timestamp <= windowSeconds * 1000);
  // Compatibility for a pre-migration spool state; new states use timed points.
  const history = Array.isArray(previous.points) ? points.map(p => p.temperature) : (previous.temperatures || []).slice(-windowSize);
  const mean = history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : temperature;
  const variance = history.length ? history.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / history.length : 0;
  const zScore = variance > 0 ? (temperature - mean) / Math.sqrt(variance) : 0;
  const elapsedSeconds = previous.timestamp !== undefined && timestamp > previous.timestamp ? (timestamp - previous.timestamp) / 1000 : null;
  const rateOfChange = elapsedSeconds === null ? 0 : (temperature - previous.temperature) / elapsedSeconds;
  const timedAlpha = elapsedSeconds === null ? alpha : 1 - ((1 - alpha) ** (elapsedSeconds / 60));
  const ewma = previous.ewma === undefined ? temperature : timedAlpha * temperature + (1 - timedAlpha) * previous.ewma;
  const ratePoints = [...points, { temperature, timestamp }];
  const recent = ratePoints.filter(p => timestamp - p.timestamp < 60000);
  const older = ratePoints.filter(p => timestamp - p.timestamp >= 60000 && timestamp - p.timestamp < 120000);
  const avg = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  const rateCPerMinute = older.length ? (avg(recent, "temperature") - avg(older, "temperature")) /
    ((avg(recent, "timestamp") - avg(older, "timestamp")) / 60000) : 0;
  const gps = gpsPlausibility(reading, previous, timestamp, maxSpeedKmh);
  const flatlineSince = previous.temperature === temperature ? previous.flatlineSince ?? previous.timestamp : timestamp;
  const minimumTemperature = Number(options.minimumTemperature ?? DEFAULTS.minimumTemperature);
  const maximumTemperature = Number(options.maximumTemperature ?? DEFAULTS.maximumTemperature);
  const outOfRange = temperature < minimumTemperature || temperature > maximumTemperature;
  const localAlert = outOfRange ? {
    active: true,
    code: temperature < minimumTemperature ? "TEMPERATURE_BELOW_LOCAL_LIMIT" : "TEMPERATURE_ABOVE_LOCAL_LIMIT",
    reason: `Temperature ${temperature.toFixed(2)}°C is outside the local ${minimumTemperature}–${maximumTemperature}°C threshold.`,
  } : { active: false, code: null, reason: null };

  return {
    edge: { ewma: Number(ewma.toFixed(4)), rollingZScore: Number(zScore.toFixed(4)),
      rateOfChange: Number(rateOfChange.toFixed(4)), rateCPerMinute, gpsPlausibility: gps,
      flatlineSeconds: Math.max(0, (timestamp - flatlineSince) / 1000), localAlert,
      ruleProfile: "deployed-local-policy-plus-physical-gps; statistical hysteresis is evaluation-only" },
    state: { ewma, temperature, timestamp, latitude: reading.latitude, longitude: reading.longitude,
      flatlineSince, points: ratePoints, temperatures: [...history, temperature].slice(-windowSize) },
  };
}

module.exports = { evaluateEdgeReading, DEFAULTS };
