#!/usr/bin/env node
"use strict";

// Rule-count sync. rules.json is the source of truth for how many rules the checker has; several
// pieces of prose state that number as well, and nothing kept them in sync. They sat at 24 while
// rules.json carried 31 for over a week, against a written instruction in AGENTS.md to update
// them. A written rule that nothing enforces is the defect class this repository keeps producing.
//
// Two mechanisms, deliberately, because either alone fails:
//
//   PINS  -- one per known claim, matched by sentence. A pin that matches NOTHING fails the build.
//            That property is the whole point: a scan that finds no sites and a repository with no
//            drift produce the same output, and this repository has shipped that mistake before.
//
//   SWEEP -- a net for a count that appears in prose without being pinned. It is calibrated, not
//            aspirational: two-or-three-digit numbers within `window` characters of a rule noun,
//            markdown only. Anything it finds must be pinned or exempted with a reason.
//
// The sweep is not sufficient on its own and here is the proof: README's "reports faults before
// you open it: 31 of them" states the count with the noun nine words away, and no reasonable
// window finds it. It is pinned by hand. Anyone widening the sweep to catch that sentence should
// first look at what else the wider window drags in.
//
// ZBI_RULES points the gate at another rules.json, mirroring ZBI_REAL_PROJECT in the test suite.
// It exists so the gate can be shown to FAIL on demand without editing a file under skills/.
//
// Run: node .github/scripts/check-rule-count.js

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SITES = path.join(ROOT, "perf", "rule-count-sites.json");
const RULES = process.env.ZBI_RULES
  ? path.resolve(process.env.ZBI_RULES)
  : path.join(ROOT, "plugins", "zebra-bi", "skills", "report-authoring", "rules.json");

const cfg = JSON.parse(fs.readFileSync(SITES, "utf8"));
const rules = JSON.parse(fs.readFileSync(RULES, "utf8")).rules;
if (!Array.isArray(rules)) {
  console.error(`${path.relative(ROOT, RULES)} has no rules array.`);
  process.exit(1);
}
const COUNT = rules.length;

const failures = [];
const lines = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/);

console.log(`rule-count sync  (rules.json: ${COUNT} rules${process.env.ZBI_RULES ? `, from ZBI_RULES=${process.env.ZBI_RULES}` : ""})\n`);

// ---- pins --------------------------------------------------------------------------------------

const pinnedLines = new Set(); // "file:line", so the sweep does not re-report a pinned site
console.log("  pinned claim sites");
for (const pin of cfg.pins) {
  const re = new RegExp(pin.pattern);
  let hits = 0;
  lines(pin.file).forEach((line, i) => {
    const m = re.exec(line);
    if (!m) return;
    hits++;
    pinnedLines.add(`${pin.file}:${i + 1}`);
    const stated = Number(m[1]);
    const ok = stated === COUNT;
    console.log(`    ${ok ? "ok  " : "DRIFT"}  ${pin.file}:${i + 1}  states ${stated}   [${pin.id}]`);
    if (!ok) {
      failures.push(
        `${pin.file}:${i + 1} states ${stated} rules; rules.json has ${COUNT}.\n` +
          `    ${line.trim()}\n` +
          `    Change the number in that sentence to ${COUNT}.`
      );
    }
  });
  if (hits === 0) {
    // The sentence was reworded or deleted. Either way this pin is now watching nothing, and a
    // silent pass here is precisely how the count drifted the last time.
    failures.push(
      `pin "${pin.id}" matched 0 sites in ${pin.file}.\n` +
        `    Pattern: /${pin.pattern}/\n` +
        `    The sentence was reworded, moved, or removed, so this pin now checks nothing.\n` +
        `    Re-pin it in perf/rule-count-sites.json against the new wording, or delete the entry\n` +
        `    if the claim is genuinely gone.`
    );
    console.log(`    MISS  ${pin.file}  matched nothing   [${pin.id}]`);
  }
}

// ---- sweep -------------------------------------------------------------------------------------

const noun = new RegExp(cfg.sweep.noun, "i");
const W = cfg.sweep.window;
const usedExemptions = new Set();
let sweepHits = 0;
let sweepPinned = 0;
let sweepUnregistered = 0;

console.log("\n  sweep for unregistered counts");
for (const file of cfg.sweep.files) {
  lines(file).forEach((line, i) => {
    const re = /\b\d{2,3}\b/g;
    let m;
    while ((m = re.exec(line))) {
      const near = line.slice(Math.max(0, m.index - W), Math.min(line.length, m.index + m[0].length + W));
      if (!noun.test(near)) continue;
      sweepHits++;
      if (pinnedLines.has(`${file}:${i + 1}`)) {
        sweepPinned++;
        continue;
      }
      const ex = cfg.exemptions.find((e) => e.file === file && line.includes(e.contains));
      if (ex) {
        usedExemptions.add(`${ex.file}::${ex.contains}`);
        continue;
      }
      sweepUnregistered++;
      failures.push(
        `${file}:${i + 1} states a number next to a rule/check noun and is neither pinned nor exempt.\n` +
          `    ${line.trim()}\n` +
          `    If it is the rule count, add a pin to perf/rule-count-sites.json so it is kept at ${COUNT}.\n` +
          `    If it is not, add an exemption there with the reason it is not.`
      );
    }
  });
}
console.log(
  `    ${sweepHits} number(s) near a rule noun; ${sweepPinned} already pinned, ` +
    `${usedExemptions.size} exempted, ${sweepUnregistered} unregistered`
);
if (sweepPinned < pinnedLines.size) {
  // Expected, and worth saying rather than leaving as an apparent off-by-one: the sweep sees fewer
  // pinned lines than there are pins because at least one claim states the count too far from any
  // rule noun for a sane window to reach. That is the argument for having pins at all.
  console.log(
    `    (${pinnedLines.size - sweepPinned} pinned site(s) the sweep cannot see — the count is stated ` +
      `too far from a rule noun. That is why pins exist.)`
  );
}

// A stale exemption is not a build failure -- the prose it excused is simply gone -- but leaving it
// makes the file read as though it is holding something back when it is not.
for (const e of cfg.exemptions) {
  if (!usedExemptions.has(`${e.file}::${e.contains}`)) {
    console.log(`    notice: exemption no longer matches anything, safe to delete — ${e.file} :: "${e.contains}"`);
  }
}

for (const gap of cfg.known_gaps || []) console.log(`\n  known gap: ${gap}`);

if (failures.length) {
  console.error(`\nrule-count sync FAILED — ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`\nrule-count sync ok — ${cfg.pins.length} pin(s) all matched and all state ${COUNT}`);
