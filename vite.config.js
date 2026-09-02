import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// A build is identified by the commit it was built from, so there is no
// version number to remember to bump and no way for the label to drift from
// what actually shipped. This is only a label: whether a new build exists is
// decided by the service worker comparing its own precache manifest, which
// changes whenever any asset does.
function buildId() {
  // GitHub Actions sets this; it is the commit being deployed.
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    const git = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const sha = git("git rev-parse --short=7 HEAD");
    // A local build with uncommitted changes is not the commit it claims to
    // be, and saying so has saved more than one confused hour.
    return git("git status --porcelain") ? `${sha}+` : sha;
  } catch (e) {
    return "dev";
  }
}

const BUILD_ID = buildId();
const BUILD_DATE = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// base must match the GitHub Pages project path
// (https://winifred-project.github.io/app/), otherwise the built asset
// URLs resolve to the domain root and nothing loads.
const BASE = "/app/";

// host: true binds 0.0.0.0 so the dev server is reachable from other
// devices on your LAN (your phone). usePolling makes file-watching work
// reliably inside Docker bind mounts.
export default defineConfig({
  base: BASE,
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
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
