import React from "react";
import ReactDOM from "react-dom/client";
import Winifred from "./App.jsx";
import { initUpdates } from "./updates.js";

// Registers the service worker and starts looking for new releases. Kept out
// of the component so a render never affects whether updates are checked for.
initUpdates();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Winifred />
  </React.StrictMode>
);
