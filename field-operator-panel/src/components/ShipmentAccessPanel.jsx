import React, { useCallback, useEffect, useState } from "react";
import { LogOut, RefreshCw, ShieldCheck, Truck, Wifi } from "lucide-react";
import { listInTransitShipments, signIn } from "../services/fieldOperatorApi.js";
import { useFieldOperatorStore } from "../stores/fieldOperatorStore.js";

const ROLES = [
  ["admin", "Admin"],
  ["manufacturer", "Manufacturer"],
  ["distributor", "Distributor"],
  ["healthcare", "Healthcare professional"],
];

function updateShipmentUrl(shipmentId, { replace = false } = {}) {
  const url = new URL(window.location.href);
  if (shipmentId) url.searchParams.set("shipmentId", shipmentId);
  else url.searchParams.delete("shipmentId");
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

function shipmentLabel(shipment) {
  return [shipment.shipmentId, shipment.destination, shipment.batchId].filter(Boolean).join(" · ");
}

export default function ShipmentAccessPanel() {
  const accessToken = useFieldOperatorStore((state) => state.accessToken);
  const identity = useFieldOperatorStore((state) => state.identity);
  const role = useFieldOperatorStore((state) => state.role);
  const shipments = useFieldOperatorStore((state) => state.shipments);
  const shipmentLoadStatus = useFieldOperatorStore((state) => state.shipmentLoadStatus);
  const shipmentLoadError = useFieldOperatorStore((state) => state.shipmentLoadError);
  const selectedShipmentId = useFieldOperatorStore((state) => state.selectedShipmentId);
  const setSession = useFieldOperatorStore((state) => state.setSession);
  const clearSession = useFieldOperatorStore((state) => state.clearSession);
  const setShipmentsLoading = useFieldOperatorStore((state) => state.setShipmentsLoading);
  const setShipments = useFieldOperatorStore((state) => state.setShipments);
  const setShipmentsError = useFieldOperatorStore((state) => state.setShipmentsError);
  const setShipmentId = useFieldOperatorStore((state) => state.setShipmentId);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginRole, setLoginRole] = useState("manufacturer");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const refreshShipments = useCallback(
    async (signal) => {
      if (!accessToken) return;
      setShipmentsLoading();
      try {
        const available = await listInTransitShipments(accessToken, { signal });
        if (!signal?.aborted) setShipments(available);
      } catch (error) {
        if (signal?.aborted) return;
        if (error.status === 401) {
          clearSession();
          setLoginError("Your session expired. Sign in again to load shipments.");
          return;
        }
        setShipmentsError(error.message || "Shipment data could not be loaded.");
      }
    },
    [accessToken, clearSession, setShipments, setShipmentsError, setShipmentsLoading],
  );

  useEffect(() => {
    if (!accessToken) return undefined;
    const controller = new AbortController();
    refreshShipments(controller.signal);
    return () => controller.abort();
  }, [accessToken, refreshShipments]);

  useEffect(() => {
    const syncFromUrl = () => {
      setShipmentId(new URLSearchParams(window.location.search).get("shipmentId")?.trim() || "");
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [setShipmentId]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError("");
    setLoginBusy(true);
    try {
      const result = await signIn({ email, password, role: loginRole });
      setSession({
        token: result.token,
        identity: result.identity,
        role: result.role || loginRole,
      });
      setPassword("");
    } catch (error) {
      setLoginError(
        error.message || "Sign-in failed. Check your credentials and backend connection.",
      );
    } finally {
      setLoginBusy(false);
    }
  };

  const handleShipmentChange = (event) => {
    const shipmentId = event.target.value;
    updateShipmentUrl(shipmentId);
    setShipmentId(shipmentId);
  };

  const selectionUnavailable =
    selectedShipmentId &&
    shipmentLoadStatus === "ready" &&
    !shipments.some((shipment) => shipment.shipmentId === selectedShipmentId);

  return (
    <section
      className="operator-panel-surface mb-6 p-4 sm:p-5"
      aria-labelledby="shipment-access-title"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary">
            {accessToken ? (
              <Truck aria-hidden="true" className="h-4 w-4" />
            ) : (
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            )}
            <h2 id="shipment-access-title" className="text-sm font-semibold text-text-primary">
              {accessToken ? "Select an in-transit shipment" : "Sign in to load shipments"}
            </h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            Authenticated access is scoped by your backend role. Synthetic demo data only.
          </p>
        </div>

        {accessToken ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-3xl lg:items-center">
            <label className="sr-only" htmlFor="shipment-picker">
              In-transit shipment
            </label>
            <select
              id="shipment-picker"
              className="min-h-11 min-w-0 flex-1 rounded-input border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-primary"
              value={selectedShipmentId}
              onChange={handleShipmentChange}
              disabled={shipmentLoadStatus === "loading"}
            >
              <option value="">
                {shipmentLoadStatus === "loading" ? "Loading shipments…" : "Choose shipment"}
              </option>
              {shipments.map((shipment) => (
                <option key={shipment.shipmentId} value={shipment.shipmentId}>
                  {shipmentLabel(shipment)}
                </option>
              ))}
            </select>
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-input border border-border px-3 py-2 text-sm text-text-secondary transition hover:border-primary/50 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={() => refreshShipments()}
              disabled={shipmentLoadStatus === "loading"}
            >
              <RefreshCw
                aria-hidden="true"
                className={`h-4 w-4 ${shipmentLoadStatus === "loading" ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-input border border-danger/40 px-3 py-2 text-sm text-danger transition hover:bg-danger/10"
              type="button"
              onClick={clearSession}
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              Sign out
            </button>
          </div>
        ) : (
          <form
            className="grid w-full gap-2 sm:grid-cols-2 lg:max-w-3xl lg:grid-cols-4"
            onSubmit={handleLogin}
          >
            <label className="sr-only" htmlFor="operator-email">
              Account email
            </label>
            <input
              id="operator-email"
              className="min-h-11 rounded-input border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary"
              autoComplete="username"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Account email"
              required
            />
            <label className="sr-only" htmlFor="operator-password">
              Password
            </label>
            <input
              id="operator-password"
              className="min-h-11 rounded-input border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              required
            />
            <label className="sr-only" htmlFor="operator-role">
              Account role
            </label>
            <select
              id="operator-role"
              className="min-h-11 rounded-input border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-primary"
              value={loginRole}
              onChange={(event) => setLoginRole(event.target.value)}
            >
              {ROLES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-input bg-primary px-4 py-2 text-sm font-semibold text-background transition hover:bg-primary-dark disabled:cursor-wait disabled:opacity-60"
              type="submit"
              disabled={loginBusy}
            >
              <Wifi aria-hidden="true" className="h-4 w-4" />
              {loginBusy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
      </div>

      {accessToken && identity?.email && (
        <p className="mt-3 text-xs text-text-muted">
          Signed in as {identity.email} ({role || "user"}). Session credentials are kept in this tab
          only.
        </p>
      )}
      {!accessToken && (
        <p className="mt-3 text-xs text-text-muted">
          The password is sent to the backend for sign-in and is not persisted by this panel.
        </p>
      )}

      {loginError && (
        <p
          className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {loginError}
        </p>
      )}
      {shipmentLoadError && (
        <p
          className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {shipmentLoadError}
        </p>
      )}
      {accessToken && shipmentLoadStatus === "ready" && shipments.length === 0 && (
        <p
          className="mt-3 rounded-input border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning"
          role="status"
        >
          No in-transit shipments are available to this account. Other shipment statuses are not
          shown in this picker.
        </p>
      )}
      {selectionUnavailable && (
        <p
          className="mt-3 rounded-input border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning"
          role="status"
        >
          Shipment “{selectedShipmentId}” is not in the accessible in-transit list for this account.
          Choose an available shipment to connect.
        </p>
      )}
      {accessToken &&
        selectedShipmentId &&
        !selectionUnavailable &&
        shipmentLoadStatus === "ready" && (
          <p className="mt-3 text-xs text-text-muted" role="status">
            Shipment selection is in the URL and ready for the live connection.
          </p>
        )}
    </section>
  );
}

export { updateShipmentUrl };
