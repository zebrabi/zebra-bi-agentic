#!/usr/bin/env node
// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";
/**
 * Per-checker tests. Each rule gets a project that should fire it and a clean project that
 * should not, because a checker only proven to fire is half tested and the half that matters
 * commercially is the other one: a rule that fires on a good report is worse than no rule.
 *
 *   node test-checkers.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const srv = require("./server.js");
const { lit } = require("./checkers.js");

const GUID = {
  tables: "ZebraBITablesBAE31B370F254F808553548EFB35BFA5",
  cards: "zebraBiCards2C860CFAA9944091B75F0DBD117F20FA",
  charts: "waterfall6C9ED82ABD1F44C4A0D590CE01EB5EE7",
  // The Plus visuals. Tables+ extends the Tables prefix, so it was already covered; Charts+
  // does not extend the `waterfall` one, so every rule skipped it and the report passed
  // unchecked. These two fixtures are what make that coverage provable rather than assumed.
  tablesPlus: "ZebraBITablesPlus3E6085701D7B426980C3859B16327993",
  chartsPlus: "ZebraBIChartsPlusC3F2FD9F79054F76BD1B722E7666AC33",
};
const W = (s) => ({ expr: { Literal: { Value: `'${s}'` } } });
const N = (n) => ({ expr: { Literal: { Value: `${n}D` } } });
const SCHEMA =
  "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json";

/**
 * Build a project. `mutate` receives the writable pieces so a test can introduce exactly one
 * fault; everything it does not touch stays valid, which is what makes a silent-run meaningful.
 */
// Every fixture directory is removed when the process exits. Without this the suite left one
// `zbi-c-*` directory per fixture per run: 5,394 of them (5.2 MB) had accumulated on one machine
// by 2026-08-15, and a CI runner accumulates the same way. Removal happens at exit rather than per
// fixture because a failing assertion is easier to inspect while its project is still on disk.
const FIXTURE_ROOTS = [];
process.on("exit", () => {
  if (process.env.ZBI_KEEP_FIXTURES) return;
  for (const r of FIXTURE_ROOTS) { try { fs.rmSync(r, { recursive: true, force: true }); } catch {} }
});

function project(mutate = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zbi-c-"));
  FIXTURE_ROOTS.push(root);
  const report = path.join(root, "Demo.Report");
  const def = path.join(report, "definition");
  const pageDir = path.join(def, "pages", "P1");
  fs.mkdirSync(pageDir, { recursive: true });

  const state = {
    pbip: { $schema: SCHEMA, version: "1.0" },
    pbir: { version: "1.0", datasetReference: { byPath: { path: "../Demo.SemanticModel" } } },
    reportJson: { $schema: "https://x", themeCollection: { baseTheme: { name: "CY24SU10" } } },
    versionJson: { $schema: "https://x/versionMetadata/1.0.0/schema.json", version: "2.0.0" },
    pagesJson: { pageOrder: ["P1"], activePageName: "P1" },
    page: { name: "P1", visualInteractions: [] },
    visuals: {
      V1: { name: "V1", position: { x: 0, y: 0, width: 600, height: 400 },
            visual: { visualType: GUID.tables, objects: {}, query: { queryState: {} } } },
    },
    bom: false,
  };
  mutate(state, GUID);

  // A realistic clean project has a model: scenario measures and a marked calendar. Without
  // one, "clean" would mean "we could not read the model", which is a different thing.
  const md = path.join(root, "Demo.SemanticModel", "definition");
  fs.mkdirSync(md, { recursive: true });
  fs.writeFileSync(path.join(md, "model.tmdl"), [
    "table Calendar", "\tdataCategory: Time", "", "\tcolumn Date", "\t\tisKey", "",
    "table Financials",
    "\tmeasure 'Value AC' = 1", "\t\tformatString: #,0",
    "\tmeasure 'Value PL' = 1", "\t\tformatString: #,0", "",
  ].join("\n"));
  const w = (p, o) => fs.writeFileSync(p, (state.bom ? "﻿" : "") + JSON.stringify(o, null, 2));
  fs.writeFileSync(path.join(root, "Demo.pbip"), JSON.stringify(state.pbip));
  w(path.join(def, "definition.pbir"), state.pbir);
  w(path.join(def, "report.json"), state.reportJson);
  // definition/version.json is REQUIRED by Desktop's packaging layer -- a project without it will
  // not open at all. The fixture lacked it, so "a clean project" described one that cannot be
  // opened; added 2026-08-15 with the rule that catches its absence.
  if (state.versionJson !== null) w(path.join(def, "version.json"), state.versionJson);
  w(path.join(def, "pages", "pages.json"), state.pagesJson);
  w(path.join(pageDir, "page.json"), state.page);
  for (const [name, v] of Object.entries(state.visuals)) {
    const vd = path.join(pageDir, "visuals", name);
    fs.mkdirSync(vd, { recursive: true });
    w(path.join(vd, "visual.json"), v);
  }
  return root;
}

const results = [];
const codes = (root) => new Set(srv.validateReport({ projectPath: root }).findings.map((f) => f.code));

/**
 * A free-form assertion, for the few things that are not "this rule fires on that mutation":
 * the shape of an assembled finding, and the literal decoder every rule reads through. Same
 * results table and same report line as `rule` below, so a failure here fails the suite.
 */
function check(name, fn) {
  try { fn(); results.push(["PASS", name, ""]); }
  catch (e) { results.push(["FAIL", name, String(e.message).split("\n")[0].slice(0, 92)]); }
}

/** Assert the rule fires on `broken` and does NOT fire on an otherwise-identical clean project. */
function rule(code, name, mutate) {
  try {
    assert.ok(codes(project(mutate)).has(code), `did not fire: ${code}`);
    assert.ok(!codes(project()).has(code), `FIRES ON A CLEAN REPORT: ${code}`);
    results.push(["PASS", name, ""]);
  } catch (e) {
    results.push(["FAIL", name, String(e.message).slice(0, 80)]);
  }
}

// --- will not open -------------------------------------------------------------------------

rule("pbip-schema-wrong", "a guessed .pbip $schema", (s) => {
  s.pbip.$schema = "https://developer.microsoft.com/json-schemas/fabric/pbip/schema.json";
});

rule("file-starts-with-bom", "a BOM in a report file", (s) => { s.bom = true; });

rule("interaction-target-missing", "an interaction naming a visual not on disk", (s) => {
  s.page.visualInteractions = [{ source: "V1", target: "GhostVisual", type: "NoFilter" }];
});

rule("interaction-target-missing", "a declared page with no page.json", (s) => {
  s.pagesJson.pageOrder = ["P1", "P2"];
});

rule("visual-object-not-an-array", "a bare object under visual.objects", (s) => {
  s.visuals.V1.visual.objects.titleSettings = { properties: { text: W("Hi") } };
});

// --- renders blank -------------------------------------------------------------------------

rule("dataset-path-does-not-resolve", "a dataset path pointing nowhere", (s) => {
  s.pbir.datasetReference.byPath.path = "../Renamed.SemanticModel";
});

rule("report-has-no-base-theme", "no base theme", (s) => { delete s.reportJson.themeCollection; });

// --- looks fine, misleads -------------------------------------------------------------------

// The clean project is a Zebra Table, so the negative control is a Zebra page with no native
// visual; the positive swaps the type for a native pie. Both directions in one call, as always.
rule("native-anti-pattern-visual", "a native pie chart where a bar table belongs", (s) => {
  s.visuals.V1.visual.visualType = "pieChart";
});

// View-mode comments. The storage link on a CERTIFIED visual is declared and ignored; the clean
// project is a certified Table with no link, and the Plus silence fixtures at the end prove the
// same link on Tables+ stays quiet (the rule reads the GUID, not the property).
const STORAGE_LINK = W(JSON.stringify({ storageBackend: "sharePointExcel", storageOptions: {
  siteId: "11111111-1111-1111-1111-111111111111", folderPath: "/drive/root:", fullFileName: "c.xlsx" } }));
rule("view-mode-storage-on-certified-visual", "a storage link on certified Tables", (s) => {
  s.visuals.V1.visual.objects.annotationLayerSettings =
    [{ properties: { annotationsStorageConfig: STORAGE_LINK } }];
});
rule("view-mode-storage-with-comment-box-off", "a storage link with the panel switched off", (s, G) => {
  s.visuals.V1.visual.visualType = G.tablesPlus;
  s.reportJson.publicCustomVisuals = [G.tablesPlus];
  s.visuals.V1.visual.objects.annotationLayerSettings =
    [{ properties: { annotationsStorageConfig: STORAGE_LINK } }];
  s.visuals.V1.visual.objects.commentBoxSettings =
    [{ properties: { show: { expr: { Literal: { Value: "false" } } } } }];
});
// The silence half of the second rule, constructed rather than assumed: a link with NO
// commentBoxSettings at all is the corpus norm for comments and must not fire.
try {
  const out = srv.validateReport({ projectPath: project((s, G) => {
    s.visuals.V1.visual.visualType = G.tablesPlus;
    s.reportJson.publicCustomVisuals = [G.tablesPlus];
    s.visuals.V1.visual.objects.annotationLayerSettings =
      [{ properties: { annotationsStorageConfig: STORAGE_LINK } }];
  }) });
  const hit = out.findings.filter((f) => /view-mode-storage/.test(f.code)).map((f) => f.code);
  assert.deepStrictEqual(hit, [], `a Plus storage link with no comment box fired: ${hit}`);
  results.push(["PASS", "a Tables+ storage link with commentBoxSettings absent stays silent", ""]);
} catch (e) {
  results.push(["FAIL", "a Tables+ storage link with commentBoxSettings absent stays silent",
    String(e.message).slice(0, 80)]);
}

// A POSITIVE fixture, not just the clean-project negative control. A rule that never fires scores
// zero false positives too, so the absence has to be constructed deliberately. Reproduced against
// Desktop 2.156.951.0: deleting this file from a project that had just opened cleanly makes the
// next open fail with "Cannot find file 'version.json'".
rule("report-missing-version-json", "definition/version.json deleted",
     (s) => { s.versionJson = null; });

// `multiline-measure-dax-on-equals-line` is a TMDL rule and its fixtures live in test-tmdl.js,
// which is the suite whose project() helper can write a fact table.

// TWO measures on Cards, not four: the declared cap is one, and the rule this replaced let a
// two-measure Cards through while the visual refused to render it.
rule("data-role-exceeds-declared-maximum", "two measures in a Cards Values well", (s, G) => {
  s.visuals.V1.visual.visualType = G.cards;
  s.visuals.V1.visual.query.queryState.Values = {
    projections: [1, 2].map((i) => ({ field: {}, queryRef: `m${i}` })),
  };
});

rule("data-role-exceeds-declared-maximum", "three Charts Values projections", (s, G) => {
  s.visuals.V1.visual.visualType = G.charts;
  s.visuals.V1.visual.query.queryState.Values = {
    projections: [1, 2, 3].map((i) => ({ field: {}, queryRef: `m${i}` })),
  };
});

// `detail` is per-hit and used to be dropped when the finding was assembled, so the customer got
// the generic message with none of the numbers the checker had already worked out. Both setters
// lose their point without it: this one says WHICH cap and by how much.
check("a finding carries the per-hit detail the checker computed", () => {
  const out = srv.validateReport({ projectPath: project((s2, G) => {
    s2.visuals.V1.visual.visualType = G.cards;
    s2.visuals.V1.visual.query.queryState.Values = {
      projections: [1, 2].map((i) => ({ field: {}, queryRef: `m${i}` })),
    };
  }) });
  const hit = out.findings.find((f) => f.code === "data-role-exceeds-declared-maximum");
  assert.ok(hit, "the role-maximum rule did not fire, so this test proves nothing");
  assert.ok(hit.detail, "finding carries no detail, so the numbers never reach the reader");
  assert.match(hit.detail, /of max/, `detail was "${hit.detail}"`);
});

// `lit()` finished with an unconditional `.replace(/[DLM]$/, "")`. That suffix is PBIR's NUMERIC
// literal type marker, so on a string it silently ate the last character: 'TrendM' -> "Trend",
// '#1A1A2D' -> "#1A1A2". Every rule comparing a name or a colour was reading corrupted input.
check("lit() keeps a trailing D, L or M that belongs to a string", () => {
  const of = (v) => lit({ expr: { Literal: { Value: v } } });
  assert.strictEqual(of("'TrendM'"), "TrendM");
  assert.strictEqual(of("'#1A1A2D'"), "#1A1A2D");
  assert.strictEqual(of("'EMEA-L'"), "EMEA-L");
});

check("lit() still strips the type suffix from a NUMERIC literal", () => {
  const of = (v) => lit({ expr: { Literal: { Value: v } } });
  assert.strictEqual(of("1234D"), "1234");
  assert.strictEqual(of("-12.5D"), "-12.5");
  assert.strictEqual(of("42L"), "42");
});

// The Plus visuals must be checked like their certified twins. Before Charts+ got its own
// prefix this fixture passed silently -- not because the report was good, but because the
// checker did not recognise the visual as Zebra at all.
rule("data-role-exceeds-declared-maximum", "three Charts+ Values projections", (s, G) => {
  s.visuals.V1.visual.visualType = G.chartsPlus;
  s.visuals.V1.visual.query.queryState.Values = {
    projections: [1, 2, 3].map((i) => ({ field: {}, queryRef: `m${i}` })),
  };
});

rule("data-role-exceeds-declared-maximum", "five Tables+ Plan projections", (s, G) => {
  s.visuals.V1.visual.visualType = G.tablesPlus;
  s.visuals.V1.visual.query.queryState.Plan = {
    projections: [1, 2, 3, 4, 5].map((i) => ({ field: {}, queryRef: `m${i}` })),
  };
});

rule("comment-filtercontexts-key", "a comment with no filterContexts key", (s) => {
  s.visuals.V1.visual.objects.annotationLayerSettings = [{ properties: {
    annotationComments: W(JSON.stringify([{ uuid: "a", title: "x - null" }])),
  } }];
});

// --- numbers wrong -------------------------------------------------------------------------

rule("computed-row-in-grand-total", "a computed row not excluded from the total", (s) => {
  s.visuals.V1.visual.objects.chartSettings = [{ properties: { showGrandTotal: W("true") } }];
  s.visuals.V1.visual.objects.categoriesMetadata = [{ properties: {
    addedFormulas: W(JSON.stringify([{ identity: "Gross margin %", expression: "[GP]/[Rev]" }])),
  } }];
});

// --- looks fine and is wrong ---------------------------------------------------------------

rule("colour-gate", "colours set without style Custom", (s) => {
  s.visuals.V1.visual.objects.designSettings = [{ properties: {
    positiveColor: { solid: { color: W("#00A")} }, negativeColor: { solid: { color: W("#A00")} },
  } }];
});

// NOT a variant of the row above -- it is the case that read clean. Cards stores the key under
// `license`, and some Cards builds carry ONLY that object, so a rule reading `licenseSettings`
// and nothing else finds no key in a report that has one.
// Current Cards carries both objects. This is the shape that defeated the stripper: clearing one
// and re-checking looks clean while the other copy is still on disk.
// RESTORED 2026-08-05 after being wrongly re-based to 20px the same day. This fixture is not
// arbitrary: the held catalogue records that a 22pt title in a 40px box makes Power BI draw its own native
// scrollbar inside the box and clip the text, that it shipped, and that a human found it in a
// screenshot. 40px is the render-proven case. Do not lower it.
rule("textbox-too-short-for-font", "a 22pt title in a 40px box", (s) => {
  s.visuals.T1 = {
    name: "T1", position: { x: 0, y: 0, width: 400, height: 40 },
    visual: { visualType: "textbox",
      objects: { general: [{ properties: { fontSize: "22" } }] } },
  };
});

// Measured 2026-09-06: the floor is ceil(pt * 1.45 + 12), so 12pt needs 30. 28 clipped on screen
// and 30 did not, at 2px granularity, which is why this fixture sits on the pair either side.
rule("textbox-too-short-for-font", "a 12pt caption in a 28px box (30 is the measured floor)", (s) => {
  s.visuals.T2 = {
    name: "T2", position: { x: 0, y: 0, width: 400, height: 28 },
    visual: { visualType: "textbox",
      objects: { general: [{ properties: { fontSize: "12" } }] } },
  };
});

// A slicer's header shows unless it is explicitly turned off, and it costs ~22px. 46 renders with
// the dropdown cut off at the bottom; 52 is the rendered floor. The fixture leaves `header` absent
// on purpose -- that is the state a slicer is in unless someone thought about it.
rule("slicer-height-clips-the-dropdown", "a 46px dropdown slicer with the header left on", (s) => {
  s.visuals.S1 = {
    name: "S1", position: { x: 0, y: 0, width: 190, height: 46 },
    visual: { visualType: "slicer", objects: { data: [{ properties: { mode: W("Dropdown") } }] } },
  };
});

rule("table-row-height-below-legible", "a Fixed row height of 12px", (s) => {
  s.visuals.V1.visual.objects.categorySettings = [{ properties: { rowHeight: N(5), height: N(12) } }];
});

rule("title-token-broken-after-save", "a measure token plus Desktop's save bookkeeping", (s) => {
  s.visuals.V1.visual.objects.titleSettings = [{ properties: { text: W("[Selected Year]") } }];
  s.visuals.V1.visual.objects.version = [{ properties: {} }];
  s.visuals.V1.visual.objects.previewSettings = [{ properties: {} }];
});

rule("table-ignores-sort-definition", "a Table given the standard sort definition", (s) => {
  s.visuals.V1.visual.query.sortDefinition = { sort: [{ field: {}, direction: "Ascending" }] };
});

// The three silent-run tests below are the vendor-template shapes from the 5 August corpus run.
// Each one fired on a shipped reference template, which makes it a product defect and not a tuning
// question. They are written as bare silent-runs rather than `rule(...)` because what is being
// asserted is the absence of a finding on a shape that is correct.
const silent = (code, name, mutate) => {
  try {
    assert.ok(!codes(project(mutate)).has(code), `FIRES ON A SHIPPED TEMPLATE SHAPE: ${code}`);
    results.push(["PASS", name, ""]);
  } catch (e) {
    results.push(["FAIL", name, String(e.message).slice(0, 80)]);
  }
};

// The other half of the textbox pair, and the reason the floor was re-measured rather than
// re-derived: a 12pt caption at exactly the measured floor renders clean, so a rule that fires here
// is over-demanding. The previous derived floor asked for 36.8px at 12pt and did exactly that.
silent("textbox-too-short-for-font", "a 12pt caption at exactly 30px, the measured floor", (s) => {
  s.visuals.T3 = {
    name: "T3", position: { x: 0, y: 0, width: 400, height: 30 },
    visual: { visualType: "textbox",
      objects: { general: [{ properties: { fontSize: "12" } }] } },
  };
});

// Header off is the idiomatic short slicer: 270 of the vendor's 408 are written this way and 44-48
// is correct for them. A rule that cannot tell the two apart flags three quarters of the corpus,
// which is why an unconditional slicer-height rule was rejected twice before this one.
silent("slicer-height-clips-the-dropdown", "a 46px dropdown slicer with the header OFF", (s) => {
  s.visuals.S2 = {
    name: "S2", position: { x: 0, y: 0, width: 190, height: 46 },
    visual: { visualType: "slicer",
      objects: { data: [{ properties: { mode: W("Dropdown") } }],
                 header: [{ properties: { show: { expr: { Literal: { Value: "false" } } } } }] } },
  };
});

// `categorySettings.height` is read by rowHeight 5 (Fixed) alone. Written beside any other value it
// is inert, not illegible -- and one shipped vendor template does exactly that.
silent("table-row-height-below-legible", "a 12px height beside rowHeight 0, where it is inert", (s) => {
  s.visuals.V1.visual.objects.categorySettings = [{ properties: { rowHeight: N(0), height: N(12) } }];
});

// An actionButton's label is state-scoped. The positive is the exact authoring mistake: the label
// written into the selector-less entry, which Desktop drops in silence. The three silent runs are
// the shapes shipped templates actually use -- label under `default`, label under `hover` ONLY
// (which real templates do), and an icon button carrying no label at all.
const BTN = (textEntries) => (s) => {
  s.visuals.V1.visual.visualType = "actionButton";
  s.visuals.V1.visual.objects = { text: textEntries };
};

rule("action-button-label-needs-state-selector", "a button label in a selector-less entry",
  BTN([{ properties: { show: W("true"), text: W("Drill through to detail") } }]));

silent("action-button-label-needs-state-selector", "a button label under selector default",
  BTN([{ properties: { show: W("true") } },
       { properties: { text: W("Drill through to detail") }, selector: { id: "default" } }]));

silent("action-button-label-needs-state-selector", "a button whose label lives ONLY under hover",
  BTN([{ properties: { show: W("true") } },
       { properties: { text: W("Explore trends") }, selector: { id: "hover" } }]));

silent("action-button-label-needs-state-selector", "an icon button with no label at all",
  BTN([{ properties: { show: W("true") } }]));


// The scrubbed report. Desktop leaves both licence objects behind with their other members
// intact -- `appliedTimestamp`, `validUntil`, `lastLicenseCheck` and `product` all outlive the
// key. So "the object is present" must not be what fires; only a `licenseKey` that is still
// there. Without this, widening the rule to two object names would double its false-positive
// surface on exactly the reports someone has just cleaned.
// Power BI writes the sort it chose itself and marks it. Nobody asked for an order, so the rule's
// "rather than the order you asked for" describes no fault. 82 of 82 vendor tables carry this.
silent("table-ignores-sort-definition", "a Table whose sort is Power BI's own default", (s) => {
  s.visuals.V1.visual.query.sortDefinition = {
    sort: [{ field: { Measure: { Expression: { SourceRef: { Entity: "Key Measures" } },
                                 Property: "AC" } }, direction: "Descending" }],
    isDefaultSort: true,
  };
});

// A Tables rule must not read a Cards visual. This one carried severity `blank`, so it told the
// customer a table renders empty -- on a Cards visual, in a reference template.
silent("table-sort-field-not-shown", "a CARDS visual sorted by an unprojected measure", (s, G) => {
  s.visuals.V1.visual.visualType = G.cards;
  s.visuals.V1.visual.query.queryState.Values = { projections: [
    { field: {}, queryRef: "Main Measures.Before AC", nativeQueryRef: "Before AC" },
  ] };
  s.visuals.V1.visual.query.sortDefinition = { sort: [
    { field: { Measure: { Expression: { SourceRef: { Entity: "Main Measures" } },
                          Property: "Before due %" } }, direction: "Descending" } ] };
});

// `skipCalculationCategories` excludes a category from the visual's CALCULATIONS, not from the
// render. With no total the visual computes nothing for an unskipped row to corrupt. This is the
// income-statement shape from three pages of `Financial statements`, whose vendor render shows no
// total row: two ratio rows unskipped, one skipped, no showGrandTotal.
silent("computed-row-in-grand-total", "computed rows in a table with no total", (s) => {
  s.visuals.V1.visual.objects.categoriesMetadata = [{ properties: {
    addedFormulas: W(JSON.stringify([
      { identity: "Gross margin %", expression: "[Gross profit] / [Revenue]", percent: true },
      { identity: "Operating income %", expression: "[Operating income] / [Revenue]", percent: true },
      { identity: "Net income %", expression: "[Net income] / [Revenue]", percent: true },
    ])),
    skipCalculationCategories: W(JSON.stringify([
      { hierarchyIdentity: "Accounts.Account group", category: "Gross margin %", level: 0 },
    ])),
  } }];
});

// `showTotals` is not a substitute for `showGrandTotal`. Zebra BI - Working capital carries
// showTotals: 1 and renders no total row and no total column.
silent("computed-row-in-grand-total", "showTotals alone does not mean a total is computed", (s) => {
  s.visuals.V1.visual.objects.chartSettings = [{ properties: { showTotals: N(1) } }];
  s.visuals.V1.visual.objects.categoriesMetadata = [{ properties: {
    addedFormulas: W(JSON.stringify([{ identity: "Net Change", expression: "[CF ops] + [CF inv]" }])),
  } }];
});

// `chartLayout: Waterfall` is the ONE value of nine that renders differently, per correction 3,
// which rendered and hashed all nine. So it must not be reported as inert.
silent("property-declared-but-inert", "chartLayout set to Waterfall, the one value that works", (s) => {
  s.visuals.V1.visual.objects.chartSettings = [{ properties: { chartLayout: W("Waterfall") } }];
});

// The date-hierarchy silent test that sat here is gone with the rule it guarded --
// `rename-needs-displayname` was retired, not narrowed a third time. Its replacement is the
// tombstone further down, which drives all three vendor shapes at once.

// This fixture was moved twice on 2026-08-05 and both moves were wrong, which is worth more than
// the fixture. It went off `chartLayout` on a census, then off `useCustomScenarioColors` on a caveat.
// Both properties have a RENDER behind them -- correction 3 hashed all nine chartLayout values, and
// `gate-experiment-colors.charts.json` runs useCustomScenarioColors as an a/b gate returning
// `identical` -- so neither should ever have moved. Restored to the original property.
//
// The lesson is about fixtures, not about colours: when a fixture has to move so a narrowing can
// land, the narrowing is the thing under suspicion, not the fixture.
rule("property-declared-but-inert", "an inert property set", (s) => {
  s.visuals.V1.visual.objects.designSettings = [{ properties: { useCustomScenarioColors: W("true") } }];
});

// Kept from the original fixture: a class-1 chartLayout value renders identically to setting nothing.
rule("property-declared-but-inert", "a chartLayout value that renders as the default", (s) => {
  s.visuals.V1.visual.objects.chartSettings = [{ properties: { chartLayout: W("Responsive") } }];
});

rule("in-cell-chart-switch-is-a-number", "showAsTable written as a boolean", (s) => {
  s.visuals.V1.visual.objects.chartSettings = [{ properties: {
    columnSettings: W(JSON.stringify({ actual: { tableView: { showAsTable: true } } })),
  } }];
});

// A tombstone, not a coverage test. `rename-needs-displayname` was removed on 2026-08-05 because
// its fault shape and the ordinary shape are byte-identical -- see the note in checkers.js where
// the checker used to be. This asserts it stays removed, on the three real shapes that produced
// its 141 false positives: a qualified queryRef with a bare nativeQueryRef, a date hierarchy
// level, and Desktop disambiguating two same-named fields. None of them may produce a finding
// from any rule.
try {
  const shapes = codes(project((s) => {
    s.visuals.V1.visual.query.queryState.Values = { projections: [
      { field: {}, queryRef: "Measures.AC", nativeQueryRef: "AC" },
      { field: {}, queryRef: "MasterData.AC", nativeQueryRef: "AC2" },
      { field: {}, queryRef: "KPI measures.AC (KPI)", nativeQueryRef: "AC_KPI" } ] };
    s.visuals.V1.visual.query.queryState.Category = { projections: [
      { field: {}, queryRef: "Calendar.YQM.Year", nativeQueryRef: "YQM Year" },
      { field: {}, queryRef: "Sales.Product", nativeQueryRef: "Product" } ] };
  }));
  assert.ok(!shapes.has("rename-needs-displayname"), "the removed rule is firing again");
  assert.ok(!srv.checkers["projection-rename-requires-displayname"],
    "the checker is back; it cannot be made correct, see the note in checkers.js");
  assert.ok(!srv.loadRules().some((r) => r.id === "rename-needs-displayname"),
    "the rule is back in rules.json; unmark it in the rule source and rebuild");
  results.push(["PASS", "the rename rule stays removed", ""]);
} catch (err) {
  results.push(["FAIL", "the rename rule stays removed", String(err.message).slice(0, 80)]);
}

rule("table-sort-field-not-shown", "a sort naming a field the table does not show", (s) => {
  s.visuals.V1.visual.query.queryState.Values = { projections: [
    { field: {}, queryRef: "Financials.Value AC", nativeQueryRef: "Value AC" },
  ] };
  s.visuals.V1.visual.query.sortDefinition = { sort: [
    { field: { Column: { Property: "KPI_ID" } }, direction: "Ascending" },
  ] };
});

rule("filterconfig-entry-needs-name", "a filterConfig entry with no name", (s) => {
  s.visuals.V1.filterConfig = { filters: [{ queryRef: "Accounts.Account" }] };
});

rule("slicer-filter-double-nested", "a slicer selection written one level too shallow", (s) => {
  s.visuals.V1.visual.objects.general = [{ properties: {
    filter: { Version: 2, From: [{ Name: "a" }], Where: [{}] },
  } }];
});

rule("nested-settings-need-full-key-set", "a chartView missing keys", (s) => {
  s.visuals.V1.visual.objects.chartSettings = [{ properties: {
    columnSettings: W(JSON.stringify({ actual: { chartView: { textColor: "#000" } } })),
  } }];
});

rule("cards-size-written-into-data", "a card size with no cards to apply it to", (s, G) => {
  s.visuals.V1.visual.visualType = G.cards;
  s.visuals.V1.visual.objects.customData = [{ properties: {
    uniformData: W(JSON.stringify({ instance: 0, globalCardSize: { w: 256, h: 104 }, cards: {} })),
  } }];
});

// The fault that cost a launch on 2026-08-14: a `visual` member written at the container root.
// Desktop refuses to open the report and reports it in a window a title check cannot see, so this
// has to be caught from disk. One arm per denylisted name, because each is a separate typo.
for (const k of ["visualContainerObjects", "visualType", "query", "objects",
  "drillFilterOtherVisuals"]) {
  rule("visual-property-at-the-json-root", `"${k}" written at the visual.json root`, (s) => {
    s.visuals.V1[k] = k === "drillFilterOtherVisuals" ? true : {};
  });
}

// A tooltip page Desktop accepts and then never opens on hover. Three arms, because the property
// is UNREACHABLE on the old schema and merely absent on the current one, and because a visual
// pointing at an unmarked page is the same defect approached from the consumer end.
const PAGE_SCHEMA = (v) =>
  `https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/${v}/schema.json`;

rule("tooltip-page-schema-too-old-for-type", "a tooltip page with no top-level type", (s) => {
  s.page.pageBinding = { name: "Pod1", type: "Tooltip" };
});

rule("tooltip-page-schema-too-old-for-type", "a tooltip page on page schema 1.0.0", (s) => {
  s.page.$schema = PAGE_SCHEMA("1.0.0");
  s.page.pageBinding = { name: "Pod1", type: "Tooltip" };
});

rule("tooltip-page-schema-too-old-for-type", "a visual pointing at an unmarked tooltip page", (s) => {
  s.visuals.V1.visual.visualContainerObjects = {
    visualTooltip: [{ properties: { show: { expr: { Literal: { Value: "true" } } },
      type: W("Canvas"), section: W("P1") } }],
  };
});

// The direction that matters commercially: a tooltip page done RIGHT must stay silent, or the rule
// fires on every report that already gets this correct. The clean project has no tooltip page at
// all, so it cannot prove this -- the page has to be present and correct.
try {
  const root = project((s) => {
    s.page.$schema = PAGE_SCHEMA("2.0.0");
    s.page.pageBinding = { name: "Pod1", type: "Tooltip" };
    s.page.type = "Tooltip";
    s.page.visibility = "HiddenInViewMode";
    s.visuals.V1.visual.visualContainerObjects = {
      visualTooltip: [{ properties: { type: W("Canvas"), section: W("P1") } }],
    };
  });
  assert.ok(!codes(root).has("tooltip-page-schema-too-old-for-type"),
    "fired on a correctly marked tooltip page");
  results.push(["PASS", "a correctly marked tooltip page is silent", ""]);
} catch (e) {
  results.push(["FAIL", "a correctly marked tooltip page is silent", String(e.message).slice(0, 80)]);
}

// --- the silence bar -----------------------------------------------------------------------
// The acceptance test the held catalogue paid for: a rule that fires on a good report is worse than
// no rule, because it trains the reader to ignore the tool.

try {
  const out = srv.validateReport({ projectPath: project() });
  assert.strictEqual(out.findings.length, 0,
    `a clean project produced ${out.findings.length} finding(s): ` +
    out.findings.map((f) => f.code).join(", "));
  results.push(["PASS", "a clean project produces ZERO findings", ""]);
} catch (e) {
  results.push(["FAIL", "a clean project produces ZERO findings", String(e.message).slice(0, 110)]);
}

// The silence bar again, for the Plus visuals specifically. Giving Charts+ its own prefix turned
// every isZebra()-guarded rule ON for a visual they had all been skipping, so the fixture above --
// which uses the certified Tables GUID -- proves nothing about them. A rule that starts firing on a
// correct Plus page is a false positive we introduced, and 19 of those shipped once already.
for (const [label, guid] of [["Tables+", GUID.tablesPlus], ["Charts+", GUID.chartsPlus]]) {
  try {
    const out = srv.validateReport({ projectPath: project((s, G) => {
      s.visuals.V1.visual.visualType = guid;
      s.reportJson.publicCustomVisuals = [guid];
    }) });
    assert.strictEqual(out.findings.length, 0,
      `a clean ${label} project produced ${out.findings.length} finding(s): ` +
      out.findings.map((f) => f.code).join(", "));
    results.push(["PASS", `a clean ${label} project produces ZERO findings`, ""]);
  } catch (e) {
    results.push(["FAIL", `a clean ${label} project produces ZERO findings`, String(e.message).slice(0, 110)]);
  }
}

try {
  const out = srv.validateReport({ projectPath: project() });
  const rules = srv.loadRules();
  const implemented = rules.filter((r) => srv.checkers[r.check]).length;
  results.push(["PASS", `${implemented}/${rules.length} rules have a checker`, ""]);
  // With every rule implemented there is no count to declare, and declaring "0 rule(s)" would
  // be noise. The assertion is that the two states are consistent, not that the line exists.
  const unrun = rules.length - implemented;
  const declared = out.notChecked.some((s) => s.includes(`${unrun} rule(s)`));
  assert.ok(unrun === 0 ? !declared : declared,
    `unrun=${unrun} but notChecked ${declared ? "declares" : "does not declare"} it`);
  results.push(["PASS", "unimplemented rules are declared only when there are some", ""]);
} catch (e) {
  results.push(["FAIL", "the unimplemented rules are declared, not hidden", String(e.message).slice(0, 80)]);
}

for (const [s, n, d] of results) console.log(`  ${s}  ${n}${d ? "  <- " + d : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
