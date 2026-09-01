import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The version people can read in Settings and quote back to you when
// something is wrong. Single source of truth: bump it in package.json.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// base must match the GitHub Pages project path
// (https://winifred-project.github.io/app/), otherwise the built asset
// URLs resolve to the domain root and nothing loads.
const BASE = "/app/";

// host: true binds 0.0.0.0 so the dev server is reachable from other
// devices on your LAN (your phone). usePolling makes file-watching work
// reliably inside Docker bind mounts.
export default defineConfig({
  base: BASE,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      // "prompt", not "autoUpdate": an automatic reload can land in the middle
      // of a craving encounter or a hard conversation, and P1 says that must
      // never happen. src/updates.js checks for new builds on resume; the app
      // asks before reloading, and a waiting build applies itself on the next
      // cold start anyway.
      registerType: "prompt",
      // We call registerSW ourselves in src/updates.js, so nothing should be
      // injected into index.html or the worker gets registered twice.
      injectRegister: null,
      includeAssets: ["apple-touch-icon.png", "favicon-32.png", "icon.svg"],
      manifest: {
        // Deliberately incurious naming: this appears on the home screen
        // and in the app switcher, where other people can see it
        // (spec section 3). No description of what the app is for.
        name: "Winifred",
        short_name: "Winifred",
        lang: "en-GB",
        id: BASE,
        start_url: BASE,
        scope: BASE,
        display: "standalone",
        orientation: "portrait",
        theme_color: "#10191d",
        background_color: "#10191d",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the whole shell: the app must run with no network at
        // all (NFR-2). No runtime caching rules, because the app makes
        // no third-party requests (NFR-1).
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        cleanupOutdatedCaches: true,
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: { usePolling: true },
  },
});
