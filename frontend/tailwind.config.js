/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f1f8f3",
          100: "#e1f0e5",
          200: "#c6e2cd",
          300: "#9dceb0",
          400: "#6db38a",
          500: "#438f66",
          600: "#2d7652",
          700: "#225f43",
          800: "#1c4c37",
          900: "#173e2f",
          950: "#0d261c",
        },
        surface: {
          page: "#f4f7f5",
          muted: "#f7faf8",
          raised: "#ffffff",
        },
        ink: {
          500: "#64756a",
          700: "#34463b",
          800: "#26392e",
          900: "#1b2c22",
        },
        border: {
          soft: "#e1e9e3",
          strong: "#cbd9cf",
        },
      },
      spacing: {
        page: "1.75rem",
        section: "1.25rem",
        18: "4.5rem",
      },
      fontSize: {
        label: ["0.75rem", { lineHeight: "1rem" }],
        caption: ["0.8125rem", { lineHeight: "1.25rem" }],
      },
      borderRadius: {
        control: "0.625rem",
        card: "0.875rem",
        panel: "1rem",
      },
      boxShadow: {
        panel: "0 1px 3px rgba(18, 50, 31, 0.06), 0 8px 24px rgba(18, 50, 31, 0.04)",
        sidebar: "2px 0 12px rgba(13, 38, 28, 0.08)",
        elevated: "0 10px 30px rgba(18, 50, 31, 0.10)",
        focus: "0 0 0 3px rgba(67, 143, 102, 0.18)",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
