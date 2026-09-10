#!/usr/bin/env node
"use strict";

// Context budget. A skill body is paid for on every activation whether or not it is read, so its
// size is a product property and not a matter of taste -- and it is the kind of property that is
// won once and lost silently, one well-meant paragraph at a time. This turns that into a failed
// build.
//
// THE ESTIMATOR IS words x 4/3, where a word is a whitespace-separated run of non-space
// characters. It is not a tokenizer and does not pretend to be one. It is stable, has no
// dependencies, and reproduces the measurement the budget was set from; a real tokenizer would be
// more accurate and would also make every ceiling in perf/context-budget.json meaningless the day
// it changed version.
//
// A ceiling is a RATCHET. Lowering one is a one-line edit to the JSON. Raising one is also a
// one-line edit, which is the point: it cannot happen by accident, only in a diff a reviewer sees.
//
// Files with a null ceiling are measured and printed but not gated. They are loaded on demand, so
// they are not part of the per-session floor, and the restructuring this budget protects works by
// moving material INTO them. A large fake ceiling would have read as coverage while catching
// nothing.
//
// Run: node .github/scripts/check-context-budget.js

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BUDGET = path.join(ROOT, "perf", "context-budget.json");

// Every markdown file under here is always-loaded or one reference away from it, so a new one must
// be budgeted rather than appearing unmeasured. `sha256sum -c` in the bundle job has the same
// blind spot for the same reason: verifying what you were told about says nothing about what was
// added.
const COVERED_TREE = path.join(ROOT, "plugins", "zebra-bi", "skills");

function tokens(text) {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * (4 / 3));
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".md")) out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

const budget = JSON.parse(fs.readFileSync(BUDGET, "utf8"));
const failures = [];
const rows = [];

for (const entry of budget.files) {
  const abs = path.join(ROOT, entry.path);
  if (!fs.existsSync(abs)) {
    // A budget pointing at a file that moved is not a passing budget. It is a budget that reads
    // nothing, which scores the same green as a budget that is being met.
    failures.push(
      `perf/context-budget.json lists ${entry.path}, which does not exist.\n` +
        `    The file was moved or renamed and the budget was not. Update the path, or drop the entry\n` +
        `    if the file is genuinely gone.`
    );
    continue;
  }
  const actual = tokens(fs.readFileSync(abs, "utf8"));
  rows.push({ path: entry.path, actual, ceiling: entry.ceiling, target: entry.target });

  if (entry.ceiling !== null && entry.ceiling !== undefined && actual > entry.ceiling) {
    failures.push(
      `${entry.path} is ${actual} tokens, over its ceiling of ${entry.ceiling} by ${actual - entry.ceiling}.\n` +
        `    This file loads in full on every skill activation, so that is ${actual - entry.ceiling} tokens paid\n` +
        `    on every session by every user. Move the new material into a reference under\n` +
        `    references/ and link to it, or cut something. Raising the ceiling in\n` +
        `    perf/context-budget.json is allowed and must be argued for in the pull request.`
    );
  }
}

// Coverage: a new always-loaded file must not slip in unbudgeted.
const budgeted = new Set(budget.files.map((f) => f.path));
const onDisk = fs.existsSync(COVERED_TREE) ? walk(COVERED_TREE, []) : [];
const unbudgeted = onDisk.filter((f) => !budgeted.has(f));
if (unbudgeted.length) {
  failures.push(
    `markdown under plugins/zebra-bi/skills/ with no budget entry:\n` +
      unbudgeted.map((f) => `      ${f} (${tokens(fs.readFileSync(path.join(ROOT, f), "utf8"))} tokens)`).join("\n") +
      `\n    Add each to perf/context-budget.json. Give it a ceiling if it loads on activation,\n` +
      `    or null if it is loaded on demand -- and say which in the "why".`
  );
}

// ---- report, every file, not only the failures -------------------------------------------------

const w = (s, n) => String(s).padStart(n);
console.log(`context budget  (estimator: ${budget.estimator})\n`);
console.log(`  ${w("tokens", 8)} ${w("ceiling", 8)} ${w("headroom", 9)}  file`);
for (const r of rows) {
  const gated = r.ceiling !== null && r.ceiling !== undefined;
  const head = gated ? r.ceiling - r.actual : null;
  const flag = gated ? (r.actual > r.ceiling ? "OVER" : "") : "";
  let line = `  ${w(r.actual, 8)} ${w(gated ? r.ceiling : "-", 8)} ${w(gated ? head : "-", 9)}  ${r.path}`;
  if (flag) line += `   <-- ${flag}`;
  if (!gated) line += `   (tracked, not gated: loaded on demand)`;
  console.log(line);
  if (r.target !== null && r.target !== undefined) {
    const delta = r.actual - r.target;
    console.log(
      `  ${w("", 8)} ${w("", 8)} ${w("", 9)}  target ${r.target} — ` +
        (delta > 0 ? `${delta} still to relocate` : `met, with ${-delta} to spare`)
    );
  }
  // The ratchet nudge. Not a failure: a file being under its ceiling is the thing working.
  if (gated && head > 0) {
    console.log(
      `  ${w("", 8)} ${w("", 8)} ${w("", 9)}  ceiling can be lowered to ${r.actual} to keep the win`
    );
  }
}

if (failures.length) {
  console.error(`\ncontext budget FAILED — ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`\ncontext budget ok — ${rows.length} file(s) measured, ${rows.filter((r) => r.ceiling != null).length} gated`);
