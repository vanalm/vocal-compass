import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // The API's APP_BASE_URL and origin check expect exactly this port, so never drift to another.
    port: 5199,
    strictPort: true,
    // Same origin in development as in production: the session cookie rides along and CORS never applies.
    proxy: { "/api": "http://localhost:8799" },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
} as never);
