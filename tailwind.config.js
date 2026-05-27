/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        mono: ["SF Mono", "ui-monospace", "Menlo", "monospace"],
      },
      colors: {
        slick: {
          bg: "#0a0a0a",
          surface: "rgba(0, 0, 0, 0.38)",
          border: "rgba(255, 255, 255, 0.14)",
          text: "#fafafa",
          subtle: "#a3a3a3",
          muted: "#737373",
        },
      },
      boxShadow: {
        "text-legible": "0 1px 3px rgba(0,0,0,0.9), 0 0 16px rgba(0,0,0,0.55)",
      },
      animation: {
        "fade-in": "fadeIn 120ms ease-out",
        "pulse-slow": "pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px) scale(0.99)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
