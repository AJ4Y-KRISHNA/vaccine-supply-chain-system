import React, { useEffect, useRef, useState } from "react";

const STATUS = {
  green: { label: "Within policy limits", variable: "--color-primary" },
  amber: { label: "Review required", variable: "--color-warning" },
  red: { label: "Critical · quarantine", variable: "--color-danger" },
  unknown: { label: "Awaiting sensor data", variable: "--color-text-muted" },
};

const WEATHER = new Set(["clear", "heat", "rain", "cold"]);
const SCENE_WIDTH = 1600;
const SCROLL_COPIES = [0, SCENE_WIDTH];
const AXLE_CENTERS = [438, 548, 1058, 1167];
const DUAL_WHEEL_OFFSET = 10;

// Fixed coordinates keep the night sky deterministic across renders and devices.
const STARS = Array.from({ length: 54 }, (_, index) => ({
  x: 22 + ((index * 173 + (index % 7) * 41) % 1556),
  y: 18 + ((index * 47 + (index % 5) * 19) % 180),
  radius: [0.45, 0.62, 0.82, 1][index % 4],
  opacity: [0.42, 0.55, 0.68, 0.82, 0.92][index % 5],
}));

const RAIN = Array.from({ length: 72 }, (_, index) => ({
  x: (index * 131 + 17) % SCENE_WIDTH,
  y: (index * 79 + 11) % 390,
  delay: -((index * 37) % 120) / 100,
  duration: 0.65 + ((index * 13) % 55) / 100,
}));

const FROST = Array.from({ length: 30 }, (_, index) => ({
  x: 14 + ((index * 83) % 1572),
  y: 36 + ((index * 61) % 330),
  radius: 1 + (index % 3) * 0.55,
  delay: -((index * 29) % 60) / 10,
}));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numberOrNull(value) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return undefined;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return Boolean(reduced);
}

function useDocumentVisibility() {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

function SceneDefinitions() {
  return (
    <defs>
      <linearGradient id="scene-sky" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="var(--color-scene-sky-top)" />
        <stop offset="0.58" stopColor="var(--color-scene-sky-mid)" />
        <stop offset="1" stopColor="var(--color-scene-horizon)" />
      </linearGradient>
      <radialGradient id="scene-city-glow">
        <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0.1" />
        <stop offset="0.48" stopColor="var(--color-accent)" stopOpacity="0.055" />
        <stop offset="1" stopColor="var(--color-scene-horizon)" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="scene-road" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="var(--color-scene-asphalt-far)" />
        <stop offset="0.48" stopColor="var(--color-road-asphalt)" />
        <stop offset="1" stopColor="var(--color-scene-asphalt-near)" />
      </linearGradient>
      <linearGradient id="scene-reflection" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0" />
        <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0.06" />
      </linearGradient>
      <linearGradient id="scene-trailer" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="var(--color-scene-truck-top)" />
        <stop offset="0.5" stopColor="var(--color-scene-truck-mid)" />
        <stop offset="1" stopColor="var(--color-scene-truck-bottom)" />
      </linearGradient>
      <linearGradient id="scene-cab" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="var(--color-scene-truck-top)" />
        <stop offset="0.55" stopColor="var(--color-scene-cab-mid)" />
        <stop offset="1" stopColor="var(--color-scene-truck-bottom)" />
      </linearGradient>
      <linearGradient id="scene-metal" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="var(--color-scene-metal-light)" />
        <stop offset="0.42" stopColor="var(--color-scene-metal)" />
        <stop offset="1" stopColor="var(--color-scene-metal-dark)" />
      </linearGradient>
      <radialGradient id="scene-rim">
        <stop offset="0" stopColor="var(--color-scene-metal-light)" />
        <stop offset="0.58" stopColor="var(--color-scene-metal)" />
        <stop offset="1" stopColor="var(--color-scene-metal-dark)" />
      </radialGradient>
      <radialGradient id="scene-headlight" cx="1" cy="0.5" r="1">
        <stop offset="0" stopColor="var(--color-scene-headlight)" stopOpacity="0.36" />
        <stop offset="0.45" stopColor="var(--color-scene-headlight)" stopOpacity="0.16" />
        <stop offset="1" stopColor="var(--color-scene-headlight)" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="scene-heat-horizon" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="var(--color-danger)" stopOpacity="0" />
        <stop offset="1" stopColor="var(--color-danger)" stopOpacity="0.11" />
      </linearGradient>
      <clipPath id="scene-road-clip" clipPathUnits="userSpaceOnUse">
        <path d="M265 318H1335L1600 500H0Z" />
      </clipPath>
      <filter id="headlight-glow" x="-20%" y="-100%" width="145%" height="300%">
        <feGaussianBlur stdDeviation="10" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="status-glow-green" x="-200%" y="-200%" width="500%" height="500%">
        <feDropShadow
          dx="0"
          dy="0"
          stdDeviation="4"
          floodColor="var(--color-primary)"
          floodOpacity="0.8"
        />
      </filter>
      <filter id="status-glow-amber" x="-200%" y="-200%" width="500%" height="500%">
        <feDropShadow
          dx="0"
          dy="0"
          stdDeviation="4"
          floodColor="var(--color-warning)"
          floodOpacity="0.8"
        />
      </filter>
      <filter id="status-glow-red" x="-250%" y="-250%" width="600%" height="600%">
        <feDropShadow
          dx="0"
          dy="0"
          stdDeviation="6"
          floodColor="var(--color-danger)"
          floodOpacity="0.9"
        />
      </filter>
      <filter id="road-texture" x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.65"
          numOctaves="3"
          stitchTiles="stitch"
          result="noise"
        />
        <feBlend in="SourceGraphic" in2="noise" mode="multiply" />
      </filter>
      <filter id="wheel-contact-shadow" x="-30%" y="-100%" width="160%" height="300%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
      <filter id="truck-shadow" x="-20%" y="-100%" width="140%" height="300%">
        <feGaussianBlur stdDeviation="6" />
      </filter>
      <filter id="heat-distortion" x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type="turbulence"
          baseFrequency="0.012"
          numOctaves="1"
          seed="4"
          result="heat-noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="heat-noise"
          scale="3"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
      <filter id="star-glow" x="-300%" y="-300%" width="700%" height="700%">
        <feGaussianBlur stdDeviation="1" result="star-blur" />
        <feMerge>
          <feMergeNode in="star-blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <pattern id="scene-road-studs" width="80" height="10" patternUnits="userSpaceOnUse">
        <rect
          x="9"
          y="2"
          width="9"
          height="3"
          rx="1"
          fill="var(--color-scene-reflector)"
          opacity="0.72"
        />
        <rect x="49" y="2" width="8" height="3" rx="1" fill="var(--color-warning)" opacity="0.6" />
      </pattern>
    </defs>
  );
}

function Wheel({ x, moving, coasting, wheelDuration }) {
  // The tire's stroked outer radius reaches the y=444 road-contact plane exactly.
  return (
    <g transform={`translate(${x} 428)`}>
      <ellipse
        cy="16"
        rx="22"
        ry="4"
        fill="var(--color-scene-shadow)"
        opacity="0.5"
        filter="url(#wheel-contact-shadow)"
      />
      <circle
        r="15"
        fill="var(--color-scene-tire)"
        stroke="var(--color-scene-metal-dark)"
        strokeWidth="2"
      />
      <g
        className={`scene-wheel-rotation${moving ? " scene-wheel-moving" : ""}${coasting ? " scene-wheel-coasting" : ""}`}
        data-testid="truck-wheel-rotation"
        data-moving={moving ? "true" : "false"}
        style={{ "--wheel-speed": `${wheelDuration}s` }}
      >
        <circle
          r="10"
          fill="url(#scene-rim)"
          stroke="var(--color-scene-metal-light)"
          strokeOpacity="0.34"
          strokeWidth="2"
        />
        <path
          d="M0-8v16M-8 0h16m-5.7-5.7 11.4 11.4m0-11.4L-5.7 5.7"
          stroke="var(--color-scene-rim-detail)"
          strokeWidth="1.1"
          opacity="0.65"
        />
        <circle
          r="4"
          fill="var(--color-scene-metal-light)"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="1.4"
        />
        <circle r="1.4" fill="var(--color-scene-metal-dark)" />
      </g>
    </g>
  );
}

function Snowflake() {
  return (
    <g fill="none" stroke="var(--color-scene-star)" strokeLinecap="round" strokeWidth="2.2">
      <path d="M0-13v26M-11.25-6.5l22.5 13M-11.25 6.5l22.5-13" />
      <path d="m0-13-3 3m3-3 3 3m-3 7-3-3m3 3 3-3m-11.25-.5h4m-4 0 2 3m15.25 8.5h-4m4 0-2-3m-15.25 3h4m-4 0 2-3m15.25-8.5h-4m4 0-2 3" />
    </g>
  );
}

function Truck({
  offset,
  moving,
  status,
  temperature,
  humidity,
  speed,
  isQuarantined,
  coasting,
  braking,
  wheelDuration,
}) {
  const glow = status === "unknown" ? undefined : `url(#status-glow-${status})`;
  const safeTemperature = numberOrNull(temperature);
  const safeHumidityValue = numberOrNull(humidity);
  const safeTemp = safeTemperature === null ? "—" : `${safeTemperature.toFixed(1)}°C`;
  const safeHumidity = safeHumidityValue === null ? "—" : `${safeHumidityValue.toFixed(1)}%`;
  const temperatureBarWidth =
    safeTemperature === null ? 0 : clamp(((safeTemperature + 20) / 70) * 187, 3, 187);

  return (
    <g
      className="scene-truck-group"
      data-testid="truck-group"
      style={{ transform: `translateX(${offset}px)` }}
    >
      <g className="scene-truck-motion">
        <ellipse
          cx="819"
          cy="444"
          rx="435"
          ry="9"
          fill="var(--color-scene-shadow)"
          opacity="0.45"
          filter="url(#truck-shadow)"
        />

        {/* Left-facing headlamp cones terminate on the road before reaching the trailer. */}
        <g
          className={`scene-headlight-beams${isQuarantined ? " scene-quarantined-beams" : ""}`}
          aria-hidden="true"
        >
          <path
            d="M376 327.5 8 350 8 401 376 334Z"
            fill="url(#scene-headlight)"
            filter="url(#headlight-glow)"
          />
          <path
            d="M380 379 0 386 0 447 380 393Z"
            fill="url(#scene-headlight)"
            opacity="0.58"
            filter="url(#headlight-glow)"
          />
        </g>

        {/* Exhaust pipe and restrained exhaust haze */}
        <rect
          x="568"
          y="237"
          width="13"
          height="73"
          rx="4"
          fill="url(#scene-metal)"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="2"
        />
        <path d="M566 238h18v7h-18z" fill="var(--color-scene-metal-light)" />
        {[0, 1, 2].map((particle) => (
          <circle
            key={particle}
            className={`scene-exhaust-particle${moving ? " scene-exhaust-moving" : ""}`}
            cx={573 + particle * 5}
            cy={231 - particle * 2}
            r={5 + particle}
            fill="var(--color-scene-exhaust)"
            style={{ "--particle-delay": `${particle * 0.6}s` }}
            aria-hidden="true"
          />
        ))}

        {/* Tall insulated trailer shell and aluminium corner structure */}
        <path
          d="M600 248Q600 237 612 237H1241Q1252 237 1252 249V400H600Z"
          fill="url(#scene-trailer)"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="3"
        />
        <path d="M612 250H1238V273H612Z" fill="var(--color-scene-livery)" opacity="0.76" />
        <text
          x="941"
          y="266"
          textAnchor="middle"
          className="scene-svg-mono"
          fontSize="15"
          letterSpacing="4"
          fill="var(--color-text-primary)"
          opacity="0.42"
        >
          COLD CHAIN · REFRIGERATED LOGISTICS
        </text>
        <path
          d="M613 281H1236"
          stroke="var(--color-scene-metal-light)"
          strokeOpacity="0.24"
          strokeWidth="2"
        />
        {[294, 309, 324, 339, 354, 369, 384].map((y) => (
          <path key={y} d={`M607 ${y}H1245`} stroke="var(--color-scene-rib)" strokeWidth="1.5" />
        ))}
        <path
          d="M612 241v159M624 241v159M1230 241v159M1242 241v159"
          stroke="var(--color-scene-metal-light)"
          strokeOpacity="0.32"
          strokeWidth="3"
        />
        <path
          d="M1242 246v151m-11-150v150m-8-115h18m-18 39h18m-18 39h18m-18-9h18"
          fill="none"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="2"
        />

        {/* Refrigeration unit, mounted at the forward upper corner of trailer */}
        <path
          d="M579 249V220Q579 214 586 214H630Q636 214 636 222V258H600V249Z"
          fill="url(#scene-metal)"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="2"
        />
        <path d="M586 225h42m-42 7h42m-42 7h42" stroke="var(--color-scene-rib)" strokeWidth="2" />
        <circle
          cx="626"
          cy="218"
          r="7"
          fill="var(--scene-status-color)"
          filter={glow}
          className={`scene-status-led${status === "red" ? " scene-red-pulse" : ""}`}
        />
        <circle cx="626" cy="218" r="2" fill="var(--color-text-primary)" opacity="0.9" />

        {/* Bolted live LCD telemetry panel */}
        <rect
          x="805"
          y="291"
          width="205"
          height="77"
          rx="5"
          fill="var(--color-scene-display)"
          stroke="var(--scene-status-color)"
          strokeOpacity="0.62"
          strokeWidth="2"
          className="scene-live-panel"
        />
        {[
          [812, 298],
          [998, 298],
          [812, 361],
          [998, 361],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" fill="var(--color-scene-metal-light)" />
        ))}
        <g transform="translate(822 319) scale(.48)">
          <Snowflake />
        </g>
        <text
          x="841"
          y="312"
          className="scene-svg-mono"
          fontSize="9"
          fill="var(--color-text-muted)"
          letterSpacing="1.5"
        >
          TEMP
        </text>
        <text
          x="841"
          y="337"
          className="scene-svg-mono"
          fontSize="18"
          fontWeight="600"
          fill="var(--scene-status-color)"
        >
          {safeTemp}
        </text>
        <text
          x="923"
          y="312"
          className="scene-svg-mono"
          fontSize="9"
          fill="var(--color-text-muted)"
          letterSpacing="1.5"
        >
          RH
        </text>
        <text
          x="923"
          y="337"
          className="scene-svg-mono"
          fontSize="18"
          fontWeight="600"
          fill="var(--scene-status-color)"
        >
          {safeHumidity}
        </text>
        <rect x="814" y="348" width="187" height="4" rx="2" fill="var(--color-scene-rib)" />
        <rect
          x="814"
          y="348"
          width={temperatureBarWidth}
          height="4"
          rx="2"
          fill="var(--scene-status-color)"
        />

        {/* Front-facing cab with raked windscreen, door, grille, bumper and generic snowflake mark */}
        <path
          d="M390 400V329Q390 318 399 309L431 276Q441 266 456 266H560Q579 267 592 284L610 310V400Z"
          fill="url(#scene-cab)"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path
          d="M405 316 438 280Q444 274 455 274H486V326H404Z"
          fill="var(--color-scene-glass)"
          stroke="var(--color-scene-metal-light)"
          strokeOpacity="0.38"
          strokeWidth="2"
        />
        <path d="M414 310 445 278h6l-31 36" fill="var(--color-text-primary)" opacity="0.12" />
        <path
          d="M409 324q31-8 71-5"
          fill="none"
          stroke="var(--color-primary)"
          strokeOpacity="0.35"
          strokeWidth="3"
        />
        <path
          d="M421 317 457 309m-31 15 38-8"
          stroke="var(--color-scene-metal-light)"
          strokeOpacity="0.8"
          strokeWidth="2"
        />
        <path
          d="M493 277v122m-3-85h81"
          fill="none"
          stroke="var(--color-scene-metal-light)"
          strokeOpacity="0.27"
          strokeWidth="2"
        />
        <rect
          x="509"
          y="289"
          width="53"
          height="27"
          rx="3"
          fill="var(--color-scene-glass)"
          stroke="var(--color-scene-metal-light)"
          strokeOpacity="0.34"
          strokeWidth="1.5"
        />
        <path
          d="M512 313h47"
          stroke="var(--color-text-primary)"
          strokeOpacity="0.12"
          strokeWidth="2"
        />
        <rect x="483" y="338" width="15" height="4" rx="2" fill="url(#scene-metal)" />
        <path
          d="M395 338h-18v-11h18"
          fill="none"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="4"
        />
        <rect
          x="372"
          y="321"
          width="18"
          height="13"
          rx="3"
          fill="var(--color-scene-metal)"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="2"
        />
        <path d="M376 324h10v7h-10z" fill="var(--color-scene-headlight)" opacity="0.8" />
        <path
          d="M400 358H389v27h11m2-23h41m-41 7h41m-41 7h41m-41 7h41"
          fill="none"
          stroke="var(--color-scene-rib)"
          strokeWidth="2"
        />
        <rect
          x="386"
          y="386"
          width="218"
          height="15"
          rx="3"
          fill="url(#scene-metal)"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="2"
        />
        <rect
          x="379"
          y="369"
          width="11"
          height="20"
          rx="3"
          fill="var(--color-scene-headlight)"
          stroke="var(--color-warning)"
          strokeWidth="1.5"
        />
        <rect
          className="scene-running-light"
          x="447"
          y="270"
          width="10"
          height="4"
          rx="2"
          fill="var(--color-warning)"
        />
        <rect
          className="scene-running-light"
          x="558"
          y="272"
          width="10"
          height="4"
          rx="2"
          fill="var(--color-warning)"
        />
        <g transform="translate(530 352) scale(.55)">
          <Snowflake />
        </g>
        <text
          x="541"
          y="373"
          className="scene-svg-mono"
          fontSize="7"
          textAnchor="middle"
          fill="var(--color-text-secondary)"
          letterSpacing="1"
        >
          CC-04
        </text>

        {/* Four axle pairs: front, cab drive axle, and two trailer axles. */}
        {AXLE_CENTERS.flatMap((center, axleIndex) =>
          [-DUAL_WHEEL_OFFSET, DUAL_WHEEL_OFFSET].map((offset) => {
            const x = center + offset;
            return (
              <Wheel
                key={`axle-${axleIndex}-wheel-${offset}`}
                x={x}
                moving={moving}
                coasting={coasting}
                wheelDuration={wheelDuration}
              />
            );
          }),
        )}

        {/* Rear marker lamps and reflective strips */}
        <rect
          x="1244"
          y="358"
          width="9"
          height="18"
          rx="2"
          fill={isQuarantined || braking ? "var(--color-danger)" : "var(--color-scene-tail-light)"}
          className={`${isQuarantined ? "scene-quarantine-lamp " : ""}${braking ? "scene-brake-flash" : ""}`}
        />
        <rect x="1244" y="380" width="9" height="13" rx="2" fill="var(--color-warning)" />
        <path
          d="M1223 397h14m-34 0h14m-34 0h14"
          stroke="var(--color-scene-reflector)"
          strokeWidth="3"
        />
        <path d="M603 402h650" stroke="var(--color-scene-metal-dark)" strokeWidth="6" />

        {/* Rear-view mirror and running light */}
        <path
          d="M407 294h-17v-15"
          fill="none"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="3"
        />
        <rect
          x="383"
          y="274"
          width="19"
          height="12"
          rx="3"
          fill="url(#scene-metal)"
          stroke="var(--color-scene-metal-dark)"
          strokeWidth="2"
        />
        <path d="M385 277h13" stroke="var(--color-text-primary)" strokeOpacity="0.35" />
        <text
          x="636"
          y="390"
          className="scene-svg-mono"
          fontSize="11"
          fill="var(--color-text-secondary)"
        >
          {moving || coasting ? `${Math.round(speed)} KM/H` : "STOPPED"}
        </text>
      </g>
    </g>
  );
}

function WeatherLayer({ weatherState, active }) {
  return (
    <g
      className={`scene-weather scene-weather-${weatherState}`}
      data-testid="weather-overlay"
      data-weather={weatherState}
      aria-hidden="true"
    >
      {weatherState === "heat" && (
        <rect
          className="scene-heat-haze"
          x="0"
          y="175"
          width="1600"
          height="325"
          fill="url(#scene-heat-horizon)"
          filter="url(#heat-distortion)"
        />
      )}
      {weatherState === "rain" &&
        RAIN.map((drop, index) => (
          <line
            key={index}
            className={`scene-rain-drop${active ? " scene-rain-active" : ""}`}
            x1={drop.x}
            y1={drop.y}
            x2={drop.x - 10}
            y2={drop.y + 29}
            stroke="var(--color-scene-rain)"
            strokeWidth="1.3"
            style={{ "--rain-delay": `${drop.delay}s`, "--rain-duration": `${drop.duration}s` }}
          />
        ))}
      {weatherState === "cold" &&
        FROST.map((flake, index) => (
          <circle
            key={index}
            className={`scene-frost-particle${active ? " scene-frost-active" : ""}`}
            cx={flake.x}
            cy={flake.y}
            r={flake.radius}
            fill="var(--color-text-primary)"
            opacity="0.55"
            style={{ "--particle-delay": `${flake.delay}s` }}
          />
        ))}
    </g>
  );
}

/**
 * Pure SVG/CSS illustration. All scene telemetry and visual states come from props;
 * it does not read or mutate shipment/simulator data.
 */
export default function TruckRoadScene({
  statusColor = "green",
  temperature = null,
  humidity = null,
  isMoving = false,
  isQuarantined = false,
  progress = 0,
  weatherState = "clear",
  speed = 0,
  totalDistanceKm = null,
  originLabel = "Origin pending",
  destinationLabel = "Destination pending",
  etaLabel = "ETA pending",
}) {
  const prefersReducedMotion = useReducedMotionPreference();
  const isVisible = useDocumentVisibility();
  const [coasting, setCoasting] = useState(false);
  const [braking, setBraking] = useState(false);
  const wasMovingRef = useRef(false);
  const normalizedStatus = Object.hasOwn(STATUS, statusColor) ? statusColor : "unknown";
  const safeTemperature = numberOrNull(temperature);
  const safeHumidity = numberOrNull(humidity);
  const safeSpeed = Math.max(0, numberOrNull(speed) ?? 0);
  const safeProgress = clamp(numberOrNull(progress) ?? 0, 0, 100);
  const safeDistance = numberOrNull(totalDistanceKm);
  const normalizedWeather = WEATHER.has(weatherState) ? weatherState : "clear";
  const quarantined = Boolean(isQuarantined || normalizedStatus === "red");
  const moving = Boolean(isMoving && !quarantined && safeSpeed > 0);
  const animationsActive = moving && isVisible && !prefersReducedMotion;

  useEffect(() => {
    let coastTimer;
    let brakeTimer;

    if (moving) {
      wasMovingRef.current = true;
      setCoasting(false);
      setBraking(false);
    } else if (wasMovingRef.current) {
      wasMovingRef.current = false;
      setCoasting(!quarantined);
      setBraking(true);
      coastTimer = window.setTimeout(() => setCoasting(false), quarantined ? 0 : 750);
      brakeTimer = window.setTimeout(() => setBraking(false), 900);
    }

    return () => {
      window.clearTimeout(coastTimer);
      window.clearTimeout(brakeTimer);
    };
  }, [moving, quarantined]);

  const durationFromSpeed = (baseSpeed) =>
    clamp(2 - ((clamp(baseSpeed, 20, 120) - 20) / 100) * 1.6, 0.4, 2);
  const wheelDuration = clamp(30 / Math.max(safeSpeed, 20), 0.4, 1.5);
  const roadDuration = durationFromSpeed(safeSpeed || 20);
  const sceneLoopDuration = (roadDuration * SCENE_WIDTH) / 120;
  const truckOffset = -75;
  const currentKm = safeDistance === null ? null : (safeDistance * safeProgress) / 100;
  const destinationDistance = safeDistance === null ? null : Math.max(0, safeDistance - currentKm);
  const signDestinationLabel =
    String(destinationLabel || "Route ahead")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ")
      .toUpperCase()
      .slice(0, 14) || "ROUTE AHEAD";
  const cityOpacity = 1 - clamp(safeProgress / 38, 0, 1);
  const hillsOpacity =
    clamp((safeProgress - 22) / 48, 0, 1) * (1 - clamp((safeProgress - 82) / 18, 0, 1));
  const arrivalOpacity = clamp((safeProgress - 74) / 26, 0, 1);
  const stopTransition = !moving && wasMovingRef.current && !quarantined;
  const sceneCoasting =
    !moving && !quarantined && (coasting || stopTransition) && isVisible && !prefersReducedMotion;
  const sceneBraking = !moving && (braking || wasMovingRef.current);
  const statusLabel = quarantined ? STATUS.red.label : STATUS[normalizedStatus].label;

  return (
    <div className="space-y-3">
      <div
        className={`scene-frame${animationsActive ? " scene-moving" : ""}${sceneCoasting ? " scene-coasting" : ""}${!moving ? " scene-parked" : ""}${!isVisible ? " scene-paused" : ""}${prefersReducedMotion ? " scene-reduced-motion" : ""}${quarantined ? " scene-quarantined" : ""}${sceneBraking ? " scene-braking" : ""}`}
        data-status={quarantined ? "red" : normalizedStatus}
        data-weather={normalizedWeather}
        role="img"
        aria-label={`Night highway scene with refrigerated truck. ${statusLabel}. Temperature ${safeTemperature === null ? "unavailable" : `${safeTemperature.toFixed(1)} degrees Celsius`}; humidity ${safeHumidity === null ? "unavailable" : `${safeHumidity.toFixed(1)} percent`}.`}
        style={{
          "--scene-status-color": `var(${STATUS[quarantined ? "red" : normalizedStatus].variable})`,
          "--scene-road-duration": `${roadDuration}s`,
          "--scene-loop-duration": `${sceneLoopDuration}s`,
          "--scene-roadside-duration": `${sceneLoopDuration * 3}s`,
          "--scene-midground-duration": `${sceneLoopDuration * 10}s`,
          "--scene-far-duration": `${sceneLoopDuration * 24}s`,
          "--scene-city-opacity": cityOpacity,
          "--scene-hills-opacity": hillsOpacity,
          "--scene-arrival-opacity": arrivalOpacity,
        }}
      >
        <svg
          className="scene-svg"
          viewBox="0 0 1600 500"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <SceneDefinitions />

          {/* Layer 1: sky, horizon glow and deterministic star field */}
          <rect width="1600" height="338" fill="url(#scene-sky)" />
          <ellipse cx="828" cy="290" rx="650" ry="170" fill="url(#scene-city-glow)" />
          {normalizedWeather === "heat" && (
            <ellipse
              cx="840"
              cy="296"
              rx="650"
              ry="160"
              fill="var(--color-danger)"
              opacity="0.045"
            />
          )}
          {quarantined && (
            <ellipse
              cx="840"
              cy="296"
              rx="650"
              ry="160"
              fill="var(--color-danger)"
              opacity="0.055"
            />
          )}
          {STARS.map((star, index) => (
            <circle
              key={index}
              cx={star.x}
              cy={star.y}
              r={index < 3 ? 1.2 : star.radius}
              fill="var(--color-scene-star)"
              opacity={star.opacity}
              filter={index < 3 ? "url(#star-glow)" : undefined}
            />
          ))}

          {/* Layer 2: looped far and middle scenery; progress crossfades the journey setting. */}
          <g
            className="scene-scroll-loop scene-parallax-far"
            data-testid="far-scenery-track"
            aria-hidden="true"
          >
            {SCROLL_COPIES.map((copyX) => (
              <g key={`far-${copyX}`} transform={`translate(${copyX} 0)`}>
                <path
                  d="M0 302h26l18-18q10-9 19 1l18 17h25l23-37 15 35 13-26 18 29h21q11-14 25-6 10 7 21 6h18l24-47 15 41 14-25 16 33h20q13-18 30-8 11 7 22 8h19l23-25 13 20 22-52 18 52 14-26 16 31h20q14-12 28-3 9 6 20 3h21l21-34 14 32 16-23 17 27h18q12-17 27-8 10 7 21 8h20l25-42 13 37 17-29 16 35h20q12-13 27-5 10 6 21 5h19l20-30 15 29 17-45 17 46 16-24 16 25h20q13-17 28-7 10 7 20 7h19l25-38 14 34 17-22 15 26h22q13-13 27-4 10 7 22 4h18l22-34 15 32 17-50 18 51 14-23 17 25h20q13-16 28-6 10 7 21 6h18l23-31 14 29 17-22 17 24h20l20-26 14 25 18-42 18 43 14-20 18 20h20q14-14 28-5 10 7 22 5h20l23-31 14 29 19-24 17 26h22v42H0Z"
                  fill="var(--color-scene-environment-far)"
                />
                <path
                  className="scene-journey-hills"
                  d="M0 316 112 291l93 15 101-42 104 36 115-17 119 30 107-50 128 43 125-28 112 31 133-45 151 38v42H0Z"
                  fill="var(--color-scene-horizon)"
                />
              </g>
            ))}
          </g>
          <g
            className="scene-scroll-loop scene-parallax-mid"
            data-testid="midground-scenery-track"
            aria-hidden="true"
          >
            {SCROLL_COPIES.map((copyX) => (
              <g key={`mid-${copyX}`} transform={`translate(${copyX} 0)`}>
                <path d="M0 316h1600v28H0z" fill="var(--color-scene-environment)" />
                <path
                  className="scene-journey-city"
                  d="M123 286v-28h18v28m21 5v-44h33v44m40 3v-21h16v21m990-5v-34h21v34m33 4v-53h42v53m48 2v-27h20v27"
                  fill="var(--color-scene-industrial)"
                />
                <g className="scene-journey-city">
                  <g className="scene-distant-lights scene-journey-lights" opacity="0.8">
                    <ellipse
                      cx="1390"
                      cy="294"
                      rx="10"
                      ry="2.3"
                      fill="var(--color-scene-headlight)"
                    />
                    <ellipse
                      cx="1410"
                      cy="294"
                      rx="10"
                      ry="2.3"
                      fill="var(--color-scene-headlight)"
                    />
                  </g>
                </g>
                <g className="scene-journey-arrival">
                  <path
                    d="M735 315v-27h18v27m12 0v-42h26v42m11 0v-34h21v34m13 0v-56h33v56m12 0v-30h20v30m12 0v-45h27v45"
                    fill="var(--color-scene-industrial)"
                  />
                  {[754, 777, 809, 842, 868, 900].map((x) => (
                    <circle
                      key={x}
                      cx={x}
                      cy="299"
                      r="2"
                      fill="var(--color-warning)"
                      opacity="0.7"
                    />
                  ))}
                </g>
              </g>
            ))}
          </g>

          {/* Layer 3: perspective asphalt, procedural grain, wet sheen and highway markings */}
          <path d="M265 318H1335L1600 500H0Z" fill="url(#scene-road)" />
          <g clipPath="url(#scene-road-clip)" aria-hidden="true">
            <g
              className="scene-scroll-loop scene-road-texture-track"
              data-testid="road-texture-track"
            >
              {SCROLL_COPIES.map((copyX) => (
                <rect
                  key={`texture-${copyX}`}
                  x={copyX}
                  y="318"
                  width={SCENE_WIDTH}
                  height="182"
                  fill="url(#scene-road)"
                  filter="url(#road-texture)"
                  opacity="0.15"
                />
              ))}
            </g>
          </g>
          <path
            d="M0 500 265 318h18L88 500Zm1600 0-265-182h-18l195 182Z"
            fill="var(--color-road-shoulder)"
            opacity="0.85"
          />
          <path
            d="M265 318H1335"
            stroke="var(--color-scene-edge-line)"
            strokeOpacity="0.4"
            strokeWidth="3"
          />
          <path
            d="M0 500 265 318m1335 0 265 182"
            fill="none"
            stroke="var(--color-scene-edge-line)"
            strokeOpacity="0.28"
            strokeWidth="3"
          />
          <path
            d="M0 489 248 319m1352 0 248 170"
            fill="none"
            stroke="var(--color-scene-metal-light)"
            strokeOpacity="0.22"
            strokeWidth="4"
          />
          <path
            d="M0 483 241 320m1366 0 241 163"
            fill="none"
            stroke="var(--color-scene-edge-line)"
            strokeOpacity="0.12"
            strokeWidth="1.5"
          />
          <path d="M265 318H1335L1600 500H0Z" fill="url(#scene-reflection)" />
          <path d="M0 486H1600V500H0Z" fill="var(--color-scene-verge)" />
          <g
            className="scene-scroll-loop scene-parallax-foreground"
            data-testid="reflector-track"
            aria-hidden="true"
          >
            {SCROLL_COPIES.map((copyX) => (
              <g key={`reflectors-${copyX}`} transform={`translate(${copyX} 0)`}>
                {Array.from({ length: 20 }, (_, index) => (
                  <g key={index} transform={`translate(${index * 80} 0)`}>
                    <rect
                      x="16"
                      y="478"
                      width="10"
                      height="4"
                      rx="1"
                      fill="var(--color-scene-reflector)"
                      opacity="0.88"
                    />
                    <rect
                      x="49"
                      y="478"
                      width="8"
                      height="4"
                      rx="1"
                      fill="var(--color-warning)"
                      opacity="0.68"
                    />
                  </g>
                ))}
              </g>
            ))}
          </g>
          <g
            className="scene-lane-track"
            data-testid="road-lines"
            data-moving={animationsActive ? "true" : "false"}
            opacity="0.48"
          >
            {Array.from({ length: 30 }, (_, index) => (
              <g key={index}>
                <rect
                  x={-120 + index * 60}
                  y="374"
                  width="36"
                  height="3"
                  rx="1.5"
                  fill="var(--color-scene-lane)"
                  opacity="0.3"
                />
                <rect
                  x={-120 + index * 60}
                  y="402"
                  width="40"
                  height="5"
                  rx="2.5"
                  fill="var(--color-scene-lane)"
                />
                <rect
                  x={-120 + index * 60}
                  y="432"
                  width="44"
                  height="6"
                  rx="3"
                  fill="var(--color-scene-lane)"
                  opacity="0.24"
                />
              </g>
            ))}
          </g>

          {/* Layer 4: kilometer posts, route progress marker and destination */}
          <g transform="translate(292 300)">
            <path d="M0 0v38" stroke="var(--color-scene-metal-dark)" strokeWidth="4" />
            <rect
              x="-23"
              y="-20"
              width="48"
              height="20"
              rx="2"
              fill="var(--color-scene-sign)"
              stroke="var(--color-scene-metal-light)"
              strokeWidth="1"
            />
            <text
              x="1"
              y="-7"
              textAnchor="middle"
              className="scene-svg-mono"
              fontSize="8"
              fill="var(--color-text-primary)"
            >
              KM 00
            </text>
          </g>
          <g
            className="scene-scroll-loop scene-parallax-roadside"
            data-testid="roadside-sign-track"
            aria-hidden="true"
          >
            {SCROLL_COPIES.map((copyX) => (
              <g key={`road-sign-${copyX}`} transform={`translate(${copyX + 1320} 0)`}>
                <path d="M0 302v111" stroke="var(--color-scene-metal-dark)" strokeWidth="4" />
                <rect
                  x="-66"
                  y="270"
                  width="132"
                  height="38"
                  rx="3"
                  fill="var(--color-scene-sign)"
                  stroke="var(--color-scene-metal-light)"
                  strokeWidth="1.5"
                />
                <text
                  x="0"
                  y="285"
                  textAnchor="middle"
                  className="scene-svg-mono"
                  fontSize="8"
                  letterSpacing="0.6"
                  fill="var(--color-text-primary)"
                >
                  {signDestinationLabel}
                </text>
                <text
                  x="0"
                  y="300"
                  textAnchor="middle"
                  className="scene-svg-mono"
                  fontSize="8"
                  fill="var(--color-accent)"
                >
                  {destinationDistance === null
                    ? "ROUTE AHEAD"
                    : `${destinationDistance.toFixed(0)} KM`}
                </text>
              </g>
            ))}
          </g>
          <g
            className="scene-destination-pin"
            transform="translate(1450 295)"
            data-testid="destination-pin"
          >
            <path
              d="M0 0v-23m0-14c-8 0-14 6-14 14s14 24 14 24 14-16 14-24-6-14-14-14Z"
              fill="var(--color-accent)"
              stroke="var(--color-text-primary)"
              strokeWidth="1.5"
            />
            <circle cy="-23" r="4" fill="var(--color-text-primary)" />
            <rect
              x="18"
              y="-41"
              width="102"
              height="19"
              rx="3"
              fill="var(--color-scene-sign)"
              stroke="var(--color-accent)"
              strokeWidth="1"
            />
            <text
              x="69"
              y="-28"
              textAnchor="middle"
              className="scene-svg-mono"
              fontSize="8"
              letterSpacing="1"
              fill="var(--color-accent)"
            >
              DESTINATION
            </text>
          </g>
          <g
            className="scene-route-progress-marker"
            transform={`translate(${310 + (safeProgress / 100) * 930} 0)`}
            data-testid="progress-marker"
            aria-label={`Route progress ${safeProgress}%`}
          >
            <path d="M0 329v42" stroke="var(--scene-status-color)" strokeWidth="2" opacity="0.7" />
            <circle
              cx="0"
              cy="328"
              r="6"
              fill="var(--scene-status-color)"
              stroke="var(--color-text-primary)"
              strokeWidth="2"
            />
          </g>

          {/* Layer 5: truck and status badges */}
          <Truck
            offset={truckOffset}
            moving={animationsActive}
            status={quarantined ? "red" : normalizedStatus}
            temperature={safeTemperature}
            humidity={safeHumidity}
            speed={safeSpeed}
            isQuarantined={quarantined}
            coasting={sceneCoasting}
            braking={sceneBraking}
            wheelDuration={wheelDuration}
          />
          {normalizedStatus === "amber" && !isQuarantined && (
            <g
              className="scene-warning-badge"
              transform={`translate(${Math.min(1180, Math.max(360, 650 + truckOffset))} 187)`}
              data-testid="warning-badge"
            >
              <path
                d="m0-19 21 37h-42Z"
                fill="var(--color-warning)"
                stroke="var(--color-scene-metal-light)"
                strokeWidth="1.5"
              />
              <text
                y="10"
                textAnchor="middle"
                fontWeight="700"
                fontSize="21"
                fill="var(--color-scene-badge-text)"
              >
                !
              </text>
            </g>
          )}
          {quarantined && (
            <g
              className="scene-quarantine-badge"
              transform={`translate(${Math.min(1080, Math.max(360, 710 + truckOffset))} 194)`}
              data-testid="quarantine-badge"
            >
              <rect
                x="-105"
                y="-18"
                width="210"
                height="37"
                rx="6"
                fill="var(--color-danger)"
                stroke="var(--color-scene-metal-light)"
                strokeOpacity="0.55"
                strokeWidth="1.5"
              />
              <text
                y="5"
                textAnchor="middle"
                className="scene-svg-mono"
                fontSize="15"
                fontWeight="700"
                letterSpacing="2"
                fill="var(--color-scene-badge-text)"
              >
                QUARANTINED
              </text>
            </g>
          )}

          {/* Layer 6: weather effects, in front of truck and road */}
          <WeatherLayer
            weatherState={normalizedWeather}
            active={!prefersReducedMotion && isVisible}
          />

          {/* Layer 7: near verge, foreground reflectors and distance readout */}
          {[90, 175, 1425, 1510].map((x, index) => (
            <rect
              key={x}
              x={x}
              y="472"
              width="15"
              height="4"
              rx="1"
              fill={index % 2 ? "var(--color-warning)" : "var(--color-scene-reflector)"}
              opacity="0.85"
            />
          ))}
          <g className="scene-km-readout" transform="translate(38 450)">
            <rect
              width="170"
              height="27"
              rx="3"
              fill="var(--color-scene-display)"
              stroke="var(--color-scene-metal-dark)"
            />
            <text
              x="10"
              y="18"
              className="scene-svg-mono"
              fontSize="11"
              letterSpacing="1"
              fill="var(--color-text-secondary)"
            >
              DISTANCE{" "}
            </text>
            <text
              x="164"
              y="18"
              textAnchor="end"
              className="scene-svg-mono"
              fontSize="11"
              fill="var(--color-scene-headlight)"
            >
              {currentKm === null ? "— KM" : `${currentKm.toFixed(1)} KM`}
            </text>
          </g>
        </svg>

        <div className="scene-overlay-top" aria-hidden="true">
          <span className="scene-chip">SIMULATED HIGHWAY</span>
          <span
            className={`scene-chip scene-chip-status scene-status-${isQuarantined ? "red" : normalizedStatus}`}
          >
            {statusLabel}
          </span>
          {normalizedWeather !== "clear" && (
            <span className="scene-chip">{normalizedWeather.toUpperCase()} SCENARIO</span>
          )}
        </div>
      </div>

      <div className="rounded-input border border-border bg-background/60 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-text-secondary">Route progress</span>
          <span
            className="operator-mono text-xs text-text-secondary"
            data-testid="route-progress-value"
          >
            {safeProgress.toFixed(0)}%
          </span>
        </div>
        <div
          aria-label="Route progress"
          aria-valuemax="100"
          aria-valuemin="0"
          aria-valuenow={safeProgress}
          className="h-2 overflow-hidden rounded-pill bg-surface-raised"
          role="progressbar"
        >
          <div
            className={`h-full rounded-pill ${quarantined || normalizedStatus === "red" ? "bg-danger" : normalizedStatus === "amber" ? "bg-warning" : normalizedStatus === "unknown" ? "bg-text-muted" : "bg-primary"}`}
            style={{ width: `${safeProgress}%` }}
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
