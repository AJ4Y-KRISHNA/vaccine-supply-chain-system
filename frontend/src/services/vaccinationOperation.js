// Persist an idempotency key before sending a vaccination. Reopening the page
// and retrying unchanged input must not debit confirmed inventory again.
export async function vaccinationOperationId(payload) {
  const key = `vaccination-operations:${sessionStorage.getItem("userEmail") || "signed-in"}`;
  if (!window.crypto?.subtle || !window.TextEncoder) throw new Error("Safe vaccination retries require a secure browser context. Open this application on localhost or HTTPS.");
  const digest = await window.crypto.subtle.digest("SHA-256", new window.TextEncoder().encode(JSON.stringify(payload)));
  // Keep only the hash, never the synthetic patient reference or notes.
  const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  let journal;
  try { journal = JSON.parse(localStorage.getItem(key) || "[]"); } catch (_error) { journal = []; }
  if (!Array.isArray(journal)) journal = [];
  const previous = journal.find(entry => entry.signature === signature);
  if (previous) return previous.id;
  const id = window.crypto?.randomUUID?.() || `vax-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem(key, JSON.stringify([...journal.slice(-99), { signature, id }])); }
  catch (_error) { throw new Error("Browser storage is unavailable. Enable local storage before recording a vaccination so interrupted requests can be retried safely."); }
  return id;
}

export function clearVaccinationOperation(operationId) {
  const key = `vaccination-operations:${sessionStorage.getItem("userEmail") || "signed-in"}`;
  try {
    const journal = JSON.parse(localStorage.getItem(key) || "[]");
    if (Array.isArray(journal)) localStorage.setItem(key, JSON.stringify(journal.filter(entry => entry.id !== operationId)));
  } catch (_error) { /* Retaining a confirmed key is safer than allowing an accidental repeat. */ }
}
