#!/usr/bin/env node
// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";
/**
 * Tests for the blob encoders.
 *
 * The load-bearing ones are at the bottom: encoder output is written into a real visual.json and
 * run back through validate_report, which must find nothing. The encoders and the checkers were
 * built independently from the same source, so that round trip is a genuine cross-check rather
 * than a tautology. If an encoder produces a blob its own validator rejects, one of the two has
 * misread the format and this is how we find out which.
 *
 *   node test-encoders.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const e = require("./encoders.js");
const srv = require("./server.js");

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(["PASS", name, ""]); }
  catch (err) { results.push(["FAIL", name, String(err.message).split("\n")[0].slice(0, 92)]); }
};
/** Assert the call is refused, and that the message explains what it prevents. */
const refuses = (fn, args, must) => {
  try { fn(args); assert.fail("the call was accepted"); }
  catch (err) {
    assert.ok(err instanceof e.EncodeError, `threw ${err.constructor.name}, not EncodeError`);
    assert.ok(new RegExp(must, "i").test(err.message),
      `message did not mention ${must}: ${err.message}`);
  }
};
/** The inner JSON, decoded back out of the PBIR literal. */
const decode = (r) => JSON.parse(r.literal.expr.Literal.Value.replace(/^'|'$/g, ""));

// --- the wrapper -----------------------------------------------------------------------------

check("output is JSON inside a single-quoted PBIR literal", () => {
  const r = e.encodeDataValueList({ target: "chartResults", values: ["Cash BOP", "Cash EOP"] });
  const raw = r.literal.expr.Literal.Value;
  assert.ok(raw.startsWith("'") && raw.endsWith("'"), "not wrapped in single quotes");
  assert.deepStrictEqual(decode(r), ["Cash BOP", "Cash EOP"]);
  assert.strictEqual(r.property, "categoriesMetadata.results");
});

check("a data value containing a newline survives", () => {
  const r = e.encodeDataValueList({ target: "chartHighlighted", values: ["Q3\n2023"] });
  assert.deepStrictEqual(decode(r), ["Q3\n2023"], "the newline was mangled");
});

// --- landmine: the full key set ----------------------------------------------------------------

check("a partial view object is completed, not passed through", () => {
  const r = e.encodeTableColumns({ mode: "chart", columns: [{ key: "actual", textColor: "#000" }] });
  const view = decode(r).actual.chartView;
  for (const k of ["backgroundFill", "textColor", "markerStyle", "showAsTable"]) {
    assert.ok(k in view, `${k} missing: omitting it renders the cells solid black`);
  }
  assert.strictEqual(view.backgroundFill, "", "absent should become empty string, not undefined");
});

// --- landmine: showAsTable's type changes with position ----------------------------------------

check("inCellChart becomes an integer enum, never a boolean", () => {
  const bar = decode(e.encodeTableColumns({ mode: "table",
    columns: [{ key: "actual", inCellChart: "bar" }] })).actual.tableView.showAsTable;
  const none = decode(e.encodeTableColumns({ mode: "table",
    columns: [{ key: "actual", inCellChart: "none" }] })).actual.tableView.showAsTable;
  assert.strictEqual(typeof bar, "number");
  assert.strictEqual(bar, 2);
  assert.strictEqual(none, 0);
});

check("mode is required, because it picks which view object is read", () => {
  refuses(e.encodeTableColumns, { columns: [{ key: "actual" }] }, "tableView is read only when");
});

check("the companion gate is returned with the blob", () => {
  const r = e.encodeTableColumns({ mode: "table", columns: [{ key: "actual" }] });
  assert.ok(/showAsTable must be true/.test(r.companion));
});

check("an inert property is refused rather than emitted as a no-op", () => {
  const r = e.encodeTableColumns({ mode: "chart", columns: [{ key: "actual", header: "X" }] });
  assert.ok(r.warnings && r.warnings.some((w) => /header/.test(w)));
  assert.ok(!("header" in decode(r).actual), "header was emitted anyway");
});

// --- landmine: the grand total -----------------------------------------------------------------

check("aggregatesOtherRows is required and says why", () => {
  refuses(e.encodeAddedFormulas,
    { categoryField: "Accounts.Account group", formulas: [{ name: "GM %", expression: "[GP]/[R]" }] },
    "silently inflated");
});

check("an aggregating row emits the exclusion blob from the same call", () => {
  const r = e.encodeAddedFormulas({ categoryField: "Accounts.Account group", formulas: [
    { name: "Gross margin %", expression: "[Gross profit] / [Revenue]", aggregatesOtherRows: true },
  ] });
  assert.ok(r.also, "skipCalculationCategories was not returned");
  assert.strictEqual(r.also.property, "categoriesMetadata.skipCalculationCategories");
  assert.strictEqual(decode(r.also)[0].category, "Gross margin %");
});

check("a non-aggregating row emits no exclusion", () => {
  const r = e.encodeAddedFormulas({ categoryField: "A.B", formulas: [
    { name: "Note", expression: "[X]", aggregatesOtherRows: false } ] });
  assert.strictEqual(r.also, null);
});

check("insertAfter warns that sorting overrides it", () => {
  const r = e.encodeAddedFormulas({ categoryField: "A.B", formulas: [
    { name: "N", expression: "[X]", aggregatesOtherRows: false, insertAfter: "Channel Partners" } ] });
  assert.ok(r.warnings.some((w) => /sorting/.test(w)));
});

// --- landmine: the filter-context key ----------------------------------------------------------

const ANNOT = {
  target: "tables",
  valuesOrder: ["Value AC", "Value PL"],
  currentFilters: [{ fieldName: "Year", queryName: "Calendar.Year", value: 2024 }],
  comments: [{ cell: { category: "Revenue", column: "Value AC" }, text: "Up on price." }],
};

check("currentFilters is required, and the message names the consequence", () => {
  const bad = { ...ANNOT }; delete bad.currentFilters;
  refuses(e.encodeAnnotations, bad, "blanks the whole visual");
});

check("every comment carries a filterContexts key", () => {
  const arr = decode(e.encodeAnnotations(ANNOT));
  for (const c of arr) assert.ok("filterContexts" in c, "the key that blanks the visual is absent");
});

check("comments are a BARE array, never a value/Count envelope", () => {
  const v = decode(e.encodeAnnotations(ANNOT));
  assert.ok(Array.isArray(v), "an envelope blanks the visual and may not be recoverable");
});

check("createdAt and updatedAt are stamped", () => {
  const [c] = decode(e.encodeAnnotations(ANNOT));
  assert.ok(c.createdAt && c.updatedAt, "omitting these silently drops the comment from the panel");
});

check("dataProperty is derived from the column's position", () => {
  const [a] = decode(e.encodeAnnotations(ANNOT));
  const [b] = decode(e.encodeAnnotations({ ...ANNOT,
    comments: [{ cell: { category: "Revenue", column: "Value PL" }, text: "x" }] }));
  assert.strictEqual(a.dataProperty, 7);
  assert.strictEqual(b.dataProperty, 8);
});

check("a column not in valuesOrder is refused", () => {
  refuses(e.encodeAnnotations, { ...ANNOT,
    comments: [{ cell: { category: "R", column: "Nope" }, text: "x" }] }, "no column to anchor");
});

check("the authored title is dropped for the form Desktop writes", () => {
  const [c] = decode(e.encodeAnnotations({ ...ANNOT,
    comments: [{ cell: { category: "Revenue", column: "Value AC" }, text: "x", title: "Mine" }] }));
  assert.strictEqual(c.title, "Revenue - null");
});

check("encoding is idempotent, so a rebuild shows no spurious diff", () => {
  assert.strictEqual(e.encodeAnnotations(ANNOT).value, e.encodeAnnotations(ANNOT).value);
});

// --- the comment layer differs by product ------------------------------------------------------

check("target is required, because the shape differs by product", () => {
  const bad = { ...ANNOT }; delete bad.target;
  refuses(e.encodeAnnotations, bad, "target must be");
});

check("a Table emits an empty categoryFields", () => {
  const [c] = decode(e.encodeAnnotations(ANNOT));
  assert.deepStrictEqual(c.categoryFields, []);
});

check("a Chart names the bound category field", () => {
  const [c] = decode(e.encodeAnnotations({ ...ANNOT, target: "charts", categoryFields: ["Year"] }));
  assert.deepStrictEqual(c.categoryFields, ["Year"]);
});

check("a hierarchy level carries one entry per level", () => {
  const [c] = decode(e.encodeAnnotations({ ...ANNOT, target: "charts",
    categoryFields: ["Year", "Quarter Name"] }));
  assert.deepStrictEqual(c.categoryFields, ["Year", "Quarter Name"]);
});

check("a Chart without categoryFields is refused, not silently emptied", () => {
  refuses(e.encodeAnnotations, { ...ANNOT, target: "charts" }, "required on a Chart");
  refuses(e.encodeAnnotations, { ...ANNOT, target: "charts", categoryFields: [] },
    "required on a Chart");
});

check("categoryFields on a Table is refused", () => {
  refuses(e.encodeAnnotations, { ...ANNOT, categoryFields: ["Year"] }, "omitted or empty");
});

check("every generated uuid is well formed", () => {
  const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;
  // Many seeds, because the malformed case came from a negative XOR on particular inputs only.
  for (let i = 0; i < 500; i++) {
    const id = e.stableId(`Category ${i}|Group ${i * 7}|Value AC`);
    assert.ok(shape.test(id), `malformed uuid: ${id}`);
  }
});

check("rich text becomes ops with attributes", () => {
  const [c] = decode(e.encodeAnnotations({ ...ANNOT, comments: [{
    cell: { category: "Revenue", column: "Value AC" },
    text: [{ text: "Up " }, { text: "sharply", bold: true }] } ] }));
  assert.strictEqual(c.deltaContent.ops.length, 2);
  assert.ok(c.deltaContent.ops[1].attributes.bold);
});

// --- landmine: card ids cannot be invented ------------------------------------------------------

check("plan_card_invert returns a procedure, not a blob", () => {
  const r = e.planCardInvert({ cardsToInvert: ["CAPEX"] });
  assert.strictEqual(r.property, null);
  assert.ok(/cannot be computed/i.test(r.instruction));
});

check("encode_card_invert refuses without ids", () => {
  refuses(e.encodeCardInvert, {}, "minted by Desktop");
});

check("card sizing is not offered, and the alternative is named", () => {
  const r = e.encodeCardInvert({ cardIds: [{ id: "abc", invert: true }] });
  assert.ok(!("globalCardSize" in decode(r)), "a size here is accepted and silently ignored");
  assert.ok(/cardsInRow/.test(r.companion));
});

// --- calculations govern the legal key space -----------------------------------------------------

check("calculations returns the legal key set for the next call", () => {
  const r = e.encodeTableCalculations({ comparisons: ["actual-plan"] });
  assert.ok(r.legalColumnKeys.includes("actual-plan") && r.legalColumnKeys.includes("previousYear"));
});

check("an unknown comparison is refused with the list", () => {
  refuses(e.encodeTableCalculations, { comparisons: ["actual-vs-plan"] }, "unknown comparison");
});

check("a column key outside the legal set is warned about", () => {
  const cal = e.encodeTableCalculations({ comparisons: ["actual-plan"] });
  const r = e.encodeTableColumns({ mode: "table", legalKeys: cal.legalColumnKeys,
    columns: [{ key: "forecast-plan" }] });
  assert.ok(r.warnings.some((w) => /will be ignored/.test(w)));
});

// --- the cross-check: does the validator accept what the encoders produce? ----------------------

function projectWith(objects) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zbi-e-"));
  const def = path.join(root, "D.Report", "definition");
  const vd = path.join(def, "pages", "P1", "visuals", "V1");
  fs.mkdirSync(vd, { recursive: true });
  const md = path.join(root, "D.SemanticModel", "definition");
  fs.mkdirSync(md, { recursive: true });
  fs.writeFileSync(path.join(md, "m.tmdl"), [
    "table Calendar", "\tdataCategory: Time", "", "\tcolumn Date", "\t\tisKey", "",
    "table F", "\tmeasure 'Value AC' = 1", "\t\tformatString: #,0",
    "\tmeasure 'Value PL' = 1", "\t\tformatString: #,0", "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "D.pbip"), JSON.stringify({ $schema:
    "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json" }));
  fs.writeFileSync(path.join(def, "definition.pbir"), JSON.stringify(
    { datasetReference: { byPath: { path: "../D.SemanticModel" } } }));
  fs.writeFileSync(path.join(def, "report.json"), JSON.stringify(
    { $schema: "https://x", themeCollection: { baseTheme: { name: "CY24SU10" } } }));
  fs.writeFileSync(path.join(def, "pages", "pages.json"),
    JSON.stringify({ pageOrder: ["P1"], activePageName: "P1" }));
  fs.writeFileSync(path.join(def, "pages", "P1", "page.json"), JSON.stringify({ name: "P1" }));
  fs.writeFileSync(path.join(vd, "visual.json"), JSON.stringify({ name: "V1", position: {},
    visual: { visualType: "ZebraBITablesBAE31B370F254F808553548EFB35BFA5", objects,
              query: { queryState: {} } } }));
  return root;
}
/** Splice an encoder result into the objects tree at its dotted property path. */
function place(objects, r) {
  for (const part of [r, r.also].filter(Boolean)) {
    const [objName, ...rest] = part.property.split(".");
    objects[objName] = objects[objName] || [{ properties: {} }];
    objects[objName][0].properties[rest.join(".")] = part.literal;
  }
  return objects;
}
const codesOf = (root) => srv.validateReport({ projectPath: root }).findings.map((f) => f.code);

check("ROUND TRIP: encoded comments pass their own validator", () => {
  const objects = place({}, e.encodeAnnotations(ANNOT));
  const found = codesOf(projectWith(objects));
  assert.ok(!found.includes("comment-filtercontexts-key"),
    "the encoder produced a comment blob its own rule rejects");
});

check("ROUND TRIP: encoded computed rows pass the grand-total rule", () => {
  const objects = place({}, e.encodeAddedFormulas({ categoryField: "Accounts.Account group",
    formulas: [{ name: "GM %", expression: "[GP]/[R]", aggregatesOtherRows: true }] }));
  // The rule is gated on the visual actually computing a total (2026-08-05), so the round trip has
  // to put the encoder's output in a visual that has one. Without this the assertion passes because
  // the rule cannot fire, which proves nothing about the encoder.
  objects.chartSettings = [{ properties: { showGrandTotal: { expr: { Literal: { Value: "'true'" } } } } }];
  const found = codesOf(projectWith(objects));
  assert.ok(!found.includes("computed-row-in-grand-total"),
    "the encoder produced a total-inflating blob its own rule rejects");
});

check("ROUND TRIP: encoded column settings pass the full-key-set and enum rules", () => {
  const objects = place({}, e.encodeTableColumns({ mode: "chart",
    columns: [{ key: "actual", textColor: "#0078D4", inCellChart: "bar" }] }));
  const found = codesOf(projectWith(objects));
  assert.ok(!found.includes("nested-settings-need-full-key-set"), "chartView was incomplete");
  assert.ok(!found.includes("in-cell-chart-switch-is-a-number"), "showAsTable got the wrong type");
});

// And the negative of the same check: a hand-written blob of the kind the encoder prevents IS
// caught. Without this, the three passes above could be passing because the rules never fire.
check("the same blobs written by hand ARE caught, so the round trip means something", () => {
  const lit = (s) => ({ expr: { Literal: { Value: `'${s}'` } } });
  const found = codesOf(projectWith({
    annotationLayerSettings: [{ properties: {
      annotationComments: lit(JSON.stringify([{ uuid: "x", title: "y" }])) } }],
    chartSettings: [{ properties: {
      // showGrandTotal is what makes the grand-total rule applicable at all since 2026-08-05.
      showGrandTotal: lit("true"),
      columnSettings: lit(JSON.stringify({ actual: { chartView: { textColor: "#000" } } })) } }],
    categoriesMetadata: [{ properties: {
      addedFormulas: lit(JSON.stringify([{ identity: "GM %", expression: "[a]/[b]" }])) } }],
  }));
  for (const code of ["comment-filtercontexts-key", "nested-settings-need-full-key-set",
                      "computed-row-in-grand-total"]) {
    assert.ok(found.includes(code), `${code} did not fire on a hand-written blob`);
  }
});

// Apostrophes: refused, as the writer refuses them, because the escaping is not established and
// one of the two forms corrupts the visual silently. Until 2026-09-01 the encoders emitted the raw
// form without a word, on the path the skill documents ("splice the literal in unchanged").
const ANNOT_APOS = (text, category) => ({
  target: "tables", valuesOrder: ["AC"],
  currentFilters: [{ fieldName: "Year", queryName: "Cal.Year", value: "2025" }],
  comments: [{ cell: { category, column: "AC" }, text }],
});
check("an apostrophe in a comment is refused, with the workaround in the message", () => {
  refuses(e.encodeAnnotations, ANNOT_APOS("Q3 doesn't close", "North"), "U\\+2019");
});
check("an apostrophe in a CATEGORY is refused too — it lands in the same literal", () => {
  refuses(e.encodeAnnotations, ANNOT_APOS("Fine", "Women's wear"), "apostrophe");
});
check("the typographic apostrophe U+2019 is accepted", () => {
  const r = e.encodeAnnotations(ANNOT_APOS("Q3 doesn\u2019t close", "Women\u2019s wear"));
  assert.ok(r.literal.expr.Literal.Value.startsWith("'"), "not a PBIR literal");
  assert.strictEqual((r.literal.expr.Literal.Value.match(/'/g) || []).length, 2, "stray quote inside");
});
check("a data value with an apostrophe is refused on the list encoders as well", () => {
  refuses(e.encodeDataValueList, { target: "chartResults", values: ["Q1", "Women's"] }, "apostrophe");
});

// --- Plus visuals: the link to the view-mode comments workbook ------------------------------------

// A team-site library is the supported location. The ids below are synthetic placeholders, not a
// real tenant's. The asymmetric site GUID below exercises little-endian byte ordering.
const STORE = { siteId: "11111111-1111-1111-1111-111111111111",
  folderPath: "/drive/root:/Shared Documents/CommentsInViewMode", fileName: "comments.xlsx" };

check("storage config lands on the annotation layer with the backend the visual switches on", () => {
  const r = e.encodeStorageConfig(STORE);
  assert.strictEqual(r.property, "annotationLayerSettings.annotationsStorageConfig");
  const v = decode(r);
  assert.strictEqual(v.storageBackend, "sharePointExcel");
  assert.deepStrictEqual(v.storageOptions, { siteId: STORE.siteId, folderPath: STORE.folderPath,
    fullFileName: STORE.fileName });
});

check("the site collection id is derived from a Graph driveId (first of its three GUIDs)", () => {
  // Synthetic packed bytes: 67452301ab89de4c8f0123456789abcd, then sixteen 22 and sixteen 33 bytes.
  const DRIVE = "b!Z0UjAauJ3kyPASNFZ4mrzSIiIiIiIiIiIiIiIiIiIiIzMzMzMzMzMzMzMzMzMzMz";
  assert.strictEqual(e.siteIdFromDriveId(DRIVE), "01234567-89ab-4cde-8f01-23456789abcd");
  const r = decode(e.encodeStorageConfig({ ...STORE, siteId: undefined, driveId: DRIVE }));
  assert.strictEqual(r.storageOptions.siteId, "01234567-89ab-4cde-8f01-23456789abcd");
});

check("a hostname,guid,guid site id is refused with the fix in the message", () => {
  refuses(e.encodeStorageConfig, { ...STORE,
    siteId: "contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222" },
    "FIRST guid");
});

check("a folder path not rooted at /drive/root: is refused", () => {
  refuses(e.encodeStorageConfig, { ...STORE, folderPath: "Shared Documents/Comments" }, "/drive/root:");
});

check("a non-xlsx file is refused", () => {
  refuses(e.encodeStorageConfig, { ...STORE, fileName: "comments.csv" }, "xlsx");
});

check("the companion names the show flag and the Plus-only constraint", () => {
  const r = e.encodeStorageConfig(STORE);
  assert.ok(/commentBoxSettings\.show/.test(r.companion));
  assert.ok(/Tables\+ or Charts\+/.test(r.companion));
});

// --- Tables: highlights, and comments that hang on them -----------------------------------------

const HL = {
  columns: ["previousYear", "actual", "actual-previousYear", "actual-previousYear-percent"],
  currentFilters: [{ fieldName: "Year", queryName: "Calendar.Year", value: 2024 }],
  highlights: [{ id: "box", shape: "rectangle", rows: ["Enterprise", "SMB"],
    columns: ["actual-previousYear-percent"] }],
};

check("a highlight carries BOTH context keys whose absence blanks the visual", () => {
  const [h] = decode(e.encodeHighlights(HL));
  assert.ok(h.sortByColumnContext && h.orderOfColumnsContext, "a context key is missing");
  assert.strictEqual(h.sortByColumnContext.columnNameToSortBy, "actual");
  assert.ok("filterContexts" in h);
});

check("the highlight vocabulary is the stable per-column index, not 7 + position", () => {
  const [h] = decode(e.encodeHighlights(HL));
  assert.deepStrictEqual(h.orderOfColumnsContext,
    [["previousYear", 1], ["actual", 0], ["actual-previousYear", 2], ["actual-previousYear-percent", 3]]);
  assert.deepStrictEqual(h.dataProperties, [3]);
  assert.strictEqual(h.highlightType, 0);
  assert.deepStrictEqual(h.dataPointSelections.map((d) => d.identifier.fullCategory), ["Enterprise", "SMB"]);
});

check("a second comparison has no measured index and is refused without one", () => {
  refuses(e.encodeHighlights, { ...HL, columns: ["plan", "previousYear", "actual"] }, "no measured index");
  const r = decode(e.encodeHighlights({ ...HL,
    columns: [{ name: "plan", index: 1 }, { name: "actual", index: 0 }, { name: "previousYear", index: 4 }],
    highlights: [{ rows: ["A"], columns: ["previousYear"] }] }));
  assert.deepStrictEqual(r[0].dataProperties, [4]);
});

check("the ids map lets a comment attach to the highlight without a cell", () => {
  const h = e.encodeHighlights(HL);
  const c = decode(e.encodeAnnotations({ target: "tables", currentFilters: HL.currentFilters,
    comments: [{ highlightId: h.ids.box, text: "Margin fell in both segments" }] }));
  assert.strictEqual(c[0].highlightId, h.ids.box);
  assert.strictEqual(c[0].commentType, 0);
  assert.ok(!("dataProperty" in c[0]) && !("dataPointSelection" in c[0]), "the shape owns the anchor");
  assert.ok("filterContexts" in c[0]);
});

check("a cell comment still needs valuesOrder; a highlight comment does not", () => {
  refuses(e.encodeAnnotations, { target: "tables", currentFilters: HL.currentFilters,
    comments: [{ cell: { category: "A", column: "AC" }, text: "x" }] }, "valuesOrder is required");
});

check("a CAGR arrow carries filterContexts and the label verbatim", () => {
  const [a] = decode(e.encodeCagrArrows({ currentFilters: HL.currentFilters,
    arrows: [{ label: "CAGR 2021–2025" }] }));
  assert.ok("filterContexts" in a);
  assert.strictEqual(a.settings.labelTitle, "CAGR 2021–2025");
  assert.strictEqual(a.settings.arrowLineWidth, 2);
});

// --- Charts: per-category scenarios --------------------------------------------------------------

const SC = {
  scenarios: { Forecast: "forecast", "2-Develop qualified": 3 },
  floating: ["2-Develop qualified"],
  results: ["Forecast", "2-Develop qualified", "Won to date"],
};

check("scenarios is an array of single-key objects mapping a data value to 3", () => {
  const r = e.encodeCategoryScenarios(SC);
  assert.strictEqual(r.property, "categoriesMetadata.scenarios");
  assert.deepStrictEqual(decode(r), [{ Forecast: 3 }, { "2-Develop qualified": 3 }]);
});

check("the three companions ride along on the also chain, empty lists included", () => {
  const seen = {};
  for (let r = e.encodeCategoryScenarios(SC); r; r = r.also) seen[r.property] = decode(r);
  assert.deepStrictEqual(seen["categoriesMetadata.results"], SC.results);
  assert.deepStrictEqual(seen["categoriesMetadata.floatingResults"], ["2-Develop qualified"]);
  assert.deepStrictEqual(seen["categoriesMetadata.highlighted"], []);
});

check("an unconfirmed scenario enum is refused rather than guessed", () => {
  refuses(e.encodeCategoryScenarios, { ...SC, scenarios: { Forecast: 2 } }, "only 'forecast'");
  refuses(e.encodeCategoryScenarios, { ...SC, scenarios: { Forecast: "plan" } }, "only 'forecast'");
});

check("a scenario or a floating step that results does not draw is refused", () => {
  refuses(e.encodeCategoryScenarios, { ...SC, results: ["Won to date"] }, "results does not list");
  refuses(e.encodeCategoryScenarios, { ...SC, floating: ["Ghost"] }, "also in results");
});

check("the companion says the Forecast role must stay empty", () => {
  const r = e.encodeCategoryScenarios(SC);
  assert.ok(/Forecast role must stay EMPTY/.test(r.companion), r.companion);
  assert.ok(r.warnings.some((w) => /data value/.test(w)));
});

for (const [s, n, d] of results) console.log(`  ${s}  ${n}${d ? "  <- " + d : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
