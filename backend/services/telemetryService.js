const TemperatureLog = require("../models/TemperatureLog");
const { processSimulatedTemperatureReading, checkMissingTelemetry } = require("./temperatureAlertService");

async function persistTemperatureLogs(logs) {
  const docs = await TemperatureLog.insertMany(logs);
  for (const log of docs) {
    const detection = await processSimulatedTemperatureReading({
      batchId: log.batchId, shipmentId: log.shipmentId, deviceId: log.deviceId || log.sensorId,
      vehicleId: log.vehicleId, temperature: log.temperature, humidity: log.humidity,
      batteryLevel: log.batteryLevel, latitude: log.location?.lat, longitude: log.location?.lng,
      timestamp: log.recordedAt, simulation: log.simulation,
    }, log._id);
    const status = detection.evaluated ? (detection.severity !== "NORMAL" ? "Alert" : "Normal") : (log.status || "Normal");
    await TemperatureLog.updateOne({ _id: log._id }, { $set: { status, evaluation: detection } });
    log.status = status;
    log.evaluation = detection;
    if (detection.evaluated) await checkMissingTelemetry(log.batchId, log.recordedAt);
  }
  return docs;
}

function simulationReadingToTemperatureLog(reading) {
  return {
    shipmentId: reading.shipmentId || "",
    batchId: reading.batchId || "",
    sensorId: reading.deviceId,
    deviceId: reading.deviceId,
    vehicleId: reading.vehicleId || "",
    temperature: reading.temperature,
    humidity: reading.humidity,
    batteryLevel: reading.batteryLevel,
    recordedAt: new Date(reading.timestamp),
    location: {
      lat: reading.latitude,
      lng: reading.longitude,
    },
    simulation: reading.simulation,
  };
}

async function persistSimulationReading(reading) {
  const [log] = await persistTemperatureLogs([simulationReadingToTemperatureLog(reading)]);
  return log;
}

module.exports = {
  persistTemperatureLogs,
  simulationReadingToTemperatureLog,
  persistSimulationReading,
};
