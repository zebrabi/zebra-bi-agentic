// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";
/**
 * Whole-file writers.
 *
 * The encoders next door produce blob FRAGMENTS. An agent still hand-emits the file around them,
 * and that file is the cost: on a real 3-page/20-visual report, 65,897 bytes over 24 files, which
 * is 16,500-18,800 output tokens spread across 20-odd sequential calls. Output tokens dominate
 * session wall-clock, so the file body — not the blobs — is where the time goes.
 *
 * These write the whole thing from a spec. Four measurements from a 709-file corpus analysis
 * shaped the design, and each one killed an approach that looks obvious from the outside:
 *
 *   Only 41.6% of authorable bytes are mechanically derivable, so a generator cannot default its
 *   way to a correct file. "visualType + bindings + position + title + ten flags" reproduces 3.8%
 *   of real files; roughly 200 distinct property paths are needed for 90%. So `properties` is a
 *   general dotted-path escape hatch, present from the first line rather than bolted on, and it is
 *   the ONLY way most of the tail is reachable. There is no whitelist to go stale.
 *
 *   Two blobs carry 65.8% of all author-chosen bytes — `chartSettings.columnSettings` at 45.0% and
 *   `annotationLayerSettings.annotationComments` at 20.8%. Both are delegated to the existing
 *   encoders, never re-implemented, because those encoders are where the nineteen documented
 *   landmines are made unreachable.
 *
 *   No property group is present in >=90% of the files of any one visualType — measured again here
 *   at 270 Zebra visuals, where the most common group, `titleSettings`, sits at 83.7%. A group the
 *   caller did not ask for is therefore NOT emitted. There is no "sensible default" layer, because
 *   the corpus says there is no sensible default.
 *
 *   24.7% of stored bytes are telemetry the visual writes about ITSELF — licence key, version,
 *   migration log, preview flags. None of it is design and one of them is a credential. Those
 *   groups are refused, actively, because a general escape hatch makes them reachable by name.
 *
 * Compression is real but bounded, and the spread matters more than the headline. Measured over
 * 589 real `visual.json` files: 1.5-8.0x per visual, and 2.7-5.3x per whole report against what is
 * on disk. A hand-authored three-visual page routing its blobs through the encoders came out at
 * 5.5x; a visual whose bytes are mostly an opaque `filterConfig` sits near the bottom of that
 * range. The tools return `specBytes` beside `bytes` so a caller can see which one they got rather
 * than take a flattering average on trust.
 *
 * And it is a conversion, not a disappearance: a report returned as a path-to-content map turns
 * output tokens into input tokens. That is still most of the wall-clock win, because output tokens
 * are the expensive term, but the bytes do not vanish.
 *
 * Nothing here writes to disk. `validate_report` only reads, and a tool that silently writes into
 * a customer's project would be a different and much larger promise.
 */

const enc = require("./encoders.js");
const { EncodeError } = enc;
const need = (cond, msg) => { if (!cond) throw new EncodeError(msg); };

// --- schema versions -------------------------------------------------------------------------
// Defaults are the most recent form observed in the local corpus, not a guess, and every one is
// overridable — a project opened by an older Desktop may need an older schema. Counts are from
// 270 Zebra visuals / 113 page.json / 51 pages.json.

const SCHEMA = {
  // visualContainer: 2.11.0 x248, 2.10.0 x11, 2.8.0 x33.
  visual: (v) => `https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/${v}/schema.json`,
  // page: 2.1.0 x78, 2.2.0 x33, 2.0.0 x1, 1.0.0 x1. A page schema below 2.x cannot express a
  // top-level "type": "Tooltip" at all, which is why the default is not the oldest.
  page: (v) => `https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/${v}/schema.json`,
  // pagesMetadata: 1.1.0 x51, unanimous.
  pages: (v) => `https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/${v}/schema.json`,
  // versionMetadata: 1.0.0, unanimous across the corpus.
  version: (v) => `https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/${v}/schema.json`,
};
const DEFAULT_VISUAL_SCHEMA = "2.11.0";
const DEFAULT_PAGE_SCHEMA = "2.1.0";
// definition/version.json is REQUIRED: without it Desktop refuses the project outright, opens an
// empty report called "Untitled" and shows an "Issues were found" dialog reading *Cannot find file
// 'version.json'*. Two fields of boilerplate, so the writer owns it rather than leaving it to a
// caller who has no way to know. `"2.0.0"` is the report-definition version, not the schema's.
const DEFAULT_DEFINITION_VERSION = "2.0.0";
const DEFAULT_PAGES_SCHEMA = "1.1.0";

// --- the product GUIDs -----------------------------------------------------------------------
// Three universes, and joining them on visualType returns near-zero overlap by design. The
// installed set is what to author with; the file-imported set appears inside shipped templates and
// AppSource-era reports and must be writable so an existing report can be edited without migrating
// its visuals as a side effect. Aliases resolve to the installed set.

const INSTALLED = {
  "tables+": "ZebraBITablesPlus3E6085701D7B426980C3859B16327993",
  "charts+": "ZebraBIChartsPlusC3F2FD9F79054F76BD1B722E7666AC33",
  cards: "zebraBiCards2C860CFAA9944091B75F0DBD117F20FA",
  tables: "ZebraBITablesBAE31B370F254F808553548EFB35BFA5",
  charts: "waterfall6C9ED82ABD1F44C4A0D590CE01EB5EE7",
};
const FILE_IMPORTED = {
  "charts-appsource": "waterfall0221D8FBE40445C1A4E598AA8EF8B506",
  "tables-appsource": "ZebraBITables98F88148E5424E949E69864664EE1860",
  "cards-appsource": "zebraBiCards8085D508EB994C8081CA47C85ABD7C26",
};
const VISUAL_ALIASES = { ...INSTALLED, ...FILE_IMPORTED };
// Prefixes, not GUIDs, because the GUID carries a version suffix. Charts+ deliberately does NOT
// share the certified Charts prefix: certified Charts is `waterfall…` for historical reasons, so
// anything matching Zebra charts by "waterfall" misses every Charts+ visual in silence.
const ZEBRA_PREFIXES = ["ZebraBITables", "ZebraBICharts", "waterfall", "zebraBiCards"];
const isZebraType = (t = "") => ZEBRA_PREFIXES.some((p) => t.startsWith(p));

// --- what must never be written ---------------------------------------------------------------
/**
 * Telemetry the visual writes about itself, not design. 24.7% of stored bytes across the corpus,
 * and `licenseSettings.licenseKey` is a credential: a report carrying one cannot be shared outside
 * the company or committed to a public repository.
 *
 * This is an active refusal rather than a quiet omission, and the difference matters. A generator
 * with no escape hatch could simply never emit them. This one takes arbitrary dotted paths, so
 * "we don't emit that" is only true until a caller types the name. The check is on the path, not
 * on the value, so it cannot be defeated by a key that happens to look like something else.
 */
const NEVER_EMIT = {
  licenseSettings: "a Zebra licence key, which is a credential — the machine resolves the licence, "
    + "the report does not carry it",
  license: "licence state the visual writes about itself",
  version: "the visual's own build number, which it rewrites on every render",
  visualCreatedVersion: "the build number the visual was created under",
  migrationLog: "the visual's internal migration bookkeeping",
  previewSettings: "preview-feature activation state the visual manages itself",
};
// `customData` is the Cards telemetry blob, and Desktop rewrites it wholesale. It is reachable
// through one deliberate, vetted route — `cardInvert`, which is step two of encoders.js's
// plan_card_invert and needs ids only Desktop can mint — and nowhere else. Handing it to the
// generic escape hatch would mean hand-writing the blob, which is exactly what that two-step
// procedure exists to stop.
const CARD_DATA_GROUP = "customData";

function assertEmittable(group, prop, where) {
  // `group in NEVER_EMIT` also matched Object.prototype, so a group called `toString`,
  // `constructor` or `__proto__` was refused with "toString is function toString() { [native
  // code] }". It failed CLOSED, so nothing slipped through and there was no pollution; the
  // message was just nonsense on a legitimate-looking name. Corrected 2026-08-31.
  // And refused explicitly, rather than left to fail downstream with a TypeError once the name is
  // used as a plain object key. No visual has a property group called `toString`.
  need(!(group in {}),
    `'${group}' cannot be used as a property group: the name collides with a built-in object `
    + `member, so it cannot be used as a key. Check the group name in the spec.`);
  need(!Object.prototype.hasOwnProperty.call(NEVER_EMIT, group),
    `'${group}.${prop}' cannot be written${where ? ` (${where})` : ""}: ${group} is ${NEVER_EMIT[group]}. `
    + `It is not design, it is the visual's own bookkeeping, and Power BI Desktop rewrites it on `
    + `the next render. Remove it from the spec.`);
  // `where` is the route, and it is the whole check here: `cardInvert` is the one caller allowed
  // to reach customData, because it goes through the vetted two-step encoder rather than
  // hand-writing a blob keyed on ids only Desktop can mint.
  need(group !== CARD_DATA_GROUP || where === "cardInvert",
    `'${group}.${prop}' cannot be written through 'properties'. Cards ids are minted by Power BI `
    + `Desktop and cannot be computed, so per-card settings go through the 'cardInvert' field, `
    + `which routes to the same two-step encoder (plan_card_invert, then encode_card_invert).`);
  need(!/^licen[cs]eKey$/i.test(prop),
    `'${group}.${prop}' looks like a licence key under a different group name. Refused: a licence `
    + `key in a report file is a credential leak, and the licence resolves per machine anyway.`);
}

// --- PBIR literals ----------------------------------------------------------------------------
/**
 * The escape hatch has to be typed, and the type has to come from the VALUE rather than from a
 * lookup table of property names. A name table would go stale the moment Zebra ships a property,
 * and getting it wrong on a numeric enum produces precisely the defect the validator's
 * `numeric-enum-must-not-be-quoted` rule exists to catch: `'3'` is not a declared value, so it is
 * dropped in silence and the visual keeps its default. A tester set `'2'` on two charts and got
 * the default waterfall on both.
 *
 *   3        -> 3D        a number is D-suffixed, never quoted
 *   true     -> true      a bare token
 *   "hi"     -> 'hi'      a quoted string
 *   {__literal:"1L"}      written raw, for the L-suffix and anything not covered above
 *   {__solid:"#1A1A2E"}   the nested colour wrapper, e.g. titleSettings.fontColor
 *   {__json:{...}}        serialised to JSON, then quoted — a blob no encoder covers yet
 *   {__raw:{...}}         the whole value verbatim, for a property that is not a PBIR literal at
 *                         all: a textbox's `general.paragraphs` is a structured array of text runs
 */
function pbirLiteral(value, where) {
  need(value !== null && value !== undefined,
    `${where} has no value. Omit the property rather than writing null: an absent property and a `
    + `null one are different things to the visual, and several Zebra properties read undefined `
    + `where they expect an empty string and render the cells solid black.`);

  if (typeof value === "boolean") return { expr: { Literal: { Value: value ? "true" : "false" } } };

  if (typeof value === "number") {
    need(Number.isFinite(value), `${where} is ${value}, which has no literal form.`);
    // Decimals take the same suffix -- the corpus carries -103.375D alongside 4D.
    return { expr: { Literal: { Value: `${value}D` } } };
  }

  if (typeof value === "string") return { expr: { Literal: { Value: `'${noApostrophe(value, where)}'` } } };

  if (typeof value === "object") {
    if (typeof value.__literal === "string") {
      // Raw. The caller is asserting they know the form -- 1L, a D-suffixed timestamp, an
      // identifier. Nothing is added and nothing is escaped.
      return { expr: { Literal: { Value: value.__literal } } };
    }
    if (typeof value.__solid === "string") {
      return { solid: { color: { expr: { Literal: { Value: `'${noApostrophe(value.__solid, where)}'` } } } } };
    }
    if ("__json" in value) {
      return { expr: { Literal: { Value: `'${noApostrophe(JSON.stringify(value.__json), where)}'` } } };
    }
    if ("__raw" in value) {
      // Not every property value is a literal. A textbox carries `general.paragraphs` as a
      // structured array of text runs, and there are more shapes than a writer can enumerate, so
      // this is the general way out rather than a growing list of special cases.
      return value.__raw;
    }
  }

  need(false, `${where} is a ${Array.isArray(value) ? "array" : typeof value} with no literal `
    + `form. Use a number, a boolean, a string, {__literal}, {__solid}, {__json} or {__raw}.`);
}

/**
 * Refused rather than escaped, and this is a deliberate gap.
 *
 * A PBIR string literal is wrapped in single quotes. Across 511 local report files there is not
 * one literal containing an apostrophe, in either the raw or the doubled form, so there is no
 * evidence for how the format escapes one. Emitting `'doesn''t'` and emitting `'doesn't'` are both
 * plausible and one of them corrupts the file silently. Guessing is the house failure mode, so the
 * call is refused and the caller is told the two ways round it.
 */
function noApostrophe(s, where) {
  need(!s.includes("'"),
    `${where} contains an apostrophe, and how a PBIR literal escapes one is not established — `
    + `no file in the reference corpus contains a literal with one, raw or doubled. Emitting a `
    + `guess would corrupt the property in silence. Use the typographic apostrophe U+2019 (’), `
    + `which is better in a report title anyway, or pass {__literal: "'...'"} if you have `
    + `verified the escaping against a render.`);
  return s;
}

/** `visual.objects.<group>` is a list of one entry holding a properties map. */
function setObjectProperty(objects, dotted, value, seen, warnings, where) {
  const i = dotted.indexOf(".");
  need(i > 0 && i < dotted.length - 1,
    `property path '${dotted}' must be 'group.property', e.g. 'chartSettings.chartType'. `
    + `Every Zebra property lives under exactly one object group.`);
  const group = dotted.slice(0, i);
  const prop = dotted.slice(i + 1);
  assertEmittable(group, prop, where);

  if (seen.has(dotted)) {
    warnings.push(`'${dotted}' was set twice — by ${seen.get(dotted)} and then by ${where}. The `
      + `later write wins. If that is not what you meant, one of the two is redundant.`);
  }
  seen.set(dotted, where);

  if (!objects[group]) objects[group] = [{ properties: {} }];
  objects[group][0].properties[prop] = value;
}

// --- bindings ---------------------------------------------------------------------------------
/**
 * A projection is ~180 bytes of nesting that carries three facts: an entity, a property, and
 * whether it is a column or a measure. The third is fully determined by the role in the corpus —
 * Category 280/280 Column, Group 91/91 Column, and Values 335/335, Plan 158/158, PreviousYear
 * 120/120, Forecast 65/65, Filters 65/65 all Measure — so it is defaulted from the role and
 * overridable per projection, because a default measured at 100% is still a default.
 */
const ROLE_FIELD_KIND = { Category: "Column", Group: "Column" };

/**
 * Split "Entity.Property" on the LAST dot, not the first. An entity can begin with one: the
 * measures table in a DirectQuery model is commonly called `.Measures`, so ".Measures.AC" is
 * entity ".Measures" and property "AC". First-dot splitting silently produces entity "" and
 * property "Measures.AC", which resolves to nothing and renders an empty visual.
 */
function splitRef(ref) {
  need(typeof ref === "string" && ref.length, "a binding must be a string or an object");
  const i = ref.lastIndexOf(".");
  need(i > 0 && i < ref.length - 1,
    `binding '${ref}' must be 'Entity.Property', e.g. 'financials.Sales AC'. If the property name `
    + `itself contains a dot, use the object form {entity, property} instead.`);
  return { entity: ref.slice(0, i), property: ref.slice(i + 1) };
}

function projectionFor(role, binding) {
  const b = typeof binding === "string" ? splitRef(binding) : { ...(binding || {}) };
  need(b.entity && b.property,
    `every ${role} binding needs an entity and a property, either as 'Entity.Property' or as `
    + `{entity, property}`);
  const kind = b.kind || ROLE_FIELD_KIND[role] || "Measure";
  need(kind === "Column" || kind === "Measure",
    `binding kind must be 'Column' or 'Measure', not '${kind}'`);

  const out = {
    field: { [kind]: { Expression: { SourceRef: { Entity: b.entity } } , Property: b.property } },
    queryRef: b.queryRef ?? `${b.entity}.${b.property}`,
    nativeQueryRef: b.nativeQueryRef ?? b.property,
  };
  // Both optional and neither defaulted. `active` marks the drill level a hierarchy opens on and
  // 103 of 280 Category projections carry none at all; `displayName` renames a column in the
  // visual. Inventing either would put a decision in the file the author never made.
  if (b.displayName !== undefined) out.displayName = b.displayName;
  if (b.active !== undefined) out.active = b.active;
  return out;
}

// --- the encoder routes -----------------------------------------------------------------------
/**
 * Every blob is built by the encoder that owns it. Nothing here re-derives a blob shape: the
 * encoders are where `filterContexts` is made mandatory (an absent KEY blanks the entire visual),
 * where a computed row is kept out of the grand total, and where `showAsTable` gets the integer
 * enum rather than the boolean of the same name one level up.
 *
 * Their `companion` strings are surfaced, never satisfied. "commentBoxSettings.show must be true"
 * is a property group the caller did not ask for, and emitting it would break the rule that no
 * group is written unattended. Refusing would be worse still — it would be a false positive on an
 * author who sets it two lines later.
 */
function applyEncoders(spec, objects, seen, warnings, companions) {
  const put = (r, where) => {
    if (!r || !r.property) return;
    setObjectProperty(objects, r.property, r.literal, seen, warnings, where);
    if (r.companion) companions.push(`${where}: ${r.companion}`);
    if (Array.isArray(r.warnings)) warnings.push(...r.warnings.map((w) => `${where}: ${w}`));
    if (r.also) put(r.also, where);
  };

  let legalColumnKeys;
  if (spec.tableCalculations) {
    const r = enc.encodeTableCalculations(spec.tableCalculations);
    legalColumnKeys = r.legalColumnKeys;
    put(r, "tableCalculations");
  }
  if (spec.tableColumns) {
    // The calculations decide which column keys are legal, so when both are in one spec the key
    // set is handed over automatically. Two separate tool calls could not do that for the caller.
    put(enc.encodeTableColumns({ legalKeys: legalColumnKeys, ...spec.tableColumns }), "tableColumns");
  }
  if (spec.addedFormulas) put(enc.encodeAddedFormulas(spec.addedFormulas), "addedFormulas");
  // Highlights go BEFORE annotations so a comment can hang on one by the caller's own key: the
  // encoder mints the uuid, and a spec written in one piece has no other way to learn it. A
  // `highlightId` that matches a highlight's `id` in this spec is swapped for the uuid; anything
  // else is passed through as the uuid the caller already holds.
  let highlightIds = {};
  if (spec.highlights) {
    const r = enc.encodeHighlights(spec.highlights);
    put(r, "highlights");
    highlightIds = r.ids ?? {};
    companions.push(`highlights: ids ${JSON.stringify(highlightIds)} -- pass one as highlightId to `
      + `a comment to hang it on the shape.`);
  }
  if (spec.annotations) {
    const a = spec.annotations;
    const comments = Array.isArray(a.comments)
      ? a.comments.map((c) => (c && typeof c.highlightId === "string" && highlightIds[c.highlightId]
        ? { ...c, highlightId: highlightIds[c.highlightId] } : c))
      : a.comments;
    const r = enc.encodeAnnotations({ ...a, comments });
    put(r, "annotations");
    if (r.expectedBubbleCount) {
      companions.push(`annotations: expect exactly ${r.expectedBubbleCount} comment bubble(s) in `
        + `the render. A lower number means a comment was dropped for a filter context that does `
        + `not match the live state.`);
    }
  }
  if (spec.cagrArrows) put(enc.encodeCagrArrows(spec.cagrArrows), "cagrArrows");
  if (spec.storageConfig) put(enc.encodeStorageConfig(spec.storageConfig), "storageConfig");
  if (spec.categoryScenarios) {
    put(enc.encodeCategoryScenarios(spec.categoryScenarios), "categoryScenarios");
  }
  if (spec.cardInvert) put(enc.encodeCardInvert(spec.cardInvert), "cardInvert");
  for (const l of spec.dataValueLists ?? []) {
    put(enc.encodeDataValueList(l), `dataValueLists[${l && l.target}]`);
  }
}

// --- serialisation ----------------------------------------------------------------------------
/**
 * Two-space pretty print, LF, no BOM, no trailing newline — which is what Power BI Desktop writes.
 * Matching it means a later Desktop save produces a diff of the properties that actually changed
 * rather than a whole-file reformat. JSON.stringify never emits a CR, so LF needs no enforcement,
 * only a test that says so.
 */
function serialise(obj) {
  return JSON.stringify(obj, null, 2);
}

/**
 * An encoder splices its literal in pre-formed, so the apostrophe refusal above never sees it. A
 * comment whose text contains one, or a category value that does, therefore reaches the file. That
 * is existing encoder behaviour and not something a writer may silently change, so it is reported
 * instead of altered — the same class of unknown, surfaced rather than guessed at.
 */
function warnOnEncoderApostrophes(content, warnings) {
  const re = /"Value"\s*:\s*"'((?:[^"\\]|\\.)*)'"/g;
  let m, hits = 0;
  while ((m = re.exec(content))) if (m[1].includes("'")) hits++;
  if (hits) {
    warnings.push(`${hits} emitted literal(s) contain an apostrophe inside the single-quoted PBIR `
      + `wrapper, from encoded blob content such as comment text or a category value. How the `
      + `format escapes one is not established, and no file in the reference corpus contains one. `
      + `Render the page and confirm the visual is not blank before shipping it.`);
  }
}

// --- write_visual -----------------------------------------------------------------------------

/**
 * An unknown spec key is refused rather than ignored. A misspelled `properites` would otherwise
 * produce a file that is valid, renders, and is missing everything the caller asked for — the
 * silent no-op this whole module exists to make unreachable.
 */
const VISUAL_KEYS = new Set(["name", "visualType", "position", "bindings", "title", "properties",
  "rawObjects", "tableCalculations", "tableColumns", "addedFormulas", "annotations", "cardInvert",
  "highlights", "cagrArrows", "storageConfig", "categoryScenarios",
  "dataValueLists", "visualContainerObjects", "filterConfig", "queryExtras", "visualExtras",
  "drillFilterOtherVisuals", "schemaVersion"]);
const PAGE_KEYS = new Set(["name", "displayName", "width", "height", "displayOption", "type",
  "visibility", "pageBinding", "visualInteractions", "properties", "filterConfig", "schemaVersion",
  "visuals"]);
const REPORT_KEYS = new Set(["pages", "activePageName", "pagesSchemaVersion", "definitionVersion"]);

function assertKnownKeys(spec, allowed, what) {
  const unknown = Object.keys(spec).filter((k) => !allowed.has(k) && spec[k] !== undefined);
  need(!unknown.length,
    `unknown ${what} field(s): ${unknown.join(", ")}. A field this writer does not read would be `
    + `silently dropped, producing a file that renders and is missing what you asked for. Known `
    + `fields: ${[...allowed].join(", ")}.`);
}

function writeVisual(spec = {}) {
  need(spec && typeof spec === "object", "a visual spec is required");
  assertKnownKeys(spec, VISUAL_KEYS, "visual spec");
  need(typeof spec.name === "string" && /^[A-Za-z0-9_-]+$/.test(spec.name),
    "name is required and becomes the visuals/<name>/ directory, so it must be a plain "
    + "identifier: letters, digits, underscore and hyphen only");
  need(spec.visualType, "visualType is required: a GUID, or an alias such as 'tables+', "
    + `'charts+', 'cards', 'tables', 'charts'. Known aliases: ${Object.keys(VISUAL_ALIASES).join(", ")}`);

  const warnings = [];
  const companions = [];
  const visualType = VISUAL_ALIASES[String(spec.visualType).toLowerCase()] ?? spec.visualType;
  if (!isZebraType(visualType)) {
    // Not refused. A Zebra page normally carries slicers and textboxes, and a page generator that
    // cannot emit one is a page generator nobody can finish a page with. But the encoder routes
    // and every landmine they close are Zebra-specific, so the caller is told which half applies.
    warnings.push(`'${visualType}' is not a Zebra visual type. The file is written as asked, but `
      + `nothing Zebra-specific applies to it: the encoder routes (tableColumns, annotations, `
      + `cardInvert and so on) build Zebra blobs and would be meaningless here.`);
  }

  const pos = spec.position || {};
  for (const k of ["x", "y", "width", "height"]) {
    need(typeof pos[k] === "number", `position.${k} is required and must be a number`);
  }
  // Two separate inputs, and tabOrder is NOT derived from z. z is paint order; tabOrder is
  // keyboard and screen-reader order; the two are identical in only 58.8% of real files, so
  // deriving either from the other would be wrong four times in ten while looking authoritative.
  // z defaults to 0 because a visual has to have one; tabOrder is simply omitted when unasked,
  // which is what a file that never set it looks like.
  const position = {
    x: pos.x, y: pos.y, z: typeof pos.z === "number" ? pos.z : 0,
    height: pos.height, width: pos.width,
  };
  if (typeof pos.tabOrder === "number") position.tabOrder = pos.tabOrder;

  const objects = {};
  const seen = new Map();

  applyEncoders(spec, objects, seen, warnings, companions);

  // Sugar, applied after the encoders and before the escape hatch. `title` is the one property
  // present on 83.7% of visuals, which is still not enough to default -- so it is written only
  // when asked for, and omitted entirely otherwise.
  if (spec.title !== undefined) {
    const t = typeof spec.title === "string" ? { text: spec.title } : spec.title;
    need(t && typeof t.text === "string", "title must be a string, or {text, show?}");
    setObjectProperty(objects, "titleSettings.text", pbirLiteral(t.text, "title.text"),
      seen, warnings, "title");
    if (t.show !== undefined) {
      setObjectProperty(objects, "titleSettings.show", pbirLiteral(t.show, "title.show"),
        seen, warnings, "title");
    }
  }

  // The escape hatch. Roughly 200 distinct property paths are needed to reproduce 90% of real
  // files, so this is the main road rather than a side door -- and it is applied last so that an
  // explicit path can override an encoder, with a warning saying it did.
  for (const [dotted, value] of Object.entries(spec.properties ?? {})) {
    setObjectProperty(objects, dotted, pbirLiteral(value, `properties['${dotted}']`),
      seen, warnings, "properties");
  }

  // Groups this writer has no model for: more than one entry, a `selector` beside the properties,
  // any shape a future Power BI schema introduces. Passed through verbatim -- but still checked
  // against the never-emit set, because a passthrough that skipped that check would be the one
  // door left open to a licence key.
  for (const [group, entries] of Object.entries(spec.rawObjects ?? {})) {
    assertEmittable(group, "*", "rawObjects");
    need(!objects[group],
      `rawObjects.${group} collides with a group already built from properties or an encoder. `
      + `Write the group once, one way.`);
    objects[group] = entries;
  }

  let query;
  // Emitted only when there is something to put in it. A textbox has no `query` key at all, and
  // writing an empty one would add a key to 95 of the corpus's non-Zebra visuals. Every Zebra
  // visual in the corpus has bindings, so this never removes one.
  if (spec.bindings !== undefined || spec.queryExtras !== undefined) {
    query = { queryState: {} };
    for (const [role, list] of Object.entries(spec.bindings ?? {})) {
      need(Array.isArray(list) && list.length,
        `bindings.${role} must be a non-empty array. Omit the role rather than binding nothing to it.`);
      query.queryState[role] = { projections: list.map((b) => projectionFor(role, b)) };
    }
    // Siblings of queryState -- `sortDefinition`, which is how a visual's sort is authored, and
    // `isDrillDisabled`. A passthrough rather than a modelled field: both are plain Power BI
    // structures with no Zebra semantics for this writer to add, and a name list would go stale.
    for (const [k, v] of Object.entries(spec.queryExtras ?? {})) {
      need(k !== "queryState", "queryExtras.queryState would overwrite the bindings. Use `bindings`.");
      query[k] = v;
    }
  }
  if (isZebraType(visualType) && !Object.keys(query?.queryState ?? {}).length) {
    warnings.push("This Zebra visual has no bindings, so it will render as an empty placeholder.");
  }

  // Key order follows what Desktop writes, so a later save diffs cleanly.
  const visual = { visualType };
  if (query) visual.query = query;
  if (Object.keys(objects).length) visual.objects = objects;
  // Emitted only when asked for. 248 of 270 corpus visuals carry it and 22 do not, so writing it
  // unasked would be inventing an answer for the 8% -- the same rule that keeps property groups
  // out of a file nobody asked for one in.
  if (spec.drillFilterOtherVisuals !== undefined) {
    visual.drillFilterOtherVisuals = spec.drillFilterOtherVisuals;
  }

  if (spec.visualContainerObjects) {
    // Container-level chrome: the Power BI title bar and the canvas-tooltip binding, both of which
    // sit outside the Zebra property space. 94 of 96 occurrences are {title:[{show:false}]} --
    // turning the host title off because the Zebra title is inside the visual.
    visual.visualContainerObjects = buildContainerObjects(spec.visualContainerObjects, warnings);
  }
  // Anything else that belongs on `visual` and has no field of its own -- `expansionStates` is the
  // one such key in the corpus, on a single file. A general passthrough rather than a name list,
  // for the same reason `properties` is general.
  for (const [k, v] of Object.entries(spec.visualExtras ?? {})) {
    need(!["visualType", "query", "objects", "drillFilterOtherVisuals", "visualContainerObjects"].includes(k),
      `visualExtras.${k} would overwrite something the spec already owns. Use the dedicated field.`);
    visual[k] = v;
  }

  const file = {
    $schema: SCHEMA.visual(spec.schemaVersion ?? DEFAULT_VISUAL_SCHEMA),
    name: spec.name,
    position,
    visual,
  };
  if (spec.filterConfig !== undefined) {
    // Opaque, deliberately. A filter's `name` is a twenty-hex-digit id with no derivation rule, so
    // modelling this would mean inventing ids that have to match nothing. It is passed through
    // verbatim, and it is the one part of a visual this generator does not compress at all.
    file.filterConfig = spec.filterConfig;
  }

  const content = serialise(file);
  warnOnEncoderApostrophes(content, warnings);
  return {
    path: `visuals/${spec.name}/visual.json`,
    content,
    bytes: Buffer.byteLength(content, "utf8"),
    specBytes: Buffer.byteLength(JSON.stringify(spec), "utf8"),
    ...(warnings.length ? { warnings } : {}),
    ...(companions.length ? { companions } : {}),
  };
}

function buildContainerObjects(src, warnings) {
  const out = {};
  const seen = new Map();
  for (const [dotted, value] of Object.entries(src)) {
    setObjectProperty(out, dotted, pbirLiteral(value, `visualContainerObjects['${dotted}']`),
      seen, warnings, "visualContainerObjects");
  }
  return out;
}

// --- write_page -------------------------------------------------------------------------------

/**
 * Paths come back relative to the `.Report` directory — `definition/pages/<name>/page.json` — so a
 * page written on its own and a page written as part of a report land in the same place, and a
 * caller prefixes once rather than reasoning about two different roots.
 */
function writePage(spec = {}) {
  need(spec && typeof spec === "object", "a page spec is required");
  assertKnownKeys(spec, PAGE_KEYS, "page spec");
  need(typeof spec.name === "string" && /^[A-Za-z0-9_-]+$/.test(spec.name),
    "name is required and becomes the pages/<name>/ directory, so it must be a plain identifier. "
    + "It is not what the user sees — that is displayName.");
  need(typeof spec.displayName === "string" && spec.displayName.length,
    "displayName is required: it is the tab label, and every page.json in the corpus has one");

  const warnings = [];
  const companions = [];
  const files = {};
  const dir = `definition/pages/${spec.name}`;

  const page = {
    $schema: SCHEMA.page(spec.schemaVersion ?? DEFAULT_PAGE_SCHEMA),
    name: spec.name,
    displayName: spec.displayName,
    displayOption: spec.displayOption ?? "FitToPage",
    height: typeof spec.height === "number" ? spec.height : 720,
    width: typeof spec.width === "number" ? spec.width : 1280,
  };
  if (spec.type !== undefined) {
    // A tooltip page needs BOTH a top-level "type" and a page schema that can express it. The
    // combination is what a validator rule checks, so getting one without the other is a caught
    // fault rather than a silent one -- but it is cheaper to refuse it here.
    need(Number(String(spec.schemaVersion ?? DEFAULT_PAGE_SCHEMA).split(".")[0]) >= 2,
      `type: "${spec.type}" needs page schema 2.0.0 or later; a 1.x page schema cannot express a `
      + `top-level type at all, so the page silently stops being a tooltip page.`);
    page.type = spec.type;
  }
  if (spec.visibility !== undefined) page.visibility = spec.visibility;
  if (spec.pageBinding !== undefined) page.pageBinding = spec.pageBinding;
  if (spec.visualInteractions !== undefined) page.visualInteractions = spec.visualInteractions;
  if (spec.properties && Object.keys(spec.properties).length) {
    const objects = {};
    const seen = new Map();
    for (const [dotted, value] of Object.entries(spec.properties)) {
      setObjectProperty(objects, dotted, pbirLiteral(value, `page properties['${dotted}']`),
        seen, warnings, "page properties");
    }
    page.objects = objects;
  }
  if (spec.filterConfig !== undefined) page.filterConfig = spec.filterConfig;

  files[`${dir}/page.json`] = serialise(page);

  const names = new Set();
  for (const v of spec.visuals ?? []) {
    need(!names.has(v && v.name),
      `two visuals on page '${spec.name}' are both called '${v && v.name}'. They would share one `
      + `directory and the second would overwrite the first.`);
    const r = writeVisual(v);
    names.add(v.name);
    files[`${dir}/${r.path}`] = r.content;
    if (r.warnings) warnings.push(...r.warnings.map((w) => `${spec.name}/${v.name}: ${w}`));
    if (r.companions) companions.push(...r.companions.map((c) => `${spec.name}/${v.name}: ${c}`));
  }

  return summarise(files, spec, warnings, companions);
}

// --- write_report -----------------------------------------------------------------------------

/**
 * The `definition/pages` tree and nothing else. What it deliberately does NOT write is listed back
 * in `notWritten`, because the most expensive of those omissions is invisible: a report with no
 * base theme in `report.json` renders NOTHING, with no error anywhere, and a generator that
 * returned a complete-looking set of page files without saying so would be handing over a report
 * that opens blank.
 */
function writeReport(spec = {}) {
  need(spec && typeof spec === "object", "a report spec is required");
  assertKnownKeys(spec, REPORT_KEYS, "report spec");
  need(Array.isArray(spec.pages) && spec.pages.length,
    "pages is required and needs at least one page");

  const warnings = [];
  const companions = [];
  const files = {};
  const order = [];

  for (const p of spec.pages) {
    const r = writePage(p);
    need(!order.includes(p.name),
      `two pages are both called '${p.name}'. They would share one directory.`);
    order.push(p.name);
    Object.assign(files, r.files);
    if (r.warnings) warnings.push(...r.warnings);
    if (r.companions) companions.push(...r.companions);
  }

  const active = spec.activePageName ?? order[0];
  need(order.includes(active),
    `activePageName '${active}' is not one of the pages: ${order.join(", ")}`);

  files["definition/pages/pages.json"] = serialise({
    $schema: SCHEMA.pages(spec.pagesSchemaVersion ?? DEFAULT_PAGES_SCHEMA),
    pageOrder: order,
    activePageName: active,
  });

  // Required, and its absence is a hard cold-open failure rather than a degraded render. See
  // DEFAULT_DEFINITION_VERSION.
  files["definition/version.json"] = serialise({
    $schema: SCHEMA.version("1.0.0"),
    version: spec.definitionVersion ?? DEFAULT_DEFINITION_VERSION,
  });

  const out = summarise(files, spec, warnings, companions);
  out.notWritten = [
    "definition/report.json — and with it themeCollection.baseTheme. A report with no base theme "
      + "renders NOTHING, with no error. It also holds publicCustomVisuals, without which every "
      + "Zebra visual on these pages is an unresolved placeholder.",
    "definition.pbir — the pointer to the semantic model.",
    "The .pbip file and the semantic model. Nothing here writes TMDL or a measure.",
    "Whether any number is right, and whether the page renders. Only data and a screenshot show "
      + "that; run validate_report over the finished project, then look at it.",
  ];
  return out;
}

function summarise(files, spec, warnings, companions) {
  const bytes = Object.values(files)
    .reduce((n, c) => n + Buffer.byteLength(c, "utf8"), 0);
  const specBytes = Buffer.byteLength(JSON.stringify(spec), "utf8");
  return {
    files,
    fileCount: Object.keys(files).length,
    bytes,
    specBytes,
    // Reported rather than averaged. A visual dominated by an opaque filterConfig or a large
    // comment blob sits near 1x, and an average would hide it behind the ones that compress well.
    compression: specBytes ? `${(bytes / specBytes).toFixed(2)}x` : null,
    ...(warnings.length ? { warnings } : {}),
    ...(companions.length ? { companions } : {}),
  };
}

// --- the inverse, for tests -------------------------------------------------------------------
/**
 * Derive a spec from a real `visual.json`. This is the round-trip oracle: without it, a test can
 * only check the writer against inputs the writer's author invented, which proves the writer does
 * what he meant rather than what the format needs.
 *
 * It DECODES — `'#1A1A2E'` becomes "#1A1A2E", `3D` becomes 3 — so regeneration has to re-encode
 * and cannot be a deep copy of pre-formed literals dressed up as a test. The never-emit groups are
 * dropped here, which is also how the comparison ignores them.
 *
 * Not registered as a tool. It is an oracle, not a workflow: an agent editing an existing report
 * should read the file it is editing.
 */
function deriveVisualSpec(file) {
  const v = file.visual || {};
  const spec = {
    name: file.name,
    visualType: v.visualType,
    schemaVersion: String(file.$schema ?? "").replace(/.*visualContainer\//, "").replace(/\/schema\.json.*/, "")
      || DEFAULT_VISUAL_SCHEMA,
    position: { ...file.position },
  };
  if (v.drillFilterOtherVisuals !== undefined) spec.drillFilterOtherVisuals = v.drillFilterOtherVisuals;

  const bindings = {};
  for (const [role, r] of Object.entries(v.query?.queryState ?? {})) {
    bindings[role] = (r.projections ?? []).map((p) => {
      const kind = Object.keys(p.field ?? {})[0];
      const entity = p.field?.[kind]?.Expression?.SourceRef?.Entity;
      const property = p.field?.[kind]?.Property;
      const plain = kind === (ROLE_FIELD_KIND[role] || "Measure")
        && p.queryRef === `${entity}.${property}`
        && p.nativeQueryRef === property
        && p.displayName === undefined && p.active === undefined;
      // The shorthand only survives when it reconstructs exactly. A leading-dot entity is the
      // case that decides it: ".Measures.AC" must split on the LAST dot, and if it does not
      // round-trip it falls back to the explicit form rather than being written wrong.
      if (plain) {
        const back = splitRef(`${entity}.${property}`);
        if (back.entity === entity && back.property === property) return `${entity}.${property}`;
      }
      const o = { entity, property, kind };
      if (p.queryRef !== `${entity}.${property}`) o.queryRef = p.queryRef;
      if (p.nativeQueryRef !== property) o.nativeQueryRef = p.nativeQueryRef;
      if (p.displayName !== undefined) o.displayName = p.displayName;
      if (p.active !== undefined) o.active = p.active;
      return o;
    });
  }
  // Set whenever the file has a `query` at all, empty bindings included, because the writer keys
  // the presence of the whole `query` key off it and a textbox has none.
  if (v.query !== undefined) spec.bindings = bindings;
  const queryExtras = {};
  for (const k of Object.keys(v.query ?? {})) if (k !== "queryState") queryExtras[k] = v.query[k];
  if (Object.keys(queryExtras).length) spec.queryExtras = queryExtras;

  const props = {};
  const raw = {};
  const skipped = [];
  for (const [group, entries] of Object.entries(v.objects ?? {})) {
    if (group in NEVER_EMIT || group === CARD_DATA_GROUP) { skipped.push(group); continue; }
    // One entry holding nothing but a properties map is the modelled shape. Anything else -- a
    // selector, several entries, a value that is not an object -- goes through verbatim rather
    // than being dropped, because dropping it would make the round trip look better than it is.
    const modelled = Array.isArray(entries) && entries.length === 1
      && entries[0] && Object.keys(entries[0]).length === 1 && entries[0].properties
      && Object.keys(entries[0].properties).length > 0;
    if (!modelled) { raw[group] = entries; continue; }
    for (const [prop, val] of Object.entries(entries[0].properties)) {
      props[`${group}.${prop}`] = decodeLiteral(val);
    }
  }
  if (Object.keys(props).length) spec.properties = props;
  if (Object.keys(raw).length) spec.rawObjects = raw;
  if (v.visualContainerObjects) {
    const c = {};
    for (const [group, entries] of Object.entries(v.visualContainerObjects)) {
      if (!Array.isArray(entries) || entries.length !== 1) continue;
      for (const [prop, val] of Object.entries(entries[0]?.properties ?? {})) {
        c[`${group}.${prop}`] = decodeLiteral(val);
      }
    }
    if (Object.keys(c).length) spec.visualContainerObjects = c;
  }
  const extras = {};
  for (const k of Object.keys(v)) {
    if (["visualType", "query", "objects", "drillFilterOtherVisuals", "visualContainerObjects"].includes(k)) continue;
    extras[k] = v[k];
  }
  if (Object.keys(extras).length) spec.visualExtras = extras;
  if (file.filterConfig !== undefined) spec.filterConfig = file.filterConfig;
  return { spec, skippedGroups: skipped };
}

/** The inverse of pbirLiteral. Unknown forms fall back to {__raw}, which is lossless. */
function decodeLiteral(val) {
  if (val && val.solid && val.solid.color) {
    const inner = decodeLiteral(val.solid.color);
    if (typeof inner === "string") return { __solid: inner };
    return { __raw: val };
  }
  const raw = val?.expr?.Literal?.Value;
  if (typeof raw !== "string") return { __raw: val };      // paragraphs, a bound expression, …
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?D$/.test(raw)) return Number(raw.slice(0, -1));
  if (/^'[\s\S]*'$/.test(raw)) {
    const inner = raw.slice(1, -1);
    // A string carrying an apostrophe cannot be re-encoded, so it goes back as a raw literal
    // rather than through the refusal. Derivation must not fail on a file that already exists.
    return inner.includes("'") ? { __literal: raw } : inner;
  }
  return { __literal: raw };                               // 1L, 0D-shaped timestamps, identifiers
}

module.exports = {
  writeVisual, writePage, writeReport, deriveVisualSpec,
  pbirLiteral, decodeLiteral, splitRef, projectionFor, serialise,
  NEVER_EMIT, VISUAL_ALIASES, INSTALLED, FILE_IMPORTED, ROLE_FIELD_KIND,
  DEFAULT_VISUAL_SCHEMA, DEFAULT_PAGE_SCHEMA, DEFAULT_PAGES_SCHEMA, SCHEMA,
};
