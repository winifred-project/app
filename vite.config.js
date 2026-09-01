import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true binds 0.0.0.0 so the dev server is reachable from other
// devices on your LAN (your phone). usePolling makes file-watching work
// reliably inside Docker bind mounts.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: { usePolling: true },
  },
});
