export const SESSION_EVENT = "vaccine:session-changed";

const SESSION_KEYS = ["role", "token", "refreshToken", "userEmail"];

// Older builds stored authentication in localStorage, which is shared by all
// tabs. Remove those legacy values once the tab loads so they cannot override
// the new per-tab session behavior. Other localStorage data (demo IDs and
// operation journals) is intentionally left alone.
for (const key of SESSION_KEYS) window.localStorage.removeItem(key);

export function clearSession() {
  for (const key of SESSION_KEYS) window.sessionStorage.removeItem(key);
  window.dispatchEvent(new Event(SESSION_EVENT));
}
export function notifySessionChanged() { window.dispatchEvent(new Event(SESSION_EVENT)); }
export function getSessionValue(key) { return window.sessionStorage.getItem(key); }
export function sessionExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now();
  } catch (_) { return true; }
}
