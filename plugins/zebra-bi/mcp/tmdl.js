// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";
/**
 * A small TMDL reader: tables, columns, measures, and the properties this plugin needs.
 *
 * TMDL is indentation-structured, so this parses to a tree by indent depth and then interprets.
 * It is deliberately not a full implementation. It exists to answer three questions that
 * nothing else in the plugin can answer, because everything else reads the report layer and
 * these are facts about the model:
 *
 *   1. Does the model have per-scenario measures? Without them `Values` and `Plan` cannot both
 *      be fed, so a variance report is impossible and the page silently becomes a plain table.
 *   2. Is a date table marked? Without one, `PreviousYear` and `Forecast` are meaningless:
 *      PY equals AC, the delta reads a flat 0.0%, and it all looks completely fine.
 *   3. Is a measure already formatted as a percent? Binding one with percent units scales it
 *      twice, so the number renders confidently a hundred times too large.
 *
 * Two TMDL details worth stating because they bite:
 *
 *   `//` is NOT a comment in TMDL. A `//` line makes the model fail to load, which is why the
 *   plugin has a separate rule for it. Descriptions use `///`.
 *
 *   A measure expression can be inline after `=` or an indented block beneath it, and DAX
 *   contains colons, so a property line can only be recognised at a shallower depth than the
 *   expression it follows. Depth, not regex, is what separates them.
 */

const fs = require("fs");
const path = require("path");
const TREE = require("./tmdl-tree.js");

/** Indent width in tabs-or-spaces. TMDL uses tabs; four spaces appears in hand-edited files. */
function depthOf(line) {
  const m = line.match(/^([\t ]*)/)[1];
  let d = 0;
  for (const ch of m) d += ch === "\t" ? 1 : 0.25;
  return Math.floor(d);
}

/** Strip the quoting TMDL uses for names containing spaces: measure 'Value AC' -> Value AC */
const unquote = (s = "") => s.trim().replace(/^'(.*)'$/, "$1").trim();

/** Indent width in columns, for the body-tracking below. A tab counts as four. */
const indentOf = (line) => (line.match(/^[\t ]*/) || [""])[0].replace(/\t/g, "    ").length;

/**
 * Mark every line as structural TMDL or as the body of an expression.
 *
 * This exists for one reason: `//` is invalid TMDL but a perfectly legal DAX comment, so
 * whether a `//` line is a fault depends entirely on whether it sits inside an expression.
 * Two forms carry a body and BOTH have to be handled:
 *
 *   - a fenced block, which TMDL OPENS at the END of the assignment line
 *     (`formatStringDefinition = ```) and closes with a line that is only ```
 *   - a bare assignment (`measure X =`), whose body runs while the indent stays deeper
 *
 * Measured against the 20 shipped Zebra BI templates (299 .tmdl files): treating every `//`
 * line as a fault reports 207 findings across 7 of them, all false, because vendor measures
 * are full of commented DAX. Missing the fence direction alone still leaves 10. Both numbers
 * are the reason this is a classifier and not a regex.
 */
function classifyLines(text) {
  const out = [];
  let inFence = false, exprIndent = null;

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    const ind = indentOf(raw);

    if (inFence) {
      const closes = trimmed === "```";
      out.push({ raw, ind, blank: trimmed === "", inExpr: !closes });
      if (closes) { inFence = false; exprIndent = null; }
      continue;
    }
    if (/```$/.test(trimmed) && trimmed !== "```") {   // an assignment opening a fenced body
      inFence = true;
      out.push({ raw, ind, blank: false, inExpr: false });
      continue;
    }

    let inExpr = false;
    if (exprIndent !== null) {
      if (trimmed === "") inExpr = true;               // a blank line does not end a DAX body
      else if (ind > exprIndent) inExpr = true;
      else exprIndent = null;
    }
    // Any assignment opens a body, not only `measure`: `formatStringDefinition`, `expression`
    // and `source` all take DAX or M. The name may be quoted and hold anything, `%` included.
    if (!inExpr && /^\s*(?:[A-Za-z_][\w]*\s+)?(?:'[^']*'|[A-Za-z_][\w .\-]*)\s*=/.test(raw)) {
      exprIndent = ind;
    }
    out.push({ raw, ind, blank: trimmed === "", inExpr });
  }
  return out;
}

/**
 * Parse one .tmdl file into { tables: [...] } -- the flat view the three Zebra questions read.
 *
 * Since 2026-09-05 this is a projection of the structural tree in tmdl-tree.js rather than a
 * line-by-line regex reader. The regex reader had three faults the tree does not: a `kpi`,
 * `detailRowsDefinition` or `formatStringDefinition` block under a measure was glued onto its DAX
 * (`kpi` is a bare word at property depth, and every non-property line deeper than a measure was
 * "continuation"); a two-space-indented file lost its structure because depth was counted in
 * tabs; and a fence closed at column 0 ended the measure early. All three forms were measured to
 * LOAD in Desktop 2.157, so a reader that mis-parses them mis-reports a correct model.
 *
 * Unknown constructs are still skipped rather than guessed at: a parser that invents structure
 * produces findings about things that are not there, which is worse than missing one.
 */
function parseTmdl(text) {
  const tree = TREE.parseTree(text);
  const tables = [];
  for (const n of tree.root.children) {
    if (n.type !== "table") continue;
    const table = { name: n.name, dataCategory: TREE.propValue(n, "dataCategory"), columns: [], measures: [] };
    tables.push(table);
    for (const c of n.children) {
      if (c.type === "measure") {
        table.measures.push({ kind: "measure", name: c.name, expression: TREE.expressionOf(c),
                              formatString: TREE.propValue(c, "formatString") });
      } else if (c.type === "column") {
        table.columns.push({ kind: "column", name: c.name, isKey: TREE.propBool(c, "isKey"),
                             formatString: TREE.propValue(c, "formatString"),
                             sortByColumn: TREE.propValue(c, "sortByColumn"),
                             dataType: TREE.propValue(c, "dataType"),
                             isCalculated: Boolean(c.hasDefault),
                             expression: c.hasDefault ? TREE.expressionOf(c) : null });
      }
    }
  }
  return { tables };
}

/** Read every .tmdl under a .SemanticModel directory. */
function readModel(projectRoot) {
  const entries = fs.existsSync(projectRoot)
    ? fs.readdirSync(projectRoot, { withFileTypes: true }) : [];
  const modelDirs = entries.filter((e) => e.isDirectory() && e.name.endsWith(".SemanticModel"));
  const model = { present: modelDirs.length > 0, files: [], sources: [], tables: [] };
  if (!model.present) return model;

  const walk = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      // A symlinked FILE is not followed. Directory symlinks were already skipped deliberately,
      // but `e.isDirectory()` is false for a symlink to a file, so `leak.tmdl -> ~/secret.txt`
      // was read in full and its content reached a finding location. The project a customer
      // points us at may be one they were handed. Corrected 2026-08-31.
      else if (e.isSymbolicLink()) continue;
      // Only `definition/` IS the model. `TMDLScripts/` holds TMDL-view script tabs (createOrReplace
      // scripts Desktop saved) and `.pbi/` holds settings; neither is loaded as the model, and a
      // script copies the objects it edits -- every lineageTag in it duplicates one in definition/.
      else if (e.name.toLowerCase().endsWith(".tmdl") && /[\\/]definition[\\/]/i.test(p)) out.push(p);
    }
    return out;
  };

  const base = path.join(projectRoot, modelDirs[0].name);
  for (const abs of walk(base)) {
    const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
    // Strip a BOM before parsing. A BOM is its own finding; it must not also corrupt the read.
    // Read the bytes, because "did this file have a BOM" is not recoverable from the string.
    const buf = fs.readFileSync(abs);
    const hadBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const text = buf.toString("utf8").replace(/^﻿/, "");
    model.files.push(rel);
    model.sources.push({ rel, hadBom, text, lines: classifyLines(text), tree: TREE.parseTree(text) });
    for (const tb of parseTmdl(text).tables) model.tables.push({ ...tb, file: rel });
  }
  // `compatibilityLevel` is reported rather than flagged. All 20 shipped templates sit at
  // 1600/1601 and every one of them opens, so a finding here would warn on correct reports.
  // It matters for one thing only: Desktop upgrades the model in memory to 1606 on open, so
  // `file.reload/v1` refuses a file still saying 1600. That is a fact the caller needs at the
  // moment it reloads, not a defect in the model.
  const db = model.sources.find((s) => /(^|\/)database\.tmdl$/i.test(s.rel));
  const cl = db && db.text.match(/compatibilityLevel:\s*(\d+)/);
  model.compatibilityLevel = cl ? Number(cl[1]) : null;
  // A cultures/ file is legitimate TMDL and cold-opens fine. It silently kills
  // `file.reload/v1`, which is the whole ~1s authoring loop, so the caller has to know
  // BEFORE it starts iterating. Collected here rather than flagged, for the same reason as
  // compatibilityLevel: it is a fact about the project, not a fault in it.
  model.cultureFiles = model.files.filter((f) => /(^|\/)cultures\//i.test(f));
  return model;
}

// --- the three questions -------------------------------------------------------------------

/** A percent format string, in either the symbol or the named form. */
const isPercentFormat = (fs_ = "") => /%/.test(fs_) || /^percent$/i.test(fs_.trim());

/**
 * Scenario measures: the model can feed `Values` and `Plan` separately.
 *
 * Detected by name rather than by DAX, because the names are a Zebra convention the skill
 * itself teaches (AC, PL, PY, FC and their spelled-out forms). Returns what it found so the
 * caller can say which scenario is missing rather than just "no scenarios".
 */
function scenarioMeasures(model) {
  const PATTERNS = {
    actual: /(^|[\s_.\-])(ac|actual|actuals)([\s_.\-]|$)/i,
    plan: /(^|[\s_.\-])(pl|plan|budget|bu)([\s_.\-]|$)/i,
    previousYear: /(^|[\s_.\-])(py|previous ?year|prior ?year|ly|last ?year)([\s_.\-]|$)/i,
    forecast: /(^|[\s_.\-])(fc|forecast)([\s_.\-]|$)/i,
  };
  const found = { actual: [], plan: [], previousYear: [], forecast: [] };
  for (const t of model.tables) {
    for (const m of t.measures) {
      for (const [role, re] of Object.entries(PATTERNS)) {
        if (re.test(m.name)) found[role].push(`${t.name}[${m.name}]`);
      }
    }
  }
  const comparative = found.plan.length || found.previousYear.length || found.forecast.length;

  // CORRECTED 2026-08-05, after `model-has-no-scenario-measures` fired on
  // `Brand portfolio analysis - FMCG`, a reference template whose model is full of scenario pairs:
  // Revenue / Revenue PY, Units Sold / Units Sold PY, MA Share % / MA Share % PY.
  //
  // `hasActual` required a measure NAMED ac/actual, which is a naming convention rather than a
  // structural fact. The vendor's convention is `<metric>` plus `<metric> PY`, so the actual is the
  // BASE measure and is never called "AC". Test structurally instead: if a comparative measure's
  // name minus its scenario token is itself a measure, that base measure IS the actual.
  const allNames = new Set();
  for (const t of model.tables) for (const m of t.measures) allNames.add(m.name.trim().toLowerCase());
  const TOKEN = /(^|[\s_.\-])(py|previous ?year|prior ?year|ly|last ?year|pl|plan|budget|bu|fc|forecast)([\s_.\-]|$)/i;
  const pairedActuals = [];
  for (const role of ["previousYear", "plan", "forecast"]) {
    for (const ref of found[role]) {
      const name = ref.replace(/^.*\[|\]$/g, "");
      const base = name.replace(TOKEN, "$1").replace(/[\s_.\-]+$/, "").trim();
      if (base && base.toLowerCase() !== name.toLowerCase() && allNames.has(base.toLowerCase())) {
        pairedActuals.push(base);
      }
    }
  }

  return {
    found,
    hasActual: found.actual.length > 0 || pairedActuals.length > 0,
    pairedActuals: [...new Set(pairedActuals)],
    hasComparative: Boolean(comparative),
  };
}

/**
 * A marked date table is `dataCategory: Time` on the table plus a column with `isKey`. Both
 * halves are required: the skill's own note is that this pair IS "Mark as date table", and
 * either alone does not do it.
 */
function dateTable(model) {
  for (const t of model.tables) {
    if ((t.dataCategory || "").trim() !== "Time") continue;
    const key = t.columns.find((c) => c.isKey);
    if (key) return { marked: true, table: t.name, keyColumn: key.name, file: t.file };
  }
  // Report the near miss, since "there is a Calendar but it is not marked" is a different
  // conversation from "there is no calendar at all".
  const candidate = model.tables.find((t) =>
    /calendar|date|dim.?date|time/i.test(t.name) || (t.dataCategory || "").trim() === "Time");

  // CORRECTED 2026-08-05, after this fired on 8 of the 20 shipped templates. The rule's stated harm
  // -- "prior year equals actual, the delta reads a flat 0.0%" -- needs the model to compute prior
  // year with TIME INTELLIGENCE. Two of the eight use none at all: `Annual Comparative income
  // statement` derives PY from `SELECTEDVALUE(PnL[Year])`, and `Brand portfolio analysis - FMCG`
  // carries no time-intelligence function anywhere. A model whose PY is a plain measure or a
  // pre-shaped column does not need a marked date table, so the finding describes no fault.
  //
  // Report whether it is used so the caller can decide. NOT claimed here: that DATEADD on an
  // unmarked but valid date column actually breaks -- marking is Power BI best practice and the
  // remaining templates ship working prior-year columns. Softening the message from a
  // wrong-numbers fact to a warning is a marked-source change and is escalated.
  const TIME_INTEL = /\b(SAMEPERIODLASTYEAR|DATEADD|PARALLELPERIOD|PREVIOUSYEAR|PREVIOUSMONTH|PREVIOUSQUARTER|DATESYTD|DATESQTD|DATESMTD|TOTALYTD|TOTALQTD|TOTALMTD)\s*\(/i;
  let usesTimeIntelligence = false;
  for (const t of model.tables) {
    for (const m of t.measures) {
      if (TIME_INTEL.test(m.expression || "")) { usesTimeIntelligence = true; break; }
    }
    if (usesTimeIntelligence) break;
  }

  return { marked: false, candidate: candidate ? candidate.name : null, usesTimeIntelligence };
}

/** Index measures by name for the report layer to look up a formatString. */
function measureIndex(model) {
  const byName = new Map();
  for (const t of model.tables) {
    for (const m of t.measures) {
      byName.set(m.name.toLowerCase(), { ...m, table: t.name });
      byName.set(`${t.name}.${m.name}`.toLowerCase(), { ...m, table: t.name });
    }
  }
  return byName;
}

module.exports = {
  parseTmdl, readModel, scenarioMeasures, dateTable, measureIndex, isPercentFormat, depthOf,
  classifyLines, indentOf, TREE,
};
