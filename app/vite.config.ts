import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
import { awBridge } from "./vite.aw-bridge";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), awBridge()],

  // Keep Rust errors visible in `tauri dev`.
  clearScreen: false,
  server: {
    // Tauri expects a fixed port.
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    // browser dev mode talks to a running Tempro backend (debug builds expose /api/call)
    // TEMPRO_API points it at a side instance (see side_instance in src-tauri/src/lib.rs)
    proxy: { "/api/call": process.env.TEMPRO_API ?? "http://127.0.0.1:5601" },
  },
}));
