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
