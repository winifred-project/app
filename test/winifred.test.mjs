// Winifred test harness. Zero dependencies: run with `node test/winifred.test.mjs`.
//
// The app is still one component (spec section 8, accepted debt), so rather than
// importing from src/App.jsx this harness slices the pure helpers and safety
// regexes straight out of the source text and evaluates them. That way the tests
// cannot drift from the shipped patterns, which is the whole point of R-5.
//
// Covers: BAR-4 and BAR-5 capacity regeneration, the 05:00 boundary and a British
// Summer Time transition; CHT-5 and CHT-6 safety screens; QST-3 quest filtering;
// BAR-6 copy constraints; and the DRK-10 wiring.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const helpers = slice("function dayStart(t) {", "function refillPausedTomorrow(logs, budget, now) {\n  const today = (unitsByDay(logs).get(dayStart(now)) || 0);\n  return today >= concentrationThreshold(budget);\n}");
const { dayStart, addDays, capacityAt, capacityTimeline, regenPerDay, concentrationThreshold, refillPausedTomorrow } =
  new Function("HOUR", "DAY",
    `${helpers}\nreturn { dayStart, addDays, capacityAt, capacityTimeline, regenPerDay, concentrationThreshold, refillPausedTomorrow };`
  )(HOUR, DAY);

// Regex literals are lifted by text so the tests exercise the shipped patterns.
function rx(name) {
  const line = src.split("\n").find((l) => l.startsWith(`const ${name} = /`));
  if (!line) throw new Error(`could not find ${name}`);
  return new Function(`return ${line.slice(line.indexOf("/"), line.lastIndexOf(";"))};`)();
}
const scoring = slice("const XP_PER_REGION = 20;", "function regionsFrom(xp) { return Math.min(28, Math.floor(xp / XP_PER_REGION)); }");
const { XP_PER_REGION, MUTATORS, seasonXP, regionsFrom } = new Function(
  `${scoring}\nreturn { XP_PER_REGION, MUTATORS, seasonXP, regionsFrom };`
)();

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
  src.includes("[state && state.logs, state && state.budget, todayStart]"));
// React #310: the loading guard returns early on the first render, so the
// capacity hook must sit above it or the hook count changes between renders.
ok("BAR-7 pause surfaced on the bar", src.includes("pausedTomorrow={pausedTomorrow}"));
ok("BAR-7 explained in the log", src.includes("the next morning's refill was paused"));
ok("log figures come from the shared walk", src.includes("capacityTimeline(logs, budget, now)"));
ok("capacity hook is hoisted above the loading guard",
  src.indexOf("const capacity = useMemo(") < src.indexOf("if (!state) {"));

// =====================================================================
// SSN-1 / SSN-2 / SSN-6: XP, and the map it buys
// =====================================================================
const mut = (name) => MUTATORS.find((m) => m.name === name);
const ordinary = mut("Blind Week");   // baseline values: 10 / 25 / 25
const crave = (n, late = false) => Array.from({ length: n }, () => ({ late }));

group("SSN-1 XP formula");
eq("ordinary week, 5 dry + 2 cravings",
  seasonXP({ dryDays: 5, cravings: crave(2), bonus: 0, mutator: ordinary }), 100);
eq("Steady Flame doubles dry days",
  seasonXP({ dryDays: 5, cravings: crave(2), bonus: 0, mutator: mut("Steady Flame") }), 150);
eq("Night Watch pays 40 for a late craving, 25 for an early one",
  seasonXP({ dryDays: 0, cravings: [{ late: true }, { late: false }], bonus: 0, mutator: mut("Night Watch") }), 65);
eq("late cravings are worth the ordinary 25 outside Night Watch",
  seasonXP({ dryDays: 0, cravings: crave(2, true), bonus: 0, mutator: ordinary }), 50);
eq("bonus XP adds flat",
  seasonXP({ dryDays: 0, cravings: [], bonus: 35, mutator: ordinary }), 35);
ok("nothing in the formula can subtract (P2: no XP penalty)",
  seasonXP({ dryDays: 0, cravings: [], bonus: 0, mutator: ordinary }) === 0);

group("SSN-2 XP clears the fog");
eq("one region costs XP_PER_REGION", regionsFrom(XP_PER_REGION), 1);
eq("a part-region does not round up", regionsFrom(149), 7);
eq("an empty season shows an empty map", regionsFrom(0), 0);
eq("560 XP clears the Reach", regionsFrom(560), 28);
ok("the map caps at 28 regions", regionsFrom(99999) === 28);
{
  // The regression that started this: under the old unweighted count the two
  // XP-only mutators changed nothing a user could see.
  const behaviour = { dryDays: 10, cravings: crave(4), bonus: 0 };
  const plain = regionsFrom(seasonXP({ ...behaviour, mutator: ordinary }));
  const flame = regionsFrom(seasonXP({ ...behaviour, mutator: mut("Steady Flame") }));
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
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nfailures:"); fails.forEach((f) => console.log(`  - ${f}`)); }
process.exit(fail ? 1 : 0);
