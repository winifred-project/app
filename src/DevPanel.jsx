import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import {
  nowMs, activeZone, realZone, getDevClock, setDevClock, onDevClock, isOverridden,
  partsIn, hourIn, dayKeyIn, dayStartLegacy, dayStartTrue, offsetMsAt,
  isSandbox, setSandbox, SANDBOX_KEY, REAL_KEY,
} from "./devclock.js";

// Winifred dev panel (spec 5.16, DEV-1 to DEV-4). Never reaches a production
// build: main.jsx imports this file dynamically inside an import.meta.env.DEV
// branch, so the whole module is dropped rather than merely unreferenced.
//
// It deliberately shows no figures of its own. The point is to look at the real
// bar, the real log and the real companion under a chosen time and place, so
// duplicating capacity here would just create a second number to disagree with.

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const ZONES = [
  ["System", null],
  ["London", "Europe/London"],
  ["New York", "America/New_York"],
  ["Dubai", "Asia/Dubai"],
  ["Sydney", "Australia/Sydney"],
  ["Auckland", "Pacific/Auckland"],
  ["Honolulu", "Pacific/Honolulu"],
];

// DEV-3: the scenarios that section 5.15 was written about, one tap each.
const SCENARIOS = [
  { label: "Spring forward", zone: "Europe/London", at: "2026-03-29T12:00:00Z",
    note: "clocks go forward at 01:00. The boundary should hold at 05:00 (TIM-5)." },
  { label: "Autumn back", zone: "Europe/London", at: "2026-10-25T12:00:00Z",
    note: "clocks go back at 02:00. The boundary should hold at 05:00 (TIM-5)." },
  { label: "Fly to Sydney", zone: "Australia/Sydney", keepInstant: true,
    note: "same instant, +11. Capacity, the log and the map should not move at all (TIM-1)." },
  { label: "Fly to New York", zone: "America/New_York", keepInstant: true,
    note: "same instant, -4. Nothing in the history should change (TIM-1)." },
  { label: "Fly home", zone: "Europe/London", keepInstant: true,
    note: "back to London. The history should look exactly as it did before you left." },
  // The clamp only engages once something has been written on the later day, so
  // the crossing is two taps with a drink logged in between. Saying so beats a
  // one-tap scenario that quietly demonstrates nothing.
  { label: "Auckland first", zone: "Pacific/Auckland", at: "2026-09-05T00:00:00Z",
    note: "5 Sept, midday in Auckland. Log a drink here, then take Date line west (TIM-4)." },
  { label: "Date line west", zone: "Pacific/Honolulu", at: "2026-09-05T09:00:00Z",
    note: "landed in Honolulu on 4 Sept having left Auckland on the 5th. The day should hold, not retreat (TIM-4)." },
];

const box = {
  position: "fixed", right: 10, bottom: 10, zIndex: 2147483000,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11,
  color: "#dfe9ec",
};
const sheet = {
  background: "#0b1215", border: "1px solid #24343a", borderRadius: 10,
  padding: 10, width: 274, boxShadow: "0 8px 28px rgba(0,0,0,.55)",
  maxHeight: "80vh", overflowY: "auto",
};
const btn = {
  background: "#16242a", border: "1px solid #2b3d44", color: "#dfe9ec",
  borderRadius: 6, padding: "4px 7px", fontSize: 11, cursor: "pointer",
  fontFamily: "inherit", minHeight: 26,
};
const row = { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 };
const label = { color: "#7e959d", marginTop: 8, marginBottom: 2, letterSpacing: ".04em", textTransform: "uppercase", fontSize: 9 };

function fmtWall(t, zone) {
  const p = partsIn(t, zone);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(p.d)}/${pad(p.mo)}/${p.y} ${pad(p.h)}:${pad(p.mi)}`;
}
function fmtOffset(ms) {
  const mins = Math.round(ms / 60000);
  const sign = mins < 0 ? "-" : "+";
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

function DevPanel() {
  const [, bump] = useState(0);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  // TIM-4 is about a day going backwards, which you cannot see in a single
  // reading. Holding the furthest day this session has reached turns it into
  // something on screen rather than something to remember.
  const [highWater, setHighWater] = useState(null);
  useEffect(() => onDevClock(() => bump((n) => n + 1)), []);
  useEffect(() => { const id = setInterval(() => bump((n) => n + 1), 1000); return () => clearInterval(id); }, []);

  const clock = getDevClock();
  const zone = activeZone();
  const t = nowMs();
  // The app uses dayStartTrue since TIM-5 landed. The legacy derivation is kept
  // alongside so this panel can say when today is one of the two days it used to
  // get wrong, which is how you tell a transition day is actually being tested
  // rather than merely selected.
  const legacy = dayStartLegacy(t, zone);
  const proper = dayStartTrue(t, zone);
  const wouldHaveDrifted = legacy !== proper;
  const regressed = hourIn(proper, zone) !== 5;
  const on = isOverridden() || isSandbox();
  const dk = dayKeyIn(t, zone);
  const wentBack = highWater && dk < highWater;
  useEffect(() => { if (!highWater || dk > highWater) setHighWater(dk); }, [dk, highWater]);

  const shift = (ms) => setDevClock({ ...clock, offsetMs: clock.offsetMs + ms });
  const goTo = (instant) => setDevClock({ ...clock, offsetMs: instant - Date.now() });
  const setZone = (z) => setDevClock({ ...clock, zone: z || realZone() });

  function nextBoundary() {
    // The app's derivation, not the superseded one. Using the old one here sent
    // "next 05:00" to 06:00 or 04:00 on exactly the two days this panel exists
    // to exercise.
    let b = dayStartTrue(t, zone);
    while (b <= t) b = dayStartTrue(b + 26 * HOUR, zone);
    goTo(b + 60 * 1000);
  }

  function runScenario(sc) {
    const instant = sc.keepInstant ? t : Date.parse(sc.at);
    setDevClock({ zone: sc.zone, offsetMs: instant - Date.now() });
    setNote(sc.note);
  }

  // DEV-2: simulated time only ever writes into the sandbox key, so a fabricated
  // evening can never land in the user's own history.
  function readStore(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function copyRealIntoSandbox() {
    const real = readStore(REAL_KEY);
    if (!real) { setNote("No real state to copy yet."); return; }
    localStorage.setItem(SANDBOX_KEY, JSON.stringify(real));
    setNote("Copied your real state into the sandbox. Reloading.");
    setTimeout(() => location.reload(), 350);
  }
  function seedFortnight() {
    const base = readStore(SANDBOX_KEY) || { onboarded: true, budget: 14, companionName: "Winifred" };
    const logs = [];
    // Two weeks ending now: moderate most days, one heavy Saturday, two dry runs.
    for (let d = 13; d >= 0; d--) {
      const dayAt = t - d * DAY;
      const wd = new Date(dayAt).getUTCDay();
      const heavy = wd === 6;
      const dry = d === 9 || d === 8 || d === 3;
      if (dry) continue;
      const n = heavy ? 4 : 2;
      for (let i = 0; i < n; i++) {
        logs.push({ t: dayAt - (20 - i) * HOUR + 22 * HOUR, units: heavy ? 2.3 : 1.4, cost: 5.4, label: heavy ? "Pint out" : "Glass of wine" });
      }
    }
    const next = {
      ...base, onboarded: true, logs, seasonStart: t - 13 * DAY, lastOpen: t,
      // Onboarding routes to the AI wizard until a tier is chosen (ONB, AIW-1),
      // so a seed without one never reaches the home screen.
      ai: { tier: "templates", cloudConsent: false, modelDownloaded: false, ...(base.ai || {}) },
    };
    if (!next.ai.tier) next.ai.tier = "templates";
    localStorage.setItem(SANDBOX_KEY, JSON.stringify(next));
    setNote(`Seeded ${logs.length} drinks across a fortnight. Reloading.`);
    setTimeout(() => location.reload(), 350);
  }
  function toggleSandbox() {
    setSandbox(!isSandbox());
    setTimeout(() => location.reload(), 200);
  }

  if (!open) {
    return (
      <div style={box}>
        <button onClick={() => setOpen(true)} style={{ ...btn, background: on ? "#3d2a12" : "#16242a", borderColor: on ? "#7a5320" : "#2b3d44" }}>
          {on ? `${isSandbox() ? "sandbox " : ""}${fmtWall(t, zone)} ${zone.split("/").pop()}` : "dev clock"}
        </button>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={sheet}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Dev clock</strong>
          <button onClick={() => setOpen(false)} style={{ ...btn, padding: "2px 7px" }}>hide</button>
        </div>

        <div style={label}>now</div>
        <div>{fmtWall(t, zone)} <span style={{ color: "#7e959d" }}>{zone} {fmtOffset(offsetMsAt(t, zone))}</span></div>
        <div style={{ color: "#7e959d" }}>
          real {fmtWall(Date.now(), realZone())} {realZone()}
        </div>

        <div style={label}>this 05:00 day</div>
        <div>{dk}, boundary at {fmtWall(proper, zone).slice(-5)}</div>
        {wentBack && (
          <div style={{ color: "#e0a458", marginTop: 3, lineHeight: 1.45 }}>
            TIM-4: today has gone backwards. This session already reached {highWater}, so entries can now be filed behind the current day.
          </div>
        )}
        {regressed && (
          <div style={{ color: "#e0a458", marginTop: 3, lineHeight: 1.45 }}>
            TIM-5 regression: the boundary is at {fmtWall(proper, zone).slice(-5)} and must be 05:00.
          </div>
        )}
        {wouldHaveDrifted && !regressed && (
          <div style={{ color: "#7e959d", marginTop: 3, lineHeight: 1.45 }}>
            A clock change day. The old derivation put this boundary at {fmtWall(legacy, zone).slice(-5)}; TIM-5 holds it at 05:00.
          </div>
        )}

        <div style={label}>place</div>
        <div style={row}>
          {ZONES.map(([name, z]) => (
            <button key={name} onClick={() => setZone(z)}
              style={{ ...btn, background: (z || realZone()) === zone ? "#24404a" : "#16242a" }}>{name}</button>
          ))}
        </div>

        <div style={label}>time</div>
        <div style={row}>
          <button style={btn} onClick={() => shift(-7 * DAY)}>-7d</button>
          <button style={btn} onClick={() => shift(-DAY)}>-1d</button>
          <button style={btn} onClick={() => shift(-HOUR)}>-1h</button>
          <button style={btn} onClick={() => shift(HOUR)}>+1h</button>
          <button style={btn} onClick={() => shift(DAY)}>+1d</button>
          <button style={btn} onClick={() => shift(7 * DAY)}>+7d</button>
        </div>
        <div style={row}>
          <button style={btn} onClick={nextBoundary}>next 05:00</button>
          <button style={btn} onClick={() => { setDevClock(null); setHighWater(null); setNote(""); }}>real now</button>
        </div>

        <div style={label}>scenarios</div>
        <div style={row}>
          {SCENARIOS.map((sc) => (
            <button key={sc.label} style={btn} onClick={() => runScenario(sc)}>{sc.label}</button>
          ))}
        </div>

        <div style={label}>state</div>
        <div style={row}>
          <button style={{ ...btn, background: isSandbox() ? "#3d2a12" : "#16242a" }} onClick={toggleSandbox}>
            sandbox {isSandbox() ? "on" : "off"}
          </button>
          <button style={btn} disabled={!isSandbox()} onClick={copyRealIntoSandbox}>copy real in</button>
          <button style={btn} disabled={!isSandbox()} onClick={seedFortnight}>seed fortnight</button>
        </div>
        {!isSandbox() && (
          <div style={{ color: "#7e959d", marginTop: 4, lineHeight: 1.45 }}>
            Seeding is sandbox-only (DEV-2). Your real history is read-only from here.
          </div>
        )}

        {note && <div style={{ color: "#9fb4bb", marginTop: 8, lineHeight: 1.5 }}>{note}</div>}
      </div>
    </div>
  );
}

export function mountDevPanel() {
  const host = document.createElement("div");
  host.id = "winifred-dev-panel";
  document.body.appendChild(host);
  ReactDOM.createRoot(host).render(<DevPanel />);
}
