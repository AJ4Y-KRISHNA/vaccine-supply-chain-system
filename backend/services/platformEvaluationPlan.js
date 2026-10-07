// Platform smoke experiment only; not the held-out detector benchmark.
const scenarioPlan = [
  { name: "normal", profile: "NORMAL", expected: false, ticks: 4 },
  { name: "door_open", profile: "DOOR_OPEN", expected: true, ticks: 4 },
  // The injected slope is 0.18 C/min, starting near 2 C. Forty 5-second
  // samples never cross 8 C; forty 60-second samples exercise the breach.
  { name: "compressor_drift", profile: "COMPRESSOR_DRIFT", expected: true, ticks: 40, tickIntervalMs: 60000 },
  { name: "sensor_flatline", profile: "SENSOR_FLATLINE", expected: false, ticks: 4 },
  { name: "gps_jump", profile: "GPS_JUMP", expected: false, ticks: 9 },
  { name: "link_loss", profile: "LINK_LOSS", expected: false, ticks: 3 },
];

function scenarioClock(item, now = Date.now()) {
  const tickIntervalMs = item.tickIntervalMs || 5000;
  // Backfill the entire horizon, not just its first sample. Every sample must
  // remain in a closed bucket and inside the normal 24-hour ingestion limit.
  const bucketStart = Math.floor((now - item.ticks * tickIntervalMs - 300000) / 300000) * 300000;
  return { tickIntervalMs, startTime: new Date(bucketStart + 1000).toISOString(),
    maximumReadingGapMs: Math.max(60000, 2 * tickIntervalMs) };
}

module.exports = { scenarioPlan, scenarioClock };
