#!/usr/bin/env node
// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";
/**
 * A pinned run against a real project nobody wrote for these rules.
 *
 * The fixture is the hand-built SalesVarianceDashboard, six visuals across three pages, stored as
 * `fixtures/sales-variance-dashboard.json` and materialised into a temp directory per run. It is
 * not a Zebra-shipped template, so it cannot serve as the "must report nothing" baseline: it
 * carries four genuine defects, each verified by hand and each pinned with its reason. What it can
 * do is pin the answer.
 *
 * That is worth more than it sounds. Every other test uses input built for the rule it exercises,
 * and fixtures agree with their author's misreading. This one caught a rule firing on every
 * projection in every visual, 19 false positives, after that same failure had been written into
 * the spec as the thing to avoid. Pinning the output means the next rule cannot repeat it
 * quietly: any new finding here fails until a human judges it.
 *
 * Runs unattended against the bundled fixture. It used to skip unless ZBI_REAL_PROJECT was set,
 * nothing ever set it, and the suite reported exit 0 for eight days while a wont-open defect sat
 * in the fixture unseen — so "absent fixture" is now a failure, not a skip.
 *
 *   node test-real-project.js
 *   ZBI_REAL_PROJECT=/path/to/other node test-real-project.js   # pins skip, generic checks run
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const srv = require("./server.js");

// The fixture now ships beside this file, and it is stored as a MANIFEST rather than a project.
//
// It used to come only from the environment: the first version embedded a machine-specific repository
// path and the build refused it, correctly, because a test file ships to customers like everything
// else. The fix was `ZBI_REAL_PROJECT`, and it worked exactly as well as an unset variable — CI
// never set it, so from 06 Aug this suite skipped on every run while reporting exit 0, and a
// wont-open defect sat in the fixture for eight days with a green tick over it. A suite that skips
// and a suite that passes are indistinguishable from the outside, which is the failure this whole
// file exists to prevent, reproduced in the file itself.
//
// Why a manifest and not just the project tree: the repository `.gitignore` blocks `*.pbip`,
// `*.Report/` and `*.SemanticModel/`, and that is a CREDENTIAL guard, not tidiness — saving a report
// in Power BI Desktop writes a Zebra licence key into each `visual.json` that has rendered, so a
// project directory living in a published repository is one Desktop session away from leaking one. Committing the tree meant punching a hole in exactly the guard that matters. A manifest
// cannot be opened in Desktop, so no key can ever be written into it, and the guard stays whole.
//
// It is materialised into a temp directory per run, which the validator then reads as an ordinary
// project. `ZBI_REAL_PROJECT` still overrides it for pointing the generic assertions at a bigger
// project locally.
const MANIFEST = path.join(__dirname, "fixtures", "sales-variance-dashboard.json");
const OVERRIDE = process.env.ZBI_REAL_PROJECT || "";
const USING_BUNDLED = !OVERRIDE;

function materialise(manifestPath) {
  const spec = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zbi-fixture-"));
  for (const [rel, content] of Object.entries(spec.files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return root;
}

// Each pinned finding, with why it is true. A pin without a reason rots into a rubber stamp.
const EXPECTED = {
  "pbip-schema-wrong": "the .pbip carries no $schema key at all, so Desktop opens Untitled",
  // Reworded 2026-08-05. The old reason read "so PY silently equals AC", which is a measured symptom
  // of a DIFFERENT fault -- no time context in the visual. An unmarked but contiguous date column
  // still computes. The finding is real, its stated consequence was borrowed, and the rule is now
  // `looks-fine` rather than `wrong-numbers`.
  "no-date-table-marked": "Calendar.tmdl has no dataCategory line, so Power BI may build its own "
    + "auto date/time hierarchy beside this one",
  // Pinned 2026-08-06 as a TRUE defect, judged rather than accepted. The hand-built prototype
  // writes designSettings.style as `'0'` -- a quoted word -- where `style` is a numeric-valued
  // enum needing `0D`. Not a declared value, so it is silently ignored. Harmless here only by
  // luck: the value it fails to set is 0, which is also what setting nothing gives. Write `'4'`
  // by the same mistake and the colour gate stays shut with the report rendering cleanly in the
  // wrong palette -- which is the defect confirmed in a shipped vendor template on 5 August.
  //
  // Finding this cost the skill two lines: `formatting.md` showed the gate as `style: '4'` and
  // `"style": "4"` while its own encoding section said numeric enums are D-suffixed, 1401 of 1401
  // across the vendor corpus. A new rule firing on a real project is how the contradiction
  // surfaced, which is the whole reason this fixture exists.
  "numeric-enum-written-as-word": "designSettings.style is `'0'`, a quoted word where the numeric "
    + "form `0D` is required, so the property is silently ignored",
  // UNPINNED 2026-08-05: `property-declared-but-inert` on `card.varianceType`. The pin was itself a
  // false positive that survived because the fixture and the rule shared one belief. varianceType is
  // a variance property whose inert verdict was measured with no comparison bound, which
  // formatting.md's own caveat calls suspect by construction, and the vendor authors four distinct
  // values of it. A pin is only as good as the claim under it.
  //
  // Pinned 2026-08-14 as a TRUE defect, and it is the most serious thing in this fixture: severity
  // `wont-open`, not cosmetic. The rule shipped on 06 Aug and nobody ever saw it fire, because the
  // same commit window is when this suite stopped running -- CI never set ZBI_REAL_PROJECT, so the
  // finding and the blindness arrived together. The fixture was hand-built and never opened in
  // Desktop, which is exactly why a defect that only shows on model load survived in it.
  "tmdl-reserved-table-name-measures": "the model declares a table named exactly `Measures`, a "
    + "reserved name that fails the whole model load with ModelSchemaValidationFailed -- the "
    + "fixture was never opened in Desktop, so nothing caught it",
};

// Neither a missing manifest nor an override that points nowhere is a reason to report success
// quietly -- reporting success quietly is the exact shape of the eight-day silence. Both fail.
let PROJECT = OVERRIDE;
let TEMP = null;
if (USING_BUNDLED) {
  if (!fs.existsSync(MANIFEST)) {
    console.log(`  FAIL  the fixture manifest is missing: ${MANIFEST}`);
    process.exit(1);
  }
  PROJECT = TEMP = materialise(MANIFEST);
} else if (!fs.existsSync(PROJECT)) {
  console.log(`  FAIL  ZBI_REAL_PROJECT points at nothing: ${PROJECT}`);
  process.exit(1);
}

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(["PASS", name, ""]); }
  catch (e) { results.push(["FAIL", name, String(e.message).split("\n")[0].slice(0, 100)]); }
};
// A check that only means anything against the bundled fixture, because the pins were measured on
// it. Skipped rather than silently passed under an override, so the count never overstates itself.
check.pinned = (name, fn) => {
  if (!USING_BUNDLED) { results.push(["SKIP", name, "not the bundled fixture"]); return; }
  check(name, fn);
};

const out = srv.validateReport({ projectPath: PROJECT });
const counts = {};
for (const f of out.findings) counts[f.code] = (counts[f.code] || 0) + 1;

check("the project is actually read, not silently skipped", () => {
  assert.ok(out.ok, out.error);
  // Generalised 2026-08-05. The `/6 visual/` pin below is specific to this fixture; the assertion
  // that matters to any project is that SOMETHING was read, because a validator that reads nothing
  // and a report with nothing wrong return the same number. A corpus harness reported a clean 0
  // findings across 20 templates it had never opened, and the count could not tell anyone.
  const visuals = Number((out.checked.find((c) => /\bvisual\(s\)/.test(c)) || "").match(/^\d+/));
  assert.ok(visuals > 0, `no visual was read, so a zero here means nothing: ${out.checked}`);
  if (USING_BUNDLED) {
    assert.ok(out.checked.some((c) => /6 visual/.test(c)), `visuals not found: ${out.checked}`);
  }
  assert.ok(out.checked.some((c) => /TMDL/.test(c)), "the model was not read");
  // Not a hardcoded catalogue size -- that went stale the day a rule was retired. This says every
  // rule in the catalogue ran, and that the catalogue did not quietly empty out.
  const total = srv.loadRules().length;
  assert.ok(total >= 20, `the catalogue is down to ${total} rules`);
  assert.strictEqual(out.rulesRun, total, "a rule in the catalogue did not run");
});

// The pins were measured on the bundled fixture and belong to it. Under an override they are
// meaningless -- pointing this suite at another project made it "fail" four ways that were only
// ever a fixture mismatch, which is noise dressed as a result. So: report what fired and let the
// reader judge, and keep the generic read-something assertion above, which still applies.
if (!USING_BUNDLED) {
  console.log(`  NOTE  ZBI_REAL_PROJECT overrides the fixture, so the pinned set does not apply.`);
  console.log(`        ${out.findings.length} finding(s): ${Object.keys(counts).join(", ") || "none"}`);
}

// The one that matters. A NEW code here means a rule started firing on a real report, which is
// how a validator becomes noise. It is not automatically wrong, but it needs a human.
check.pinned("no rule fires that is not pinned", () => {
  const unexpected = Object.keys(counts).filter((c) => !(c in EXPECTED));
  assert.strictEqual(unexpected.length, 0,
    `new finding(s) on a real project: ${unexpected.join(", ")}. Judge each one: if it is a true `
    + `defect add it to EXPECTED with the reason, if not the rule is a false positive and 19 of `
    + `those shipped once already.`);
});

check.pinned("every pinned finding still fires exactly once", () => {
  for (const [code, why] of Object.entries(EXPECTED)) {
    assert.strictEqual(counts[code], 1, `${code} fired ${counts[code] ?? 0}x, expected 1 (${why})`);
  }
});

check.pinned("the total is exactly the pinned set", () => {
  assert.strictEqual(out.findings.length, Object.keys(EXPECTED).length,
    `${out.findings.length} findings, pinned ${Object.keys(EXPECTED).length}`);
});

check("notChecked is populated even on a real project", () => {
  assert.ok(out.notChecked.length >= 3);
});

if (TEMP) fs.rmSync(TEMP, { recursive: true, force: true });

for (const [s, n, d] of results) console.log(`  ${s}  ${n}${d ? "  <- " + d : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
const skipped = results.filter((r) => r[0] === "SKIP").length;
console.log(`\n${results.length - failed - skipped}/${results.length - skipped} passed` + (skipped ? `, ${skipped} skipped (override)` : ""));
process.exit(failed ? 1 : 0);
