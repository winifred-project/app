// Release delivery: how a home-screen install finds out a new build exists.
//
// The whole app shell is precached so it runs with no network at all (NFR-2),
// which means a launch from the home screen never touches the server. A new
// build is only noticed when something explicitly asks the service worker to
// look, and nothing did. On iOS especially, a home-screen app is frozen and
// resumed rather than reloaded, so `load` can fail to fire for weeks and a
// person can sit on an old version indefinitely.
//
// So: check when the app comes back to the foreground, when the connection
// returns, and hourly while it is open. The decision about *when* to reload
// stays with the app, never with this module: a silent reload landing in the
// middle of a craving encounter or a hard conversation is exactly the kind of
// thing P1 exists to prevent.

import { registerSW } from "virtual:pwa-register";

const CHECK_INTERVAL = 60 * 60 * 1000;

// Injected by Vite from package.json (see vite.config.js).
export const APP_VERSION = __APP_VERSION__;

let updateSW = null; // returned by registerSW; call with true to apply and reload
let registration = null;
let ready = false; // a new build is installed and waiting
const listeners = new Set();

function announce() {
  if (ready) return;
  ready = true;
  listeners.forEach((fn) => {
    try { fn(); } catch (e) { /* a listener must never break the check */ }
  });
}

function look() {
  if (!registration) return Promise.resolve();
  if (navigator.onLine === false) return Promise.resolve();
  return registration.update().catch(() => { /* offline or server down; try again later */ });
}

export function initUpdates() {
  if (updateSW || !("serviceWorker" in navigator)) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: announce,
    onRegisteredSW(swUrl, r) {
      if (!r) return;
      registration = r;
      // A build that installed during a previous session is already waiting.
      if (r.waiting) announce();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") look();
      });
      window.addEventListener("online", look);
      setInterval(look, CHECK_INTERVAL);
    },
  });
}

export function isUpdateReady() { return ready; }

export function onUpdateReady(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Registration is asynchronous, so a check run seconds after launch can land
// before onRegisteredSW has fired. Ask the browser directly rather than
// telling an installed user that updates are unavailable.
async function currentRegistration() {
  if (registration) return registration;
  if (!("serviceWorker" in navigator)) return null;
  try {
    registration = (await navigator.serviceWorker.getRegistration()) || null;
  } catch (e) {
    registration = null;
  }
  return registration;
}

// "ready" | "current" | "offline" | "unavailable"
export async function checkForUpdate() {
  if (ready) return "ready";
  const reg = await currentRegistration();
  if (!reg) return "unavailable";
  if (navigator.onLine === false) return "offline";
  try {
    await reg.update();
  } catch (e) {
    return "offline";
  }
  // update() resolves once the check completes, but the worker finishes
  // installing a moment later, so give onNeedRefresh a beat to fire.
  await new Promise((r) => setTimeout(r, 400));
  if (reg.waiting) announce();
  return ready ? "ready" : "current";
}

export function applyUpdate() {
  if (!updateSW) {
    window.location.reload();
    return;
  }
  updateSW(true);
  // The reload is workbox's job, once the new worker takes control. If that
  // does not happen, reload anyway rather than leave a button that appears
  // to do nothing; the waiting build activates on the next launch regardless.
  setTimeout(() => window.location.reload(), 3000);
}
