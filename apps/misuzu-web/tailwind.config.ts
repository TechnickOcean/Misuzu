import type { Config } from "tailwindcss"

export default {
  darkMode: "class",
  content: ["./index.html", "./src/client/**/*.{vue,ts}", "./src/shared/**/*.ts"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config
