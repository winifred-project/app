import React from "react";
import ReactDOM from "react-dom/client";
import Winifred from "./App.jsx";
import { initUpdates } from "./updates.js";

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
