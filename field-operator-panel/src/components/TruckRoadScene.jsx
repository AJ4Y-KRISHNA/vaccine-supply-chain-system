import { motion, useReducedMotion } from "framer-motion";

const STATUS_PRESENTATION = {
  green: {
    colorClass: "text-primary",
    label: "Within policy limits",
    shouldPulse: true,
  },
  amber: {
    colorClass: "text-warning",
    label: "Excursion — review required",
    shouldPulse: true,
  },
  red: {
    colorClass: "text-danger",
    label: "Critical — quarantine state",
    shouldPulse: true,
  },
  stopped: {
    colorClass: "text-text-muted",
    label: "Stopped",
    shouldPulse: false,
  },
  unknown: {
    colorClass: "text-text-muted",
    label: "Awaiting sensor data",
    shouldPulse: false,
  },
};

const clampPercent = (value) => {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null;
};

const formatReading = (value, suffix = "") => {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return "—";
  }
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}${suffix}` : "—";
};

function resolveStatus(statusColor, isQuarantined) {
  if (isQuarantined || statusColor === "red" || statusColor === "danger") {
    return STATUS_PRESENTATION.red;
  }
  if (statusColor === "green" || statusColor === "primary") {
    return STATUS_PRESENTATION.green;
  }
  if (statusColor === "amber" || statusColor === "warning") {
    return STATUS_PRESENTATION.amber;
  }
  if (statusColor === "stopped") {
    return STATUS_PRESENTATION.stopped;
  }
  return STATUS_PRESENTATION.unknown;
}

function SnowflakeMark() {
  return (
    <g
      aria-hidden="true"
      className="text-primary"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="3"
    >
      <path d="M0 -17V17M-14.7 -8.5 14.7 8.5M-14.7 8.5 14.7 -8.5" />
      <path d="m0 -17-4 4m4-4 4 4m-4 13-4-4m4 4 4-4M-14.7-8.5h5m-5 0 2 5m22.4 7.9h-5m5 0-2-5m-22.4 0h5m-5 0 2 5m22.4-13h-5m5 0-2 5" />
    </g>
  );
}

function Wheel({ centerX, moving, rotationDuration }) {
  return (
    <g transform={`translate(${centerX} 215)`}>
      <circle r="34" className="fill-background stroke-border" strokeWidth="5" />
      <motion.g
        animate={moving ? { rotate: 360 } : { rotate: 0 }}
        initial={false}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        transition={{
          duration: moving ? rotationDuration : 0,
          ease: "linear",
          repeat: moving ? Infinity : 0,
        }}
      >
        <circle r="23" className="fill-surface-raised stroke-text-muted" strokeWidth="3" />
        <circle r="8" className="fill-surface stroke-border" strokeWidth="3" />
        <path
          d="M0-18v9m0 18v9m-18-18h9m18 0h9m-12.7-12.7 6.4 6.4m-25.4 0 6.4-6.4m0 25.4-6.4 6.4m25.4 0-6.4-6.4"
          className="stroke-text-muted"
          strokeLinecap="round"
          strokeWidth="3"
        />
      </motion.g>
    </g>
  );
}

function TruckSvg({
  status,
  temperature,
  humidity,
  speed,
  moving,
  isQuarantined,
  rotationDuration,
}) {
  const reducedMotion = useReducedMotion();
  const pulse = status.shouldPulse && !reducedMotion;

  return (
    <motion.svg
      aria-label={`Virtual refrigerated truck. ${status.label}. Temperature ${formatReading(temperature, " degrees Celsius")}. Humidity ${formatReading(humidity, " percent relative humidity")}.`}
      className="h-auto w-full overflow-visible"
      role="img"
      viewBox="0 0 900 270"
      initial={false}
      animate={moving && !reducedMotion ? { y: [0, -1.5, 0] } : { y: 0 }}
      transition={
        moving && !reducedMotion
          ? { duration: 1.3, ease: "easeInOut", repeat: Infinity }
          : { duration: 0.2 }
      }
    >
      <title>Software-simulated refrigerated delivery truck</title>

      {/* Trailer and refrigeration equipment */}
      <rect
        x="154"
        y="68"
        width="455"
        height="132"
        rx="9"
        className="fill-surface-raised stroke-border"
        strokeWidth="3"
      />
      <path d="M166 80v108m12-108v108m411-108v108" className="stroke-border" strokeWidth="2" />
      <path d="M194 83h388" className="stroke-text-secondary" strokeOpacity="0.2" strokeWidth="2" />
      <rect
        x="124"
        y="93"
        width="28"
        height="91"
        rx="5"
        className="fill-background stroke-border"
        strokeWidth="3"
      />
      <path
        d="M130 106h16m-16 9h16m-16 9h16m-16 9h16"
        className="stroke-text-muted"
        strokeWidth="2"
      />
      <text
        x="127"
        y="174"
        className="operator-mono fill-text-secondary"
        fontSize="7"
        letterSpacing="1"
      >
        COLD
      </text>

      {/* Cold-chain mark and embedded temperature/humidity readouts */}
      <rect
        x="230"
        y="96"
        width="94"
        height="66"
        rx="7"
        className="fill-background stroke-border"
        strokeWidth="2"
      />
      <g transform="translate(277 126) scale(.65)">
        <SnowflakeMark />
      </g>
      <text
        x="277"
        y="153"
        className="operator-mono fill-text-secondary"
        fontSize="8"
        textAnchor="middle"
        letterSpacing="1"
      >
        COLD CHAIN
      </text>

      <rect
        x="352"
        y="109"
        width="105"
        height="55"
        rx="5"
        className="fill-background stroke-border"
        strokeWidth="2"
      />
      <text
        x="362"
        y="124"
        className="operator-mono fill-text-muted"
        fontSize="8"
        letterSpacing="1"
      >
        TEMP
      </text>
      <text x="362" y="151" className="operator-mono fill-text-primary" fontSize="17">
        {formatReading(temperature, "°C")}
      </text>
      <rect
        x="470"
        y="109"
        width="105"
        height="55"
        rx="5"
        className="fill-background stroke-border"
        strokeWidth="2"
      />
      <text
        x="480"
        y="124"
        className="operator-mono fill-text-muted"
        fontSize="8"
        letterSpacing="1"
      >
        HUMIDITY
      </text>
      <text x="480" y="151" className="operator-mono fill-text-primary" fontSize="17">
        {formatReading(humidity, "%")}
      </text>

      {/* Status LED: green=within limits, amber=review, red=critical/quarantined */}
      <circle cx="164" cy="61" r="11" className="fill-background stroke-border" strokeWidth="2" />
      <motion.circle
        cx="164"
        cy="61"
        r="6"
        className={`fill-current ${status.colorClass} ${pulse && status === STATUS_PRESENTATION.red ? "truck-led-critical" : ""}`}
        style={{
          transformBox: "fill-box",
          transformOrigin: "center",
          filter:
            status === STATUS_PRESENTATION.red
              ? "drop-shadow(0 0 7px var(--color-danger))"
              : undefined,
        }}
        animate={
          pulse ? { opacity: [1, 0.65, 1], scale: [1, 1.18, 1] } : { opacity: 0.75, scale: 1 }
        }
        transition={
          pulse
            ? { duration: isQuarantined ? 0.9 : 1.8, ease: "easeInOut", repeat: Infinity }
            : { duration: 0.2 }
        }
      />

      {/* Cab, windshield, mirror, door seam and headlight */}
      <path
        d="M610 111h103c17 0 30 8 40 22l31 42v25H606v-76c0-7 0-13 4-13Z"
        className="fill-surface-raised stroke-border"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <path
        d="M718 119h-48v42h78l-22-31c-2-4-4-8-8-11Z"
        className="fill-background stroke-border"
        strokeWidth="2"
      />
      <path d="M747 134h26l20 27h-46Z" className="fill-background stroke-border" strokeWidth="2" />
      <path
        d="M788 135h19v9h-12l-7 8"
        className="fill-surface-raised stroke-border"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <path d="M737 166v30m-116-28h-12" className="stroke-border" strokeWidth="2" />
      <rect x="799" y="178" width="12" height="12" rx="3" className="fill-accent" />
      <path d="M808 185h8" className="stroke-text-secondary" strokeWidth="3" />

      {/* Chassis and the two visible wheels */}
      <path d="M147 194h654v14H147z" className="fill-background stroke-border" strokeWidth="3" />
      <Wheel
        centerX={519}
        moving={moving && !reducedMotion && !isQuarantined}
        rotationDuration={rotationDuration}
      />
      <Wheel
        centerX={765}
        moving={moving && !reducedMotion && !isQuarantined}
        rotationDuration={rotationDuration}
      />

      {/* Small cab-side digital speed display */}
      <rect
        x="672"
        y="172"
        width="55"
        height="18"
        rx="3"
        className="fill-background stroke-border"
        strokeWidth="1.5"
      />
      <text
        x="699"
        y="185"
        className="operator-mono fill-text-secondary"
        fontSize="8"
        textAnchor="middle"
      >
        {formatReading(speed, " km/h")}
      </text>
    </motion.svg>
  );
}

/**
 * Deterministic visual-only scene. Inputs are supplied by the parent; it owns
 * no simulator or shipment state. statusColor accepts green, amber, red,
 * stopped, unknown and the Tailwind-token aliases primary/warning/danger.
 */
export default function TruckRoadScene({
  statusColor = "unknown",
  temperature = null,
  humidity = null,
  speed = null,
  isMoving = false,
  isQuarantined = false,
  progress = null,
  weatherState = "clear",
  totalDistanceKm = null,
  originLabel = "Origin pending",
  destinationLabel = "Destination pending",
  etaLabel = "ETA pending",
}) {
  const reducedMotion = useReducedMotion();
  const status = resolveStatus(statusColor, isQuarantined);
  const safeProgress = clampPercent(progress);
  const progressForStyle = safeProgress ?? 0;
  const numericSpeed = Number(speed);
  const effectiveSpeed = Number.isFinite(numericSpeed) && numericSpeed > 0 ? numericSpeed : 30;
  const rotationDuration = Math.min(1.4, Math.max(0.3, 30 / effectiveSpeed));
  const moving =
    isMoving &&
    !isQuarantined &&
    status !== STATUS_PRESENTATION.red &&
    status !== STATUS_PRESENTATION.stopped &&
    !reducedMotion;
  const centerMarkers = [
    { progress: 0, position: 4 },
    { progress: 50, position: 50 },
    { progress: 100, position: 96 },
  ];
  const weatherLabel =
    weatherState && weatherState !== "clear"
      ? `Weather scenario: ${weatherState}`
      : "Weather scenario: clear";
  const progressColorClass =
    status === STATUS_PRESENTATION.red
      ? "bg-danger"
      : status === STATUS_PRESENTATION.amber
        ? "bg-warning"
        : status === STATUS_PRESENTATION.green
          ? "bg-primary"
          : "bg-text-muted";

  return (
    <div className="space-y-4">
      <div
        className="relative isolate min-h-[220px] overflow-hidden rounded-input border border-border bg-gradient-to-b from-night to-background px-3 pt-3 sm:min-h-[280px] sm:px-5 sm:pt-4"
        aria-label="Simulated refrigerated truck scene"
        role="group"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-45">
          <span className="absolute left-[12%] top-[17%] h-1 w-1 rounded-full bg-text-secondary" />
          <span className="absolute left-[26%] top-[31%] h-1 w-1 rounded-full bg-text-secondary" />
          <span className="absolute left-[43%] top-[14%] h-1 w-1 rounded-full bg-text-secondary" />
          <span className="absolute left-[61%] top-[25%] h-1 w-1 rounded-full bg-text-secondary" />
          <span className="absolute left-[77%] top-[13%] h-1 w-1 rounded-full bg-text-secondary" />
          <span className="absolute left-[89%] top-[34%] h-1 w-1 rounded-full bg-text-secondary" />
        </div>

        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-pill border border-accent/30 bg-background/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
            Simulated scene
          </span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span
              className={`rounded-pill border border-border bg-background/80 px-2.5 py-1 text-[10px] font-medium ${status.colorClass}`}
            >
              {status.label}
            </span>
            <span className="rounded-pill border border-border bg-background/80 px-2.5 py-1 text-[10px] text-text-secondary">
              {weatherLabel}
            </span>
          </div>
        </div>

        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[36%] overflow-hidden bg-road-asphalt"
        >
          <div className="absolute inset-x-0 top-0 h-2 bg-road-shoulder" />
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden">
            <div className={`road-markings-track ${moving ? "road-markings-moving" : ""}`}>
              {Array.from({ length: 32 }, (_, index) => (
                <span key={index} className="road-marking" />
              ))}
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-2 bg-road-shoulder" />
        </div>

        <div className="pointer-events-none absolute inset-x-3 bottom-[29%] z-[1] h-7 sm:inset-x-6">
          {centerMarkers.map(({ progress: marker, position }, index) => {
            const distance =
              totalDistanceKm !== null &&
              totalDistanceKm !== undefined &&
              !(typeof totalDistanceKm === "string" && totalDistanceKm.trim() === "") &&
              Number.isFinite(Number(totalDistanceKm))
                ? `${((Number(totalDistanceKm) * marker) / 100).toFixed(0)} km`
                : marker === 0
                  ? "0 km"
                  : "— km";
            return (
              <span
                key={marker}
                className={`absolute top-0 -translate-x-1/2 text-[9px] ${
                  index === 1 ? "text-text-secondary" : "text-text-muted"
                }`}
                style={{ left: `${position}%` }}
              >
                {distance}
              </span>
            );
          })}
          {safeProgress !== null && (
            <div
              className={`absolute bottom-0 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-background ${status.colorClass} bg-current`}
              style={{ left: `${Math.min(98, Math.max(2, progressForStyle))}%` }}
              aria-hidden="true"
            />
          )}
        </div>

        <div className="pointer-events-none absolute bottom-[27%] right-[8%] z-[2] flex -translate-y-1/2 flex-col items-center text-accent">
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
            <path
              d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle cx="12" cy="10" r="2.5" fill="currentColor" />
          </svg>
          <span className="rounded-pill border border-accent/30 bg-background/90 px-1.5 py-0.5 text-[8px] uppercase tracking-wide">
            Destination
          </span>
        </div>

        <div className="absolute bottom-[7%] left-1/2 z-[3] w-[min(780px,66%)] -translate-x-1/2">
          <TruckSvg
            status={status}
            temperature={temperature}
            humidity={humidity}
            speed={speed}
            moving={moving}
            isQuarantined={isQuarantined}
            rotationDuration={rotationDuration}
          />
        </div>
      </div>

      <div className="rounded-input border border-border bg-background/60 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-text-secondary">Route progress</span>
          <span className="operator-mono text-xs text-text-secondary">
            {safeProgress === null ? "—" : `${safeProgress.toFixed(0)}%`}
          </span>
        </div>
        <div
          aria-label="Route progress"
          aria-valuemax="100"
          aria-valuemin="0"
          aria-valuenow={safeProgress ?? undefined}
          className="h-2 overflow-hidden rounded-pill bg-surface-raised"
          role="progressbar"
        >
          <div
            className={`h-full rounded-pill ${progressColorClass}`}
            style={{ width: `${progressForStyle}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-3 items-center gap-2 text-[10px] sm:text-xs">
          <p className="min-w-0 truncate text-left text-text-secondary" title={originLabel}>
            {originLabel}
          </p>
          <p className="min-w-0 truncate text-center text-text-muted" title={etaLabel}>
            {etaLabel}
          </p>
          <p className="min-w-0 truncate text-right text-text-secondary" title={destinationLabel}>
            {destinationLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
