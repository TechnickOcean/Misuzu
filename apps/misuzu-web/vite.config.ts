import { resolve } from "node:path"
import { defineConfig } from "vite-plus"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/client"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist/client",
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
})
