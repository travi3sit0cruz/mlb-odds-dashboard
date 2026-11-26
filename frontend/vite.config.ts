import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy /api calls to the backend during `bun run dev` so you can run
    // frontend in hot-reload mode (port 5173) while backend runs on 4000.
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
