// Ephemeral process-local bridge between the application producers and the
// currently attached field-operator WebSocket service. Persisted records remain
// authoritative; socket delivery must never make a successful write fail.
let publisher = null;

function registerPublisher(nextPublisher) {
  publisher = nextPublisher || null;
}

function unregisterPublisher(currentPublisher) {
  if (publisher === currentPublisher) publisher = null;
}

async function publishReading(shipmentId, reading, details) {
  if (!publisher) return 0;
  try { return await publisher.publishReading(shipmentId, reading, details); }
  catch (_) { return 0; }
}

function publishAlert(alert) {
  if (!publisher) return 0;
  try { return publisher.publishAlert(alert); }
  catch (_) { return 0; }
}

function publishStatusChange(shipmentId, event) {
  if (!publisher) return 0;
  try { return publisher.publishStatusChange(shipmentId, event); }
  catch (_) { return 0; }
}

module.exports = { registerPublisher, unregisterPublisher, publishReading, publishAlert, publishStatusChange };
