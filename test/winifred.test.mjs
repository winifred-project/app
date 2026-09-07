// Winifred test harness. Zero dependencies: run with `node test/winifred.test.mjs`.
//
// The app is still one component (spec section 8, accepted debt), so rather than
// importing from src/App.jsx this harness slices the pure helpers and safety
// regexes straight out of the source text and evaluates them. That way the tests
// cannot drift from the shipped patterns, which is the whole point of R-5.
//
// Covers: BAR-4 and BAR-5 capacity regeneration, the 05:00 boundary and a British
// Summer Time transition; section 5.15 timezone and travel behaviour (TIM-1, TIM-4,
// TIM-5 and TIM-6 as pending scenarios, TIM-3 and TIM-7 as live assertions); CHT-5 and CHT-6 safety screens; QST-3 quest filtering;
// BAR-6 copy constraints; and the DRK-10 wiring.

// Pinned so the suite is deterministic wherever it runs: `at()` below builds
// instants with the local Date constructor, and the zone injected into the
// sliced helpers is pinned to match it. Before the clock module landed this
// harness silently depended on the machine's timezone.
process.env.TZ = "Europe/London";
const TEST_ZONE = "Europe/London";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dayStartLegacy, dayStartTrue, addDaysIn, dayKeyIn, weekStartIn, hourIn, offsetMsAt,
  nextDayKey, daysBetweenKeys, boundaryOfKey, weekdayOfKey, freezeLogDays,
  weekStartKeyIn, entryTime, offsetLabel, backfillState, clampDaySeen, partsIn,
  STATE_VERSION, packState, unpackState, catalogueResolves } from "../src/devclock.js";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "src", "App.jsx"), "utf8");

// ---- pull the live implementation out of the source ----
function slice(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`could not slice ${startMarker}`);
  return src.slice(a, b + endMarker.length);
}
const helpers = slice("function logDay(l) {", "// ---- end of pure day maths ----");
// The sliced helpers now take their zone from the clock module rather than from
// the ambient Date object, so the sandbox is handed a zone it controls. `zone`
// is a let, not a const: the travel cases below move it.
let zone = TEST_ZONE;
const inject = {
  HOUR, DAY,
  dayKeyIn, weekStartIn, weekStartKeyIn, nextDayKey, daysBetweenKeys, boundaryOfKey, weekdayOfKey,
  activeZone: () => zone,
};
const EXPORTED = ["logDay", "effectiveDayKey", "dayLabel", "unitsByDay", "capacityAt", "capacityTimeline",
  "regenPerDay", "concentrationThreshold", "refillPausedTomorrow", "refillToday",
  // SSN-7 / TIM-6 and BAR-10 additions, all pure and all above the marker.
  "weekIndex", "weekIndexOfKey", "MUTATOR_EPOCH_KEY", "seasonDryDayKeys",
  "unitsInWindow", "baselineAt", "baselineNote", "BASELINE_WINDOWS", "BASELINE_MIN_WINDOWS"];
const { logDay, effectiveDayKey, dayLabel, unitsByDay, capacityAt, capacityTimeline, regenPerDay,
  concentrationThreshold, refillPausedTomorrow, refillToday, weekIndex, weekIndexOfKey,
  MUTATOR_EPOCH_KEY, seasonDryDayKeys, unitsInWindow, baselineAt, baselineNote,
  BASELINE_WINDOWS, BASELINE_MIN_WINDOWS } =
  new Function(...Object.keys(inject),
    `${helpers}\nreturn { ${EXPORTED.join(", ")} };`
  )(...Object.values(inject));

// `mod` sits above the sliced block with the other one-line maths, so it is
// lifted by name rather than reimplemented here: the mutator rotation is indexed
// from a fixed Monday and a week before it counts negative, which is the whole
// reason the function exists.
const mod = new Function(`${slice("function mod(n, m) {", "}")}\nreturn mod;`)();

// The boundary is no longer computed in App.jsx at all, so these bind the
// module's derivation to the zone under test. The app reaches the same functions
// through dayKeyIn, which the sandbox above is given, so there is one derivation
// under test rather than the harness choosing its own.
const dayStart = (t) => dayStartTrue(t, zone);
const addDays = (b, n) => addDaysIn(b, n, zone);

// Regex literals are lifted by text so the tests exercise the shipped patterns.
function rx(name) {
  const line = src.split("\n").find((l) => l.startsWith(`const ${name} = /`));
  if (!line) throw new Error(`could not find ${name}`);
  return new Function(`return ${line.slice(line.indexOf("/"), line.lastIndexOf(";"))};`)();
}
const scoring = slice("const XP_PER_REGION = 20;", "function regionsFrom(xp) { return Math.min(28, Math.floor(xp / XP_PER_REGION)); }");
// SSN-7's resolver reaches out of this slice for the week arithmetic, so the
// sandbox is handed the same functions the app reaches through the clock module
// rather than the harness deciding the rotation for itself.
const scoringInject = { mod, weekIndex, weekIndexOfKey, weekStartKeyIn, boundaryOfKey, activeZone: () => zone };
const { XP_PER_REGION, MUTATORS, seasonXP, regionsFrom, mutatorFor, mutatorAt, mutatorAtKey } =
  new Function(...Object.keys(scoringInject),
    `${scoring}\nreturn { XP_PER_REGION, MUTATORS, seasonXP, regionsFrom, mutatorFor, mutatorAt, mutatorAtKey };`
  )(...Object.values(scoringInject));

const CRISIS_RE = rx("CRISIS_RE");
const QUEST_BAN_RE = rx("QUEST_BAN_RE");
const BANNED_RE = new Function(
  `return [${src.match(/const BANNED_RE = \[([\s\S]*?)\];/)[1]}];`
)();

// ---- tiny runner ----
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) {
  cond ? pass++ : (fail++, fails.push(name));
  console.log(`${cond ? "  ok  " : " FAIL "} ${name}`);
}
function eq(name, got, want, tol = 0.001) {
  ok(`${name} (${got.toFixed(2)} = ${want.toFixed(2)})`, Math.abs(got - want) < tol);
}
function group(title) { console.log(`\n${title}`); }



// =====================================================================
// BAR-4 / BAR-5: capacity regeneration
// =====================================================================
const B = 14;
const at = (n, h = 22) => new Date(2026, 5, 1 + n, h, 0, 0).getTime(); // from Mon 1 Jun 2026
const L = (n, u, h = 22) => ({ t: at(n, h), units: u, cost: 5, label: "x" });

group("BAR-4 regeneration");
eq("refill rate is budget/7", regenPerDay(B), 2);
eq("no logs means a full bar", capacityAt([], B, at(0)), 14);
{
  // 4 units is below the concentration threshold, so this isolates pure refill.
  const one = [L(0, 4)];
  eq("day 0, after 4 units", capacityAt(one, B, at(0, 23)), 10);
  eq("day 1", capacityAt(one, B, at(1, 23)), 12);
  eq("day 2, back to full", capacityAt(one, B, at(2, 23)), 14);
  eq("day 9, still capped at full", capacityAt(one, B, at(9, 23)), 14);
  eq("60 quiet days cannot stockpile", capacityAt([L(0, 2)], B, at(60, 23)), 14);
}
{
  // The case the model exists for: a heavy weekend must still cost you midweek.
  // Saturday is a concentrated day (8 >= 6), so Sunday's refill is forfeited too.
  const wk = [L(5, 8), L(6, 5)]; // Sat and Sun
  eq("saturday, 8 units", capacityAt(wk, B, at(5, 23)), 6);
  eq("sunday, refill forfeited, 5 more", capacityAt(wk, B, at(6, 23)), 1);
  eq("monday grants no amnesty", capacityAt(wk, B, at(7, 23)), 3);
  eq("tuesday", capacityAt(wk, B, at(8, 23)), 5);
  eq("wednesday", capacityAt(wk, B, at(9, 23)), 7);
}
group("BAR-5 debt floor");
{
  const huge = [L(0, 40)];
  eq("debt pegs at one budget", capacityAt(huge, B, at(0, 23)), -14);
  // day 0 is concentrated, so day 1 forfeits its refill: zero arrives a day later
  eq("worst case reaches zero in 8 days", capacityAt(huge, B, at(8, 23)), 0);
  eq("and a full bar in 15", capacityAt(huge, B, at(15, 23)), 14);
  eq("still recoverable, given quiet days", capacityAt(huge, B, at(40, 23)), 14);
}
eq("budget/7 a day is break-even",
  capacityAt(Array.from({ length: 20 }, (_, i) => L(i, 2)), B, at(19, 23)), 12);

group("BAR-7 concentration costs the next morning");
eq("threshold is three days' worth", concentrationThreshold(B), 6);
ok("6.0 units in a day is concentrated", refillPausedTomorrow([L(0, 6)], B, at(0, 23)));
ok("5.9 units is not", !refillPausedTomorrow([L(0, 5.9)], B, at(0, 23)));
ok("spread days never pause", !refillPausedTomorrow([L(0, 2)], B, at(0, 23)));
{
  // A full budget in one sitting versus the same units spread evenly.
  const oneSession = [L(0, 14)];
  eq("one session empties the bar", capacityAt(oneSession, B, at(0, 23)), 0);
  eq("the next morning is forfeited", capacityAt(oneSession, B, at(1, 23)), 0);
  eq("refill resumes the day after", capacityAt(oneSession, B, at(2, 23)), 2);
  eq("full again on day 8, not day 7", capacityAt(oneSession, B, at(8, 23)), 14);
  const spread = Array.from({ length: 7 }, (_, i) => L(i, 2));
  eq("the same 14 units spread never pauses", capacityAt(spread, B, at(6, 23)), 12);
  ok("so concentration ends lower on the same date",
    capacityAt(oneSession, B, at(6, 23)) < capacityAt(spread, B, at(6, 23)));
}
{
  // Six units from a full bar cost six, plus the forfeited two.
  const six = [L(0, 6)];
  eq("full bar, 6 units", capacityAt(six, B, at(0, 23)), 8);
  eq("no refill next morning", capacityAt(six, B, at(1, 23)), 8);
  eq("then it resumes", capacityAt(six, B, at(2, 23)), 10);
}
{
  // Consecutive concentrated days forfeit consecutive mornings.
  const two = [L(0, 8), L(1, 8)];
  eq("day 0", capacityAt(two, B, at(0, 23)), 6);
  eq("day 1, forfeited refill then 8 more", capacityAt(two, B, at(1, 23)), -2);
  eq("day 2, forfeited again", capacityAt(two, B, at(2, 23)), -2);
  eq("day 3, refill resumes", capacityAt(two, B, at(3, 23)), 0);
}
group("BAR-9 the refill is a figure the bar can be checked against");
eq("no logs, nothing was restored", refillToday([], B, at(0)), 0);
{
  const one = [L(0, 4)];
  eq("the first day ever logged restored nothing", refillToday(one, B, at(0, 23)), 0);
  eq("the next morning restored a day's worth", refillToday(one, B, at(1, 23)), 2);
  // The defect BAR-9 exists to fix was a figure with nothing to check it
  // against, so assert the figure IS the movement rather than merely near it.
  eq("and that figure is exactly the movement the bar made",
    capacityAt(one, B, at(1, 23)) - capacityAt(one, B, at(0, 23)), refillToday(one, B, at(1, 23)));
  eq("a capped bar restored nothing", refillToday(one, B, at(4, 23)), 0);
}
{
  // A partial refill: only one unit of headroom was missing, so only one is back
  // and the copy must not promise the full two.
  const nearly = [L(0, 1)];
  eq("a partial refill reports what fitted, not the rate", refillToday(nearly, B, at(1, 23)), 1);
}
{
  // BAR-7: a forfeited morning restored nothing, and must read as nothing rather
  // than as a gap in the figure.
  const heavy = [L(0, 6)];
  eq("the morning after a concentrated day", refillToday(heavy, B, at(1, 23)), 0);
  eq("the morning after that", refillToday(heavy, B, at(2, 23)), 2);
}
{
  // BAR-5/BAR-9: a refill lands while capacity is negative too. The band cannot
  // be drawn there, which is why the copy has to carry the figure.
  const sliding = Array.from({ length: 6 }, (_, i) => L(i, 5));
  ok("six days of five units leaves debt", capacityAt(sliding, B, at(6, 23)) < 0);
  eq("and a refill still landed this morning", refillToday(sliding, B, at(6, 23)), 2);
}
ok("never reports more than the daily rate",
  [0, 1, 2, 3, 7, 14, 30].every((d) => refillToday([L(0, 4), L(3, 9)], B, at(d, 23)) <= regenPerDay(B)));

group("BAR-9 the refill is observable, not merely correct");
ok("the bar is handed what was restored", src.includes("restored={restoredToday}"));
ok("the figure comes from the same walk as the bar", src.includes("refillToday(state.logs, state.budget, now, maxDaySeen)"));
{
  // The bar carries the refill on two channels, not three. The growth animation
  // was removed rather than relocated a third time: it was built to fire on the
  // morning after, two placements spent it where nobody was looking, and by the
  // time it was visible it was the fifth telling of one fact. Assert the absence
  // directly, because the intent was the thing that kept being wrong.
  const bar = src.slice(src.indexOf("function HealthBar("));
  const barBody = bar.slice(0, bar.indexOf("\nfunction "));
  ok("the bar takes no animate prop", !/animate/.test(barBody));
  ok("no growth transform survives", !/scaleX\(/.test(barBody) && !/transformOrigin/.test(barBody));
  ok("and it needs no reduced-motion gate of its own", !/usePrefersReducedMotion/.test(barBody));
  ok("the fill still transitions on width when a drink is logged",
    barBody.includes('transition: "width 500ms ease"'));
  const home = src.slice(src.indexOf("<HealthBar capacity={capacity} budget={state.budget}"));
  const homeTag = home.slice(0, home.indexOf("/>"));
  ok("the home screen bar carries the band and the figure", /restored={restoredToday}/.test(homeTag));
  const exp = src.slice(src.indexOf("<HealthBar capacity={capacity} budget={budget}"));
  const expTag = exp.slice(0, exp.indexOf("/>"));
  ok("the explainer shows the same bar, from the same render", /restored={restored}/.test(expTag));
  ok("no once-a-day flag survives anywhere", !/lastRefillShownDay/.test(src));
  ok("the explainer offers no link back to itself", !/onExplain/.test(expTag));
}
// This was one animation removed, not a policy on animation: the companion still
// moves, and still stops under reduced motion (CMP-6 to CMP-9, NFR-9).
ok("the companion keeps its motion", /wf-breathe|wf-sway|wf-wander|wf-blink/.test(src));
ok("and still respects reduced motion", src.includes("usePrefersReducedMotion()"));
ok("NFR-4: the restored figure is in words, not only in a tint",
  /\$\{restored\.toFixed\(1\)\} back today/.test(src));
ok("and in the accessible name", src.includes("units restored at 05:00 today"));
{
  // BAR-9a: the two rows now have one rule each. The header carries the slow
  // channel, the caption carries the day's refill news. Both of BAR-9's figures
  // are still in words on the home screen; only the row changed, and it changed
  // because the two would not fit in one slot at 390px.
  ok("BAR-10 takes the header row's label slot", src.includes('{trend || "Capacity"}'));
  ok("and the restored figure moves to the caption row with the rest of it",
    /const note = pausedTomorrow[\s\S]{0,400}restored\.toFixed\(1\)\} back today/.test(src));
  ok("nothing is left appending the restored figure to the header", !/cameBack/.test(src));
  // Measured in a browser at 390x664: this slot has 211px beside "How this
  // works", which is the figure BAR-9 recorded. Every branch below fits on one
  // line; the sentence removed did not, at 288px.
  // Scoped to the expression that renders the row, because the comment above it
  // quotes the superseded sentence in order to record why it went.
  const noteExpr = slice("const note = pausedTomorrow", '"Full. Nothing to restore.";');
  ok("BAR-7's forfeit line no longer runs past its slot",
    !noteExpr.includes("Three days' worth today"));
  // Five branches, four of them templates, and each one measured in the browser
  // against the 211px this slot has. A new branch has to be measured too, so the
  // count is pinned rather than left open.
  ok("and every branch of the row is one of the measured forms",
    (noteExpr.match(/`/g) || []).length === 8 && (noteExpr.match(/\?/g) || []).length === 5);
  ok("the forfeit is still stated on the bar, and as arithmetic rather than reproach",
    src.includes("none tomorrow") && src.includes('"None back tomorrow"'));
  ok("and the reason for it stays where there is room to give it (DRK-10, BAR-8)",
    src.includes("Log three or more days' worth in a single day"));
  // The longest string any branch can produce, since the refill is capped at
  // budget/7 and the budget slider tops out at 30: "+4.3 back today, +4.3
  // tomorrow", which measured 206px.
  const longest = "+4.3 back today, +4.3 tomorrow";
  ok(`the widest caption any budget can produce is ${longest.length} characters`, longest.length <= 30);
}
{
  // The original defect, as a regression guard: an hour with no day attached read
  // as plausibly past as future at 10:25 on the morning after.
  const bare = src.split("\n").map((l, i) => [i + 1, l])
    .filter(([, l]) => /back at 05:00(?! tomorrow)/.test(l) && !/BAR-9|read as/.test(l));
  ok(`no copy names 05:00 without saying which one (${bare.length} lines flagged)`, bare.length === 0);
  bare.forEach(([n, l]) => console.log(`        line ${n}: ${l.trim().slice(0, 100)}`));
}

group("BAR-7 the log's figures must match the bar");
{
  const logs = [L(0, 8), L(4, 3)];
  const tl = capacityTimeline(logs, B, at(6, 23));
  eq("timeline ends where capacityAt says", tl[tl.length - 1].after, capacityAt(logs, B, at(6, 23)));
  ok("the day after a concentrated day is marked paused", tl[1].paused === true);
  eq("and its refill is zero", tl[1].refill, 0);
  ok("a normal day is not marked paused", tl[2].paused === false);
  eq("refill never overshoots the cap", tl.reduce((a, r) => Math.max(a, r.refill), 0), 2);
}

group("BAR-4 05:00 day boundary");
ok("a 01:00 drink belongs to the night before",
  dayStart(at(1, 1)) === dayStart(at(0, 22)));
eq("so it is already spent by 06:00", capacityAt([L(1, 4, 1)], B, at(1, 6)), 12);
{
  // British Summer Time ends Sun 25 Oct 2026. Counting days by dividing epoch
  // milliseconds would slip an extra tick across the change; the local-date walk
  // must not. 4 units a day stays below the concentration threshold.
  const oct = (d, h) => new Date(2026, 9, d, h, 0, 0).getTime();
  const dst = [{ t: oct(24, 22), units: 4, cost: 5, label: "x" }];
  eq("day of the clock change", capacityAt(dst, B, oct(25, 22)), 12);
  eq("three ticks across it, not four", capacityAt(dst, B, oct(27, 22)), 14);
  const deep = [{ t: oct(24, 22), units: 5, cost: 5, label: "x" }, { t: oct(25, 22), units: 5, cost: 5, label: "x" }];
  eq("two sub-threshold days across the change", capacityAt(deep, B, oct(27, 22)), 10);
}

// =====================================================================
// CHT-6: crisis detection, on every tier, before any model call
// =====================================================================
group("CHT-6 crisis detection triggers");
[
  "I get the shakes in the morning",
  "I think I'm dependent on it now",
  "I can't stop drinking",
  "I need a drink to function",
  "I've been having withdrawal symptoms",
  "I want to hurt myself",
  "I feel hopeless",
].forEach((m) => ok(`triggers: ${m}`, CRISIS_RE.test(m)));

group("CHT-6 no false positives on innocent phrasing");
[
  "how's my week looking",
  "I fancy a pint tonight",
  "encourage me please",
  "what is my capacity",
  "how does the bar restore",
  "why didn't it reset on Monday",
  "I had a rough night",
].forEach((m) => ok(`clean: ${m}`, !CRISIS_RE.test(m)));

// =====================================================================
// CHT-5: output filter
// =====================================================================
group("CHT-5 permission-giving is caught");
[
  "You've earned one, have it.",
  "One won't hurt, honestly.",
  "Treat yourself to a pint.",
  "You deserve a glass tonight.",
  "Go on, have one.",
  "14 units is safe to drink weekly.",
].forEach((m) => ok(`caught: ${m}`, BANNED_RE.some((r) => r.test(m))));

group("CHT-5 capacity copy is not caught");
[
  "Full. Nothing to restore.",
  "+2.0 back at 05:00",
  "Each morning at 05:00, 2.0 units come back, up to a full 14.",
  "Nothing resets on a Monday. A heavy night is still there on Tuesday.",
  "Steady as she goes. 5.0 units in hand right now.",
  "2.0 units of headroom return every morning, whatever yesterday held.",
  "3 days with nothing logged, +6.0 restored",
  // BAR-9a and BAR-10's copy, re-run through the permission filter because R-5
  // requires it of any change to chat, quests or copy, and because "back today"
  // and "under your usual" are the two phrasings most likely to read as leave.
  "+2.0 back today, +2.0 tomorrow",
  "+2.0 back today, none tomorrow",
  "None back tomorrow",
  "+2.0 back today. Full.",
  "25.0 under your usual",
  "4.0 over your usual",
  "Level with your usual",
].forEach((m) => ok(`clean: ${m.slice(0, 50)}`, !BANNED_RE.some((r) => r.test(m))));

// =====================================================================
// QST-3: quest safety screen
// =====================================================================
group("QST-3 unsafe quests rejected");
[
  "Pop to the pub for a soft drink",
  "Pour yourself a wine",
  "Drive to the shop",
  "Climb the ladder and clear the gutters",
  "Sharpen the kitchen knives",
  "Sharpen a knife",
  "Use the bread blade",
  "Trim it with scissors",
  "Get the axe from the shed",
  "Clear the roof",
  "Stand on the balcony ledge",
  "Climb the scaffold",
].forEach((q) => ok(`rejected: ${q}`, QUEST_BAN_RE.test(q)));

group("QST-3 benign quests allowed");
[
  "Repot the spider plant on the windowsill",
  "Brush the dog for ten minutes",
  "Empty or fill the dishwasher like a speedrun",
  "Stretch for five minutes, phone in another room",
  "Write tomorrow's three must-dos on actual paper",
  "Prep tomorrow's breakfast or lunch right now",
].forEach((q) => ok(`allowed: ${q}`, !QUEST_BAN_RE.test(q)));

// The generated pools are filtered; the curated default deck in defaultState is
// not, and deliberately includes an alcohol-free substitute drink.
group("QST-3 filter applies to generated pools only");
ok("templateQuests filters its pool", /\.filter\(questSafe\)/.test(src));
ok("model output is filtered too", /return arr\.filter\(questSafe\)/.test(src));

// =====================================================================
// BAR-6 / ONB-4 / DRK-10: copy constraints and wiring
// =====================================================================
group("BAR-6 no clinical recovery claims in app copy");
{
  const CLINICAL = /(your (liver|body|brain|blood)\s+(is|has|will)|blood alcohol|\bBAC\b|detox|sober(ing)? up|metaboli[sz]|toxin|flush(ing)? out|cleanse|\bheals?\b|healing|liver (function|recovery|repair))/i;
  const offenders = src.split("\n").map((l, i) => [i + 1, l])
    .filter(([, l]) => CLINICAL.test(l) && !/not a statement about|never clinical|BAR-6|NHS advice to spread/i.test(l));
  ok(`none found (${offenders.length} lines flagged)`, offenders.length === 0);
  offenders.forEach(([n, l]) => console.log(`        line ${n}: ${l.trim().slice(0, 100)}`));
}

group("BAR-1 / MET-4 no copy promises a weekly reset");
{
  const WEEKLY = /(as the week does|on track this week|best week in a while|resets? (on )?monday(?! )|this week'?s? (units|total|budget) (is|are))/i;
  const bad = src.split("\n").map((l, i) => [i + 1, l])
    .filter(([, l]) => WEEKLY.test(l) && !/Nothing resets on a Monday|nothing wipes clean on a Monday|Nothing here resets on a Monday|no longer|BAR-|MET-/i.test(l));
  ok(`none found (${bad.length} lines flagged)`, bad.length === 0);
  bad.forEach(([n, l]) => console.log(`        line ${n}: ${l.trim().slice(0, 100)}`));
}

group("wiring");
ok("ONB-4 withdrawal and GP copy present", /withdrawal/i.test(src) && /GP/.test(src));
ok("BAR-6 explainer reachable from the bar", src.includes('onExplain={() => setScreen("log")}'));
ok("DRK-10 log route wired", src.includes('if (screen === "log")'));
ok("DRK-10 reachable from Settings", src.includes("Drink log and history"));
ok("DRK-10 per-entry removal exists", src.includes("function removeLog"));
ok("no calendar-week bar filter remains", !src.includes("const weekLogs"));
ok("capacity is memoised, not recomputed per tick",
  src.includes("[state && state.logs, state && state.budget, todayK]"));
// React #310: the loading guard returns early on the first render, so the
// capacity hook must sit above it or the hook count changes between renders.
ok("BAR-7 pause surfaced on the bar", src.includes("pausedTomorrow={pausedTomorrow}"));
ok("BAR-7 explained in the log", src.includes("the next morning's refill was paused"));
ok("log figures come from the shared walk", src.includes("capacityTimeline(logs, budget, now, today)"));
ok("capacity hook is hoisted above the loading guard",
  src.indexOf("const capacity = useMemo(") < src.indexOf("if (!state) {"));

// =====================================================================
// SSN-1 / SSN-2 / SSN-6: XP, and the map it buys
// =====================================================================
const mut = (name) => MUTATORS.find((m) => m.name === name);
const ordinary = mut("Blind Week");   // baseline values: 10 / 25 / 25
const crave = (n, late = false) => Array.from({ length: n }, () => ({ late }));
// SSN-7 made the mutator a per-item lookup rather than one value for the season,
// so the uniform cases below inject a resolver that returns the same rule for
// everything. `dry(n)` stands in for n dry days, which are now identified by key.
const uniform = (m) => () => m;
const dry = (n) => Array.from({ length: n }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

group("SSN-1 XP formula");
eq("ordinary week, 5 dry + 2 cravings",
  seasonXP({ dryDayKeys: dry(5), cravings: crave(2), bonus: 0, mutatorAt: uniform(ordinary) }), 100);
eq("Steady Flame doubles dry days",
  seasonXP({ dryDayKeys: dry(5), cravings: crave(2), bonus: 0, mutatorAt: uniform(mut("Steady Flame")) }), 150);
eq("Night Watch pays 40 for a late craving, 25 for an early one",
  seasonXP({ dryDayKeys: [], cravings: [{ late: true }, { late: false }], bonus: 0, mutatorAt: uniform(mut("Night Watch")) }), 65);
eq("late cravings are worth the ordinary 25 outside Night Watch",
  seasonXP({ dryDayKeys: [], cravings: crave(2, true), bonus: 0, mutatorAt: uniform(ordinary) }), 50);
eq("bonus XP adds flat",
  seasonXP({ dryDayKeys: [], cravings: [], bonus: 35, mutatorAt: uniform(ordinary) }), 35);
ok("nothing in the formula can subtract (P2: no XP penalty)",
  seasonXP({ dryDayKeys: [], cravings: [], bonus: 0, mutatorAt: uniform(ordinary) }) === 0);

group("SSN-2 XP clears the fog");
eq("one region costs XP_PER_REGION", regionsFrom(XP_PER_REGION), 1);
eq("a part-region does not round up", regionsFrom(149), 7);
eq("an empty season shows an empty map", regionsFrom(0), 0);
eq("560 XP clears the Reach", regionsFrom(560), 28);
ok("the map caps at 28 regions", regionsFrom(99999) === 28);
{
  // The regression that started this: under the old unweighted count the two
  // XP-only mutators changed nothing a user could see.
  const behaviour = { dryDayKeys: dry(10), cravings: crave(4), bonus: 0 };
  const plain = regionsFrom(seasonXP({ ...behaviour, mutatorAt: uniform(ordinary) }));
  const flame = regionsFrom(seasonXP({ ...behaviour, mutatorAt: uniform(mut("Steady Flame")) }));
  ok(`Steady Flame clears more fog than an ordinary week for identical behaviour (${plain} -> ${flame})`, flame > plain);
}
ok("the map no longer reads raw day and craving counts",
  !src.includes("dryDays + seasonCravings.length"));
ok("the map reads XP", src.includes("const revealed = regionsFrom(xp)"));

group("SSN-6 the link is stated, not implied");
ok("home screen prices a region", src.includes("XP clears a region"));
ok("home screen names the next region's cost", src.includes("XP to the next region"));
ok("the fog claim is conditional on a region clearing", src.includes("after > revealed"));
ok("recap does not call XP banked", !src.includes('"banked this season"'));
ok("no copy claims XP is deducted", !/costs points/i.test(src));


// =====================================================================
// TIM-1 to TIM-6: time, timezone and travel (spec 5.15, not yet built)
// =====================================================================
// Every case below was invisible to manual verification because a single
// device in a single timezone cannot produce any of them.
group("TIM-5 the 05:00 boundary on a DST transition day");
{
  // dayStart is still midnight-plus-five, so on a transition day it takes the
  // offset in force at midnight, which is not the one in force at 05:00.
  const hourOn = (iso) => hourIn(dayStart(Date.parse(iso)), zone);
  const trueHourOn = (iso) => hourIn(dayStartTrue(Date.parse(iso), zone), zone);
  ok("an ordinary September day", hourOn("2026-09-02T12:00:00Z") === 5);
  ok("the spring-forward Sunday (29 Mar 2026)", hourOn("2026-03-29T12:00:00Z") === 5);
  ok("the Monday after the spring change", hourOn("2026-03-30T12:00:00Z") === 5);
  ok("the autumn Sunday (25 Oct 2026)", hourOn("2026-10-25T12:00:00Z") === 5);
  ok("the Monday after the autumn change", hourOn("2026-10-26T12:00:00Z") === 5);
  // The property the existing BST case checks, which held all along and is why
  // the hour drift went unnoticed: no day is lost or duplicated either way.
  const span = (a, b) => {
    let n = 0, cur = dayStart(Date.parse(a)); const end = dayStart(Date.parse(b));
    while (cur <= end && n < 500) { n++; cur = addDays(cur, 1); }
    return n;
  };
  ok("no day lost across the spring change (28 Mar to 31 Mar is 4 days)", span("2026-03-28T12:00:00Z", "2026-03-31T12:00:00Z") === 4);
  ok("no day duplicated across the autumn change (24 Oct to 27 Oct is 4 days)", span("2026-10-24T12:00:00Z", "2026-10-27T12:00:00Z") === 4);
  // The old derivation is kept in the module so the regression it caused stays
  // documented and cannot be reintroduced silently.
  // A walk must advance from every boundary, including the two it used to stall
  // or skip on. This is the case the "no day lost" check above did not isolate.
  for (const iso of ["2026-03-29T12:00:00Z", "2026-10-25T12:00:00Z", "2026-09-02T12:00:00Z"]) {
    const b = dayStart(Date.parse(iso));
    ok(`addDays advances exactly one day from the ${iso.slice(0, 10)} boundary`,
      addDays(b, 1) > b && hourIn(addDays(b, 1), zone) === 5 && addDays(b, 1) - b <= 25 * HOUR && addDays(b, 1) - b >= 23 * HOUR);
    ok(`addDays is reversible across the ${iso.slice(0, 10)} boundary`, addDays(addDays(b, 1), -1) === b);
  }
  ok("the legacy derivation still drifts, which is why it was replaced",
    hourIn(dayStartLegacy(Date.parse("2026-03-29T12:00:00Z"), zone), zone) === 6);
}

group("TIM-1 the same history must not depend on where the phone is");
{
  // One fixed history: a fortnight of moderate logging plus one Saturday night
  // that finishes at 03:30, all logged in London and therefore carrying London
  // day keys frozen at the moment of logging.
  const raw = [];
  const base = Date.parse("2026-08-18T19:00:00Z");
  for (let i = 0; i < 14; i++) if (i % 3 !== 0) raw.push({ t: base + i * DAY, units: 3, cost: 5, label: "x" });
  const lateNight = Date.parse("2026-08-30T02:30:00Z"); // Sat night, London
  raw.push({ t: lateNight, units: 4, cost: 5, label: "x" });
  const hist = freezeLogDays(raw, "Europe/London");
  const now = Date.parse("2026-09-02T10:00:00Z");

  const seen = new Map();
  for (const tz of ["Europe/London", "America/New_York", "Asia/Dubai", "Australia/Sydney"]) {
    zone = tz;
    const cap = capacityAt(hist, B, now);
    const entry = hist[hist.length - 1];
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayOfKey(logDay(entry))];
    const days = new Set(capacityTimeline(hist, B, now).map((d) => d.key)).size;
    seen.set(tz, { cap, weekday, days });
    console.log(`        ${tz.padEnd(18)} capacity ${cap.toFixed(2)}  walk length ${days}  the 03:30 finish reads as ${weekday}`);
  }
  zone = TEST_ZONE;

  const caps = [...new Set([...seen.values()].map((v) => v.cap.toFixed(2)))];
  const weekdays = [...new Set([...seen.values()].map((v) => v.weekday))];
  const lengths = [...new Set([...seen.values()].map((v) => v.days))];
  ok(`one history gives one capacity in every zone (${caps.join(", ")})`, caps.length === 1);
  ok(`the 03:30 finish stays Saturday in every zone (${weekdays.join("/")})`, weekdays.length === 1 && weekdays[0] === "Sat");
  ok(`the walk is the same length in every zone (${lengths.join(", ")})`, lengths.length === 1);
  ok("a logged drink stores its day", /day: todayK/.test(src));
  ok("a logged drink stores the offset that produced it", /tzo: Math\.round\(offsetMsAt/.test(src));
  ok("bucketing reads the stored day, not the timestamp", /function logDay\(l\) \{ return l\.day/.test(src));
}

group("TIM-2 the migration runs once, on both ways state arrives");
{
  const raw = [
    { t: Date.parse("2026-08-30T02:30:00Z"), units: 4, cost: 5, label: "x" },
    { t: Date.parse("2026-08-28T19:00:00Z"), units: 2, cost: 5, label: "x" },
  ];
  const once = freezeLogDays(raw, "Europe/London");
  ok("every entry gains a day", once.every((l) => typeof l.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l.day)));
  ok("every entry gains the offset in force at the time", once.every((l) => typeof l.tzo === "number"));
  ok("the 03:30 finish is frozen to the night before", once[0].day === "2026-08-29");
  ok("British Summer Time is +60, not the offset today", once[0].tzo === 60);
  // Idempotence matters because the loader and the import path both call it, and
  // an export can be re-imported any number of times.
  const twice = freezeLogDays(once, "Australia/Sydney");
  ok("running it again changes nothing, even from another zone",
    JSON.stringify(twice) === JSON.stringify(once));
  ok("the storage key advanced", /REAL_KEY = "winifred-state-v2"/.test(fs.readFileSync(path.join(here, "..", "src", "devclock.js"), "utf8")));
  ok("the previous key is migrated from", /LEGACY_KEYS = \["winifred-state-v1"/.test(fs.readFileSync(path.join(here, "..", "src", "devclock.js"), "utf8")));
  ok("the loader migrates", /return migrateState\(JSON\.parse\(raw\)\)/.test(src));
  // The version gate was the original design and shipped a store that claimed to
  // be migrated because defaultState declares the current version and the merge
  // puts defaults first. Backfilling unconditionally is what removes the class.
  ok("the backfill is not gated on a version the defaults supply",
    !/if \(\(s\.stateVersion \|\| 1\) < 2\)/.test(src));
  ok("the backfill is the module's, so what is tested here is what runs",
    /return withDaySeen\(backfillState\(s, activeZone\(\)\)\)/.test(src));
  ok("the import path migrates too, rather than re-merging by hand",
    /\.\.\.migrateState\(parsed\), onboarded: true/.test(src));
}

group("TIM-4 the current day must never move backwards");
{
  // Auckland to Honolulu crosses the date line westward and repeats a date.
  const depart = Date.parse("2026-09-05T00:00:00Z"); // 5 Sep, 12:00 NZST
  const arrive = Date.parse("2026-09-05T09:00:00Z"); // 4 Sep, 23:00 HST
  zone = "Pacific/Auckland";
  const before = effectiveDayKey(depart, null);
  zone = "Pacific/Honolulu";
  const rawAfter = effectiveDayKey(arrive, null);
  const clamped = effectiveDayKey(arrive, before);
  zone = TEST_ZONE;
  console.log(`        departs on ${before} (Auckland), the raw local day on arrival is ${rawAfter} (Honolulu)`);
  ok(`the raw local day does go backwards, which is why the clamp exists (${before} to ${rawAfter})`, rawAfter < before);
  ok(`clamped, the day holds at ${before}`, clamped === before);
  ok("a day already reached is never given up", effectiveDayKey(depart, "2026-09-09") === "2026-09-09");
  ok("an ordinary forward day is not held back", effectiveDayKey(Date.parse("2026-09-10T12:00:00Z"), "2026-09-05") === "2026-09-10");
  ok("the highest day seen is part of stored state", /maxDaySeen: null/.test(src) && /function withDaySeen/.test(src));
  ok("it advances on every write, not on the render tick", /const next = withDaySeen\(merged\)/.test(src));
  ok("capacity reads the clamped day", /capacityAt\(state\.logs, state\.budget, now, maxDaySeen\)/.test(src));
}

group("TIM-3 a boundary met early is safe, and one already met is never withdrawn");
{
  // Flying east can bring the next 05:00 forward. TIM-3 accepts that; what it
  // requires is that it cannot be farmed, which the BAR-4 cap already ensures.
  const full = [{ t: at(0, 22), units: 0.5, cost: 5, label: "x" }];
  ok("an extra boundary on a near-full bar cannot exceed the budget",
    capacityAt(full, B, at(1, 22)) <= B + 0.001);
  const drained = [{ t: at(0, 22), units: 5, cost: 5, label: "x" }];
  const oneTick = capacityAt(drained, B, at(1, 22));
  const twoTicks = capacityAt(drained, B, at(2, 22));
  ok(`an extra boundary grants exactly one refill, never two (${oneTick.toFixed(2)} then ${twoTicks.toFixed(2)})`,
    Math.abs((twoTicks - oneTick) - regenPerDay(B)) < 0.001);
  ok("capacity never decreases with no new logs",
    capacityAt(drained, B, at(3, 22)) >= capacityAt(drained, B, at(2, 22)));
}

group("TIM-6 a scored window stores its own bounds");
{
  ok("a locked forecast stores its own start and end as day keys",
    /weekendKey, weekendEndKey: monKey/.test(src));
  ok("the weekend is stepped from the week's Monday, not offset by 24-hour multiples",
    /nextDayKey\(wsKey, 5\), monKey = nextDayKey\(wsKey, 7\)/.test(src) && !/ws \+ 5 \* DAY/.test(src));
  ok("scoring reads the frozen days", /logDay\(l\) >= from && logDay\(l\) < to/.test(src));
  ok("the locked forecast is found by its stored key, not a live recompute",
    /p\.weekendKey \? p\.weekendKey === weekendKey/.test(src));
  ok("a season's length is elapsed duration, not boundaries crossed",
    src.includes("Math.floor((now - state.seasonStart) / DAY) + 1"));
  ok("a season stores the day it began", /seasonStartDay: todayK/.test(src));
  {
    // The old walk added a fixed 24 hours to the season's start. Where that
    // start sat within an hour of 05:00, an autumn change slid one step back
    // across the boundary: a day key repeated and a dry day vanished with the
    // XP it had earned (SSN-1).
    const start = Date.parse("2026-10-20T04:30:00Z"); // 05:30 local, BST
    const startKey = dayKeyIn(start, zone);
    const added = new Set(), stepped = new Set();
    for (let i = 0; i < 10; i++) {
      added.add(dayKeyIn(start + i * DAY, zone));
      stepped.add(nextDayKey(startKey, i));
    }
    ok(`adding 24 hours ten times still loses a day (${added.size} of 10)`, added.size === 9);
    ok(`stepping the day key ten times gives ten days (${stepped.size} of 10)`, stepped.size === 10);
    ok("the season no longer adds 24 hours to its start",
      !/dayKey\(state\.seasonStart \+ i \* DAY\)/.test(src));
    ok("the season steps day keys instead", /nextDayKey\(seasonStartKey, i\)/.test(src));
  }
}


// =====================================================================
// The cases that would have caught the defects review found. Kept together and
// named for what they guard, because each one exists because something passed.
// =====================================================================
group("wiring: every symbol App.jsx uses from the clock module is imported");
{
  // Dropping STATE_VERSION from the import list while defaultState still used it
  // threw a ReferenceError at module evaluation, so the app rendered nothing.
  // Neither this harness nor `vite build` saw it: the harness slices text rather
  // than evaluating the module, and Rollup treats an unresolved identifier as a
  // global. Only opening the page found it, which is too late and too manual.
  const dc = fs.readFileSync(path.join(here, "..", "src", "devclock.js"), "utf8");
  const exported = [...dc.matchAll(/^export (?:function|const|class) (\w+)/gm)].map((m) => m[1]);
  const importBlock = (src.match(/import \{([\s\S]*?)\} from "\.\/devclock\.js";/) || [, ""])[1];
  const imported = new Set(importBlock.split(/[,\n]/).map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean));
  // Strip comments and the import block itself before looking for uses.
  const body = src.replace(/import \{[\s\S]*?\} from "\.\/devclock\.js";/, "").replace(/\/\/.*$/gm, "");
  const missing = exported.filter((name) => !imported.has(name) && new RegExp(`\\b${name}\\b`).test(body));
  ok(`no clock-module symbol is used without importing it (${missing.length ? missing.join(", ") : "none missing"})`,
    missing.length === 0);
}

group("TIM-5 the hour either side of a clock change, not just noon");
{
  // The first round of these sampled noon only. At noon a five-hour rewind stays
  // on the correct side of the transition, so the one-hour band that was wrong
  // was never probed, and a derivation that filed 05:30 on 29 March as the 28th
  // passed every case. Reference: read the wall clock, step back before 05:00.
  const ref = (t, z) => {
    const p = partsIn(t, z);
    const k = `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    return p.h < 5 ? nextDayKey(k, -1) : k;
  };
  const ZONES = ["Europe/London", "America/New_York", "Australia/Sydney", "America/Santiago",
    "Australia/Lord_Howe", "Pacific/Chatham", "Asia/Tehran", "Asia/Kathmandu", "Australia/Eucla", "UTC"];
  let mismatches = 0, checked = 0, futureBoundary = 0, wrongHour = 0, stalled = 0;
  for (const z of ZONES) {
    // Every clock change 2024-2030, swept minute by minute over a day either side.
    const marks = [];
    let prev = offsetMsAt(Date.parse("2024-01-01T00:00:00Z"), z);
    for (let t = Date.parse("2024-01-01T00:00:00Z"); t < Date.parse("2030-01-01T00:00:00Z"); t += 3600e3) {
      const o = offsetMsAt(t, z);
      if (o !== prev) { marks.push(t); prev = o; }
    }
    marks.push(Date.parse("2026-09-02T00:00:00Z")); // and one ordinary day
    for (const m of marks) {
      for (let t = m - 26 * HOUR; t < m + 26 * HOUR; t += 15 * 60e3) {
        checked++;
        if (dayKeyIn(t, z) !== ref(t, z)) mismatches++;
        const b = dayStartTrue(t, z);
        if (b > t) futureBoundary++;
        if (hourIn(b, z) !== 5) wrongHour++;
        if (addDaysIn(b, 1, z) <= b) stalled++;
      }
    }
  }
  console.log(`        ${checked.toLocaleString()} instants across ${ZONES.length} zones and every clock change 2024-2030`);
  ok(`the day a moment belongs to always matches the wall clock (${mismatches} mismatches)`, mismatches === 0);
  ok(`no boundary is ever later than the moment inside it (${futureBoundary})`, futureBoundary === 0);
  ok(`every boundary is 05:00 local (${wrongHour} exceptions)`, wrongHour === 0);
  ok(`the walk advances from every boundary (${stalled} stalls)`, stalled === 0);
}

group("TIM-6 a weekend window is 48 hours of days, whatever the offsets do");
{
  // Six weekends in three years contain a clock change. The old bounds were the
  // week's Monday plus multiples of 24 hours, which scored those against a 47 or
  // 49 hour window and recorded a forecast miss the user had not made (FCT-3).
  let bad = 0, changed = 0;
  for (const z of ["Europe/London", "Australia/Sydney", "America/Santiago", "Africa/Cairo", "Pacific/Chatham"]) {
    for (let t = Date.parse("2025-01-01T12:00:00Z"); t < Date.parse("2028-01-01T12:00:00Z"); t += 7 * DAY) {
      const wsKey = weekStartKeyIn(t, z);
      const satKey = nextDayKey(wsKey, 5), monKey = nextDayKey(wsKey, 7);
      const sat = boundaryOfKey(satKey, z), mon = boundaryOfKey(monKey, z);
      if (hourIn(sat, z) !== 5 || hourIn(mon, z) !== 5) bad++;
      if (daysBetweenKeys(satKey, monKey) !== 2) bad++;
      if (mon - sat !== 2 * DAY) changed++;   // a real clock change inside the weekend
    }
  }
  ok(`both ends of every weekend sit at 05:00 and two days apart (${bad} exceptions)`, bad === 0);
  ok(`and the sweep did include weekends containing a clock change (${changed} of them)`, changed > 0);
  ok("the app derives the weekend by stepping", /nextDayKey\(wsKey, 5\)/.test(src) && !/ws \+ 5 \* DAY/.test(src));
}

group("MET-4 one window, shared, that does not shed a day mid-evening");
{
  // A trailing 168-hour filter drops its oldest day partway through an evening,
  // so the home-screen units, kcal, spend and the companion's mood all fell by a
  // day's worth at 23:00 while the bar, which walks days, did not move. That is
  // the disagreement MET-4 exists to forbid, reintroduced by a timestamp filter.
  const logs = [];
  for (let d = 7; d >= 0; d--) {
    const t = Date.parse("2026-09-02T21:00:00Z") - d * DAY;
    logs.push({ t, day: dayKeyIn(t, zone), units: 2, cost: 5, label: "x" });
  }
  const windowed = (now) => {
    const todayK = effectiveDayKey(now, null);
    const from = nextDayKey(todayK, -6);
    return logs.filter((l) => logDay(l) >= from).reduce((a, l) => a + l.units, 0);
  };
  const rolling = (now) => logs.filter((l) => l.t >= now - 7 * DAY).reduce((a, l) => a + l.units, 0);
  const readings = ["2026-09-02T19:00:00Z", "2026-09-02T21:30:00Z", "2026-09-02T22:30:00Z", "2026-09-03T01:00:00Z"];
  const w = readings.map((r) => windowed(Date.parse(r)));
  const roll = readings.map((r) => rolling(Date.parse(r)));
  console.log(`        day-key window across one evening: ${w.join(", ")}  |  the old rolling filter: ${roll.join(", ")}`);
  ok(`the shared window holds steady through an evening (${w.join(", ")})`, new Set(w).size === 1);
  ok(`the rolling filter did not, which is why it went (${roll.join(", ")})`, new Set(roll).size > 1);
  ok("the app filters on the day key", /logDay\(l\) >= windowStart/.test(src) && !/l\.t >= now - 7 \* DAY/.test(src));
}

group("TIM-2 the whole backfill, on every shape of state that can arrive");
{
  const zone = "Europe/London";
  const v1 = {
    logs: [{ t: Date.parse("2026-08-30T02:30:00Z"), units: 4, cost: 5, label: "x" }],
    budget: 14, seasonStart: Date.parse("2026-08-20T19:00:00Z"),
    predictions: [{ weekendStartT: Date.parse("2026-08-29T04:00:00Z"), weekendEnd: Date.parse("2026-08-31T04:00:00Z"), predicted: 6, scored: false }],
  };
  const m = backfillState(v1, zone);
  ok("a v1 store gains a frozen day per entry", m.logs[0].day === "2026-08-29");
  ok("a v1 store gains the offset in force then", m.logs[0].tzo === 60);
  ok("a v1 store gains its season's start day", m.seasonStartDay === "2026-08-20");
  ok("a v1 store gains both forecast bounds", m.predictions[0].weekendKey === "2026-08-29" && m.predictions[0].weekendEndKey === "2026-08-31");
  // Read from the module rather than written out, so bumping the version for a
  // new migration cannot leave this assertion quietly checking the old one.
  ok("and is recorded as current", m.stateVersion === STATE_VERSION);
  // The version gate this replaced passed its own tests and did nothing, because
  // the defaults merge supplied the current version before it was consulted.
  const alreadyClaiming = backfillState({ ...v1, stateVersion: 2 }, zone);
  ok("a store that merely claims to be current is still backfilled", alreadyClaiming.logs[0].day === "2026-08-29");
  const twice = backfillState(backfillState(v1, zone), "Australia/Sydney");
  ok("running it again from another zone changes nothing", JSON.stringify(twice) === JSON.stringify(m));
  const newer = backfillState({ ...v1, stateVersion: 9 }, zone);
  ok("an export from a later build is never downgraded", newer.stateVersion === 9);
  const halfDone = backfillState({ logs: [{ t: Date.parse("2026-08-30T02:30:00Z"), units: 1, cost: 1, label: "x", day: "2026-08-29" }] }, zone);
  ok("an entry with a day but no offset still gains one", halfDone.logs[0].tzo === 60);
  ok("and keeps the day it already had", halfDone.logs[0].day === "2026-08-29");
  ok("empty state does not throw", backfillState({}, zone).logs.length === 0);
  ok("a fresh install is left alone", backfillState({ logs: [], predictions: [] }, zone).seasonStartDay === undefined);
}

group("TIM-4 a stuck day must be recoverable, not a ratchet");
{
  ok("an ordinary day advances", clampDaySeen("2026-09-01", "2026-09-02") === "2026-09-02");
  ok("a day already reached is held", clampDaySeen("2026-09-05", "2026-09-04") === "2026-09-05");
  ok("the date-line lead is inside the ceiling", clampDaySeen("2026-09-05", "2026-09-04") === "2026-09-05");
  // Without a ceiling this survives export and re-import, leaves the bar
  // permanently full and the log showing nothing but dry days, and the only
  // recovery is deleting everything.
  ok("a mark a week ahead is discarded", clampDaySeen("2026-09-09", "2026-09-02") === "2026-09-02");
  ok("a mark a year ahead is discarded", clampDaySeen("2027-09-02", "2026-09-02") === "2026-09-02");
  ok("nothing stored means today", clampDaySeen(null, "2026-09-02") === "2026-09-02");
  ok("the dev clock cannot write into the real store",
    /sandbox \|\| isOverridden\(\) \? SANDBOX_KEY : REAL_KEY/.test(fs.readFileSync(path.join(here, "..", "src", "devclock.js"), "utf8")));
}

group("TIM-7 an entry's time is shown where it was logged");
{
  const t = Date.parse("2026-08-29T16:00:00Z"); // 02:00 next day in Sydney
  const sydney = { t, day: "2026-08-29", tzo: 600, units: 2, cost: 5, label: "x" };
  const london = { t, day: "2026-08-29", tzo: 60, units: 2, cost: 5, label: "x" };
  ok(`a Sydney drink reads at its Sydney clock with the offset named (${entryTime(sydney, "Europe/London")})`,
    entryTime(sydney, "Europe/London") === "02:00 +10:00");
  ok("and is not silently retimed to the reader's clock", entryTime(sydney, "Europe/London") !== "17:00");
  ok(`a local drink carries no label (${entryTime(london, "Europe/London")})`, entryTime(london, "Europe/London") === "17:00");
  ok("a half-hour offset renders as one", offsetLabel(345) === "+05:45");
  ok("a negative offset renders as one", offsetLabel(-240) === "-04:00");
  ok("an entry with no stored offset falls back to the reader's clock rather than breaking",
    entryTime({ t }, "Europe/London") === "17:00");
  ok("the log renders it", /entryTime\(l, activeZone\(\)\)/.test(src));
}

group("TIM-3 a crossing, rather than properties that hold regardless");
{
  // The first version of this group never changed zone, so its three assertions
  // were properties of any capped walk. This flies the same history east.
  const logs = [];
  for (let d = 5; d >= 0; d--) {
    const t = Date.parse("2026-09-01T21:00:00Z") - d * DAY;
    logs.push({ t, day: dayKeyIn(t, "Europe/London"), units: 3, cost: 5, label: "x" });
  }
  const now = Date.parse("2026-09-02T10:00:00Z");
  zone = "Europe/London";
  const home = capacityAt(logs, B, now);
  const homeDay = effectiveDayKey(now, null);
  zone = "Australia/Sydney";
  const away = capacityAt(logs, B, now, homeDay);
  const awayDay = effectiveDayKey(now, homeDay);
  zone = TEST_ZONE;
  console.log(`        London ${home.toFixed(2)} on ${homeDay}, Sydney ${away.toFixed(2)} on ${awayDay}`);
  ok(`flying east never reduces capacity (${home.toFixed(2)} to ${away.toFixed(2)})`, away >= home - 0.001);
  ok("and grants at most one extra refill, which TIM-3 accepts",
    away - home <= regenPerDay(B) + 0.001);
  ok("the day never retreats on the crossing", awayDay >= homeDay);
}

group("TIM-7 timezone handling must not surface as configuration");
{
  // Strip comments, and strip Intl's `timeZone:` option, which is how a zone is
  // passed to a formatter rather than offered to a user. What is left is prose
  // the user could read, which is where a setting would show up.
  // Intl's `timeZone:` option and Date's getTimezoneOffset are how a zone is
  // read or passed, not how one is offered to a user.
  const prose = src.replace(/\/\/.*$/gm, "")
    .replace(/timeZone:\s*[^,}]+/g, "")
    .replace(/getTimezoneOffset\(\)/g, "");
  ok("no timezone control in the user interface", !/timezone|time zone/i.test(prose));
  ok("no travel mode", !/travel\s*mode/i.test(prose));
  ok("no prompt asking the user to confirm a day", !/which day|confirm.{0,20}day/i.test(prose));
}

group("NFR-10 the app is a fixed-scale surface");
{
  const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");
  const lock = fs.readFileSync(path.join(here, "..", "src", "viewportlock.js"), "utf8");
  const main = fs.readFileSync(path.join(here, "..", "src", "main.jsx"), "utf8");
  const viewport = (html.match(/name="viewport"\s+content="([^"]*)"/) || [])[1] || "";

  ok("the viewport forbids user scaling", /user-scalable=no/.test(viewport));
  ok("and pins the scale at 1 in both directions", /maximum-scale=1/.test(viewport) && /minimum-scale=1/.test(viewport));
  ok("the safe-area opt-in survives it", /viewport-fit=cover/.test(viewport));
  ok("double-tap zoom is off", /touch-action:\s*manipulation/.test(html));
  // `none` would take panning and scrolling with it, which is not the ask.
  ok("without taking scrolling with it", !/touch-action:\s*none/.test(html));

  // WebKit has ignored user-scalable=no for pinch since iOS 10, so the meta tag
  // on its own leaves the app zoomable on the device it is built for.
  ok("the WebKit pinch loophole is closed", /gesturestart/.test(lock) && /gesturechange/.test(lock));
  ok("with cancellable listeners", /passive:\s*false/.test(lock));
  ok("and it runs before the first paint", main.indexOf("lockViewportScale()") < main.indexOf("createRoot"));
  ok("only multi-touch is cancelled", /touches\.length > 1/.test(lock));

  // The focus zoom is the one the user actually hit: it fires on an ordinary tap
  // into a field and the page stays zoomed afterwards. 16px is iOS's threshold.
  const controls = src.split("\n").map((l, i) => [i + 1, l])
    .filter(([, l]) => /fontSize:\s*(?:[0-9]|1[0-5])(?:\.[0-9]+)?\s*[,}]/.test(l))
    .filter(([, l]) => /<input|<textarea|<select|const field =/.test(l));
  ok(`no form control sits under 16px (${controls.length} flagged)`, controls.length === 0);
  controls.forEach(([n, l]) => console.log(`        line ${n}: ${l.trim().slice(0, 100)}`));
  ok("and a floor catches any that set no size", /input,\s*textarea,\s*select\s*{\s*font-size:\s*max\(16px/.test(html));

  // NFR-4: removing pinch removes a route to larger text, so the other one has
  // to stay open. text-size-adjust at 100% is what keeps the system size honoured.
  ok("NFR-4: the system text size is still honoured", /-webkit-text-size-adjust:\s*100%/.test(html) && /[^-]text-size-adjust:\s*100%/.test(html));
  // Comments stripped: the module explains in prose why ctrl+wheel is left alone,
  // and that sentence must not read as the code doing it.
  const lockCode = lock.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("and desktop browser zoom is left alone", !/ctrlKey/.test(lockCode) && !/wheel/.test(lockCode));
}

group("screen changes start at the top");
{
  // A screen change is state and not navigation, so nothing resets the document
  // scroll on its own: the recap opened at the offset the home screen was left
  // at, which on a phone is far enough down to hide its own back button.
  const effect = slice('  const homeScroll = useRef(0);', '  }, [screen]);');

  ok("the reset is keyed on the screen", /\}, \[screen\]\);/.test(src) && effect.length > 0);
  ok("a repeat render of the same screen leaves the offset alone", /if \(from === screen\) return;/.test(effect));
  ok("home's offset is remembered on the way out", /if \(from === "home"\) homeScroll\.current = window\.scrollY;/.test(effect));
  ok("the way back to home restores it", /screen === "home" \? homeScroll\.current : 0/.test(effect));
  // Before layout the new screen has no height yet and a restore lands clamped
  // short, which reads as a second jump rather than as no jump at all.
  ok("and the move waits for layout", /requestAnimationFrame\(\(\) => window\.scrollTo\(/.test(effect));
  ok("with the frame cancelled on unmount", /cancelAnimationFrame\(frame\)/.test(effect));
  // NFR-9: a smooth scroll here would be motion the user did not ask for on
  // every single screen change, and the reduced-motion route does not cover it.
  ok("NFR-9: the move is instant, not animated", !/behavior:\s*"smooth"/.test(effect));
}

group("DAT-6 the export can be sent, not only saved");
{
  const shareFn = slice("  async function shareData() {", "\n  }\n");
  // The prose in here explains why text must not ride along with the file, so
  // the assertions below would find their own comment if it stayed.
  const shareCode = shareFn.replace(/\/\/.*$/gm, "");

  ok("the file is offered to the share sheet", /navigator\.share\(/.test(shareCode));
  // navigator.share exists on browsers that will not take a file, so testing
  // for the method rather than for the capability is how a dead button ships.
  ok("capability is tested with the file, not for the method",
    /navigator\.canShare && navigator\.canShare\(\{ files: \[file\] \}\)/.test(shareCode));
  ok("a machine with no sheet gets the download instead",
    /\)\) \{ downloadExport\(\); return; \}/.test(shareCode));
  // A share called after an await has lost the tap's user activation, which is
  // a rejection on iOS and a silent no-op elsewhere.
  ok("nothing is awaited before the share is asked for",
    shareCode.indexOf("await") === shareCode.indexOf("await navigator.share"));
  ok("no title or text rides along with the file",
    !/navigator\.share\(\{[^)]*(title|text):/.test(shareCode));
  {
    // P1: a cancelled sheet is a decision. Writing the file anyway would be the
    // app overriding it, and saying "sent" would be worse.
    const caught = shareCode.slice(shareCode.lastIndexOf("} catch"));
    ok("a cancelled sheet is recognised", /AbortError/.test(caught));
    ok("and writes nothing behind the user", caught.indexOf("return;") < caught.indexOf("downloadExport"));
  }
  ok("the filename carries the day, so a folder of backups can be read",
    /return `winifred-\$\{todayK\}\.json`/.test(src));
  ok("the fixed filename is gone", !src.includes("winifred-export.json"));
  ok("Settings sends rather than downloads", src.includes("onClick={shareData}") && !src.includes("exportData"));
  // The whole state is more than the user pictures when they think "my data",
  // and a share sheet is one tap from the wrong person.
  ok("the control says what is in the file",
    /notes to future self/.test(src) && /Keep it somewhere only you can reach/.test(src));
}

group("DAT-7 a file arriving from outside is asked about, not applied");
{
  ok("one validator serves both routes in", src.includes("function readExport(") &&
    (src.match(/readExport\(/g) || []).length >= 3);
  ok("TIM-2's migration still runs on an import",
    /function applyImport\([\s\S]{0,600}migrateState\(parsed\)/.test(src));

  const consumer = slice("    importerRef.current = (text) => {", "    };");
  ok("an opened file waits for an answer", /setPendingImport\(parsed\)/.test(consumer));
  ok("and is not applied on arrival", !/applyImport/.test(consumer));
  ok("a file that is not an export is refused the same way",
    /That doesn't look like a Winifred export/.test(consumer));

  // DAT-3 keeps its wholesale restore: arriving at the picker is the asking.
  const picker = slice("                  const reader = new FileReader();", "                  reader.readAsText(file);");
  ok("the picker still restores wholesale (DAT-3)", /applyImport\(parsed\)/.test(picker));

  ok("the confirmation sits ahead of every other route",
    src.indexOf("if (pendingImport) {") < src.indexOf('if (screen === "setup")'));
  const confirm = slice("  if (pendingImport) {", "\n  // ----- setup -----");
  ok("it names what is in the file", /The file holds/.test(confirm));
  ok("and what is on the device", /This device holds/.test(confirm));
  ok("P1: keeping what is here is an equal option, not a get-out",
    /Keep what is on this device/.test(confirm));
  ok("P2: it says nothing merges and there is no undo",
    /Nothing merges, and there is no undo/.test(confirm));
  ok("the restore is the only thing that writes", (confirm.match(/applyImport\(/g) || []).length === 1);

  const cfg = fs.readFileSync(path.join(here, "..", "vite.config.js"), "utf8");
  ok("the app registers as a handler for the export's type",
    /file_handlers:\s*\[/.test(cfg) && /"application\/json": \[".json"\]/.test(cfg));
  ok("the handler stays inside the app's scope", /\{ action: BASE, accept:/.test(cfg));
  // The app is a single held state; a second copy of it is not where an
  // opened file belongs.
  ok("an opened file goes to the window already running",
    /launch_handler:\s*\{ client_mode: "focus-existing" \}/.test(cfg));
}

// =====================================================================
// BAR-4: the walk's guard is a bound on this history, not a constant
// =====================================================================
group("BAR-4 the walk reaches today however long the history is");
{
  // The defect, directly: the guard was 4000 iterations, which is ten years and
  // eleven months, so on the 4001st day after a first log the walk stopped short
  // of today and the bar simply froze at a figure from 2036. Nothing errored and
  // nothing was incorrect about any single step of it.
  const long = [L(0, 4), L(4100, 10)];
  eq("a drink logged on day 4100 is still counted", capacityAt(long, B, at(4100, 23)), 4);
  const tl = capacityTimeline(long, B, at(4100, 23));
  ok("the timeline ends on today, not on an iteration limit",
    tl[tl.length - 1].key === dayKeyIn(at(4100, 23), zone));
  eq("and twenty years of history still lands on the right figure",
    capacityAt([L(0, 4), L(7300, 12)], B, at(7300, 23)), 2);
  ok("the guard is derived from the span rather than written out",
    /const limit = Math\.max\(1, daysBetweenKeys\(cur, today\) \+ 1\) \+ 1;/.test(src));
  ok("and no magic day count is left in the walk", !/guard\+\+ < 4000/.test(src));
}

// =====================================================================
// SSN-7: XP is earned under the rule in force at the time
// =====================================================================
group("SSN-7 the mutator rotation cannot rewrite the past");
{
  // Every week keeps the mutator the absolute-millisecond arithmetic gave it.
  // The rotation is now stepped in day keys (TIM-6's rule), and the epoch is
  // chosen so the phase is identical; this holds it there.
  let anomalies = 0, mismatches = 0, prev = null;
  for (let d = Date.UTC(2024, 0, 1); d < Date.UTC(2031, 0, 1); d += DAY) {
    const t = d + 12 * HOUR;
    const key = weekStartKeyIn(t, zone);
    const legacy = Math.floor(weekStartIn(t, zone) / (7 * DAY));
    if (prev && prev.key !== key && weekIndexOfKey(key) - prev.i !== 1) anomalies++;
    if (mod(legacy, 4) !== mod(weekIndexOfKey(key), 4)) mismatches++;
    prev = { key, i: weekIndexOfKey(key) };
  }
  ok(`the rotation advances exactly one week at a time, clock changes included (${anomalies} anomalies)`, anomalies === 0);
  ok(`and every week from 2024 to 2030 keeps the rule it already had (${mismatches} mismatches)`, mismatches === 0);
  ok("a week before the epoch indexes into the array rather than off it",
    !!mutatorAtKey(nextDayKey(MUTATOR_EPOCH_KEY, -21)) && !!mutatorAtKey("2019-01-07"));

  // The measured regression. One dry day banked in a Steady Flame week is worth
  // 20 XP, which is one region clear. Read the following Monday, under Night
  // Watch, the old formula rescored it at 10 and the region vanished off the map
  // with nothing logged and nothing done.
  const flameWeekDay = "2026-09-03";   // Thu, week of Mon 31 Aug: Steady Flame
  const nightWeekDay = "2026-09-08";   // Tue, week of Mon 07 Sep: Night Watch
  ok("the two days really do sit in different mutator weeks",
    mutatorAtKey(flameWeekDay).name === "Steady Flame" && mutatorAtKey(nightWeekDay).name === "Night Watch");
  const earned = seasonXP({ dryDayKeys: [flameWeekDay], cravings: [], bonus: 0, mutatorAt });
  eq("a dry day is scored under the week it fell in", earned, 20);
  eq("one region cleared", regionsFrom(earned), 1);
  eq("and it is still 20 when read from inside the next week", seasonXP({ dryDayKeys: [flameWeekDay], cravings: [], bonus: 0, mutatorAt }), 20);
  ok("so the region is still there (this is the defect, as a guard)", regionsFrom(seasonXP({ dryDayKeys: [flameWeekDay], cravings: [], bonus: 0, mutatorAt })) === 1);
  // What the old formula did, reconstructed: one mutator applied to everything.
  const asIfUniform = [flameWeekDay].length * mutatorAtKey(nightWeekDay).dryXP;
  ok(`the superseded uniform scoring would have halved it (${asIfUniform} vs ${earned})`, asIfUniform < earned);
  // A late craving beaten during Night Watch keeps its 40 when Blind Week
  // arrives, which is the same rule read from the other side.
  const lateCraving = [{ t: boundaryOfKey(nightWeekDay, zone) + 15 * HOUR, late: true }];
  eq("a late craving keeps the 40 it was beaten for", seasonXP({ dryDayKeys: [], cravings: lateCraving, bonus: 0, mutatorAt }), 40);
  ok("the component passes the resolver, not this week's rule",
    src.includes("const xp = seasonXP({ dryDayKeys, cravings: seasonCravings, bonus: seasonBonus, mutatorAt })"));
  ok("and nothing multiplies a dry-day count by one mutator any more",
    !/dryDays \* mutator\.dryXP/.test(src));
}

// =====================================================================
// TIM-6: the season's days are counted as days, not as a duration
// =====================================================================
group("TIM-6 dry days are enumerated by key");
{
  const none = new Set();
  ok("a season on its first day has nothing closed yet",
    seasonDryDayKeys("2026-09-02", "2026-09-02", none).length === 0);
  eq("five closed days, none logged", seasonDryDayKeys("2026-09-02", "2026-09-07", none).length, 5);
  ok("today is never counted, however dry it looks",
    !seasonDryDayKeys("2026-09-02", "2026-09-07", none).includes("2026-09-07"));
  // The measured case: a season started at 13:16 on 2 September, read on the
  // morning of the 7th. Six day keys have passed; the duration said five, so the
  // walk stopped a day short and the 6th was never examined.
  const logged = new Set(["2026-09-02", "2026-09-04", "2026-09-05", "2026-09-06"]);
  const keys = seasonDryDayKeys("2026-09-02", "2026-09-07", logged);
  ok("yesterday is examined rather than left until tomorrow", keys.includes("2026-09-03") && keys.length === 1);
  {
    // Had yesterday been dry it would now be credited, which is the half of the
    // defect the real data could not show.
    const otherwise = new Set(["2026-09-02", "2026-09-04", "2026-09-05"]);
    ok("a dry yesterday is credited today, not a day late",
      seasonDryDayKeys("2026-09-02", "2026-09-07", otherwise).includes("2026-09-06"));
  }
  eq("a season cannot enumerate past its own length",
    seasonDryDayKeys("2026-01-01", "2027-01-01", none).length, 28);
  ok("the walk no longer reads the duration figure",
    !/for \(let i = 0; i < seasonDayNum - 1; i\+\+\)/.test(src));
  ok("SSN-3 still reads the season's length as elapsed duration (TIM-6)",
    src.includes("Math.min(28, Math.floor((now - state.seasonStart) / DAY) + 1)"));
}

// =====================================================================
// DRK-11 / DAT-8: the packed log
// =====================================================================
group("DRK-11 the log points at a catalogue it cannot have edited");
{
  const fat = [
    { t: 1, day: "2026-09-02", tzo: 60, label: "Hawkstone Session", ml: 568, abv: 4, units: 2.3, cost: 6.5 },
    { t: 2, day: "2026-09-02", tzo: 60, label: "Hawkstone Session", ml: 568, abv: 4, units: 2.3, cost: 6.5 },
    { t: 3, day: "2026-09-04", tzo: 60, label: "Hells", ml: 440, abv: 4.6, units: 2, cost: 2.5 },
    { t: 4, day: "2026-09-04", tzo: 60, label: "Pint out", ml: 568, abv: 4.5, units: 2.6, cost: 6.5, seed: "beer" },
  ];
  const sameLogs = (a, b) => a.length === b.length && a.every((x, i) => {
    const ka = Object.keys(x).sort(), kb = Object.keys(b[i]).sort();
    return JSON.stringify(ka) === JSON.stringify(kb) && ka.every((k) => x[k] === b[i][k]);
  });
  const held = { budget: 14, drinks: [{ label: "Hells", ml: 440, abv: 4.6, units: 2, cost: 2.5 }], logs: fat };
  const packed = packState(held);
  // Checked before anything reads it, so a packer that quietly returns its input
  // reports a failure here rather than throwing and taking the rest of the
  // group's checks down with it.
  ok("packing produces a catalogue", Array.isArray(packed.drinkCat));
  const cat = packed.drinkCat || [];
  ok("repeated drinks collapse to one catalogue row", cat.length === 3);
  ok("an entry keeps only its own time fields plus an index",
    JSON.stringify(Object.keys(packed.logs[0] || {}).sort()) === JSON.stringify(["c", "day", "t", "tzo"]));
  ok("the round trip is lossless", sameLogs(unpackState(packed).logs, fat));
  ok("a field riding along on a seeded button survives it", unpackState(packed).logs[3].seed === "beer");
  ok("packing is idempotent", JSON.stringify(packState(packed)) === JSON.stringify(packed));
  ok("hydrating twice is idempotent",
    sameLogs(unpackState(unpackState(packed)).logs, fat));
  ok("the catalogue never survives into held state", !("drinkCat" in unpackState(packed)));

  // The reason this is not a pointer into `state.drinks`. TIM-1 settled that the
  // day a drink belongs to is frozen at logging; what was in the glass is the
  // same class of fact, and the deck is edited by the user all the time.
  const edited = unpackState(packed);
  edited.drinks = [{ label: "Hells", ml: 440, abv: 5.2, units: 2.3, cost: 3.1 }];
  ok("editing the drink deck cannot rewrite a night already logged",
    sameLogs(unpackState(packState(edited)).logs, fat));
  ok("and the catalogue is derived from the logs, never from the deck",
    !JSON.stringify(packState(edited).drinkCat || []).includes("5.2"));

  // DRK-10 removes entries, so a row nothing points at any more should go.
  const trimmed = unpackState(packed);
  trimmed.logs = trimmed.logs.filter((l) => l.label !== "Hells");
  ok("a catalogue row the last log left behind is dropped on the next write",
    (packState(trimmed).drinkCat || []).length === 2);

  // Size, measured rather than asserted as a principle.
  const fatBytes = JSON.stringify(held).length;
  const slimBytes = JSON.stringify(packed).length;
  ok(`the store is smaller for it (${fatBytes} -> ${slimBytes} bytes)`, slimBytes < fatBytes);
  {
    const many = Array.from({ length: 1040 }, (_, i) => ({ ...fat[i % 2], t: i + 10 }));
    const a = JSON.stringify({ budget: 14, logs: many }).length;
    const b = JSON.stringify(packState({ budget: 14, logs: many })).length;
    ok(`a year of logging drops by more than half (${(a / 1024).toFixed(0)} KiB -> ${(b / 1024).toFixed(0)} KiB)`, b < a * 0.5);
  }

  // A damaged file, and the two different jobs the loader and the picker have.
  const broken = { budget: 14, logs: [{ c: 9, t: 1, day: "2026-09-02", tzo: 60 }], drinkCat: [] };
  ok("DAT-8: the picker refuses a file whose indices resolve to nothing", !catalogueResolves(broken));
  ok("and accepts a well-formed one", catalogueResolves(packed));
  ok("a fat export from an earlier build is still accepted", catalogueResolves(held));
  ok("the loader keeps the night rather than dropping it",
    unpackState(broken).logs.length === 1 && unpackState(broken).logs[0].label === "Unrecorded drink");
  ok("and says what it is rather than counting it as nothing real",
    unpackState(broken).logs[0].units === 0);

  // Wiring: three funnels, and all three have to be the packed form.
  ok("the one write path packs", /localStorage\.setItem\(storeKey\(\), JSON\.stringify\(packState\(s\)\)\)/.test(src));
  ok("the migration hydrates before anything else reads the logs",
    /const parsed = unpackState\(input\);/.test(src) &&
    src.indexOf("const parsed = unpackState(input);") < src.indexOf("...JSON.parse(JSON.stringify(defaultState)), ...parsed,"));
  ok("DAT-2/DAT-8: the export carries the packed form", /JSON\.stringify\(packState\(state\), null, 2\)/.test(src));
  ok("DAT-3: the shape check includes the catalogue", /if \(!catalogueResolves\(parsed\)\) return null;/.test(src));
  ok("nothing puts the catalogue into defaultState", !/^\s*drinkCat:/m.test(src));
}

// =====================================================================
// BAR-10: the self-relative channel
// =====================================================================
group("BAR-10 measured against the user, not the budget");
{
  // A day key n days before 1 Sep 2026, so the fixtures read as calendar weeks.
  const day = (n) => nextDayKey("2026-09-01", n);
  const logsFor = (perDay) => Object.entries(perDay).flatMap(([k, u]) =>
    [{ t: boundaryOfKey(k, zone) + 20 * HOUR, day: k, tzo: 60, units: u, cost: 5, label: "x" }]);
  const nowOn = (k) => boundaryOfKey(k, zone) + 22 * HOUR;

  ok("no history says nothing at all", baselineAt([], nowOn(day(0)), null) === null);
  {
    // Six days of history: not one complete prior window, let alone two.
    const b = baselineAt(logsFor({ [day(-5)]: 4, [day(-1)]: 6 }), nowOn(day(0)), null);
    ok("one week in, there is no baseline yet", b.baseline === null);
    eq("and it says how many days are still needed", b.needDays, 15);
    ok("the bar keeps its label rather than showing a placeholder", baselineNote(b) === null);
  }
  {
    // Twenty days of history is the point two whole prior windows exist.
    const per = {};
    for (let i = -20; i <= 0; i++) per[day(i)] = 2;
    const b = baselineAt(logsFor(per), nowOn(day(0)), null);
    ok("twenty days in, the channel opens", b.baseline !== null && b.windows === 2);
    eq("no needDays left to serve", b.needDays, 0);
    eq("current window", b.current, 14);
    eq("baseline of two identical windows", b.baseline, 14);
    ok("and a steady fortnight reads as level", baselineNote(b) === "Level with your usual");
  }
  {
    // Four prior windows of 40, 40, 10, 40 and a current one of 20. The median
    // is 40, so the holiday week does not drag the standard down; a mean would
    // have made 20 look like only a small improvement.
    const per = {};
    const weeks = [40, 40, 10, 40];            // windows 1..4 back
    for (let w = 1; w <= 4; w++) for (let i = 0; i < 7; i++) per[day(-7 * w - i)] = weeks[w - 1] / 7;
    for (let i = 0; i < 7; i++) per[day(-i)] = 20 / 7;
    const b = baselineAt(logsFor(per), nowOn(day(0)), null);
    eq("four windows are in play", b.windows, 4);
    eq("the median ignores the outlier week", b.baseline, 40);
    eq("the trailing week", b.current, 20);
    ok("and the copy names the gap in units", baselineNote(b) === "20.0 under your usual");
  }
  {
    // Drinking more than usual says so, in the same register and with no colour,
    // no target and nothing about a body (P1, BAR-6).
    const per = {};
    for (let w = 1; w <= 4; w++) for (let i = 0; i < 7; i++) per[day(-7 * w - i)] = 2;
    for (let i = 0; i < 7; i++) per[day(-i)] = 5;
    const b = baselineAt(logsFor(per), nowOn(day(0)), null);
    ok("over reads as over", baselineNote(b) === "21.0 over your usual");
  }
  {
    // A window reaching back before the first log would count days the user was
    // not being measured on as abstinent ones, making every real week look worse
    // than it was: dishonest under P2 and on the discouraging side of it.
    const per = {};
    for (let i = 0; i <= 27; i++) per[day(-i)] = 2;
    const b = baselineAt(logsFor(per), nowOn(day(0)), null);
    ok(`only whole windows inside recorded history count (${b.windows})`, b.windows === 3);
  }
  {
    // Half a unit either way is a rounding difference, not a trend.
    const per = {};
    for (let w = 1; w <= 4; w++) for (let i = 0; i < 7; i++) per[day(-7 * w - i)] = 2;
    for (let i = 0; i < 7; i++) per[day(-i)] = i === 0 ? 2.4 : 2;
    ok("a 0.4 difference is not a direction", baselineNote(baselineAt(logsFor(per), nowOn(day(0)), null)) === "Level with your usual");
  }
  {
    // Seven day keys inclusive of the end day, which is the window MET-4 makes
    // the bar, the home-screen figures and the companion's mood share.
    const m = new Map([["2026-09-01", 3], ["2026-08-26", 9], ["2026-08-25", 100]]);
    eq("the seventh day back is inside the window", unitsInWindow(m, "2026-09-01"), 12);
    ok("the eighth is not", unitsInWindow(m, "2026-09-01") < 100);
  }
  ok("four windows of context, two before it will speak",
    BASELINE_WINDOWS === 4 && BASELINE_MIN_WINDOWS === 2);
  ok("BAR-10 takes no notice of the budget at all",
    !/baselineAt\([^)]*budget/.test(src) && !/function baselineAt\(logs, now, maxSeen, budget/.test(src));
  ok("it rides in the header row's label slot, so MET-5 keeps its pixels",
    src.includes('<span>{trend || "Capacity"}</span>'));
  ok("BAR-3: hidden with every other unit-derived figure under Blind Week",
    src.includes("const trend = hidden ? null : baselineNote(baseline);"));
  ok("BAR-6: nothing in the copy claims anything about a body",
    !/(liver|blood|sober|metabolis|process(es|ed)? alcohol|recover(s|y)? by)/i.test(
      src.slice(src.indexOf("function baselineNote"), src.indexOf("// ---- end of pure day maths ----"))));
  ok("NFR-6: and it is not a target, a goal or a permission",
    !/(you've earned|goal|target|should be|well done)/i.test(
      src.slice(src.indexOf("function baselineNote"), src.indexOf("// ---- end of pure day maths ----"))));
  ok("DRK-10 explains it where the refill rule is explained (BAR-6)",
    src.includes("Your usual.") && src.includes("It needs twenty days logged"));
  ok("and the memo does not run on the one-second tick",
    /const baseline = useMemo\(\n\s+\(\) => \(state \? baselineAt/.test(src));
}

// =====================================================================
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nfailures:"); fails.forEach((f) => console.log(`  - ${f}`)); }
process.exit(fail ? 1 : 0);
