const Device = require("../models/SimulatorDevice");
const { checkMissingTelemetry } = require("./temperatureAlertService");
let timer, checking = false;
const health = { running: false, lastCheckedAt: null, lastError: null };

async function checkOnce(now = new Date()) {
  if (checking) return;
  checking = true;
  try {
    const devices = await Device.find({ "monitoring.enabled": true }).lean();
    for (const device of devices) {
      const watch = device.monitoring, config = device.snapshot.config;
      if (!config.batchId) continue;
      // Only explicitly armed virtual clocks advance with elapsed wall time.
      // The generator remains seed/tick-driven; no clock or reading is rewritten.
      const elapsed = Math.max(0, +now - +new Date(watch.anchorWallAt));
      const asOf = new Date(+new Date(watch.anchorSimulationAt) + elapsed);
      await checkMissingTelemetry(config.batchId, asOf, { deviceId: device.deviceId,
        shipmentId: config.shipmentId || "", expectedSince: watch.expectedSince });
    }
    health.lastCheckedAt = now.toISOString(); health.lastError = null;
  } catch (_) { health.lastError = "Telemetry monitor check failed; inspect MongoDB and policy/device configuration."; }
  finally { checking = false; }
  return { ...health };
}
function start() {
  if (timer) return;
  health.running = true;
  timer = setInterval(() => { checkOnce(); }, 5000); timer.unref?.();
}
function stop() { if (timer) clearInterval(timer); timer = null; health.running = false; }
module.exports = { checkOnce, start, stop, getHealth: () => ({ ...health }) };
