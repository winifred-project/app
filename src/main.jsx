import React from "react";
import ReactDOM from "react-dom/client";
import Winifred from "./App.jsx";
import { initUpdates } from "./updates.js";
import { lockViewportScale } from "./viewportlock.js";

// NFR-10: iOS Safari has ignored `user-scalable=no` for pinch since iOS 10, so
// the meta tag alone leaves the app zoomable on the one device it is built for.
// Run before render, since a gesture is possible from the first paint.
lockViewportScale();

// Registers the service worker and starts looking for new releases. Kept out
// of the component so a render never affects whether updates are checked for.
initUpdates();

// DEV-1: the dev clock panel (spec 5.16) is pulled in dynamically inside a
// dead branch, so Rollup drops the module from a production build entirely
// rather than shipping it behind a runtime flag.
if (import.meta.env.DEV) {
  import("./DevPanel.jsx").then((m) => m.mountDevPanel()).catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Winifred />
  </React.StrictMode>
);
