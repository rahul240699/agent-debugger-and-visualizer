import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        node: {
          pending: "#6B7280",
          active: "#FCD34D",
          success: "#10B981",
          alert: "#EF4444",
        },
      },
      animation: {
        pulse_node: "pulse_node 1.5s ease-in-out infinite",
        shake: "shake 0.4s ease-in-out",
      },
      keyframes: {
        pulse_node: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(252, 211, 77, 0.7)" },
          "50%": { boxShadow: "0 0 0 8px rgba(252, 211, 77, 0)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-4px)" },
          "40%, 80%": { transform: "translateX(4px)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
