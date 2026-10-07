import React, { useEffect, useMemo, useState } from "react";
import { LoaderCircle, RotateCcw, ShieldAlert, Wifi } from "lucide-react";
import { useFieldOperatorStore } from "../stores/fieldOperatorStore.js";

const MIN_TEMPERATURE = -20;
const MAX_TEMPERATURE = 40;
const MAX_OVERRIDE_MINUTES = 120;
const MAX_RAMP_MINUTES = 60;
const COMMAND_TIMEOUT_MS = 15000;

const temperaturePresets = [
  { label: "Refrigeration Fault", temperature: 12, behavior: "ramp", rampDuration: 2 },
  { label: "Door Left Open", temperature: 10, humidity: 85, behavior: "ramp", rampDuration: 1 },
  { label: "Freezing Risk", temperature: -2, behavior: "ramp", rampDuration: 2 },
];

const humidityPresets = [
  { label: "Low Humidity Event", humidity: 20, behavior: "hold", rampDuration: 0 },
  { label: "High Humidity", humidity: 85, behavior: "hold", rampDuration: 0 },
];

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validPolicyRange(minimum, maximum) {
  return minimum !== null && maximum !== null && minimum < maximum;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `field-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isExtreme(value, minimum, maximum) {
  if (value === null || !validPolicyRange(minimum, maximum)) return false;
  const policySpan = maximum - minimum;
  return value < minimum - 2 * policySpan || value > maximum + 2 * policySpan;
}

function formatRemaining(activeOverride, simulationClock) {
  const expiresAt = Date.parse(activeOverride?.expiresAt);
  const simulatedNow = Date.parse(simulationClock);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(simulatedNow))
    return "Waiting for simulation clock";
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - simulatedNow) / 1000));
  return `${Math.floor(remainingSeconds / 60)}m ${String(remainingSeconds % 60).padStart(2, "0")}s simulated time remaining`;
}

function PolicySlider({
  id,
  label,
  unit,
  value,
  minimum,
  maximum,
  rangeMinimum,
  rangeMaximum,
  step,
  enabled,
  onEnabledChange,
  onValueChange,
  disabled,
}) {
  const hasRange = validPolicyRange(rangeMinimum, rangeMaximum);
  const policyText = hasRange
    ? `Policy: ${rangeMinimum} to ${rangeMaximum}${unit}`
    : "Approved policy limits unavailable";
  const bandStart = hasRange
    ? clamp(((rangeMinimum - minimum) / (maximum - minimum)) * 100, 0, 100)
    : 0;
  const bandEnd = hasRange
    ? clamp(((rangeMaximum - minimum) / (maximum - minimum)) * 100, 0, 100)
    : 0;
  const bandStyle = hasRange
    ? { left: `${bandStart}%`, width: `${Math.max(0, bandEnd - bandStart)}%` }
    : undefined;

  return (
    <fieldset
      className="rounded-input border border-border bg-background/60 p-4"
      disabled={disabled}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label
          className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary"
          htmlFor={`${id}-enabled`}
        >
          <input
            id={`${id}-enabled`}
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
            className="h-4 w-4 accent-primary"
            disabled={!hasRange}
          />
          {label}
        </label>
        <span className="operator-mono text-xs text-text-secondary">{policyText}</span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-center">
        <div>
          <div className="relative mb-2 h-2 rounded-pill bg-surface-raised">
            {hasRange && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 rounded-pill bg-primary/70"
                style={bandStyle}
              />
            )}
          </div>
          <input
            aria-label={`${label} slider`}
            type="range"
            min={minimum}
            max={maximum}
            step={step}
            value={value}
            onChange={(event) => onValueChange(Number(event.target.value))}
            disabled={!enabled || !hasRange || disabled}
            className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <label className="sr-only" htmlFor={`${id}-value`}>{`${label} (${unit})`}</label>
        <input
          id={`${id}-value`}
          type="number"
          min={minimum}
          max={maximum}
          step={step}
          value={value}
          onChange={(event) => onValueChange(asFiniteNumber(event.target.value))}
          disabled={!enabled || !hasRange || disabled}
          className="min-h-10 w-full rounded-input border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {hasRange
          ? "Green band shows the approved batch policy range."
          : "This metric cannot be overridden until its approved batch policy is available."}
      </p>
    </fieldset>
  );
}

export default function ManualOverrideConsole({
  shipmentId,
  policy,
  telemetry,
  activeOverride,
  simulationClock,
  connectionStatus,
  sendCommand,
}) {
  const overrideResult = useFieldOperatorStore((state) => state.overrideResult);
  const [temperature, setTemperature] = useState(null);
  const [humidity, setHumidity] = useState(null);
  const [temperatureEnabled, setTemperatureEnabled] = useState(false);
  const [humidityEnabled, setHumidityEnabled] = useState(false);
  const [behavior, setBehavior] = useState("hold");
  const [rampDuration, setRampDuration] = useState(2);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [latitudeOffset, setLatitudeOffset] = useState(0.001);
  const [longitudeOffset, setLongitudeOffset] = useState(0.001);
  const [gpsWasApplied, setGpsWasApplied] = useState(false);
  const [gpsResetRequestId, setGpsResetRequestId] = useState(null);
  const [pendingRequest, setPendingRequest] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const temperatureMinimum = asFiniteNumber(policy?.minimumTemperature);
  const temperatureMaximum = asFiniteNumber(policy?.maximumTemperature);
  const humidityMinimum = asFiniteNumber(policy?.minimumHumidity);
  const humidityMaximum = asFiniteNumber(policy?.maximumHumidity);
  const hasTemperaturePolicy = validPolicyRange(temperatureMinimum, temperatureMaximum);
  const hasHumidityPolicy = validPolicyRange(humidityMinimum, humidityMaximum);
  const isConnected = connectionStatus === "connected";
  const temperatureValue = clamp(
    temperature ??
      asFiniteNumber(telemetry?.temperature) ??
      (hasTemperaturePolicy ? (temperatureMinimum + temperatureMaximum) / 2 : 0),
    MIN_TEMPERATURE,
    MAX_TEMPERATURE,
  );
  const humidityValue = clamp(
    humidity ??
      asFiniteNumber(telemetry?.humidity) ??
      (hasHumidityPolicy ? (humidityMinimum + humidityMaximum) / 2 : 50),
    0,
    100,
  );

  useEffect(() => {
    setTemperature(null);
    setHumidity(null);
    setTemperatureEnabled(hasTemperaturePolicy);
    setHumidityEnabled(false);
    setBehavior("hold");
    setRampDuration(2);
    setDurationMinutes(10);
    setSelectedPreset("");
    setPendingRequest(null);
    setFeedback(null);
    setGpsWasApplied(false);
    setGpsResetRequestId(null);
  }, [hasHumidityPolicy, hasTemperaturePolicy, shipmentId]);

  useEffect(() => {
    if (!pendingRequest) return undefined;
    const timeout = window.setTimeout(() => {
      setPendingRequest((current) =>
        current?.requestId === pendingRequest.requestId ? null : current,
      );
      setFeedback({
        type: "warning",
        text: "The command was sent but not confirmed. It may not have been applied; check live telemetry before trying again.",
      });
    }, COMMAND_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [pendingRequest]);

  useEffect(() => {
    if (!pendingRequest || overrideResult?.requestId !== pendingRequest.requestId) return;
    setPendingRequest(null);
    const status = String(overrideResult.status || "").toLowerCase();
    if (status === "accepted") {
      setFeedback({
        type: "success",
        text: overrideResult.message || "The server confirmed the request.",
      });
      if (pendingRequest.command === "GPS_OVERRIDE") setGpsWasApplied(true);
      if (pendingRequest.command === "RELEASE_OVERRIDE" && !gpsResetRequestId)
        setGpsWasApplied(false);
    } else {
      setFeedback({
        type: "error",
        text: overrideResult.message || overrideResult.error || "The server rejected the request.",
      });
    }
  }, [gpsResetRequestId, overrideResult, pendingRequest]);

  useEffect(() => {
    if (!gpsResetRequestId || overrideResult?.requestId !== gpsResetRequestId) return;
    setGpsResetRequestId(null);
    if (String(overrideResult.status || "").toLowerCase() === "accepted") {
      setGpsWasApplied(false);
    } else {
      setFeedback({
        type: "warning",
        text:
          overrideResult.message ||
          "Environment release was confirmed, but the GPS reset was not confirmed.",
      });
    }
  }, [gpsResetRequestId, overrideResult]);

  const activeOverrideIsRunning = useMemo(() => {
    const state = String(activeOverride?.status || "").toLowerCase();
    return Boolean(activeOverride && (state === "active" || activeOverride.mode === "manual"));
  }, [activeOverride]);

  const applyPreset = (preset) => {
    if (preset.temperature !== undefined) {
      setTemperature(preset.temperature);
      setTemperatureEnabled(true);
    }
    if (preset.humidity !== undefined) {
      setHumidity(preset.humidity);
      setHumidityEnabled(true);
    }
    setBehavior(preset.behavior);
    setRampDuration(preset.rampDuration);
    setSelectedPreset(preset.label);
    setFeedback({
      type: "info",
      text: `${preset.label} fills synthetic target values. Select Apply override to send them to the simulator.`,
    });
  };

  const send = (command, description) => {
    const requestId = createRequestId();
    const result = sendCommand({ ...command, requestId });
    if (!result?.ok) {
      setFeedback({ type: "error", text: result?.error || "The command could not be sent." });
      return null;
    }
    setPendingRequest({ requestId, command: command.type });
    setFeedback({ type: "pending", text: `${description} sent. Waiting for server confirmation.` });
    return requestId;
  };

  const handleApply = (event) => {
    event.preventDefault();
    setFeedback(null);
    const targetTemperature = temperatureEnabled ? temperatureValue : null;
    const targetHumidity = humidityEnabled ? humidityValue : null;
    if (
      (!temperatureEnabled || !hasTemperaturePolicy) &&
      (!humidityEnabled || !hasHumidityPolicy)
    ) {
      setFeedback({
        type: "error",
        text: "Select a metric with an available approved batch policy.",
      });
      return;
    }
    if (temperatureEnabled && !hasTemperaturePolicy) {
      setFeedback({
        type: "error",
        text: "Temperature policy limits are unavailable for this batch.",
      });
      return;
    }
    if (humidityEnabled && !hasHumidityPolicy) {
      setFeedback({
        type: "error",
        text: "Humidity policy limits are unavailable for this batch.",
      });
      return;
    }
    if (behavior === "ramp" && (rampDuration < 1 || rampDuration > MAX_RAMP_MINUTES)) {
      setFeedback({
        type: "error",
        text: `Ramp duration must be 1–${MAX_RAMP_MINUTES} simulated minutes.`,
      });
      return;
    }
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > MAX_OVERRIDE_MINUTES
    ) {
      setFeedback({
        type: "error",
        text: `Override duration must be 1–${MAX_OVERRIDE_MINUTES} simulated minutes.`,
      });
      return;
    }
    if (
      temperatureEnabled &&
      (targetTemperature < MIN_TEMPERATURE || targetTemperature > MAX_TEMPERATURE)
    ) {
      setFeedback({
        type: "error",
        text: `Temperature target must be ${MIN_TEMPERATURE}–${MAX_TEMPERATURE}°C.`,
      });
      return;
    }
    if (humidityEnabled && (targetHumidity < 0 || targetHumidity > 100)) {
      setFeedback({ type: "error", text: "Humidity target must be 0–100% RH." });
      return;
    }
    const extremeTemperature =
      temperatureEnabled && isExtreme(targetTemperature, temperatureMinimum, temperatureMaximum);
    const extremeHumidity =
      humidityEnabled && isExtreme(targetHumidity, humidityMinimum, humidityMaximum);
    if (
      (extremeTemperature || extremeHumidity) &&
      !window.confirm(
        "This target is more than twice the policy-range span beyond an approved limit. Continue with this synthetic demo override?",
      )
    )
      return;

    const ramp = behavior === "ramp" ? rampDuration : 0;
    const command = {
      type: "OVERRIDE",
      shipmentId,
      ...(temperatureEnabled ? { temperature: targetTemperature } : {}),
      ...(humidityEnabled ? { humidity: targetHumidity } : {}),
      behavior,
      durationMinutes,
      rampDuration: ramp,
      expiresInMs: (durationMinutes + ramp) * 60 * 1000,
      presetName: selectedPreset || undefined,
      reason: `Field operator synthetic override${selectedPreset ? `: ${selectedPreset}` : ""}`,
    };
    send(command, "Override");
  };

  const applyGps = () => {
    if (!gpsEnabled) {
      setFeedback({
        type: "error",
        text: "Turn on simulated GPS drift before applying a position.",
      });
      return;
    }
    if (Math.abs(latitudeOffset) > 0.01 || Math.abs(longitudeOffset) > 0.01) {
      setFeedback({ type: "error", text: "GPS offsets must be between −0.01 and +0.01 degrees." });
      return;
    }
    const id = send(
      { type: "GPS_OVERRIDE", latOffset: latitudeOffset, lngOffset: longitudeOffset },
      "GPS drift",
    );
    if (id) setGpsWasApplied(true);
  };

  const releaseOverrides = ({ includeGps = true } = {}) => {
    const releaseId = send({ type: "RELEASE_OVERRIDE", shipmentId }, "Release request");
    if (!releaseId || !includeGps || !gpsWasApplied) return;
    const gpsRequestId = createRequestId();
    const gpsResult = sendCommand({
      type: "GPS_OVERRIDE",
      requestId: gpsRequestId,
      shipmentId,
      latOffset: 0,
      lngOffset: 0,
    });
    if (gpsResult?.ok) setGpsResetRequestId(gpsRequestId);
    else
      setFeedback({
        type: "warning",
        text: "Environment release was sent, but the GPS reset could not be sent.",
      });
  };

  const inputDisabled = !isConnected || Boolean(pendingRequest);
  const activeSummary = activeOverrideIsRunning
    ? [
        activeOverride.targetTemperature !== undefined &&
          `Temp ${activeOverride.targetTemperature}°C`,
        activeOverride.targetHumidity !== undefined &&
          `Humidity ${activeOverride.targetHumidity}% RH`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "No server-confirmed environment override is active.";

  return (
    <section
      className="operator-panel-surface p-5 sm:p-6 xl:col-span-12"
      aria-labelledby="section-05"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-input border border-border bg-surface-raised p-2 text-primary">
              <ShieldAlert aria-hidden="true" className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="operator-mono text-xs text-text-muted">05</span>
                <h2 id="section-05" className="text-base font-semibold text-text-primary">
                  Manual Environment Control
                </h2>
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                Operator-requested environment changes
              </p>
            </div>
          </div>
        </div>
        <span
          className={`rounded-pill border px-2.5 py-1 text-xs ${isConnected ? "border-primary/30 bg-primary-glow text-primary" : "border-warning/30 bg-warning/5 text-warning"}`}
        >
          {isConnected ? "Connected to selected shipment" : "Connect to a shipment to control it"}
        </span>
      </div>

      <div
        className="mb-5 rounded-input border border-warning/30 bg-warning/5 px-4 py-3 text-xs leading-5 text-warning"
        role="note"
      >
        SIMULATOR TOOL — changes are synthetic. Readings flow through the policy engine. Not for
        clinical use.
      </div>

      <div
        className="mb-5 rounded-input border border-border bg-background/60 p-4"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Server-confirmed state
            </p>
            <p className="mt-1 text-sm font-medium text-text-primary">{activeSummary}</p>
            {activeOverrideIsRunning && (
              <p className="operator-mono mt-1 text-xs text-warning">
                {formatRemaining(activeOverride, simulationClock)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => releaseOverrides({ includeGps: true })}
            disabled={!isConnected || pendingRequest?.command === "RELEASE_OVERRIDE"}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-input border border-danger/50 px-3 py-2 text-sm font-semibold text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Release all overrides
          </button>
        </div>
      </div>

      <form onSubmit={handleApply}>
        <div className="grid gap-4 lg:grid-cols-2">
          <PolicySlider
            id="override-temperature"
            label="Temperature target"
            unit="°C"
            value={temperatureValue}
            minimum={MIN_TEMPERATURE}
            maximum={MAX_TEMPERATURE}
            rangeMinimum={temperatureMinimum}
            rangeMaximum={temperatureMaximum}
            step={0.1}
            enabled={temperatureEnabled}
            onEnabledChange={setTemperatureEnabled}
            onValueChange={(value) => {
              setTemperature(value);
              setSelectedPreset("");
            }}
            disabled={inputDisabled}
          />
          <PolicySlider
            id="override-humidity"
            label="Humidity target"
            unit="% RH"
            value={humidityValue}
            minimum={0}
            maximum={100}
            rangeMinimum={humidityMinimum}
            rangeMaximum={humidityMaximum}
            step={1}
            enabled={humidityEnabled}
            onEnabledChange={setHumidityEnabled}
            onValueChange={(value) => {
              setHumidity(value);
              setSelectedPreset("");
            }}
            disabled={inputDisabled}
          />
        </div>

        <div className="mt-4 grid gap-4 rounded-input border border-border bg-background/60 p-4 sm:grid-cols-3">
          <label className="text-xs font-medium text-text-secondary">
            Behavior
            <select
              value={behavior}
              onChange={(event) => setBehavior(event.target.value)}
              disabled={inputDisabled}
              className="mt-1 min-h-10 w-full rounded-input border border-border bg-surface-raised px-3 text-sm text-text-primary disabled:opacity-50"
            >
              <option value="hold">Hold target</option>
              <option value="ramp">Ramp to target</option>
            </select>
          </label>
          {behavior === "ramp" && (
            <label className="text-xs font-medium text-text-secondary">
              Ramp duration (simulated minutes)
              <input
                type="number"
                min="1"
                max={MAX_RAMP_MINUTES}
                step="1"
                value={rampDuration}
                onChange={(event) => setRampDuration(Number(event.target.value))}
                disabled={inputDisabled}
                className="mt-1 min-h-10 w-full rounded-input border border-border bg-surface-raised px-3 text-sm text-text-primary disabled:opacity-50"
              />
            </label>
          )}
          <label className="text-xs font-medium text-text-secondary">
            Hold override (simulated minutes, max {MAX_OVERRIDE_MINUTES})
            <input
              type="number"
              min="1"
              max={MAX_OVERRIDE_MINUTES}
              step="1"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
              disabled={inputDisabled}
              className="mt-1 min-h-10 w-full rounded-input border border-border bg-surface-raised px-3 text-sm text-text-primary disabled:opacity-50"
            />
          </label>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Synthetic scenarios
          </p>
          <div className="flex flex-wrap gap-2">
            {temperaturePresets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                disabled={
                  inputDisabled ||
                  (preset.temperature !== undefined && !hasTemperaturePolicy) ||
                  (preset.humidity !== undefined && !hasHumidityPolicy)
                }
                className={`min-h-10 rounded-input border px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${selectedPreset === preset.label ? "border-primary/60 bg-primary-glow text-primary" : "border-border text-text-secondary hover:border-primary/40 hover:text-text-primary"}`}
              >
                {preset.label}
              </button>
            ))}
            {humidityPresets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                disabled={inputDisabled || !hasHumidityPolicy}
                className={`min-h-10 rounded-input border px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${selectedPreset === preset.label ? "border-primary/60 bg-primary-glow text-primary" : "border-border text-text-secondary hover:border-primary/40 hover:text-text-primary"}`}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => releaseOverrides({ includeGps: false })}
              disabled={!isConnected || pendingRequest?.command === "RELEASE_OVERRIDE"}
              className="min-h-10 rounded-input border border-danger/40 px-3 py-2 text-xs text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Return to Auto
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-input border border-border bg-background/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label
              htmlFor="gps-drift-enabled"
              className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary"
            >
              <input
                id="gps-drift-enabled"
                type="checkbox"
                checked={gpsEnabled}
                onChange={(event) => setGpsEnabled(event.target.checked)}
                className="h-4 w-4 accent-primary"
                disabled={!isConnected || Boolean(pendingRequest)}
              />
              Simulate GPS drift
            </label>
            <span className="text-xs text-text-muted">
              Synthetic position offsets, ±0.01° maximum
            </span>
          </div>
          {gpsEnabled && (
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="text-xs font-medium text-text-secondary">
                Latitude offset (°)
                <input
                  type="number"
                  min="-0.01"
                  max="0.01"
                  step="0.0001"
                  value={latitudeOffset}
                  onChange={(event) => setLatitudeOffset(Number(event.target.value))}
                  disabled={!isConnected || Boolean(pendingRequest)}
                  className="mt-1 min-h-10 w-full rounded-input border border-border bg-surface-raised px-3 text-sm text-text-primary disabled:opacity-50"
                />
              </label>
              <label className="text-xs font-medium text-text-secondary">
                Longitude offset (°)
                <input
                  type="number"
                  min="-0.01"
                  max="0.01"
                  step="0.0001"
                  value={longitudeOffset}
                  onChange={(event) => setLongitudeOffset(Number(event.target.value))}
                  disabled={!isConnected || Boolean(pendingRequest)}
                  className="mt-1 min-h-10 w-full rounded-input border border-border bg-surface-raised px-3 text-sm text-text-primary disabled:opacity-50"
                />
              </label>
              <button
                type="button"
                onClick={applyGps}
                disabled={!isConnected || Boolean(pendingRequest)}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-input border border-accent/40 px-3 py-2 text-sm text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Wifi aria-hidden="true" className="h-4 w-4" />
                Apply GPS position
              </button>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-5 text-text-muted">
            Extreme means more than two full policy-range spans beyond a policy limit. A
            confirmation is required before sending those synthetic values.
          </p>
          <button
            type="submit"
            disabled={
              !isConnected ||
              Boolean(pendingRequest) ||
              !(
                (temperatureEnabled && hasTemperaturePolicy) ||
                (humidityEnabled && hasHumidityPolicy)
              )
            }
            className="inline-flex min-h-11 min-w-40 items-center justify-center gap-2 rounded-input bg-primary px-4 py-2 text-sm font-semibold text-background transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingRequest?.command === "OVERRIDE" ? (
              <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : null}
            {pendingRequest?.command === "OVERRIDE" ? "Sending…" : "Apply override"}
          </button>
        </div>
      </form>

      {feedback && (
        <p
          className={`mt-4 rounded-input border px-3 py-2 text-sm ${
            feedback.type === "error"
              ? "border-danger/30 bg-danger/10 text-danger"
              : feedback.type === "warning"
                ? "border-warning/30 bg-warning/5 text-warning"
                : feedback.type === "success"
                  ? "border-primary/30 bg-primary-glow text-primary"
                  : "border-border bg-background/70 text-text-secondary"
          }`}
          role={feedback.type === "error" ? "alert" : "status"}
        >
          {pendingRequest && feedback.type === "pending" && (
            <LoaderCircle aria-hidden="true" className="mr-2 inline h-4 w-4 animate-spin" />
          )}
          {feedback.text}
        </p>
      )}
    </section>
  );
}

export { isExtreme, formatRemaining };
