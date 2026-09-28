/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0A0F1E",
        surface: "#111827",
        "surface-raised": "#1F2937",
        border: "#1E3A5F",
        primary: "#10B981",
        "primary-dark": "#059669",
        "primary-glow": "rgba(16, 185, 129, 0.15)",
        accent: "#3B82F6",
        warning: "#F59E0B",
        danger: "#EF4444",
        "danger-glow": "rgba(239, 68, 68, 0.20)",
        "text-primary": "#F9FAFB",
        "text-secondary": "#9CA3AF",
        "text-muted": "#4B5563",
        night: "#0F172A",
        "road-asphalt": "#1C1C1E",
        "road-shoulder": "#374151",
        "road-marking": "#D1D5DB",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        card: "12px",
        input: "8px",
      },
      boxShadow: {
        glow: "0 0 24px rgba(16, 185, 129, 0.08)",
      },
      transitionDuration: {
        state: "200ms",
        layout: "400ms",
      },
    },
  },
  plugins: [],
};
