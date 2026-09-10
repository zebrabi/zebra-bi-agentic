#!/usr/bin/env node
"use strict";

// Every rule in the catalogue must have a checker that can actually fire. A rule declared in
// rules.json with no implementation behind it is worse than no rule: it is counted in the number
// we tell the customer, it appears in the catalogue, and it never once reports the fault it names.
// The two existing suites disagree about whether that is allowed (see AGENTS.md), so this gate
// states the strict position on its own and does not depend on which suite ran.
//
// The mapping is rule.check -> a key of the `checkers` object exported by mcp/checkers.js. The
// rule id is what a human argues about; `check` is the wiring. Failures are reported by id,
// because that is what the reader is looking for.
//
// checkers.js is READ, never modified, and is required directly rather than parsed, so this gate
// asserts the function exists at runtime rather than that its name appears in the file. A regex
// over source would pass on a name inside a comment.
//
// ZBI_RULES points the gate at another rules.json, mirroring ZBI_REAL_PROJECT in the test suite.
// Every rule is implemented today, so this gate passes trivially -- and a gate that has only ever
// been seen to pass is indistinguishable from a gate that reads nothing. The override is how you
// watch it fail without editing generated output under skills/.
//
// Run: node .github/scripts/check-rule-implementations.js

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const RULES = process.env.ZBI_RULES
  ? path.resolve(process.env.ZBI_RULES)
  : path.join(ROOT, "plugins", "zebra-bi", "skills", "report-authoring", "rules.json");
const CHECKERS = path.join(ROOT, "plugins", "zebra-bi", "mcp", "checkers.js");

const { checkers } = require(CHECKERS);
const rules = JSON.parse(fs.readFileSync(RULES, "utf8")).rules;

if (!checkers || typeof checkers !== "object" || Object.keys(checkers).length === 0) {
  console.error(`${path.relative(ROOT, CHECKERS)} exported no checkers. The gate cannot read anything — fix it before trusting any result.`);
  process.exit(1);
}
if (!Array.isArray(rules) || rules.length === 0) {
  console.error(`${path.relative(ROOT, RULES)} has no rules array.`);
  process.exit(1);
}

console.log(
  `rule implementations  (${rules.length} rules, ${Object.keys(checkers).length} checkers` +
    `${process.env.ZBI_RULES ? `, rules from ZBI_RULES=${process.env.ZBI_RULES}` : ""})\n`
);

const missing = [];
for (const rule of rules) {
  const fn = checkers[rule.check];
  const ok = typeof fn === "function";
  if (!ok) missing.push(rule);
  console.log(`  ${ok ? "ok  " : "MISS"}  ${String(rule.id).padEnd(38)} -> ${rule.check}`);
}

// The reverse direction is owned by test-tmdl.js ("every checker has a rule"), so it is reported
// here rather than failed, to avoid two gates asserting the same thing with different wording.
const claimed = new Set(rules.map((r) => r.check));
const orphans = Object.keys(checkers).filter((c) => !claimed.has(c));
if (orphans.length) {
  console.log(`\n  notice: ${orphans.length} checker(s) with no rule — cannot fire, cannot be reported: ${orphans.join(", ")}`);
  console.log(`  test-tmdl.js fails on this; it is a notice here so the two gates do not disagree in wording.`);
}

if (missing.length) {
  console.error(`\nrule implementations FAILED — ${missing.length} rule(s) declared with nothing behind them\n`);
  for (const r of missing) {
    console.error(
      `  - rule "${r.id}" names check "${r.check}", and plugins/zebra-bi/mcp/checkers.js exports no such\n` +
        `    function. The rule is counted in the catalogue and can never fire.\n` +
        `    Implement checkers.${r.check}, or remove the rule from rules.json.\n` +
        `    Do NOT relax this gate: as of the last measurement all rules were implemented, so a\n` +
        `    failure here is either a real gap or a mis-detected mapping. Investigate first.\n`
    );
  }
  process.exit(1);
}
console.log(`\nrule implementations ok — all ${rules.length} rules have a checker function`);
