import {
  Activity,
  Battery,
  Bell,
  Clock3,
  Droplets,
  MapPin,
  Route,
  ShieldCheck,
  Snowflake,
  Thermometer,
  Truck,
  WifiOff,
} from "lucide-react";

const sections = [
  { number: "01", title: "Truck scene", subtitle: "Shipment and cold-chain state", icon: Truck },
  {
    number: "02",
    title: "Live readings",
    subtitle: "Temperature, humidity and device health",
    icon: Activity,
  },
  { number: "03", title: "Route map", subtitle: "Simulated GPS position and route", icon: MapPin },
  {
    number: "04",
    title: "ETA & route info",
    subtitle: "Destination, distance and delivery estimate",
    icon: Route,
  },
  {
    number: "05",
    title: "Manual override",
    subtitle: "Operator-requested environment changes",
    icon: ShieldCheck,
  },
  { number: "06", title: "Alert feed", subtitle: "Explainable cold-chain events", icon: Bell },
  {
    number: "07",
    title: "Sensor history",
    subtitle: "Temperature and humidity over time",
    icon: Activity,
  },
];

function SectionHeading({ number, title, subtitle, icon: Icon }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="mt-0.5 rounded-input border border-border bg-surface-raised p-2 text-primary">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="operator-mono text-xs text-text-muted">{number}</span>
          <h2 id={`section-${number}`} className="text-base font-semibold text-text-primary">
            {title}
          </h2>
        </div>
        <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
      </div>
      <span className="rounded-pill border border-border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted">
        Awaiting data
      </span>
    </div>
  );
}

function Placeholder({ children, className = "" }) {
  return (
    <div
      className={`flex min-h-32 flex-col items-center justify-center rounded-input border border-dashed border-border bg-background/60 px-5 py-6 text-center ${className}`}
    >
      <p className="text-sm font-medium text-text-secondary">{children}</p>
    </div>
  );
}

function ReadingTile({ label, icon: Icon, unit }) {
  return (
    <div className="operator-panel-raised p-4">
      <div className="flex items-center gap-2 text-text-secondary">
        <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
        <span className="text-sm">{label}</span>
      </div>
      <p
        className="operator-mono mt-4 text-2xl font-medium text-text-muted"
        aria-label={`${label}: no reading yet`}
      >
        — <span className="text-sm text-text-muted">{unit}</span>
      </p>
      <p className="mt-1 text-xs text-text-muted">No sensor sample received</p>
    </div>
  );
}

function RouteDatum({ label }) {
  return (
    <div className="border-b border-border/70 py-3 last:border-0">
      <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <p className="operator-mono mt-1 text-sm text-text-muted">—</p>
    </div>
  );
}

function App() {
  return (
    <div className="min-h-screen bg-background text-text-primary">
      <header className="fixed inset-x-0 top-0 z-20 h-16 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-input border border-primary/30 bg-primary-glow p-2 text-primary">
              <Snowflake aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold tracking-[0.12em] text-text-primary sm:text-sm">
                FIELD OPERATOR PANEL
              </p>
              <p className="hidden text-xs text-text-muted sm:block">Cold-chain shipment monitor</p>
            </div>
          </div>

          <div className="hidden min-w-0 flex-1 justify-center px-4 md:flex">
            <span className="operator-mono max-w-64 truncate rounded-input border border-border bg-surface px-3 py-2 text-xs text-text-muted">
              Shipment: not selected
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-danger/30 bg-danger-glow px-2.5 py-1 text-xs text-danger sm:px-3">
              <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Disconnected</span>
            </span>
            <span className="hidden items-center gap-1.5 text-xs text-text-muted lg:inline-flex">
              <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
              Clock unavailable
            </span>
            <span className="rounded-pill border border-accent/30 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-accent sm:text-xs">
              Simulated
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-10 pt-24 sm:px-6 lg:px-8">
        <div className="mb-7 flex flex-col justify-between gap-3 border-b border-border pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Field operations
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Shipment overview
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
              Select a shipment in a later step to view its simulated cold-chain status and operator
              workflow.
            </p>
          </div>
          <span className="w-fit rounded-pill border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">
            Waiting for shipment data
          </span>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <section
            aria-labelledby="truck-heading"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-7"
          >
            <SectionHeading {...sections[0]} />
            <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-input border border-border bg-background px-5 py-8 sm:min-h-[280px]">
              <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-10 h-px border-t border-dashed border-border"
              />
              <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-[4.7rem] h-px border-t border-dashed border-border/60"
              />
              <Placeholder className="relative w-full max-w-lg bg-surface/90">
                <Truck aria-hidden="true" className="mb-3 h-8 w-8 text-text-muted" />
                Shipment scene will appear when a shipment is selected.
              </Placeholder>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {["Shipment", "Batch", "Vehicle", "Progress"].map((label) => (
                <div
                  key={label}
                  className="rounded-input border border-border bg-background/60 px-3 py-2.5"
                >
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
                  <p className="operator-mono mt-1 truncate text-xs text-text-muted">—</p>
                </div>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="readings-heading"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-5"
          >
            <SectionHeading {...sections[1]} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <ReadingTile label="Temperature" icon={Thermometer} unit="°C" />
              <ReadingTile label="Humidity" icon={Droplets} unit="% RH" />
              <ReadingTile label="Battery" icon={Battery} unit="%" />
            </div>
            <div className="mt-4 rounded-input border border-border bg-background/60 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-text-secondary">Approved policy range</span>
                <span className="operator-mono text-text-muted">Unavailable</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-text-muted">
                Limits will be shown only when an approved batch policy is available.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="map-heading"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-7"
          >
            <SectionHeading {...sections[2]} />
            <div className="relative min-h-[240px] overflow-hidden rounded-input border border-border bg-background p-4 sm:min-h-[320px]">
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage:
                    "linear-gradient(30deg, transparent 48%, #1E3A5F 49%, #1E3A5F 50%, transparent 51%), linear-gradient(150deg, transparent 48%, #1E3A5F 49%, #1E3A5F 50%, transparent 51%)",
                  backgroundSize: "92px 92px",
                }}
              />
              <div className="relative flex min-h-[208px] items-center justify-center sm:min-h-[288px]">
                <Placeholder className="max-w-sm bg-surface/95">
                  <MapPin aria-hidden="true" className="mb-3 h-7 w-7 text-text-muted" />
                  Map position will appear after GPS telemetry arrives.
                </Placeholder>
              </div>
              <span className="absolute bottom-3 left-3 rounded-pill border border-accent/30 bg-background/90 px-2.5 py-1 text-[10px] text-accent">
                Simulated GPS · not live vehicle tracking
              </span>
            </div>
          </section>

          <section
            aria-labelledby="route-heading"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-5"
          >
            <SectionHeading {...sections[3]} />
            <div className="rounded-input border border-border bg-background/60 px-4">
              <RouteDatum label="Origin" />
              <RouteDatum label="Destination" />
              <div className="grid grid-cols-2 gap-4">
                <RouteDatum label="Distance remaining" />
                <RouteDatum label="Estimated arrival" />
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-text-muted">
              Route and ETA are unavailable until a shipment and simulated route are provided.
            </p>
          </section>

          <section
            aria-labelledby="override-heading"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-5"
          >
            <SectionHeading {...sections[4]} />
            <div className="rounded-input border border-warning/30 bg-warning/5 p-4">
              <p className="text-sm font-medium text-warning">No manual changes are active</p>
              <p className="mt-2 text-xs leading-5 text-text-secondary">
                This panel will request simulator changes through the backend policy workflow. It
                will not directly create or clear a safety alert.
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {["Temperature target", "Humidity target", "Operator", "Last change"].map((label) => (
                <div
                  key={label}
                  className="rounded-input border border-border bg-background/60 px-3 py-3"
                >
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
                  <p className="operator-mono mt-2 text-xs text-text-muted">
                    Available in a later step
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="alerts-heading"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-7"
          >
            <SectionHeading {...sections[5]} />
            <div className="flex items-start gap-3 rounded-input border border-border bg-background/60 p-4">
              <Bell aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
              <div>
                <p className="text-sm font-medium text-text-secondary">No alert data available</p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  This empty state means no readings have been loaded; it does not indicate that a
                  shipment is within limits.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {["Open", "Acknowledged", "Resolved"].map((status) => (
                <span
                  key={status}
                  className="rounded-pill border border-border px-3 py-1 text-xs text-text-muted"
                >
                  {status}: —
                </span>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="history-heading"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-12"
          >
            <SectionHeading {...sections[6]} />
            <div className="grid gap-4 lg:grid-cols-2">
              {[
                { label: "Temperature history", unit: "°C", icon: Thermometer },
                { label: "Humidity history", unit: "% RH", icon: Droplets },
              ].map(({ label, unit, icon: Icon }) => (
                <div
                  key={label}
                  className="rounded-input border border-border bg-background/60 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                      <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
                      {label}
                    </div>
                    <span className="operator-mono text-xs text-text-muted">{unit}</span>
                  </div>
                  <Placeholder className="min-h-32">No sensor history to chart yet.</Placeholder>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-text-muted">
              Approved policy thresholds and event markers will be added when real simulator history
              is connected.
            </p>
          </section>
        </div>

        <footer className="mt-8 flex flex-col gap-2 border-t border-border pt-5 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            Vaccine supply chain · Software demo · Synthetic data only · Not for clinical or
            production use
          </p>
          <p className="operator-mono">Field Operator Panel · v0.1.0</p>
        </footer>
      </main>
    </div>
  );
}

export default App;
