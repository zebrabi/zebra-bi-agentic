#!/usr/bin/env node
// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";
/**
 * Tests for the whole-file writers.
 *
 * Three kinds, and the last two carry the weight:
 *
 *   Unit tests pin the literal forms, the refusals, and the encoder delegation.
 *
 *   A cross-check writes a generated project to disk and runs `validate_report` over it, which
 *   must find nothing. The writers and the checkers were built from the same format knowledge by
 *   different routes, so a generator that emits a file its own validator rejects is caught here.
 *   A negative control sits beside it, because three passing round trips prove nothing if the
 *   rules simply cannot fire on the shape being tested.
 *
 *   A ROUND TRIP takes real `visual.json` files, derives a spec, regenerates, and compares. The
 *   vendored fixture always runs; a larger local corpus runs when one is present. Both print the
 *   number of files read, and zero files is a failure rather than a silent pass — a sweep that
 *   reads nothing reports a beautiful hundred percent.
 *
 *   node test-writers.js
 *   ZBI_VISUAL_CORPUS=/path/to/reports node test-writers.js     # add an external corpus
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const w = require("./writers.js");
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

const MIN = { name: "V1", visualType: "tables", position: { x: 0, y: 0, width: 100, height: 100 } };
const emit = (extra) => JSON.parse(w.writeVisual({ ...MIN, ...extra }).content);
/** The raw literal written at a dotted path. */
const at = (file, dotted) => {
  const i = dotted.indexOf(".");
  return file.visual.objects[dotted.slice(0, i)][0].properties[dotted.slice(i + 1)];
};

// --- the literal forms, which is where the escape hatch can silently corrupt a file -------------

check("a number becomes a D-suffixed literal, NEVER a quoted one", () => {
  const f = emit({ properties: { "chartType.chartType": 3 } });
  assert.strictEqual(at(f, "chartType.chartType").expr.Literal.Value, "3D");
});

// The exact defect `numeric-enum-must-not-be-quoted` exists to catch: '3' is not a declared enum
// value, so it is dropped in silence and the visual keeps its default. A tester set '2' on two
// charts and got the default waterfall on both.
check("a numeric enum written through the escape hatch cannot come out quoted", () => {
  const f = emit({ properties: { "chartType.chartType": 2, "designSettings.style": 4 } });
  for (const p of ["chartType.chartType", "designSettings.style"]) {
    assert.ok(!/^'/.test(at(f, p).expr.Literal.Value), `${p} came out quoted`);
  }
});

check("a decimal keeps its decimals and its suffix", () => {
  assert.strictEqual(
    at(emit({ properties: { "axisBreakSettings.percent": -103.375 } }),
       "axisBreakSettings.percent").expr.Literal.Value, "-103.375D");
});

check("a boolean is a bare token, a string is quoted", () => {
  const f = emit({ properties: { "chartSettings.invert": false, "dataLabelSettings.units": "K" } });
  assert.strictEqual(at(f, "chartSettings.invert").expr.Literal.Value, "false");
  assert.strictEqual(at(f, "dataLabelSettings.units").expr.Literal.Value, "'K'");
});

check("__literal is written raw, which is how the L-suffix stays reachable", () => {
  assert.strictEqual(
    at(emit({ properties: { "card.varianceType": { __literal: "2L" } } }),
       "card.varianceType").expr.Literal.Value, "2L");
});

check("__solid produces the nested colour wrapper, not a bare literal", () => {
  const v = at(emit({ properties: { "titleSettings.fontColor": { __solid: "#1A1A2E" } } }),
                "titleSettings.fontColor");
  assert.strictEqual(v.solid.color.expr.Literal.Value, "'#1A1A2E'");
  assert.ok(!v.expr, "a solid colour must not also carry a bare expr");
});

check("__json serialises then quotes, so a tail blob is reachable with no code change", () => {
  const raw = at(emit({ properties: { "groupsMetadata.custom": { __json: { a: [1, 2] } } } }),
                  "groupsMetadata.custom").expr.Literal.Value;
  assert.strictEqual(raw, `'{"a":[1,2]}'`);
});

check("__raw writes a property value that is not a literal at all", () => {
  // A textbox carries general.paragraphs as a structured array of text runs. There are more such
  // shapes than a writer can enumerate, so this is the general way out.
  const paras = [{ textRuns: [{ value: "Source: internal", textStyle: { fontSize: "9pt" } }] }];
  assert.deepStrictEqual(
    emit({ visualType: "textbox", properties: { "general.paragraphs": { __raw: paras } } })
      .visual.objects.general[0].properties.paragraphs, paras);
});

check("rawObjects passes a whole group through, but is still never-emit checked", () => {
  const f = emit({ rawObjects: { data: [{ properties: { a: 1 } }, { properties: { b: 2 } }] } });
  assert.strictEqual(f.visual.objects.data.length, 2, "a multi-entry group was not passed through");
  refuses(w.writeVisual, { ...MIN, rawObjects: { licenseSettings: [] } }, "credential");
  refuses(w.writeVisual, { ...MIN, title: "T", rawObjects: { titleSettings: [] } }, "collides");
});

check("a value with no literal form is refused rather than guessed at", () => {
  refuses(w.writeVisual, { ...MIN, properties: { "a.b": [1, 2] } }, "no literal form");
  refuses(w.writeVisual, { ...MIN, properties: { "a.b": null } }, "Omit the property");
});

// A textbox has no `query` key at all, and writing an empty one would add a key to 95 of the
// corpus's non-Zebra visuals. Every Zebra visual in the corpus has bindings, so this removes none.
check("query is omitted entirely when there is nothing to put in it", () => {
  assert.ok(!("query" in emit({ visualType: "textbox" }).visual), "an empty query was invented");
  assert.ok("query" in emit({ bindings: { Values: ["M.AC"] } }).visual);
});

// No corpus file has an apostrophe inside a PBIR literal, in either the raw or the doubled form,
// so there is no evidence for the escaping. Both candidates look plausible and one corrupts the
// property in silence, so the call is refused and the two ways round it are named.
check("an apostrophe is refused, with both workarounds in the message", () => {
  refuses(w.writeVisual, { ...MIN, title: "Q3 doesn't add up" }, "U\\+2019");
  refuses(w.writeVisual, { ...MIN, title: "Q3 doesn't add up" }, "__literal");
});

check("a dotted path that is not group.property is refused", () => {
  refuses(w.writeVisual, { ...MIN, properties: { chartType: 3 } }, "must be 'group.property'");
});

// A misspelled field would otherwise produce a file that is valid, renders, and is missing
// everything the caller asked for -- the silent no-op this module exists to make unreachable.
check("a misspelled spec field is refused, not ignored", () => {
  refuses(w.writeVisual, { ...MIN, properites: { "a.b": 1 } }, "unknown visual spec field");
  refuses(w.writePage, { name: "P", displayName: "P", visual: [] }, "unknown page spec field");
  refuses(w.writeReport, { pages: [{ name: "A", displayName: "A" }], activePage: "A" },
    "unknown report spec field");
});

// --- the never-emit set, which a general escape hatch makes reachable by name -------------------

check("every never-emit group is actively refused, not quietly dropped", () => {
  for (const g of Object.keys(w.NEVER_EMIT)) {
    refuses(w.writeVisual, { ...MIN, properties: { [`${g}.anything`]: true } }, g);
  }
});

check("the licence key refusal says why, because it is a credential", () => {
  refuses(w.writeVisual, { ...MIN, properties: { "licenseSettings.licenseKey": "X" } },
    "credential");
});

check("a licence key smuggled under another group name is still refused", () => {
  refuses(w.writeVisual, { ...MIN, properties: { "coreSettings.licenseKey": "X" } }, "credential");
});

check("Cards customData is refused through the escape hatch and routed to the encoder", () => {
  refuses(w.writeVisual, { ...MIN, visualType: "cards", properties: { "customData.uniformData": 1 } },
    "cardInvert");
});

check("cardInvert IS the way through, and it goes via the encoder", () => {
  const f = emit({ visualType: "cards",
    cardInvert: { cardIds: [{ id: "abc", invert: true }] } });
  const raw = at(f, "customData.uniformData").expr.Literal.Value;
  assert.deepStrictEqual(JSON.parse(raw.slice(1, -1)),
    JSON.parse(e.encodeCardInvert({ cardIds: [{ id: "abc", invert: true }] }).value),
    "cardInvert did not delegate to encode_card_invert");
});

// --- no group is emitted unattended ------------------------------------------------------------
// The corpus reason: across 270 Zebra visuals not one property group reaches 90% presence, and the
// most common (titleSettings) sits at 83.7%. There is no group a generator may assume.

check("a minimal spec emits NO object groups at all", () => {
  const f = emit({});
  assert.ok(!("objects" in f.visual),
    `objects was emitted unasked: ${JSON.stringify(f.visual.objects)}`);
});

check("asking for a title emits titleSettings and nothing else", () => {
  const f = emit({ title: "Revenue by region" });
  assert.deepStrictEqual(Object.keys(f.visual.objects), ["titleSettings"]);
  assert.deepStrictEqual(Object.keys(f.visual.objects.titleSettings[0].properties), ["text"]);
});

// --- bindings -----------------------------------------------------------------------------------

check("role decides Column vs Measure, measured at 100% both ways in the corpus", () => {
  const f = emit({ bindings: { Category: ["Sales.Region"], Values: ["Measures.AC"] } });
  assert.ok(f.visual.query.queryState.Category.projections[0].field.Column);
  assert.ok(f.visual.query.queryState.Values.projections[0].field.Measure);
});

// A measures table called `.Measures` is common, and splitting ".Measures.AC" on the FIRST dot
// gives entity "" and property "Measures.AC", which resolves to nothing and renders empty.
check("a leading-dot entity splits on the LAST dot, not the first", () => {
  const p = emit({ bindings: { Values: [".Measures.AC"] } }).visual.query.queryState.Values.projections[0];
  assert.strictEqual(p.field.Measure.Expression.SourceRef.Entity, ".Measures");
  assert.strictEqual(p.field.Measure.Property, "AC");
  assert.strictEqual(p.queryRef, ".Measures.AC");
  assert.strictEqual(p.nativeQueryRef, "AC");
});

check("kind, displayName and active are overridable per projection", () => {
  const p = emit({ bindings: { Category: [
    { entity: "M", property: "AC", kind: "Measure", displayName: "Actual", active: true }] } })
    .visual.query.queryState.Category.projections[0];
  assert.ok(p.field.Measure, "kind override was ignored");
  assert.strictEqual(p.displayName, "Actual");
  assert.strictEqual(p.active, true);
});

check("neither displayName nor active is invented when unasked", () => {
  const p = emit({ bindings: { Category: ["Sales.Region"] } })
    .visual.query.queryState.Category.projections[0];
  assert.deepStrictEqual(Object.keys(p), ["field", "queryRef", "nativeQueryRef"]);
});

check("an empty role list is refused rather than emitted as a dead role", () => {
  refuses(w.writeVisual, { ...MIN, bindings: { Values: [] } }, "non-empty array");
});

// 248 of 270 corpus visuals carry drillFilterOtherVisuals and 22 do not, so writing it unasked
// would be inventing an answer for the 8% that never set it.
check("drillFilterOtherVisuals is written only when asked for", () => {
  assert.ok(!("drillFilterOtherVisuals" in emit({}).visual), "it was invented");
  assert.strictEqual(emit({ drillFilterOtherVisuals: false }).visual.drillFilterOtherVisuals, false);
  assert.strictEqual(emit({ drillFilterOtherVisuals: true }).visual.drillFilterOtherVisuals, true);
});

// sortDefinition is how a visual's own sort is authored, and it is a sibling of queryState rather
// than a property group, so nothing but a passthrough reaches it.
check("queryExtras reaches sortDefinition and isDrillDisabled, and cannot clobber the bindings", () => {
  const sort = { sort: [{ direction: "Descending" }] };
  const f = emit({ bindings: { Values: ["M.AC"] },
    queryExtras: { sortDefinition: sort, isDrillDisabled: true } });
  assert.deepStrictEqual(f.visual.query.sortDefinition, sort);
  assert.strictEqual(f.visual.query.isDrillDisabled, true);
  assert.ok(f.visual.query.queryState.Values, "the bindings were lost");
  refuses(w.writeVisual, { ...MIN, queryExtras: { queryState: {} } }, "would overwrite the bindings");
});

// --- position ------------------------------------------------------------------------------------

check("z and tabOrder are two inputs, and tabOrder is never derived from z", () => {
  const both = emit({ position: { x: 0, y: 0, width: 1, height: 1, z: 100, tabOrder: 7 } });
  assert.strictEqual(both.position.z, 100);
  assert.strictEqual(both.position.tabOrder, 7);
  const zOnly = emit({ position: { x: 0, y: 0, width: 1, height: 1, z: 100 } });
  assert.ok(!("tabOrder" in zOnly.position),
    "tabOrder was derived from z, which is wrong in 41.2% of real files");
});

check("the four geometry numbers are required", () => {
  for (const k of ["x", "y", "width", "height"]) {
    const pos = { x: 0, y: 0, width: 1, height: 1 };
    delete pos[k];
    refuses(w.writeVisual, { ...MIN, position: pos }, `position.${k} is required`);
  }
});

// --- delegation to the encoders ------------------------------------------------------------------

check("tableColumns delegates to encode_table_columns byte for byte", () => {
  const args = { mode: "chart", columns: [{ key: "actual", textColor: "#0078D4", inCellChart: "bar" }] };
  const raw = at(emit({ tableColumns: args }), "chartSettings.columnSettings").expr.Literal.Value;
  assert.strictEqual(raw.slice(1, -1), e.encodeTableColumns(args).value);
});

check("annotations delegates, and the comment layer keeps its filterContexts key", () => {
  const args = {
    target: "tables", valuesOrder: ["AC"],
    currentFilters: [{ fieldName: "P", queryName: "f.P", value: "2024" }],
    comments: [{ cell: { category: "North", column: "AC" }, text: "hi" }],
  };
  const raw = at(emit({ annotations: args }), "annotationLayerSettings.annotationComments")
    .expr.Literal.Value;
  assert.strictEqual(raw.slice(1, -1), e.encodeAnnotations(args).value);
  assert.ok("filterContexts" in JSON.parse(raw.slice(1, -1))[0],
    "an absent filterContexts KEY blanks the entire visual");
});

// One spec, one file: the highlight is minted and the comment hangs on it by the caller's own key.
// Before this route the agent called two tools and spliced the uuid by hand.
check("highlights route, and a comment hangs on one by the spec's own key", () => {
  const filters = [{ fieldName: "Year", queryName: "Calendar.Year", value: 2024 }];
  const r = w.writeVisual({ ...MIN,
    highlights: { columns: ["previousYear", "actual"], currentFilters: filters,
      highlights: [{ id: "box", shape: "ellipse", rows: ["SMB"], columns: ["actual"] }] },
    annotations: { target: "tables", currentFilters: filters,
      comments: [{ highlightId: "box", text: "SMB carried the quarter" }] } });
  const f = JSON.parse(r.content);
  const hl = JSON.parse(at(f, "annotationLayerSettings.annotationHighlights").expr.Literal.Value.slice(1, -1));
  const cm = JSON.parse(at(f, "annotationLayerSettings.annotationComments").expr.Literal.Value.slice(1, -1));
  assert.ok(hl[0].sortByColumnContext && hl[0].orderOfColumnsContext, "a context key is missing");
  assert.strictEqual(cm[0].highlightId, hl[0].uuid ?? cm[0].highlightId);
  assert.match(cm[0].highlightId, /^[0-9a-f-]{36}$/i, "the caller's key was not swapped for the uuid");
  assert.ok(r.companions.some((c) => /highlights: ids/.test(c)), "the ids map was not surfaced");
});

check("cagrArrows, storageConfig and categoryScenarios route to their encoders", () => {
  const f = emit({ visualType: "charts+",
    cagrArrows: { currentFilters: [{ fieldName: "Y", queryName: "C.Y", value: 2024 }],
      arrows: [{ label: "CAGR 2021-2025" }] },
    storageConfig: { siteId: "11111111-1111-1111-1111-111111111111", folderPath: "/drive/root:",
      fileName: "comments.xlsx" },
    categoryScenarios: { scenarios: { Forecast: "forecast" }, results: ["Forecast", "Won"] } });
  const o = f.visual.objects;
  assert.ok(o.annotationLayerSettings[0].properties.annotationCagrArrows, "no CAGR arrow");
  assert.ok(o.annotationLayerSettings[0].properties.annotationsStorageConfig, "no storage link");
  const cm = o.categoriesMetadata[0].properties;
  for (const k of ["scenarios", "results", "floatingResults", "highlighted"]) {
    assert.ok(cm[k], `categoriesMetadata.${k} was dropped from the also chain`);
  }
});

check("addedFormulas brings its exclusion blob along, so the grand total is not inflated", () => {
  const f = emit({ addedFormulas: { categoryField: "A.B", formulas: [
    { name: "GM %", expression: "[GP]/[R]", aggregatesOtherRows: true }] } });
  const props = f.visual.objects.categoriesMetadata[0].properties;
  assert.ok(props.addedFormulas, "no addedFormulas");
  assert.ok(props.skipCalculationCategories, "the `also` blob was dropped, inflating the total");
});

// One spec owns both sides, so the legal key set is handed over. Two separate tool calls cannot.
check("tableCalculations hands its legal key set to tableColumns automatically", () => {
  const r = w.writeVisual({ ...MIN,
    tableCalculations: { comparisons: ["actual-plan"] },
    tableColumns: { mode: "table", columns: [{ key: "forecast-plan" }] } });
  assert.ok(r.warnings.some((x) => /not in the legal key set/.test(x)),
    `the key set was not handed over: ${JSON.stringify(r.warnings)}`);
});

// Surfaced, never satisfied. Emitting commentBoxSettings would be writing a property group the
// caller did not ask for; refusing would be a false positive on an author who sets it next.
check("an encoder companion is reported, and its group is NOT emitted for you", () => {
  const r = w.writeVisual({ ...MIN, annotations: {
    target: "tables", valuesOrder: ["AC"],
    currentFilters: [{ fieldName: "P", queryName: "f.P", value: "2024" }],
    comments: [{ cell: { category: "North", column: "AC" }, text: "hi" }] } });
  assert.ok(r.companions.some((c) => /commentBoxSettings\.show must be true/.test(c)),
    "the companion gate was swallowed");
  const f = JSON.parse(r.content);
  assert.ok(!f.visual.objects.commentBoxSettings, "a group the caller never asked for was emitted");
});

check("a refused encoder call surfaces as a refused write", () => {
  refuses(w.writeVisual, { ...MIN, addedFormulas: { categoryField: "A.B",
    formulas: [{ name: "X", expression: "[y]" }] } }, "aggregatesOtherRows");
});

check("an escape-hatch path that collides with an encoder warns rather than overwriting silently", () => {
  const r = w.writeVisual({ ...MIN,
    tableCalculations: { comparisons: ["actual-plan"] },
    properties: { "chartSettings.calculations": { __json: ["actual-previousYear"] } } });
  assert.ok(r.warnings.some((x) => /was set twice/.test(x)), "the collision was silent");
});

// --- the products ---------------------------------------------------------------------------------

check("aliases resolve to the installed GUIDs, and every product is reachable", () => {
  for (const [alias, guid] of Object.entries(w.VISUAL_ALIASES)) {
    assert.strictEqual(emit({ visualType: alias }).visual.visualType, guid, alias);
  }
  assert.ok(Object.keys(w.INSTALLED).length === 5 && Object.keys(w.FILE_IMPORTED).length === 3,
    "the certified, Plus and file-imported GUID universes are not all present");
});

check("an explicit GUID is written through untouched", () => {
  const g = "ZebraBIChartsPlusC3F2FD9F79054F76BD1B722E7666AC33";
  assert.strictEqual(emit({ visualType: g }).visual.visualType, g);
});

// Not refused: a Zebra page normally carries slicers and textboxes, and a page generator that
// cannot emit one is a page generator nobody can finish a page with.
check("a non-Zebra visual type is written, with a warning saying what does not apply", () => {
  const r = w.writeVisual({ ...MIN, visualType: "slicer" });
  assert.strictEqual(JSON.parse(r.content).visual.visualType, "slicer");
  assert.ok(r.warnings.some((x) => /not a Zebra visual type/.test(x)));
});

// --- file hygiene -----------------------------------------------------------------------------------

check("output is UTF-8 with no BOM, LF only, and no trailing newline", () => {
  const c = w.writeVisual({ ...MIN, title: "Revenue" }).content;
  assert.ok(!c.includes("\r"), "a CR reached the output");
  assert.ok(!c.startsWith("﻿"), "a BOM reached the output");
  assert.ok(!c.endsWith("\n"), "Power BI Desktop writes no trailing newline");
  assert.strictEqual(Buffer.byteLength(c, "utf8"), w.writeVisual({ ...MIN, title: "Revenue" }).bytes);
});

check("the same spec twice produces byte-identical output", () => {
  const spec = { ...MIN, title: "Revenue", annotations: {
    target: "tables", valuesOrder: ["AC"],
    currentFilters: [{ fieldName: "P", queryName: "f.P", value: "2024" }],
    comments: [{ cell: { category: "North", column: "AC" }, text: "hi" }] } };
  assert.strictEqual(w.writeVisual(spec).content, w.writeVisual(spec).content);
});

check("filterConfig passes through verbatim, ids and all", () => {
  const fc = { filters: [{ name: "1957468d70ec900509d6", field: { Column: {} }, type: "Advanced" }] };
  assert.deepStrictEqual(emit({ filterConfig: fc }).filterConfig, fc);
});

// --- pages and reports --------------------------------------------------------------------------------

check("write_page returns page.json plus a visual directory per visual", () => {
  const r = w.writePage({ name: "P1", displayName: "Overview", visuals: [MIN,
    { ...MIN, name: "V2" }] });
  assert.deepStrictEqual(Object.keys(r.files).sort(), [
    "definition/pages/P1/page.json",
    "definition/pages/P1/visuals/V1/visual.json",
    "definition/pages/P1/visuals/V2/visual.json",
  ]);
  const p = JSON.parse(r.files["definition/pages/P1/page.json"]);
  assert.strictEqual(p.displayName, "Overview");
  assert.strictEqual(p.width, 1280);
  assert.ok(!("objects" in p), "a page group was emitted unasked");
});

check("a tooltip page on a 1.x page schema is refused, because the type is silently lost", () => {
  refuses(w.writePage, { name: "T", displayName: "T", type: "Tooltip", schemaVersion: "1.0.0" },
    "cannot express a top-level type");
});

check("write_report writes pages.json with the page order and an active page", () => {
  const r = w.writeReport({ pages: [
    { name: "A", displayName: "A", visuals: [MIN] },
    { name: "B", displayName: "B", visuals: [] }] });
  const meta = JSON.parse(r.files["definition/pages/pages.json"]);
  assert.deepStrictEqual(meta.pageOrder, ["A", "B"]);
  assert.strictEqual(meta.activePageName, "A");
  // 5, not 4: two page.json + one visual.json + pages.json + version.json.
  assert.strictEqual(r.fileCount, 5);
});

// definition/version.json is not optional -- without it Desktop refuses the project outright and
// opens an empty report called "Untitled". Asserted on content, not just presence, because an
// empty or misspelled file fails the same way as a missing one.
check("write_report always writes definition/version.json", () => {
  const r = w.writeReport({ pages: [{ name: "A", displayName: "A", visuals: [MIN] }] });
  const v = JSON.parse(r.files["definition/version.json"]);
  assert.strictEqual(v.version, "2.0.0");
  assert.match(v.$schema, /versionMetadata\/1\.0\.0\/schema\.json$/);
});

check("an activePageName that is not a page is refused", () => {
  refuses(w.writeReport, { pages: [{ name: "A", displayName: "A" }], activePageName: "Z" },
    "is not one of the pages");
});

check("duplicate page and visual names are refused before they overwrite each other", () => {
  refuses(w.writePage, { name: "P", displayName: "P", visuals: [MIN, MIN] }, "share one directory");
  refuses(w.writeReport, { pages: [{ name: "A", displayName: "A" }, { name: "A", displayName: "A" }] },
    "share one directory");
});

// A report with no base theme renders NOTHING, with no error. Returning a complete-looking set of
// page files without saying what is missing would hand over a report that opens blank.
check("write_report names what it did NOT write, base theme first", () => {
  const r = w.writeReport({ pages: [{ name: "A", displayName: "A" }] });
  assert.ok(r.notWritten.some((s) => /baseTheme/.test(s) && /renders NOTHING/.test(s)));
  assert.ok(r.notWritten.some((s) => /publicCustomVisuals/.test(s)));
  assert.ok(r.notWritten.some((s) => /definition\.pbir/.test(s)));
});

// --- the cross-check: does the validator accept what the writers produce? ---------------------------

/** Materialise a generated pages tree into a real project and hand it to validate_report. */
function projectFrom(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zbi-w-"));
  const rep = path.join(root, "D.Report");
  const md = path.join(root, "D.SemanticModel", "definition");
  fs.mkdirSync(md, { recursive: true });
  fs.writeFileSync(path.join(md, "database.tmdl"), "database\n\tcompatibilityLevel: 1606\n");
  fs.writeFileSync(path.join(md, "m.tmdl"), [
    "table Calendar", "\tdataCategory: Time", "", "\tcolumn Date", "\t\tisKey", "",
    "table Sales", "\tmeasure 'Value AC' = 1", "\t\tformatString: #,0",
    "\tmeasure 'Value PL' = 1", "\t\tformatString: #,0", "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "D.pbip"), JSON.stringify({ $schema:
    "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json" }));
  fs.mkdirSync(path.join(rep, "definition"), { recursive: true });
  fs.writeFileSync(path.join(rep, "definition", "definition.pbir"), JSON.stringify(
    { datasetReference: { byPath: { path: "../D.SemanticModel" } } }));
  fs.writeFileSync(path.join(rep, "definition", "report.json"), JSON.stringify({
    $schema: "https://x",
    themeCollection: { baseTheme: { name: "CY24SU10" } },
    publicCustomVisuals: Object.values(w.INSTALLED),
  }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(rep, rel.split("/").join(path.sep));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

/** A report that exercises every route: two products, an encoder blob, the escape hatch. */
const FULL_REPORT = {
  pages: [{
    name: "Overview", displayName: "Overview",
    visuals: [
      {
        name: "tblPL", visualType: "tables",
        position: { x: 24, y: 24, width: 1232, height: 400, z: 0, tabOrder: 0 },
        title: "Profit and loss by account - actual vs plan",
        bindings: {
          Category: ["Sales.Account"],
          Values: ["Sales.Value AC"],
          Plan: ["Sales.Value PL"],
        },
        tableCalculations: { comparisons: ["actual-plan", "actual-plan-percent"] },
        tableColumns: { mode: "table", columns: [{ key: "actual", order: 0, bold: true }] },
        properties: { "chartSettings.showAsTable": true, "designSettings.style": 4 },
      },
      {
        name: "chRegion", visualType: "charts",
        position: { x: 24, y: 440, width: 600, height: 256, z: 1 },
        title: "Revenue by region",
        bindings: { Category: ["Sales.Region"], Values: ["Sales.Value AC"] },
        properties: { "chartType.chartType": 2 },
        visualContainerObjects: { "title.show": false },
      },
    ],
  }],
};

check("CROSS-CHECK: a fully generated report produces ZERO validator findings", () => {
  const r = w.writeReport(FULL_REPORT);
  const out = srv.validateReport({ projectPath: projectFrom(r.files) });
  assert.ok(out.ok, out.error);
  assert.deepStrictEqual(out.findings.map((f) => `${f.code} @ ${f.location}`), [],
    "the writers produced a report their own validator rejects");
  assert.ok(out.rulesRun > 20, `only ${out.rulesRun} rules ran, so the pass means little`);
});

// Without this, the pass above could be a pass because the rules cannot fire on a generated shape
// at all. The same visual with the same properties hand-written the wrong way MUST be caught.
check("the negative control: the same report written the wrong way IS caught", () => {
  const r = w.writeReport(FULL_REPORT);
  const files = { ...r.files };
  const rel = "definition/pages/Overview/visuals/chRegion/visual.json";
  const broken = JSON.parse(files[rel]);
  // A quoted numeric enum -- exactly what the escape hatch's number path prevents.
  broken.visual.objects.chartType[0].properties.chartType = { expr: { Literal: { Value: "'2'" } } };
  files[rel] = JSON.stringify(broken, null, 2);
  const out = srv.validateReport({ projectPath: projectFrom(files) });
  // The rule's id and its checker's key are deliberately different names in this repository, and
  // findings carry the id. Asserting on the checker key would silently never match.
  assert.ok(out.findings.some((f) => f.code === "numeric-enum-written-as-word"),
    "the validator did not catch a hand-broken file, so the clean run above proves nothing");
});

// --- the ROUND TRIP against real files -------------------------------------------------------------

/**
 * Semantic equality, ignoring key order and ignoring the never-emit groups — those are telemetry
 * the visual writes about itself and a generator that reproduced them would be reproducing a
 * licence key.
 */
function stripNeverEmit(file) {
  const out = JSON.parse(JSON.stringify(file));
  const objs = out.visual && out.visual.objects;
  if (objs) {
    for (const g of Object.keys(objs)) {
      if (g in w.NEVER_EMIT || g === "customData") delete objs[g];
    }
    if (!Object.keys(objs).length) delete out.visual.objects;
  }
  return out;
}
const sortDeep = (v) => Array.isArray(v) ? v.map(sortDeep)
  : (v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
      : v);
const sameSemantically = (a, b) =>
  JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));

/**
 * The dotted paths where two trees disagree. "DIFFERS" on its own is not a finding anybody can
 * act on; the path is what turns a pass rate into a list of things to fix or to declare.
 */
function diffPaths(a, b, p = "", out = []) {
  if (JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b))) return out;
  const plain = (x) => x && typeof x === "object" && !Array.isArray(x);
  if (plain(a) && plain(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], `${p}.${k}`, out);
    return out;
  }
  out.push(p);
  return out;
}

/** Every `expr` key in a derived spec would mean the spec is a copy of the file, not a decode. */
function countExprKeys(node) {
  if (Array.isArray(node)) return node.reduce((n, x) => n + countExprKeys(x), 0);
  if (!node || typeof node !== "object") return 0;
  let n = 0;
  for (const [k, v] of Object.entries(node)) { if (k === "expr") n++; n += countExprKeys(v); }
  return n;
}

function roundTrip(label, sources) {
  let pass = 0;
  const failures = [];
  const ratios = { Tables: [], Charts: [], Cards: [], other: [] };
  for (const { rel, text } of sources) {
    let original;
    try { original = JSON.parse(text.replace(/^﻿/, "")); } catch { continue; }
    let regenerated, spec;
    try {
      spec = w.deriveVisualSpec(original).spec;
      regenerated = JSON.parse(w.writeVisual(spec).content);
    } catch (err) {
      failures.push(`${rel}: REFUSED — ${String(err.message).split("\n")[0].slice(0, 80)}`);
      continue;
    }
    if (sameSemantically(stripNeverEmit(original), regenerated)) {
      pass++;
      const t = original.visual.visualType || "";
      const fam = /Tables/i.test(t) ? "Tables" : /Cards/i.test(t) ? "Cards"
        : (/Charts/i.test(t) || /waterfall/i.test(t)) ? "Charts" : "other";
      // How much of the spec is a verbatim passthrough rather than a decoded value. A round trip
      // that passes because the spec is a copy of the file measures nothing, and this is the
      // number that says which one happened.
      // Absent fields count zero, not the four bytes of "null" — three of those on a 400-byte
      // spec would read as a 3% passthrough that does not exist.
      const bytes = (x) => x === undefined ? 0 : Buffer.byteLength(JSON.stringify(x), "utf8");
      let rawBytes = bytes(spec.rawObjects) + bytes(spec.visualExtras) + bytes(spec.queryExtras);
      let rawProps = 0;
      for (const v of Object.values(spec.properties ?? {})) {
        if (v && typeof v === "object" && "__raw" in v) { rawProps++; rawBytes += bytes(v); }
      }
      ratios[fam].push({
        rel, rawBytes, rawProps,
        filterBytes: bytes(spec.filterConfig),
        spec: Buffer.byteLength(JSON.stringify(spec), "utf8"),
        emitted: Buffer.byteLength(w.writeVisual(spec).content, "utf8"),
        original: Buffer.byteLength(text, "utf8"),
      });
    } else {
      failures.push(`${rel}: DIFFERS at ${diffPaths(stripNeverEmit(original), regenerated)
        .join(", ") || "(unknown)"}`);
    }
  }
  return { label, n: sources.length, pass, failures, ratios };
}

/** The vendored manifest, which always runs. Its visual.json entries are real report files. */
function fixtureSources() {
  const m = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "sales-variance-dashboard.json"), "utf8"));
  return Object.entries(m.files)
    .filter(([p]) => p.endsWith("visual.json"))
    .map(([rel, text]) => ({ rel: rel.split("/").slice(-2).join("/"), text }));
}

/** A larger local corpus when one is configured or present. Read-only, never written to. */
function corpusSources() {
  const root = process.env.ZBI_VISUAL_CORPUS
    || path.join(os.homedir(), "Documents", "Claude_Code_PBI");
  if (!fs.existsSync(root)) return { root, sources: [] };
  const out = [];
  (function walk(d) {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const en of es) {
      const p = path.join(d, en.name);
      if (en.isDirectory()) walk(p);
      // Everything, not only the Zebra visuals. A real page carries slicers and textboxes, and a
      // pass rate measured only on the visuals the writer was designed around is a pass rate
      // measured on the easy half.
      else if (en.name === "visual.json") {
        out.push({ rel: p.split(path.sep).slice(-3).join("/"), text: fs.readFileSync(p, "utf8") });
      }
    }
  })(root);
  return { root, sources: out };
}

const fixture = roundTrip("vendored fixture", fixtureSources());
const corpus = corpusSources();
const external = corpus.sources.length ? roundTrip("local corpus", corpus.sources) : null;

// A sweep that reads nothing reports a beautiful hundred percent, so the count is the assertion.
check("ROUND TRIP: the vendored fixture actually supplied files to read", () => {
  assert.ok(fixture.n >= 5, `only ${fixture.n} fixture visuals were read`);
});

check("ROUND TRIP: every vendored fixture visual regenerates identically", () => {
  assert.deepStrictEqual(fixture.failures, [], `${fixture.pass}/${fixture.n} passed`);
});

// If the spec still carried pre-formed {expr:{Literal}} objects, regeneration would be a deep copy
// and the pass above would prove nothing about the emitter.
check("ROUND TRIP: a derived spec holds decoded values, never a pre-formed literal", () => {
  for (const { text } of fixtureSources()) {
    const { spec } = w.deriveVisualSpec(JSON.parse(text));
    assert.strictEqual(countExprKeys(spec.properties ?? {}), 0,
      `a derived spec carried an expr object, so the round trip is a deep copy: `
      + JSON.stringify(spec.properties));
  }
  const { spec } = w.deriveVisualSpec(JSON.parse(fixtureSources()[1].text));
  assert.strictEqual(spec.properties["titleSettings.text"], "Revenue by Product",
    "a quoted literal was not decoded back to a plain string");
});

/**
 * The share of a derived spec that is a verbatim passthrough — `rawObjects`, `__raw` values,
 * `visualExtras`, `queryExtras` — rather than a value the emitter had to re-encode.
 */
function verbatimShare(rt, families) {
  let raw = 0, total = 0;
  for (const fam of families) for (const r of rt.ratios[fam]) { raw += r.rawBytes; total += r.spec; }
  return total ? raw / total : 1;
}
const ZEBRA_FAMILIES = ["Tables", "Charts", "Cards"];

// The `expr` check above catches a passthrough that arrives through `properties`. It does not walk
// `rawObjects`, which is the other door — a derivation that routed whole groups through it would
// keep the round trip at 100% and prove nothing, which is exactly the deep-copy failure this pair
// of checks exists to make unreachable. Measured at 0.0% on the fixture and 0.4% across the
// corpus, so a 2% ceiling has real headroom and only fires on a routing regression.
check("ROUND TRIP: the fixture regenerates from decoded values, not a verbatim passthrough", () => {
  const share = verbatimShare(fixture, ZEBRA_FAMILIES);
  assert.ok(share < 0.02,
    `${(100 * share).toFixed(1)}% of the derived spec is passed through verbatim, so the round `
    + `trip is measuring a copy rather than the emitter`);
});

// And the control for the ceiling itself. A threshold nobody has seen fire is a threshold that
// might be measuring the wrong quantity: this reroutes one fixture visual's whole objects tree
// through rawObjects and confirms both that the spec still round-trips and that the share detects
// it. A passthrough is lossless, so correctness alone would never notice.
check("ROUND TRIP: rerouting a group through rawObjects IS detected by the share", () => {
  const original = JSON.parse(fixtureSources()[1].text);
  const { spec } = w.deriveVisualSpec(original);
  const rerouted = { name: spec.name, visualType: spec.visualType, position: spec.position,
    schemaVersion: spec.schemaVersion, bindings: spec.bindings,
    drillFilterOtherVisuals: spec.drillFilterOtherVisuals,
    rawObjects: JSON.parse(w.writeVisual(spec).content).visual.objects };
  assert.ok(sameSemantically(stripNeverEmit(original), JSON.parse(w.writeVisual(rerouted).content)),
    "the reroute changed the output, so it is not the lossless copy this control needs");
  const bytes = (x) => Buffer.byteLength(JSON.stringify(x), "utf8");
  const share = bytes(rerouted.rawObjects) / bytes(rerouted);
  assert.ok(share > 0.02,
    `a wholly rerouted spec measured only ${(100 * share).toFixed(1)}% verbatim, so the ceiling `
    + `is not measuring what it claims to`);
});

// The stronger version of the same worry, on real files. Conditional, so the fixture check above
// is the one that always runs: a load-bearing assertion that only fires when an optional corpus
// happens to be present is an assertion that silently stops running.
if (external) {
  check("ROUND TRIP: no Zebra property in the corpus takes the verbatim route", () => {
    let props = 0;
    for (const { text } of corpus.sources) {
      let f; try { f = JSON.parse(text.replace(/^﻿/, "")); } catch { continue; }
      if (!/^(ZebraBITables|ZebraBICharts|zebraBiCards|waterfall)/.test(f.visual?.visualType ?? "")) continue;
      props += Object.keys(w.deriveVisualSpec(f).spec.properties ?? {}).length;
    }
    const rawProps = ZEBRA_FAMILIES.reduce(
      (n, fam) => n + external.ratios[fam].reduce((m, r) => m + r.rawProps, 0), 0);
    assert.ok(props > 500, `only ${props} Zebra properties were derived, so this proves little`);
    assert.strictEqual(rawProps, 0, `${rawProps} of ${props} Zebra properties were passed through`);
    const share = verbatimShare(external, ZEBRA_FAMILIES);
    assert.ok(share < 0.02, `${(100 * share).toFixed(1)}% of Zebra spec bytes are verbatim`);
  });
}

// The negative control for the round trip itself. Mutate one derived spec and the comparison MUST
// fail; a comparison that always passes measures nothing.
check("ROUND TRIP: a mutated spec FAILS the comparison", () => {
  const src = fixtureSources()[1];
  const original = JSON.parse(src.text);
  const { spec } = w.deriveVisualSpec(original);
  spec.properties["titleSettings.text"] = "Something else entirely";
  assert.ok(!sameSemantically(stripNeverEmit(original), JSON.parse(w.writeVisual(spec).content)),
    "a changed title still compared equal, so the comparison proves nothing");
  const spec2 = w.deriveVisualSpec(original).spec;
  spec2.position.x = spec2.position.x + 1;
  assert.ok(!sameSemantically(stripNeverEmit(original), JSON.parse(w.writeVisual(spec2).content)),
    "a moved visual still compared equal");
});

if (external) {
  check("ROUND TRIP: the local corpus supplied files to read", () => {
    assert.ok(external.n >= 20, `only ${external.n} corpus visuals were read`);
  });
  // NOT asserted at 100%. The pass rate is a measurement, and pinning it would turn an honest
  // number into a number chosen to be green. It is printed below and the failures are named.
  check("ROUND TRIP: the local corpus pass rate is above half", () => {
    assert.ok(external.pass / external.n > 0.5,
      `${external.pass}/${external.n} — a majority of real files must regenerate`);
  });
}

// --- the measurement -------------------------------------------------------------------------------

function report(rt) {
  console.log(`\n  ROUND TRIP — ${rt.label}: ${rt.pass}/${rt.n} regenerate identically `
    + `(${(100 * rt.pass / rt.n).toFixed(1)}%)`);
  const byReason = new Map();
  for (const f of rt.failures) {
    const key = f.includes("REFUSED") ? `REFUSED — ${f.split("— ")[1]}` : f.split(": ")[1];
    byReason.set(key, (byReason.get(key) || 0) + 1);
  }
  for (const [k, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`      ${String(n).padStart(4)}  ${k}`);
  }
  console.log("      family    n   spec B  emitted B  original B   spec->emitted  spec->original"
    + "   verbatim  filterConfig");
  for (const [fam, list] of Object.entries(rt.ratios)) {
    if (!list.length) continue;
    const sum = (k) => list.reduce((a, x) => a + x[k], 0);
    const r = list.map((x) => x.emitted / x.spec).sort((a, b) => a - b);
    const ro = list.map((x) => x.original / x.spec).sort((a, b) => a - b);
    const span = (a) => `${a[0].toFixed(1)}-${a[a.length - 1].toFixed(1)}x`;
    const pct = (k) => `${(100 * sum(k) / sum("spec")).toFixed(1)}%`;
    console.log(`      ${fam.padEnd(8)} ${String(list.length).padStart(3)} `
      + `${String(sum("spec")).padStart(7)} ${String(sum("emitted")).padStart(10)} `
      + `${String(sum("original")).padStart(11)}   ${span(r).padStart(13)}  ${span(ro).padStart(14)}`
      + `   ${pct("rawBytes").padStart(8)}  ${pct("filterBytes").padStart(12)}`);
  }
}

// --- the protocol ---------------------------------------------------------------------------------
// A writer that works when called directly and a writer Claude Code can actually reach are
// different claims, and the schema is the documentation, so it has to survive the wire.

function rpc(messages) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, "server.js")]);
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", reject);
    p.on("close", () => resolve(out.trim().split("\n").filter(Boolean).map(JSON.parse)));
    for (const m of messages) p.stdin.write(JSON.stringify(m) + "\n");
    p.stdin.end();
    setTimeout(() => p.kill(), 8000);
  });
}

(async () => {
  const replies = await rpc([
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "write_report",
      arguments: FULL_REPORT } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "write_visual",
      arguments: { name: "V", visualType: "tables", position: { x: 0, y: 0, width: 1, height: 1 },
                   properties: { "licenseSettings.licenseKey": "secret" } } } },
  ]);

  check("PROTOCOL: the three writers are advertised with drivable schemas", () => {
    const tools = replies.find((x) => x.id === 1).result.tools;
    for (const n of ["write_visual", "write_page", "write_report"]) {
      const t = tools.find((x) => x.name === n);
      assert.ok(t, `${n} is not advertised`);
      assert.ok(t.description.length > 40, `${n} has a thin description`);
      assert.ok(t.inputSchema.required.length, `${n} declares nothing required`);
    }
    // The literal-form contract is the one thing a caller cannot guess, so it must be IN the
    // schema rather than in prose that never reaches the model.
    const wv = tools.find((x) => x.name === "write_visual");
    assert.ok(/3D/.test(wv.inputSchema.properties.properties.description),
      "the schema does not document the numeric literal form");
    assert.ok(/__literal/.test(wv.inputSchema.properties.properties.description));
  });

  check("PROTOCOL: write_report answers with the whole tree over stdio", () => {
    const p = JSON.parse(replies.find((x) => x.id === 2).result.content[0].text);
    assert.ok(p.files["definition/pages/pages.json"], "no pages.json");
    assert.ok(p.files["definition/pages/Overview/visuals/tblPL/visual.json"], "no visual");
    assert.ok(p.notWritten.some((s) => /baseTheme/.test(s)));
  });

  check("PROTOCOL: a refused write comes back as an answer, not a dead connection", () => {
    const r = replies.find((x) => x.id === 3);
    assert.strictEqual(r.result.isError, true);
    assert.ok(/credential/.test(JSON.parse(r.result.content[0].text).error));
  });

  for (const [s, n, d] of results) console.log(`  ${s}  ${n}${d ? "  <- " + d : ""}`);
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  report(fixture);
  if (external) report(external);
  else console.log(`\n  (no local corpus at ${corpus.root} — set ZBI_VISUAL_CORPUS to add one)`);
  process.exit(failed ? 1 : 0);
})();
