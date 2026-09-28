import GaugeComponent from "react-gauge-component";
import { Battery, Droplets, Thermometer } from "lucide-react";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function metricState(value, minimum, maximum) {
  if (value === null) return { label: "Waiting for sensor", color: "text-text-muted" };
  if (minimum === null || maximum === null) {
    return { label: "Policy unavailable", color: "text-text-secondary" };
  }
  if (value < minimum) return { label: "Below approved range", color: "text-warning" };
  if (value > maximum) return { label: "Above approved range", color: "text-warning" };
  return { label: "Within approved range", color: "text-primary" };
}

function GaugeCard({ label, unit, value, minimum, maximum, scaleMin, scaleMax, icon: Icon }) {
  const reading = finite(value);
  const safeMinimum = finite(minimum);
  const safeMaximum = finite(maximum);
  const hasPolicy = safeMinimum !== null && safeMaximum !== null && safeMinimum < safeMaximum;
  const status = metricState(reading, safeMinimum, safeMaximum);
  const subArcs = hasPolicy
    ? [
        ...(safeMinimum > scaleMin
          ? [{ limit: clamp(safeMinimum, scaleMin, scaleMax), color: "var(--color-danger)" }]
          : []),
        { limit: clamp(safeMaximum, scaleMin, scaleMax), color: "var(--color-primary)" },
        ...(safeMaximum < scaleMax ? [{ color: "var(--color-danger)" }] : []),
      ]
    : [{ color: "var(--color-border)" }];

  return (
    <article className="operator-panel-raised min-w-0 p-4" aria-label={`${label} gauge`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-text-secondary">
          <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">{label}</h3>
        </div>
        <span className="operator-mono text-xs text-text-muted">{unit}</span>
      </div>
      {reading === null ? (
        <div className="flex min-h-36 flex-col items-center justify-center text-center">
          <p className="operator-mono text-2xl text-text-muted">—</p>
          <p className="mt-2 text-xs text-text-muted">No sensor sample received</p>
        </div>
      ) : (
        <>
          <div className="mx-auto mt-1 h-36 max-w-[300px]" aria-hidden="true">
            <GaugeComponent
              type="semicircle"
              minValue={scaleMin}
              maxValue={scaleMax}
              value={clamp(reading, scaleMin, scaleMax)}
              arc={{ subArcs, padding: 0.015, width: 0.2 }}
              pointer={{
                color: "var(--color-text-primary)",
                animate: true,
                animationDuration: 300,
              }}
              labels={{
                valueLabel: { hide: true },
                tickLabels: { hideMinMax: true, defaultTickValueConfig: { hide: true } },
              }}
              marginInPercent={0.08}
            />
          </div>
          <div className="-mt-2 text-center">
            <p className="operator-mono text-2xl font-semibold text-text-primary">
              {reading.toFixed(1)}{" "}
              <span className="text-sm font-normal text-text-secondary">{unit}</span>
            </p>
            <p className={`mt-1 text-xs font-medium ${status.color}`}>{status.label}</p>
          </div>
        </>
      )}
      <p className="mt-3 border-t border-border/70 pt-2 text-xs text-text-muted">
        Approved range: {hasPolicy ? `${safeMinimum}–${safeMaximum} ${unit}` : "Not provided"}
      </p>
    </article>
  );
}

function BatteryCard({ value, criticalBatteryPercent }) {
  const battery = finite(value);
  const critical = finite(criticalBatteryPercent);
  const status =
    battery === null
      ? { label: "Waiting for sensor", color: "text-text-muted" }
      : critical !== null && battery <= critical
        ? { label: "Critical battery", color: "text-danger" }
        : { label: "Device battery", color: "text-primary" };

  return (
    <article className="operator-panel-raised min-w-0 p-4" aria-label="Battery level">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-text-secondary">
          <Battery aria-hidden="true" className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Battery</h3>
        </div>
        <span className="operator-mono text-xs text-text-muted">%</span>
      </div>
      {battery === null ? (
        <div className="flex min-h-36 flex-col items-center justify-center text-center">
          <p className="operator-mono text-2xl text-text-muted">—</p>
          <p className="mt-2 text-xs text-text-muted">No sensor sample received</p>
        </div>
      ) : (
        <div className="flex min-h-36 flex-col justify-center">
          <p className="operator-mono text-2xl font-semibold text-text-primary">
            {battery.toFixed(1)} <span className="text-sm font-normal text-text-secondary">%</span>
          </p>
          <div
            className="mt-4 h-2 overflow-hidden rounded-pill bg-background"
            role="meter"
            aria-label="Battery level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clamp(battery, 0, 100)}
          >
            <div
              className={`h-full rounded-pill transition-[width] duration-300 ${critical !== null && battery <= critical ? "bg-danger" : "bg-primary"}`}
              style={{ width: `${clamp(battery, 0, 100)}%` }}
            />
          </div>
          <p className={`mt-3 text-xs font-medium ${status.color}`}>{status.label}</p>
        </div>
      )}
      <p className="mt-3 border-t border-border/70 pt-2 text-xs text-text-muted">
        Critical threshold: {critical === null ? "Not provided" : `${critical}%`}
      </p>
    </article>
  );
}

export default function TelemetryGauges({ telemetry, policy }) {
  const latest = telemetry || {};
  const currentPolicy = policy || {};
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <GaugeCard
        label="Temperature"
        unit="°C"
        value={latest.temperature}
        minimum={currentPolicy.minimumTemperature}
        maximum={currentPolicy.maximumTemperature}
        scaleMin={-20}
        scaleMax={40}
        icon={Thermometer}
      />
      <GaugeCard
        label="Humidity"
        unit="% RH"
        value={latest.humidity}
        minimum={currentPolicy.minimumHumidity}
        maximum={currentPolicy.maximumHumidity}
        scaleMin={0}
        scaleMax={100}
        icon={Droplets}
      />
      <BatteryCard
        value={latest.battery}
        criticalBatteryPercent={currentPolicy.criticalBatteryPercent}
      />
    </div>
  );
}
