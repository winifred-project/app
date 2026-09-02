// Winifred: injectable clock and place (spec 5.16, DEV-1 to DEV-4).
//
// Two problems this solves. First, `now` was read straight from Date.now() in
// sixteen places, so nothing that takes days to happen could be looked at
// without waiting days: carried debt (BAR-5), a forfeited refill (BAR-7), the
// Blind Week reveal (BAR-3), the re-entry banner (SSN-5), day 28 (SSN-3).
// Second, the day boundary was computed against the device's ambient timezone,
// so none of the travel cases in section 5.15 could be reproduced at all except
// by changing the machine's system clock, which is impossible on a phone.
//
// Both are fixed the same way: time and place become explicit parameters with
// the real ones as defaults. In a production build nothing ever sets an
// override, so every function here returns exactly what the ambient device
// would have returned (DEV-1).
//
// Day maths is done through Intl rather than through the Date object's local
// methods, because Intl can be pointed at any IANA zone and carries that zone's
// real DST history. That is what makes "as if I were in Sydney last March" a
// thing the app can be shown, rather than a thing a test asserts.

const HOUR = 3600 * 1000;
export const DAY_BOUNDARY_HOUR = 5; // spec section 4

// ---- zone-aware calendar arithmetic -------------------------------------

const fmtCache = new Map();
function fmt(zone) {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(zone, f);
  }
  return f;
}

// The wall-clock reading in `zone` at instant `t`.
export function partsIn(t, zone) {
  const p = {};
  for (const part of fmt(zone).formatToParts(t)) if (part.type !== "literal") p[part.type] = part.value;
  let h = Number(p.hour);
  if (h === 24) h = 0; // en-GB with hour12:false renders midnight as 24
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h, mi: Number(p.minute), s: Number(p.second) };
}

export function hourIn(t, zone) { return partsIn(t, zone).h; }

// UTC offset in ms that `zone` was on at instant `t`. Positive east of UTC.
export function offsetMsAt(t, zone) {
  const p = partsIn(t, zone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}

// The instant at which `zone` reads the given wall clock. Two passes: the first
// guess uses the offset at the wrong instant, which is only wrong near a
// transition, and the second lands it. Where a wall clock does not exist (the
// hour skipped in spring) this returns the instant the clock jumps to, which is
// the behaviour the day boundary wants.
export function instantOf(zone, y, mo, d, h, mi) {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const first = wall - offsetMsAt(wall, zone);
  return wall - offsetMsAt(first, zone);
}

// The 05:00 day boundary that the shipped build computes: local midnight of the
// date, plus five hours of absolute time. On a day whose UTC offset changes
// between midnight and 05:00 this lands an hour out, which is the TIM-5 defect.
// Kept so the defect stays reproducible in the dev panel and in the harness
// until TIM-5 lands; `dayStartTrue` is what replaces it.
export function dayStartLegacy(t, zone) {
  const p = partsIn(t - DAY_BOUNDARY_HOUR * HOUR, zone);
  return instantOf(zone, p.y, p.mo, p.d, 0, 0) + DAY_BOUNDARY_HOUR * HOUR;
}

// TIM-5: 05:00 on the local calendar date, derived directly.
// TIM-5: which day a moment belongs to, and when that day began.
//
// Both are derived from the wall clock, by asking what the local reading is and
// stepping the date back if it is before 05:00. The obvious alternative, and the
// one this replaced twice, is to rewind five hours of absolute time and read the
// date off that. Those are equivalent only while the offset holds constant
// across the window, so on every clock-change day there is a one-hour band that
// gets the wrong date: London 05:30 on 29 March filed as the 28th, and London
// 04:30 on 26 October filed as the 26th, which makes a Saturday-night drink read
// as Sunday and defeats the "a late Friday counts as Friday" rule outright. The
// first fix here corrected the hour the boundary lands on and left the date
// wrong, which is why the second one derives the date first and the boundary
// from it, rather than the other way round.
export function dayKeyIn(t, zone) {
  const p = partsIn(t, zone);
  const key = keyOfParts(p);
  return p.h < DAY_BOUNDARY_HOUR ? nextDayKey(key, -1) : key;
}
export function dayStartTrue(t, zone) { return boundaryOfKey(dayKeyIn(t, zone), zone); }

// Must use the same derivation as dayStartTrue, or a walk that starts on a
// boundary steps off the grid at a transition and never lines up with the
// per-day totals again. The existing British Summer Time case caught exactly
// that when only dayStart was switched over.
export function addDaysIn(boundaryMs, n, zone) {
  return boundaryOfKey(nextDayKey(dayKeyIn(boundaryMs, zone), n), zone);
}

// ---- day keys as the unit of account (TIM-1) ----------------------------
//
// Once a log entry carries its own frozen day, the walk that drives capacity is
// over calendar dates rather than over instants, and these are the arithmetic
// for that. They take no zone: a date is a date, which is the whole point of
// freezing it. ISO order is chronological order, so `<` and `sort()` work.

export function nextDayKey(key, n) {
  const [y, mo, d] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, mo - 1, d + n));
  return keyOfUTC(shifted);
}
// Stable, sortable, and the shape TIM-1 freezes onto a log entry.
function keyOfParts(p) {
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
function keyOfUTC(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
export function daysBetweenKeys(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / (24 * HOUR));
}
// The instant a given day began, for labelling and for the log's time display.
export function boundaryOfKey(key, zone) {
  const [y, mo, d] = key.split("-").map(Number);
  return instantOf(zone, y, mo, d, DAY_BOUNDARY_HOUR, 0);
}
export function weekdayOfKey(key) {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

// TIM-1/TIM-2: freezing a log's day, as a pure function so the migration can be
// tested directly rather than through the component that calls it.
export function freezeLogDays(logs, zone) {
  return (logs || []).map((l) => {
    if (l.day && l.tzo != null) return l;
    // Each field is backfilled on its own. Gating the pair on `day` alone left
    // an entry that had a day and no offset without one for ever.
    return {
      ...l,
      day: l.day || dayKeyIn(l.t, zone),
      tzo: l.tzo != null ? l.tzo : Math.round(offsetMsAt(l.t, zone) / 60000),
    };
  });
}

// TIM-7: the clock time an entry was logged at, in the place it was logged, with
// the offset named. A drink logged at 02:00 in Sydney rendered as a bare 02:00 to
// a reader in London is a true number shown misleadingly, and rendering it at the
// reader's own local time, which is what an unqualified formatter does, is worse.
export function offsetLabel(mins) {
  const sign = mins < 0 ? "-" : "+";
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
export function entryTime(l, zone) {
  const here = Math.round(offsetMsAt(l.t, zone) / 60000);
  const there = l.tzo != null ? l.tzo : here;
  const shifted = new Date(l.t + there * 60000);
  const hm = `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
  return there === here ? hm : `${hm} ${offsetLabel(there)}`;
}

// The Monday this day belongs to. Stepped, and anchored on 05:00 like every
// other boundary: the previous version was local midnight plus five absolute
// hours, the formula TIM-5 bans, and it was only ever harmless because a clock
// change almost never falls on a Monday.
export function weekStartKeyIn(t, zone) {
  const key = dayKeyIn(t, zone);
  return nextDayKey(key, -((weekdayOfKey(key) + 6) % 7));
}
export function weekStartIn(t, zone) { return boundaryOfKey(weekStartKeyIn(t, zone), zone); }

// ---- state backfill and the day clamp (TIM-2, TIM-4) --------------------
//
// Both live here, as pure functions of their inputs, so they can be tested
// directly. The first versions lived inside the component and were covered only
// by source-text greps asserting they were called, which is how a migration
// that ran and did nothing passed every test around it.

export function backfillState(s, zone) {
  const out = { ...s };
  out.logs = freezeLogDays(out.logs, zone);
  if (out.seasonStart && !out.seasonStartDay) out.seasonStartDay = dayKeyIn(out.seasonStart, zone);
  out.predictions = (out.predictions || []).map((p) => {
    if (!p || !p.weekendStartT) return p;
    const a = p.weekendKey ? p : { ...p, weekendKey: dayKeyIn(p.weekendStartT, zone) };
    return a.weekendEndKey || !p.weekendEnd ? a : { ...a, weekendEndKey: dayKeyIn(p.weekendEnd, zone) };
  });
  // Never downgrade: an export from a later build carries a higher number, and
  // this records what has run rather than overwriting what already did.
  out.stateVersion = Math.max(Number(out.stateVersion) || 1, STATE_VERSION);
  return out;
}

// TIM-4: advance, never retreat, with one exception. A mark implausibly far
// ahead of the device's own day is discarded rather than honoured: the
// legitimate case is a westward date-line crossing, worth about twenty-six
// hours at most, so anything past two days came from a clock that was briefly
// wrong or from state written under a simulated one. Without the ceiling the
// clamp is a one-way ratchet that survives export and re-import, and a mark a
// year ahead leaves the bar permanently full and the log showing nothing but
// collapsed dry days, recoverable only by deleting everything.
export const MAX_DAY_LEAD = 2;
export function clampDaySeen(stored, rawToday) {
  if (stored && stored > nextDayKey(rawToday, MAX_DAY_LEAD)) return rawToday;
  return !stored || rawToday > stored ? rawToday : stored;
}

// ---- the override itself ------------------------------------------------

function systemZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
}

const DEV = typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;
const SESSION_KEY = "winifred-devclock";

let override = null; // { offsetMs, zone } or null. Never set outside DEV.
const listeners = new Set();

if (DEV) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) override = JSON.parse(raw);
  } catch (e) { /* fine */ }
}

export const isDev = !!DEV;
export function activeZone() { return (override && override.zone) || systemZone(); }
export function realZone() { return systemZone(); }
export function nowMs() { return Date.now() + ((override && override.offsetMs) || 0); }
export function clockOffsetMs() { return (override && override.offsetMs) || 0; }
export function isOverridden() { return !!override && (override.offsetMs !== 0 || override.zone !== systemZone()); }

// DEV-1: a production build has no caller for this, and the guard means a stray
// one would do nothing rather than shifting a real user's day.
export function setDevClock(next) {
  if (!DEV) return;
  override = next ? { offsetMs: next.offsetMs || 0, zone: next.zone || systemZone() } : null;
  try {
    if (override) sessionStorage.setItem(SESSION_KEY, JSON.stringify(override));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch (e) { /* fine */ }
  listeners.forEach((fn) => fn());
}
export function getDevClock() { return override ? { ...override } : { offsetMs: 0, zone: systemZone() }; }
export function onDevClock(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---- storage keys and the dev sandbox (DEV-2) ---------------------------
//
// Simulated time can fabricate an evening that never happened. That must never
// land in the user's own history, so while the sandbox is on the app reads and
// writes a separate key. Real state stays readable, which is the useful half:
// you can copy it in and then fast-forward a copy of your actual fortnight.

// TIM-2 advances the key, because the migration derives a field per log entry
// and cannot be expressed as a defaults merge. DAT-1's merge still runs on top.
export const STATE_VERSION = 2;
export const REAL_KEY = "winifred-state-v2";
export const LEGACY_KEYS = ["winifred-state-v1", "lastorders-state-v3"];
export const SANDBOX_KEY = "winifred-state-sandbox";
const SANDBOX_FLAG = "winifred-devsandbox";

let sandbox = false;
if (DEV) {
  try { sandbox = sessionStorage.getItem(SANDBOX_FLAG) === "1"; } catch (e) { /* fine */ }
}

export function isSandbox() { return !!sandbox; }
export function setSandbox(on) {
  if (!DEV) return;
  sandbox = !!on;
  try {
    if (sandbox) sessionStorage.setItem(SANDBOX_FLAG, "1");
    else sessionStorage.removeItem(SANDBOX_FLAG);
  } catch (e) { /* fine */ }
  listeners.forEach((fn) => fn());
}
// DEV-2: an override makes the store the sandbox whether or not the sandbox
// switch was thrown. The two were independent toggles, so a shifted clock with
// the sandbox off wrote a simulated day into the real store's high-water mark on
// the next load, which the panel's own copy said could not happen. In a
// production build neither can be set, so this is always REAL_KEY.
export function storeKey() { return sandbox || isOverridden() ? SANDBOX_KEY : REAL_KEY; }
