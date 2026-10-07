const configuredApiBase = (import.meta.env.VITE_BACKEND_API_URL || "/api").replace(/\/$/, "");
const API_BASE_URL = configuredApiBase.endsWith("/api")
  ? configuredApiBase
  : `${configuredApiBase}/api`;

async function request(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error("Cannot reach the backend. Check that it is running and try again.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.message || payload.error || `The backend request failed (${response.status}).`,
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function signIn({ email, password, role }) {
  const result = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: email.trim(), password, role }),
  });
  if (!result.token) throw new Error("The backend did not return an access token.");
  return result;
}

export async function listInTransitShipments(token, { signal } = {}) {
  const result = await request("/live-shipments?limit=100", { token, signal });
  const shipments = Array.isArray(result) ? result : result.shipments;
  if (!Array.isArray(shipments))
    throw new Error("The backend returned an unexpected shipment list.");
  return shipments.filter((shipment) =>
    String(shipment.status || "")
      .toLowerCase()
      .includes("transit"),
  );
}

/**
 * The simulator status route is intentionally restricted by the backend to
 * admin/manufacturer identities. Its persisted device config is the current
 * authoritative source for the synthetic GPS polyline.
 */
export async function getSimulatorRoutes(token, { signal } = {}) {
  const result = await request("/simulator/status", { token, signal });
  if (!Array.isArray(result.simulations)) {
    throw new Error("The backend returned an unexpected simulator status.");
  }
  return result.simulations;
}

/** Load all persisted readings using the backend's keyset cursor; no client-side history cap. */
export async function getShipmentTemperatureHistory(token, shipmentId, { signal, pageSize = 500 } = {}) {
  const safeShipmentId = String(shipmentId || "").trim();
  if (!safeShipmentId) throw new Error("Select a shipment before loading its sensor history.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("History page size must be between 1 and 1000.");
  }
  const records = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) params.set("cursor", cursor);
    const result = await request(
      `/live-shipments/${encodeURIComponent(safeShipmentId)}/temperature-history?${params}`,
      { token, signal },
    );
    if (!Array.isArray(result.records)) throw new Error("The backend returned an unexpected sensor-history page.");
    records.push(...result.records.map((record) => ({
      readingId: record.readingId || null,
      sequenceNumber: record.sequenceNumber ?? null,
      temperature: record.temperature ?? null,
      humidity: record.humidity ?? null,
      battery: record.batteryLevel ?? null,
      speed: null,
      gpsLat: record.location?.lat ?? null,
      gpsLng: record.location?.lng ?? null,
      vehicleId: record.vehicleId || null,
      deviceId: record.deviceId || null,
      source: record.source || "unknown",
      simulationClock: record.recordedAt || null,
      status: record.status || null,
    })));
    cursor = result.hasMore ? result.nextCursor : null;
    if (result.hasMore && !cursor) throw new Error("The backend omitted the next sensor-history cursor.");
  } while (cursor && !signal?.aborted);
  return records;
}

export async function submitManualReading(token, reading) {
  return request("/readings/manual", { token, method: "POST", body: JSON.stringify(reading) });
}
