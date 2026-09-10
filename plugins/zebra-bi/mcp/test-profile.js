#!/usr/bin/env node
// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";

/**
 * Tests for profile_project.
 *
 * The controls matter more than the assertions here. This tool's whole job is to be COMPLETE, and
 * a profiler that reads nothing returns a tidy empty enumeration that looks exactly like a model
 * with nothing in it. So every test that counts something also asserts the count is non-zero, and
 * there is an explicit test that a Power Query partition is reported as UNPROFILED rather than as
 * zero rows.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const srv = require("./server.js");

const results = [];
function check(name, fn) {
  try { fn(); results.push(["PASS", name, ""]); }
  catch (e) { results.push(["FAIL", name, String(e.message).slice(0, 90)]); }
}

/** A project with a DATATABLE fact table, so cardinality is really on disk. */
function project({ fact = null, measures = null, calendar = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zbi-p-"));
  const def = path.join(root, "Demo.Report", "definition");
  fs.mkdirSync(path.join(def, "pages", "P1", "visuals", "V1"), { recursive: true });
  const md = path.join(root, "Demo.SemanticModel", "definition", "tables");
  fs.mkdirSync(md, { recursive: true });

  const w = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2));
  fs.writeFileSync(path.join(root, "Demo.pbip"), JSON.stringify({ $schema:
    "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json" }));
  w(path.join(def, "definition.pbir"),
    { version: "1.0", datasetReference: { byPath: { path: "../Demo.SemanticModel" } } });
  w(path.join(def, "report.json"), { themeCollection: { baseTheme: { name: "CY24SU10" } } });
  w(path.join(def, "version.json"), { version: "2.0.0" });
  w(path.join(def, "pages", "pages.json"), { pageOrder: ["P1"], activePageName: "P1" });
  w(path.join(def, "pages", "P1", "page.json"), { name: "P1" });
  w(path.join(def, "pages", "P1", "visuals", "V1", "visual.json"),
    { name: "V1", position: { x: 0, y: 0, width: 10, height: 10 },
      visual: { visualType: "textbox", objects: {} } });

  const DEFAULT_FACT = [
    "table Sales",
    "\tcolumn Region",
    "\t\tdataType: string",
    "\tcolumn Segment",
    "\t\tdataType: string",
    "\tcolumn Amount",
    "\t\tdataType: double",
    "\tpartition Sales = calculated",
    "\t\tmode: import",
    "\t\tsource =",
    "\t\t\tDATATABLE(",
    '\t\t\t\t"Region", string,',
    '\t\t\t\t"Segment", string,',
    '\t\t\t\t"Amount", double,',
    "\t\t\t\t{",
    '\t\t\t\t\t{"North", "SMB", 10},',
    '\t\t\t\t\t{"South", "SMB", 20},',
    '\t\t\t\t\t{"North", "Enterprise", 30}',
    "\t\t\t\t}",
    "\t\t\t)",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(md, "Sales.tmdl"), fact === null ? DEFAULT_FACT : fact);
  if (measures) fs.writeFileSync(path.join(md, "Measures.tmdl"), measures);
  if (calendar) fs.writeFileSync(path.join(md, "Calendar.tmdl"), calendar);
  return root;
}

const prof = (opts) => srv.profileProjectTool({ projectPath: project(opts) });

const MEASURES = "table '.Measures'\n\tmeasure Revenue = SUM(Sales[Amount])\n"
               + "\tmeasure 'Revenue PY' = 1\n";

// --- it reads, and the counts are non-zero ---------------------------------------------------

check("it reads the model at all (non-zero tables and columns)", () => {
  const r = prof({ measures: MEASURES });
  assert.strictEqual(r.ok, true, r.error);
  assert.ok(r.tables.length >= 2, `only ${r.tables.length} table(s) — did it read anything?`);
  assert.ok(r.tables.some((t) => t.columns.length > 0), "no columns on any table");
});

check("a categorical column ON THE FACT TABLE is enumerated", () => {
  // The whole point: these are not in the relationship diagram and a hand-written list misses them.
  const refs = prof({ measures: MEASURES }).dimensions.map((d) => d.ref);
  assert.ok(refs.includes("Sales[Region]"), `Region missing from ${refs.join(", ")}`);
  assert.ok(refs.includes("Sales[Segment]"), `Segment missing from ${refs.join(", ")}`);
});

check("a numeric column is NOT offered as a dimension", () => {
  const refs = prof({ measures: MEASURES }).dimensions.map((d) => d.ref);
  assert.ok(!refs.includes("Sales[Amount]"), "offered a measure column as a dimension");
});

// --- the denominator -------------------------------------------------------------------------

check("the enumeration denominator is dimensions x measures", () => {
  const r = prof({ measures: MEASURES });
  assert.strictEqual(r.enumeration.usableDimensions.length, 2);
  assert.strictEqual(r.enumeration.measureCount, 2);
  assert.strictEqual(r.enumeration.candidateQuestions, 4);
});

// --- real cardinality off a DATATABLE ----------------------------------------------------------

check("DATATABLE rows give REAL cardinality and members", () => {
  const r = prof({ measures: MEASURES });
  const sales = r.tables.find((t) => t.name === "Sales");
  assert.strictEqual(sales.rowCount, 3, `rowCount ${sales.rowCount}`);
  assert.strictEqual(sales.dataOnDisk, true);
  const region = sales.columns.find((c) => c.name === "Region");
  assert.strictEqual(region.distinct, 2, `Region distinct ${region.distinct}`);
  assert.deepStrictEqual([...region.members].sort(), ["North", "South"]);
  const amount = sales.columns.find((c) => c.name === "Amount");
  assert.strictEqual(amount.min, 10);
  assert.strictEqual(amount.max, 30);
});

// ⚠️ THE CONTROL THAT MATTERS. A Power Query partition has no rows on disk. Reporting zero rows
// would be a confident lie; the tool must say it did not profile them.
check("a Power Query partition is reported as UNPROFILED, not as zero rows", () => {
  const pq = "table Sales\n\tcolumn Region\n\t\tdataType: string\n"
           + "\tpartition Sales = m\n\t\tmode: import\n\t\tsource = let x = 1 in x\n";
  const r = prof({ fact: pq, measures: MEASURES });
  const sales = r.tables.find((t) => t.name === "Sales");
  assert.strictEqual(sales.dataOnDisk, false);
  assert.strictEqual(sales.rowCount, null, "claimed a row count it cannot know");
  assert.ok(r.notProfiled.some((n) => /Cardinality and ranges for/.test(n)),
    "did not say which tables went unprofiled");
});

// --- findings and gaps --------------------------------------------------------------------------

check("a cardinality-1 dimension is a FINDING, not silently dropped", () => {
  const one = "table Sales\n\tcolumn Region\n\t\tdataType: string\n"
    + "\tpartition Sales = calculated\n\t\tmode: import\n\t\tsource =\n\t\t\tDATATABLE(\n"
    + '\t\t\t\t"Region", string,\n\t\t\t\t{\n\t\t\t\t\t{"Only"},\n\t\t\t\t\t{"Only"}\n\t\t\t\t}\n\t\t\t)\n';
  const r = prof({ fact: one, measures: MEASURES });
  assert.ok(r.gaps.some((g) => /CARDINALITY 1/.test(g) && /Sales\[Region\]/.test(g)),
    `not reported: ${r.gaps.join(" | ")}`);
  // and it must not inflate the denominator
  assert.ok(!r.enumeration.usableDimensions.includes("Sales[Region]"));
});

check("no date column is reported as a structural gap", () => {
  const r = prof({ measures: MEASURES });
  assert.ok(r.gaps.some((g) => /NO DATE COLUMN/.test(g)), r.gaps.join(" | "));
});

check("no plan/PY measure is reported as a structural gap", () => {
  const r = prof({ measures: "table '.Measures'\n\tmeasure Revenue = 1\n" });
  assert.ok(r.gaps.some((g) => /NO PLAN\/PY\/FORECAST/.test(g)), r.gaps.join(" | "));
});

check("a model WITH a PY measure does not report the scenario gap", () => {
  const r = prof({ measures: MEASURES });
  assert.ok(!r.gaps.some((g) => /NO PLAN\/PY\/FORECAST/.test(g)),
    "fired on a model that has Revenue / Revenue PY");
});

check("notProfiled is never empty", () => {
  assert.ok(prof({ measures: MEASURES }).notProfiled.length > 0);
});

// --- signal ranking ---------------------------------------------------------------------------

/** Build a DATATABLE fact table from rows of [Region, Segment, Amount]. */
function factOf(rows) {
  return [
    "table Sales",
    "\tcolumn Region", "\t\tdataType: string",
    "\tcolumn Segment", "\t\tdataType: string",
    "\tcolumn Amount", "\t\tdataType: double",
    "\tpartition Sales = calculated", "\t\tmode: import", "\t\tsource =", "\t\t\tDATATABLE(",
    '\t\t\t\t"Region", string,', '\t\t\t\t"Segment", string,', '\t\t\t\t"Amount", double,',
    "\t\t\t\t{",
    rows.map(([r, s, a]) => `\t\t\t\t\t{"${r}", "${s}", ${a}}`).join(",\n"),
    "\t\t\t\t}", "\t\t\t)", "",
  ].join("\n");
}

// Region moves Amount hard (10 vs 400). Segment is EXACTLY flat: both segments average 205.
const SIGNAL_FACT = factOf([
  ["North", "SMB", 10], ["North", "Ent", 10],
  ["South", "SMB", 400], ["South", "Ent", 400],
]);

check("a dimension that MOVES the measure outranks one that does not", () => {
  const r = prof({ fact: SIGNAL_FACT, measures: MEASURES });
  const byRegion = r.signal.ranked.find((q) => /by Region$/.test(q.question));
  const bySegment = r.signal.ranked.find((q) => /by Segment$/.test(q.question));
  assert.ok(byRegion, "Amount by Region was not ranked at all");
  assert.ok(bySegment, "Amount by Segment was not ranked at all");
  assert.ok(byRegion.effect > bySegment.effect,
    `Region ${byRegion.effect} should beat Segment ${bySegment.effect}`);
  assert.strictEqual(bySegment.effect, 0, "a dimension with no effect should score 0");
});

check("effect is bounded 0..1 — never a divide-by-near-zero blow-up", () => {
  // A column centred on zero: the mean is ~0, which is what produced effect=202 before the fix.
  const centred = SIGNAL_FACT.replace('{"North", "SMB", 10},', '{"North", "SMB", -100},')
                             .replace('{"South", "SMB", 300},', '{"South", "SMB", 100},');
  const r = prof({ fact: centred, measures: MEASURES });
  for (const q of r.signal.ranked) {
    assert.ok(q.effect >= 0 && q.effect <= 1, `${q.question} scored ${q.effect}`);
  }
});

check("a band DERIVED from the column is excluded as a tautology, with the reason", () => {
  // Region is cut straight from Amount: everything under 100 is "low". 30 rows, so perfect
  // separation is ~1e-8 likely by chance -- which is what makes it a definition and not a finding.
  // ⚠️ Deliberately 30 rows and not 4. At 4 rows perfect separation happens 17% of the time by
  // chance, so the tool correctly REFUSES to call it derived; an earlier version of this fixture
  // used 4 and the resulting "failure" was the test being wrong, not the code.
  const rows = [];
  for (let i = 0; i < 15; i++) rows.push(["low", i % 2 ? "SMB" : "Ent", i + 1]);
  for (let i = 0; i < 15; i++) rows.push(["high", i % 2 ? "SMB" : "Ent", 100 + i]);
  const r = prof({ fact: factOf(rows), measures: MEASURES });
  assert.ok(!r.signal.ranked.some((q) => /Amount by Region/.test(q.question)),
    "ranked a tautology as a finding");
  assert.ok(r.signal.excludedAsDerived.some((d) => /Amount by Region/.test(d)),
    `excluded silently instead of with a reason: ${JSON.stringify(r.signal.excludedAsDerived)}`);
});

check("perfect separation on FEW rows is kept — it is plausibly chance, not a definition", () => {
  // The control for the test above. Two groups of two separate perfectly 17% of the time.
  const r = prof({ fact: factOf([["North", "SMB", 10], ["North", "Ent", 20],
                                 ["South", "SMB", 300], ["South", "Ent", 400]]),
                   measures: MEASURES });
  assert.ok(r.signal.ranked.some((q) => /Amount by Region/.test(q.question)),
    "suppressed a real finding as a tautology on four rows");
});

check("no rows on disk means an EMPTY ranking, not a fabricated one", () => {
  const pq = "table Sales\n\tcolumn Region\n\t\tdataType: string\n"
           + "\tpartition Sales = m\n\t\tmode: import\n\t\tsource = let x = 1 in x\n";
  const r = prof({ fact: pq, measures: MEASURES });
  assert.strictEqual(r.signal.rankedCount, 0, "ranked questions it had no data for");
});

// --- propose_pages ------------------------------------------------------------------------------

const propose = require("./propose.js");
const proposed = (opts, popts) => propose.proposePages(prof(opts), popts);

check("every proposed page shows the SAME measure", () => {
  // Different measures per page is a recorded semantic failure: the pages read as a comparison
  // while being none. This is the regression test for it.
  const r = proposed({ fact: SIGNAL_FACT, measures: MEASURES }, { maxPages: 4 });
  assert.strictEqual(r.ok, true, r.error);
  assert.ok(r.subjectMeasure, "no subject measure chosen");
  const titles = r.spec.pages.flatMap((p) => p.visuals.map((v) => v.properties["titleSettings.text"]));
  // The title names the MEASURE that is bound, not the column that was ranked.
  const subj = r.subjectMeasure.replace(/^.*\[|\]$/g, "");
  for (const t of titles) assert.ok(t.includes(subj), `page titled "${t}" is not about ${subj}`);
});

check("one page per DIMENSION — never two pages cut the same way", () => {
  const r = proposed({ fact: SIGNAL_FACT, measures: MEASURES }, { maxPages: 9 });
  const names = r.spec.pages.map((p) => p.displayName);
  assert.strictEqual(new Set(names).size, names.length, `duplicate dimension: ${names.join(", ")}`);
});

check("with NO scenario pair it refuses to invent a comparison, loudly", () => {
  // A measure that DOES aggregate the ranked column (so the pages are bindable at all) but has no
  // PY/PL twin — otherwise this would be testing unbindability, not the comparison refusal.
  const r = proposed({ fact: SIGNAL_FACT,
    measures: "table '.Measures'\n\tmeasure Revenue = SUM(Sales[Amount])\n" });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.comparisonBound, null);
  for (const p of r.spec.pages) {
    for (const v of p.visuals) {
      assert.ok(!v.bindings.Plan && !v.bindings.PreviousYear,
        "bound a comparison well with no scenario measure behind it");
    }
  }
  assert.ok(r.youMustStillDecide.some((d) => /NO SCENARIO MEASURE PAIR/.test(d)),
    "stayed quiet about having no variance");
});

check("with AC + PY present it DOES bind the comparison", () => {
  const sc = "table '.Measures'\n\tmeasure AC = SUM(Sales[Amount])\n\tmeasure PY = 1\n";
  const r = proposed({ fact: SIGNAL_FACT, measures: sc });
  assert.ok(r.comparisonBound, "found AC and PY and still bound nothing");
  const v = r.spec.pages[0].visuals[0];
  assert.ok(v.bindings.PreviousYear, "PreviousYear well left empty");
});

check("an unrankable project is REFUSED, not proposed from thin air", () => {
  const pq = "table Sales\n\tcolumn Region\n\t\tdataType: string\n"
           + "\tpartition Sales = m\n\t\tmode: import\n\t\tsource = let x = 1 in x\n";
  const r = proposed({ fact: pq, measures: MEASURES });
  assert.strictEqual(r.ok, false, "proposed pages with nothing ranked behind them");
  assert.ok(/unranked|not on\s*\n?\s*disk|rows are not/i.test(r.error), r.error);
});

// ☠️ THE TEST THAT WAS MISSING. 23 tests passed and `validate_report` was clean while every page
// bound a raw COLUMN into Values; Zebra's Values well takes a MEASURE, and Desktop rendered
// "Something's wrong with one or more fields". Only the screenshot caught it. This asserts the
// thing the screenshot was checking, so it never has to be caught that way twice.
// The scenario detection has to SURVIVE profileProject. It was computed and dropped, so
// propose_pages re-derived it from measure names and could not see the vendor convention -- the
// actual is the base measure `Revenue` and is never called "AC". `MEASURES` here has been that
// exact shape all along, which is why nothing caught it: no test asked whether a pair was found.
check("the Revenue / Revenue PY convention survives as a scenario pair", () => {
  const r = prof({ fact: SIGNAL_FACT, measures: MEASURES });
  assert.ok(r.scenarios, "profileProject dropped the scenario detection it had already computed");
  assert.strictEqual(r.scenarios.hasComparative, true, "no comparative measure found");
  assert.ok(r.scenarios.pairedActuals.includes("Revenue"),
    `pairedActuals was ${JSON.stringify(r.scenarios.pairedActuals)}`);
});

// The negative arm: a model with one measure and no comparison must not acquire one.
check("a model with no comparative measure reports no pair", () => {
  const r = prof({ fact: SIGNAL_FACT,
    measures: "table '.Measures'\n\tmeasure Revenue = SUM(Sales[Amount])\n" });
  assert.strictEqual(r.scenarios.hasComparative, false, "invented a comparison out of one measure");
  assert.deepStrictEqual(r.scenarios.pairedActuals, [], "paired an actual with nothing");
});

// A measure whose own name contains a dot. write_visual splits a string binding on the LAST dot,
// correctly and by design, so `.Measures.Avg. Score` became entity `.Measures.Avg` and property
// " Score" -- a field that resolves to nothing and a visual that renders empty, with no validator
// rule behind it. `Avg.`, `No.` and `Qty.` are ordinary prefixes. Found by review 2026-08-31.
check("a measure name containing a dot binds to the right entity and property", () => {
  const r = proposed({ fact: SIGNAL_FACT,
    measures: "table '.Measures'\n\tmeasure 'Avg. Score' = AVERAGE(Sales[Amount])\n" },
    { maxPages: 1 });
  assert.strictEqual(r.ok, true, r.error);
  const bound = r.spec.pages[0].visuals[0].bindings.Values[0];
  assert.strictEqual(typeof bound, "object",
    `bound as a string (${bound}), which the last-dot split will mangle`);
  assert.strictEqual(bound.entity, ".Measures", `entity was "${bound.entity}"`);
  assert.strictEqual(bound.property, "Avg. Score", `property was "${bound.property}"`);
});

// A VARIANCE column is mixed-sign by definition. Share of the SIGNED total nets toward zero and
// the documented 0..1 concentration read 13.3 on four rows. Share of the absolute totals is bounded.
check("concentration stays within 0..1 on a mixed-sign (variance) column", () => {
  const r = prof({ fact: factOf([["North", "SMB", 120], ["North", "Ent", 80],
                                 ["South", "SMB", -95], ["South", "Ent", -90]]),
                   measures: MEASURES });
  for (const q of r.signal.ranked) {
    assert.ok(q.concentrationTopMember === null
      || (q.concentrationTopMember >= 0 && q.concentrationTopMember <= 1),
      `${q.question}: concentration ${q.concentrationTopMember} is outside 0..1`);
  }
});

// A model that NAMES its actuals, with two metrics. The fallback path took `[0]` of each scenario
// list, so Units is declared first here on purpose: the old code paired Revenue AC with Units PL.
check("named actuals pair with the comparison of the SAME metric, never another's", () => {
  const measures = "table '.Measures'\n"
    + "\tmeasure 'Units PL' = 1\n\tmeasure 'Units AC' = 2\n"
    + "\tmeasure 'Revenue AC' = SUM(Sales[Amount])\n\tmeasure 'Revenue PL' = 3\n\tmeasure 'Revenue PY' = 4\n";
  const r = proposed({ fact: SIGNAL_FACT, measures }, { maxPages: 1 });
  assert.strictEqual(r.ok, true, r.error);
  assert.ok(r.comparisonBound, "no comparison bound although Revenue AC/PL/PY all exist");
  const base = (ref) => ref.replace(/^.*\[|\]$/g, "").replace(/\s+(AC|PL|PY)$/, "");
  assert.strictEqual(base(r.comparisonBound.actual), "Revenue");
  assert.strictEqual(base(r.comparisonBound.plan), "Revenue", `plan was ${r.comparisonBound.plan}`);
  assert.strictEqual(base(r.comparisonBound.previousYear), "Revenue", `PY was ${r.comparisonBound.previousYear}`);
});

// The pair sits on a metric OTHER than the one the data says carries signal. The page must not
// draw it (a variance of one measure under a page chosen by another), the notice must say so, and
// comparisonBound must report what was bound rather than what exists. This branch carried a
// ReferenceError from 2026-08-31 until the first fixture reached it on 2026-09-01.
check("a pair on a different metric is reported, not drawn", () => {
  const measures = "table '.Measures'\n"
    + "\tmeasure 'Sentiment Avg' = AVERAGE(Sales[Amount])\n"
    + "\tmeasure Revenue = 1\n\tmeasure 'Revenue PY' = 2\n";
  const r = proposed({ fact: SIGNAL_FACT, measures }, { maxPages: 1 });
  assert.strictEqual(r.ok, true, r.error);
  assert.match(r.subjectMeasure, /Sentiment Avg/, `subject was ${r.subjectMeasure}`);
  const v = r.spec.pages[0].visuals[0];
  assert.ok(!v.bindings.Plan && !v.bindings.PreviousYear, "drew a comparison from another metric");
  assert.strictEqual(r.comparisonBound, null, "comparisonBound reports a pair that was not bound");
  assert.ok(r.comparisonAvailable && /Revenue/.test(r.comparisonAvailable.actual), "the available pair is not reported");
  assert.ok(r.youMustStillDecide.some((d) => /PAIR EXISTS BUT NOT ON THE SUBJECT/.test(d)),
    "no notice that a pair exists elsewhere");
});

check("Values binds a MEASURE that exists in the model, never a raw column", () => {
  const p = prof({ fact: SIGNAL_FACT, measures: MEASURES });
  const r = propose.proposePages(p, { maxPages: 4 });
  assert.strictEqual(r.ok, true, r.error);
  // profile.measures are "Table[Name]"; write_visual takes "Table.Name".
  const known = new Set(p.measures.map((m) => m.replace(/\[(.+)\]$/, ".$1")));
  const columns = new Set(p.tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.name}`)));
  // A binding is either "Entity.Property" or {entity, property} — the object form is what a
  // measure whose own name contains a dot has to use, since the string form splits on the last one.
  const refOf = (b) => (typeof b === "string" ? b : `${b.entity}.${b.property}`);
  for (const page of r.spec.pages) {
    for (const v of page.visuals) {
      for (const raw of v.bindings.Values) {
        const ref = refOf(raw);
        assert.ok(known.has(ref), `Values bound "${ref}", which is not a measure in this model`);
        assert.ok(!columns.has(ref), `Values bound the COLUMN "${ref}" — Desktop will refuse it`);
      }
    }
  }
});

check("a ranked column with NO measure over it is refused, not bound raw", () => {
  // Amount has no measure aggregating it, so there is nothing legal to put in Values.
  const r = propose.proposePages(prof({ fact: SIGNAL_FACT,
    measures: "table '.Measures'\n\tmeasure Headcount = COUNTROWS(Sales)\n" }), {});
  assert.strictEqual(r.ok, false, "proposed a page it could not legally bind");
  assert.ok(/no measure aggregating it|takes a measure/i.test(r.error), r.error);
});

check("every page carries the numbers that justified it", () => {
  const r = proposed({ fact: SIGNAL_FACT, measures: MEASURES });
  assert.strictEqual(r.rationale.length, r.spec.pages.length);
  for (const x of r.rationale) assert.ok(/effect [\d.]+/.test(x.why), x.why);
});

check("a missing project is an error, not an empty profile", () => {
  const r = srv.profileProjectTool({ projectPath: path.join(os.tmpdir(), "zbi-does-not-exist") });
  assert.strictEqual(r.ok, false, "returned a clean profile for a directory that does not exist");
});

// --- report ---------------------------------------------------------------------------------

let failed = 0;
for (const [state, name, detail] of results) {
  if (state === "FAIL") { failed++; console.log(`  FAIL  ${name}  <- ${detail}`); }
  else console.log(`  PASS  ${name}`);
}
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
