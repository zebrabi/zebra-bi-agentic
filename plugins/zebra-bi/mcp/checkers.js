// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";
/**
 * One function per rule `check`. Each returns an array of {location} — the rule supplies the
 * wording, so a checker never writes customer-facing prose and the two cannot drift.
 *
 * Every checker here is decidable from the project files alone. Nothing reads data, nothing
 * renders, nothing needs Power BI Desktop. The nine rules that need DAX inference or a fuzzy
 * threshold are deliberately absent: a heuristic presented beside a fact reads as a fact.
 *
 * The bar these have to clear is not "does it fire on a broken report". It is "does it stay
 * silent on Zebra's own shipped templates". Microsoft's PBIR validator returns two errors on an
 * untouched vendor template, and that is the failure this file exists to avoid repeating.
 */

// Version-robust prefixes rather than full GUIDs, since the GUID carries a version suffix.
const tmdl = require("./tmdl.js");
const T = require("./tmdl-tree.js");

// Tables+ shares the Tables prefix, so it is covered by ZEBRA.tables. Charts+ does NOT
// share the Charts prefix: certified Charts is `waterfall…` for historical reasons, while
// Charts+ is `ZebraBIChartsPlus…`. Without its own prefix every rule below treats a Charts+
// page as "not a Zebra visual" and skips it, so the report passes without being checked.
const ZEBRA = {
  tables: "ZebraBITables",
  charts: "waterfall",
  chartsPlus: "ZebraBICharts",
  cards: "zebraBiCards",
};
const isZebra = (t = "") => Object.values(ZEBRA).some((p) => t.startsWith(p));
const isTable = (t = "") => t.startsWith(ZEBRA.tables);
const isCards = (t = "") => t.startsWith(ZEBRA.cards);
// The Plus visuals are the two whose GUID carries "Plus" after the product name. View-mode
// comments exist only on them; the certified twins declare the same property and ignore it.
const isPlus = (t = "") => /^ZebraBI(?:Tables|Charts)Plus/.test(t);

/** `visual.objects.<name>` is a list of one. Reach into the first entry's properties. */
const obj = (v, name) => {
  const o = v?.visual?.objects?.[name];
  return Array.isArray(o) ? o[0]?.properties ?? null : null;
};
/** Unwrap a PBIR literal: {expr:{Literal:{Value:"'x'"}}} -> "x" */
const lit = (p) => {
  const raw = p?.expr?.Literal?.Value;
  if (typeof raw !== "string") return null;
  const unquoted = raw.replace(/^'/, "").replace(/'$/, "");
  // The D/L/M suffix is PBIR's NUMERIC literal type marker, so strip it only from a numeric
  // payload. Applied to every string it truncated real values: 'TrendM' -> "Trend",
  // '#1A1A2D' -> "#1A1A2", 'EMEA-L' -> "EMEA-". writers.js:801 already scoped it this way, and
  // checkers.js worked around the corruption locally rather than fixing it here.
  return /^-?\d+(?:\.\d+)?[DLM]$/.test(unquoted) ? unquoted.slice(0, -1) : unquoted;
};
/** A blob property holds JSON inside a string. Parse defensively; a bad blob is its own rule. */
const blob = (p) => {
  const s = lit(p);
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
};
const projections = (v, role) => v?.visual?.query?.queryState?.[role]?.projections ?? [];

/**
 * Which lines sit inside a ``` fenced body.
 *
 * NOT `classifyLines().inExpr`, and the difference is the whole reason this exists. `inExpr` marks
 * every deeper line after ANY assignment as expression body -- deliberately, because that is what
 * makes the `//` rule safe against 207 false positives in vendor DAX. But `measure X = 1` is an
 * assignment too, so `formatString:` and `description:` beneath it are `inExpr` as well, and a
 * property-position rule guarded by it can never fire where it matters most.
 *
 * A fence is the only place a TMDL file holds arbitrary text, so it is the only guard these rules
 * need. Measured: with NO guard at all, `description:` and the unquoted-name rule find 0 hits
 * across 1,325 real .tmdl files, so this is belt-and-braces rather than the thing holding them up.
 */
function fencedLines(text) {
  const lines = text.split(/\r?\n/);
  const inFence = new Array(lines.length).fill(false);
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (open) {
      inFence[i] = true;
      if (trimmed === "```") open = false;
      continue;
    }
    if (/```$/.test(trimmed)) { open = true; inFence[i] = false; }
  }
  return inFence;
}

/**
 * Blank out everything in a TMDL file that is NOT executable DAX, line by line, returning an array
 * the same length as the input so line numbers still line up.
 *
 * Blanked: `///` descriptions (prose, and prose can quote DAX), `//` and `--` line comments, and
 * the CONTENTS of string literals. What remains is code.
 *
 * ☠️ This is the guard the `//` rule learned the hard way -- matching DAX-shaped text anywhere in a
 * .tmdl file produced 207 false positives across 7 of the 20 shipped templates, because vendor
 * measures are full of commented-out DAX. Any new DAX rule must go through here.
 */
function daxOnly(text) {
  return text.split(/\r?\n/).map((line) => {
    if (/^\s*\/\/\//.test(line)) return "";          // description: prose
    let out = "";
    let inString = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inString = !inString; out += '"'; continue; }
      if (inString) { out += " "; continue; }          // keep length, drop content
      if ((ch === "/" && line[i + 1] === "/") || (ch === "-" && line[i + 1] === "-")) break;
      out += ch;
    }
    return out;
  });
}

const checkers = {
  // --- will not open ------------------------------------------------------------------------

  /** A guessed schema opens an empty report called Untitled with an error dialog. */
  "pbip-schema-must-match-published-pattern"(p) {
    const out = [];
    const ok = /^https:\/\/developer\.microsoft\.com\/json-schemas\/fabric\/pbip\/pbipProperties\/1\.\d+\.\d+\/schema\.json$/;
    for (const f of p.pbipFiles) {
      if (f.parseError) continue;                     // reported as unparseable-json instead
      if (!ok.test(f.parsed?.$schema ?? "")) out.push({ location: `${f.rel}:$schema` });
    }
    return out;
  },

  /** A BOM anywhere makes Desktop reject the whole definition, not just that file. */
  "no-byte-order-mark-in-report-files"(p) {
    return p.allFiles.filter((f) => f.hadBom).map((f) => ({ location: f.rel }));
  },

  // --- the model layer, and why these five are here ----------------------------------------
  //
  // Every check below is a COLD-OPEN failure: Desktop refuses the model, so there is no running
  // instance to reload against and the fix costs a full restart rather than a ~1s reload. They
  // are also the cheapest faults in the product to detect — each one is a named Desktop error
  // with a deterministic textual cause — and until now the catalogue had none of them. The
  // guidance existed as prose plus a PowerShell snippet the agent had to remember to run, which
  // is why the model layer produced more lost cycles than any other part of the loop.
  //
  // All five report ZERO findings across the 20 shipped Zebra BI templates (299 .tmdl files),
  // and each has a positive control in test-tmdl.js. Both halves matter: the first version of
  // the `//` check fired 207 times on those same templates.

  /** TMDL rejects a BOM outright, and the report-layer check above never reads the model. */
  "tmdl-file-must-not-have-a-bom"(p) {
    if (!p.model || !p.model.present) return [];
    return p.model.sources.filter((s) => s.hadBom).map((s) => ({ location: s.rel }));
  },

  /**
   * `//` is not a TMDL comment — but it IS a DAX comment, so only a `//` OUTSIDE an expression
   * body is a fault. That distinction is the whole rule: the vendor's own measures are full of
   * commented DAX, and a naive version of this check reports 207 false positives on them.
   */
  "tmdl-comment-must-use-triple-slash"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const s of p.model.sources) {
      s.lines.forEach((l, i) => {
        if (!l.inExpr && /^\s*\/\/(?!\/)/.test(l.raw)) out.push({ location: `${s.rel}:${i + 1}` });
      });
    }
    return out;
  },

  /**
   * `///` is a description bound to the object on the next line, and a relationship accepts
   * none. Above a measure or a column it is correct and common, so the check has to look at
   * what the description actually lands on rather than at the `///` alone.
   */
  "tmdl-relationship-takes-no-description"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const s of p.model.sources) {
      s.lines.forEach((l, i) => {
        if (l.inExpr || !/^\s*\/\/\//.test(l.raw)) return;
        for (let j = i + 1; j < s.lines.length; j++) {
          const n = s.lines[j];
          if (n.blank) continue;
          if (/^\s*\/\/\//.test(n.raw)) return;        // still inside the description block
          if (/^\s*relationship\b/.test(n.raw)) out.push({ location: `${s.rel}:${i + 1}` });
          return;
        }
      });
    }
    return out;
  },

  /**
   * Measures and columns share one namespace per table, so `Sales` cannot be both. Scoped to
   * the table on purpose: the same name in two different tables is legal and ordinary.
   */
  "measure-and-column-must-not-share-a-name"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const t of p.model.tables) {
      const cols = new Set((t.columns || []).map((c) => c.name.toLowerCase()));
      for (const m of t.measures || []) {
        if (cols.has(m.name.toLowerCase())) {
          out.push({ location: `${t.file}:${t.name}[${m.name}]` });
        }
      }
    }
    return out;
  },

  /**
   * A multi-line measure must start its DAX on the line AFTER `=`, indented.
   *
   * `measure X = CALCULATE(` followed by more indented lines parses as a measure whose expression
   * is the single fragment on the `=` line. The model then loads with ZERO tables and Desktop
   * opens "Untitled". Cost one full cold open in `2026-08-13-finance-pack`.
   *
   * Deliberately narrow: it fires only when the `=` line's expression has UNBALANCED brackets AND
   * the next line is more deeply indented. A complete single-line expression is the normal form
   * and must never be flagged -- most measures in every shipped template are exactly that.
   */
  "multiline-measure-must-not-start-dax-on-the-equals-line"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    // ☠️ TMDL text lives in `model.sources`, NOT in `p.files` -- `p.files` holds the REPORT layer
    // and contains no .tmdl at all. The first version of this checker iterated `p.files` looking
    // for `.tmdl`, matched nothing, and scored a clean zero across all 20 shipped templates. It
    // was not clean; it was blind. A checker that reads nothing and a corpus with nothing wrong
    // produce the same number, which is why the positive fixture in test-checkers.js is not
    // optional for this rule.
    for (const src of p.model.sources || []) {
      const rel = src.rel;
      const lines = src.text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*)measure\s+(?:'([^']+)'|([^\s=]+))\s*=\s*(\S.*)$/.exec(lines[i]);
        if (!m) continue;
        const expr = m[4].trim();
        // ``` opens the LEGAL fenced form, whose body is SUPPOSED to be on the lines below.
        // Skipped explicitly: the corpus holds 11 of these across the vendor templates and the
        // SaaS MRR reference model, and a draft that judged continuation by "the next line does
        // not look like a property" reported every one of them as a fault.
        if (expr.startsWith("```")) continue;
        // Skip forward over blank lines rather than bailing on the first one. `measure R =
        // CALCULATE(` followed by a blank line and then the indented DAX is the same fault with
        // the same cold-open cost, and bailing on `!next.trim()` made the rule miss it.
        let n = i + 1;
        while (n < lines.length && !lines[n].trim()) n++;
        const next = lines[n];
        if (next === undefined) continue;
        if (next.search(/\S/) <= m[1].length) continue;  // not a continuation
        // Two forms of "this expression does not end on this line", and only the first was
        // checked until 2026-08-28. Parens count outside string literals, so a `(` inside a
        // caption cannot open a phantom continuation.
        // A DAX comment runs to the end of the line and its parens are prose, so counting them
        // read `measure Revenue = SUM(Facts[Amount])  -- FY23 (unadjusted` as a continuation and
        // fired this rule -- at `wont-open`, the most severe level -- on a model that opens fine.
        // One trailing `(` in a comment on a 400-measure model was 400 findings. Reported by
        // review 2026-08-31.
        let depth = 0, inString = false;
        for (let k = 0; k < expr.length; k++) {
          const ch = expr[k];
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if ((ch === "-" && expr[k + 1] === "-") || (ch === "/" && expr[k + 1] === "/")) break;
          if (ch === "(") depth++;
          else if (ch === ")") depth--;
        }
        // VAR is the form the field actually hits. `measure X = VAR a = 1` is balanced, so the
        // paren test passed it, and every VAR/RETURN measure takes this shape -- which is to say
        // the rule named the fault, was tested, and missed its most common instance. A VAR
        // without a RETURN is not valid DAX, so a VAR on the = line ALWAYS continues below.
        // Reported from the field 2026-08-22, confirmed by probe 2026-08-28.
        if (depth <= 0 && !/^VAR\s/i.test(expr)) continue;
        out.push({ location: `${rel}:${i + 1}:${m[2] || m[3]}` });
      }
    }
    return out;
  },

  /**
   * ---------------------------------------------------------------------------------------------
   * THE THREE DAX RULES. Read this before adding a fourth.
   *
   * Everything from the first `=` onward is DAX, and this file has always treated it as opaque on
   * purpose: judging an expression needs the model's names and types, which no file check has.
   * These three are the exception because each is a HARD PARSE OR EVALUATION ERROR whose shape is
   * visible in the text alone. That matters for false positives: an expression that trips one of
   * these cannot work, so the rule cannot fire on a correct report -- which is the bar AGENTS.md
   * sets and the reason the wider "is this DAX sensible" rules were not written.
   *
   * All three were measured on Desktop 2.157 against a live model, with controls.
   * See feedback/2026-09-05-dax-layer-measured.md.
   */

  /**
   * `REMOVEFILTERS` is a CALCULATE filter modifier, not a table expression.
   *
   * Measured message: "REMOVEFILTERS function cannot be used as a table expression. It can appear
   * only as a filter in CALCULATE." Where a TABLE is wanted, `ALL(Table)` is the equivalent.
   *
   * ☠️ This is the single most common error in the 452-variant corpus -- 10 occurrences -- and
   * every one came from a drafter writing what it believed was the CORRECTED form, having been
   * told to prefer REMOVEFILTERS over ALL. The rule exists because the advice invites the fault.
   *
   * Narrow by construction: only the positions where a table is REQUIRED are matched. REMOVEFILTERS
   * inside CALCULATE/CALCULATETABLE is correct and must never be flagged -- that is the form the
   * skill actively recommends, and it appears throughout the shipped templates.
   */
  "dax-removefilters-must-be-a-calculate-filter"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    // Iterators and table functions whose FIRST argument is a table.
    const FIRST_ARG_TABLE =
      "RANKX|FILTER|SUMX|AVERAGEX|COUNTX|COUNTAX|MINX|MAXX|PRODUCTX|CONCATENATEX|MEDIANX|" +
      "RANKX|ADDCOLUMNS|SELECTCOLUMNS|SUMMARIZE|GROUPBY|COUNTROWS|GENERATE|GENERATEALL";
    const patterns = [
      new RegExp(`\\b(?:${FIRST_ARG_TABLE})\\s*\\(\\s*REMOVEFILTERS\\s*\\(`, "i"),
      // TOPN takes the table SECOND: TOPN(n, <table>, ...)
      /\bTOPN\s*\(\s*[^,()]+,\s*REMOVEFILTERS\s*\(/i,
      // A VAR cannot hold it either -- the original form of this rule, kept.
      /\bVAR\s+[A-Za-z_]\w*\s*=\s*REMOVEFILTERS\s*\(/i,
    ];
    for (const src of p.model.sources || []) {
      const lines = daxOnly(src.text);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        if (patterns.some((re) => re.test(lines[i]))) {
          out.push({ location: `${src.rel}:${i + 1}` });
        }
      }
    }
    return out;
  },

  /**
   * A VAR may not be named after a DAX function.
   *
   * `VAR LastDate = …` fails with the generic "The syntax for 'LastDate' is incorrect" -- the
   * message never says "reserved", so this costs real diagnosis time. Measured on LastDate, Filter
   * and Sum; a suffix (`LastDateValue`) clears it, so the collision is exact-match.
   *
   * ☠️ THE LIST IS MEASURED, NOT "DAX FUNCTION NAMES". The first draft of this rule used the
   * plausible heuristic -- any function name -- and the corpus sweep caught it firing on
   * `Financial statements`, a SHIPPED template, at `VAR mid = ISINSCOPE(...)`. `MID` is a DAX
   * function and is a perfectly legal variable name. So are ROUND, FORMAT, SEARCH, LEFT, RIGHT,
   * LEN, TRIM, UPPER, LOWER, NOW, TODAY, YEAR, MONTH, DAY, ABS, INT, SIGN, POWER, OFFSET, INDEX,
   * WINDOW, SELECTCOLUMNS and CONCATENATE.
   *
   * 234 names were then put through the engine one at a time: 105 are refused, 129 are fine. The
   * refused set is table functions, filter modifiers, time intelligence, aggregators and language
   * keywords -- NOT scalar text/math functions. Only the measured 105 are listed below. Do not add
   * a name to this list without running it; the shape of the set is not guessable, which is the
   * whole reason the first version was wrong.
   */
  "dax-var-must-not-be-named-after-a-function"(p) {
    if (!p.model || !p.model.present) return [];
    const RESERVED = new Set([
      // CALCULATIONS and MEASURE are grammar keywords rather than function names, proven by the
      // VAR probe: `VAR Calculations` is refused while `VAR Accounts` (an ordinary EXISTING table)
      // is accepted and a non-existent name gives "Failed to resolve" instead. `CalculationGroup`
      // is NOT reserved, so the family is not guessable either.
      "CALCULATIONS", "MEASURE",
      "ADDCOLUMNS", "ALL", "ALLEXCEPT", "ALLNOBLANKROW", "ALLSELECTED", "AND", "ASC", "AVERAGE",
      "AVERAGEA", "AVERAGEX", "BLANK", "CALCULATE", "CALCULATETABLE", "CLOSINGBALANCEMONTH",
      "CONTAINS", "COUNT", "COUNTA", "COUNTAX", "COUNTBLANK", "COUNTROWS", "COUNTX", "CROSSJOIN",
      "CUSTOMDATA", "DATATABLE", "DATE", "DATESBETWEEN", "DATESINPERIOD", "DATESMTD", "DATESQTD",
      "DATESYTD", "DEFINE", "DESC", "DISTINCT", "DISTINCTCOUNT", "DIVIDE", "EARLIER", "EARLIEST",
      "ENDOFMONTH", "ERROR", "EVALUATE", "EXCEPT", "FALSE", "FILTER", "FIRSTDATE", "FIRSTNONBLANK",
      "GENERATE", "GENERATEALL", "HASONEFILTER", "HASONEVALUE", "IF", "INTERSECT", "ISEMPTY",
      "ISFILTERED", "ISSUBTOTAL", "KEEPFILTERS", "LASTDATE", "LASTNONBLANK", "LOG", "LOOKUPVALUE",
      "MAX", "MAXA", "MAXX", "MEDIAN", "MIN", "MINA", "MINX", "NEXTDAY", "NOT",
      "OPENINGBALANCEMONTH", "OR", "ORDER", "PARALLELPERIOD", "PATH", "PATHCONTAINS", "PREVIOUSDAY",
      "PREVIOUSMONTH", "PREVIOUSQUARTER", "PREVIOUSYEAR", "RANK", "RANKX", "RELATED",
      "RELATEDTABLE", "RETURN", "ROLLUP", "ROLLUPGROUP", "ROW", "SAMEPERIODLASTYEAR",
      "STARTOFMONTH", "STARTOFYEAR", "SUM", "SUMMARIZE", "SUMX", "SWITCH", "TOPN", "TOTALMTD",
      "TOTALQTD", "TOTALYTD", "TRUE", "UNION", "USERELATIONSHIP", "USERNAME", "VALUE", "VALUES",
      "VAR",
    ]);
    const out = [];
    for (const src of p.model.sources || []) {
      const lines = daxOnly(src.text);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        const re = /\bVAR\s+([A-Za-z_]\w*)\s*=/gi;
        let m;
        while ((m = re.exec(lines[i])) !== null) {
          if (RESERVED.has(m[1].toUpperCase())) {
            out.push({ location: `${src.rel}:${i + 1}`, detail: `VAR '${m[1]}' is a DAX function name` });
          }
        }
      }
    }
    return out;
  },

  /**
   * `Calculations` is a reserved word in DAX and must be single-quoted when referenced.
   *
   * The table LOADS fine; every unquoted reference in an expression fails with "The syntax for
   * 'Calculations' is incorrect". It matters because `Calculations` is a common measure-holder
   * table name.
   *
   * ☠️ Gated on the model ACTUALLY declaring such a table. Without that gate the rule would fire on
   * any expression that happens to contain the word, and an unquoted reference to a table that does
   * not exist is a different fault with a different message.
   */
  "dax-calculations-table-must-be-quoted"(p) {
    if (!p.model || !p.model.present) return [];
    const declares = (p.model.sources || []).some((s) =>
      /^\s*table\s+'?Calculations'?\s*$/im.test(s.text)
    );
    if (!declares) return [];
    const out = [];
    for (const src of p.model.sources || []) {
      const lines = daxOnly(src.text);
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (!ln) continue;
        // A table reference is `Calculations[` or a bare `Calculations` as a function argument.
        // Require no preceding quote or word character so 'Calculations'[x] is never matched.
        if (/(?<!['\w])Calculations\s*(?:\[|\))/.test(ln)) {
          out.push({ location: `${src.rel}:${i + 1}` });
        }
      }
    }
    return out;
  },

  // REJECTED 2026-08-15: "report-field-references-must-resolve-in-the-model".
  //
  // The observation was real -- unresolved names after a rename cost TWO full cold opens in
  // `2026-08-13-finance-pack`. The rule drafted from it was wrong, and the corpus said so:
  // **12 findings across the 20 reference templates**, every one of which opens in Desktop.
  //
  // Two separate defects, and the second is why this is a rejection rather than a narrowing:
  //
  //  1. `SourceRef.Entity` is not always a table name. PBIR queries alias their tables in a `From`
  //     clause and then reference the ALIAS, so `Comments.Comment` in `Financial statements` points
  //     at a table actually called `'Comments hierarchical'`. Resolving that needs the query's own
  //     `From` bindings, not a global table index.
  //  2. More fundamentally, the premise is false. An unresolvable field reference in the REPORT
  //     layer does not stop the model loading -- those twelve templates prove it. The finance-pack
  //     failure was unresolved names in `relationships.tmdl`, i.e. in the MODEL. The draft
  //     conflated the two and would have shipped `wont-open` severity on a report that opens.
  //
  // A model-side version of this check (relationship endpoints resolving against declared tables)
  // is still worth writing and is NOT what this was. Do not resurrect this shape.

  /** `Measures` is reserved and fails the whole model load. A leading dot is the house dodge. */
  "measure-holder-table-must-not-be-named-measures"(p) {
    if (!p.model || !p.model.present) return [];
    return p.model.tables
      .filter((t) => (t.name || "").trim().toLowerCase() === "measures")
      .map((t) => ({ location: `${t.file}:${t.name}` }));
  },

  /**
   * TMDL has no `description:` property; descriptions are a `///` line above the object.
   *
   * The guard is FENCE MEMBERSHIP, not `inExpr`. That is deliberate: `inExpr` marks every deeper
   * line after any assignment as expression body, which would make this property-position rule
   * unable to fire under `measure X = 1` -- exactly where it matters (see c4f8cef). The cost is
   * that a non-fenced expression body is not excluded, so an M partition written as `source =`
   * plus indented `something: value` lines is judged. Measured 0 hits across 1,325 real .tmdl
   * files, but the comment previously claimed a protection the code does not implement.
   */
  "tmdl-description-is-not-a-property"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const src of p.model.sources || []) {
      const fenced = fencedLines(src.text);
      (src.lines || []).forEach((ln, i) => {
        if (fenced[i] || ln.blank) return;
        if (/^\s*description\s*:/.test(ln.raw)) out.push({ location: `${src.rel}:${i + 1}` });
      });
    }
    return out;
  },

  /**
   * `table Financial Data` is read as a name plus the start of a body, and Desktop reports it as
   * an INDENTATION error on a line whose indentation is correct -- so the message points away
   * from the fault. Quoting is the whole fix: `table 'Financial Data'`.
   *
   * Only the NAME is judged, never the expression: everything from the first `=` onward is DAX
   * or M and its spaces are ordinary. Zero hits across 1,325 real .tmdl files.
   */
  "tmdl-name-with-a-space-must-be-quoted"(p) {
    if (!p.model || !p.model.present) return [];
    const DECL = /^(\s*)(table|column|measure|partition|hierarchy|level|role|perspective|calculationGroup|calculationItem)\s+(.+?)\s*$/;
    const out = [];
    for (const src of p.model.sources || []) {
      const fenced = fencedLines(src.text);
      (src.lines || []).forEach((ln, i) => {
        if (fenced[i] || ln.blank) return;
        const m = DECL.exec(ln.raw);
        if (!m) return;
        let name = m[3];
        const eq = name.indexOf("=");
        if (eq >= 0) name = name.slice(0, eq);
        name = name.trim();
        if (!name || name.startsWith("'") || !/\s/.test(name)) return;
        out.push({ location: `${src.rel}:${i + 1}:${m[2]} ${name}` });
      });
    }
    return out;
  },

  /**
   * `Goal` is reserved, and unlike `Measures` it does NOT stop the model loading. The table looks
   * healthy in the Data pane and every visual bound to it renders "Something's wrong with one or
   * more fields", so nothing on screen connects the symptom to the name. Severity is `blank`, not
   * `wont-open`, for that reason: a reader sent to the cold-open checklist is in the wrong loop.
   */
  "table-must-not-be-named-goal"(p) {
    if (!p.model || !p.model.present) return [];
    return p.model.tables
      .filter((t) => (t.name || "").trim().toLowerCase() === "goal")
      .map((t) => ({ location: `${t.file}:${t.name}` }));
  },

  /** An interaction naming a visual or page that is not on disk crashes Desktop on open. */
  "interaction-target-must-exist"(p) {
    const out = [];
    const known = new Set(p.visuals.map((v) => v.name));
    for (const page of p.pages) {
      for (const i of page.parsed?.visualInteractions ?? []) {
        for (const key of ["source", "target"]) {
          const id = i?.[key];
          if (id && !known.has(id)) out.push({ location: `${page.rel}:visualInteractions.${key}=${id}` });
        }
      }
    }
    for (const name of p.declaredPages) {
      if (!p.pages.some((pg) => pg.pageName === name)) {
        out.push({ location: `definition/pages/pages.json:pageOrder=${name}` });
      }
    }
    return out;
  },

  /** Every entry under visual.objects must be an array. A bare object is a type error. */
  "visual-object-entry-must-be-an-array"(p) {
    const out = [];
    for (const v of p.visuals) {
      const objects = v.parsed?.visual?.objects;
      if (!objects || typeof objects !== "object") continue;
      for (const [name, val] of Object.entries(objects)) {
        if (!Array.isArray(val)) out.push({ location: `${v.rel}:visual.objects.${name}` });
      }
    }
    return out;
  },

  // --- renders blank -----------------------------------------------------------------------

  /** A dataset path that resolves to nothing opens an empty Untitled report, silently. */
  "dataset-reference-path-must-resolve"(p) {
    return p.pbirFiles
      .filter((f) => f.byPath && !f.byPathResolves)
      .map((f) => ({ location: `${f.rel}:datasetReference.byPath.path=${f.byPath}` }));
  },

  /** No base theme renders nothing: no visuals, no page tabs, no error. */
  "report-requires-a-base-theme"(p) {
    const r = p.files.get("definition/report.json");
    if (!r || r.parseError) return [];
    return r.parsed?.themeCollection?.baseTheme
      ? []
      : [{ location: "definition/report.json:themeCollection.baseTheme" }];
  },

  /**
   * `definition/version.json` is REQUIRED and its absence is a hard cold-open failure.
   *
   * Reproduced 2026-08-15 on Desktop 2.156.951.0 by deleting the file from a project that had
   * just opened cleanly. Desktop throws in
   *   Microsoft.PowerBI.Packaging.ExplorationSerializer.GetFileData(..., isRequired: true)
   *     -> DeserializeRootExplorationArtifactAsync
   * reporting `Error Reading StorageSection: ReportDocument`, and puts up an "Issues were found"
   * modal reading *Cannot find file 'version.json'* while the main window sits on "Untitled".
   *
   * This is a FROM-SCRATCH-ONLY trap and that is exactly why it needs a rule: every project a
   * human has ever saved out of Desktop already has the file, so it is invisible to anyone who
   * starts from someone else's `.pbip` and only bites the agent that writes a report layer from
   * nothing. The modal is opaque to UI Automation — neither its text nor its
   * "Copy details to clipboard" button is reachable — so the failure costs a cold open, a
   * screenshot and a human to read it. Detecting it from disk costs a file lookup.
   */
  "report-definition-requires-version-json"(p) {
    // Only a PBIR project has definition/report.json at all; do not fire on a legacy report.
    if (!p.files.get("definition/report.json")) return [];
    return p.files.get("definition/version.json")
      ? []
      : [{ location: "definition/version.json" }];
  },

  /**
   * Every role has a declared maximum and exceeding it replaces the visual with an error.
   *
   * Read off the three capability manifests, so these are the vendor's own numbers rather than
   * anything measured here. This replaces a narrower Cards-only check that fired at four Values:
   * the real cap is ONE, so that rule passed a two-measure Cards which fails to render. A row of
   * KPI tiles comes from Group, never from several measures.
   */
  "role-projection-count-within-visual-maximum"(p) {
    const MAX = {
      [ZEBRA.tables]: { Group: 4, Values: 21, PreviousYear: 1, Plan: 3, Forecast: 3,
        Tooltips: 5, Comments: 2, CategoryClass: 4 },
      [ZEBRA.charts]: { Group: 2, Values: 2, PreviousYear: 1, Plan: 1, Forecast: 1,
        Tooltips: 5, Comments: 2 },
      [ZEBRA.chartsPlus]: { Group: 2, Values: 2, PreviousYear: 1, Plan: 1, Forecast: 1,
        Tooltips: 5, Comments: 2 },
      [ZEBRA.cards]: { Group: 1, Values: 1, PreviousYear: 1, Plan: 1, Forecast: 1,
        Tooltips: 5, Comments: 2, "KPI Descriptions": 2 },
    };
    const out = [];
    for (const v of p.visuals) {
      const prefix = Object.values(ZEBRA).find((z) => (v.visualType ?? "").startsWith(z));
      if (!prefix) continue;
      for (const [role, cap] of Object.entries(MAX[prefix])) {
        const n = projections(v.parsed, role).length;
        if (n > cap) {
          out.push({ location: `${v.rel}:query.queryState.${role}`, detail: `${n} of max ${cap}` });
        }
      }
    }
    return out;
  },

  /** An absent filterContexts KEY blanks the whole visual. An empty array is fine. */
  "annotation-comment-requires-filtercontexts-key"(p) {
    const out = [];
    for (const v of p.visuals) {
      const props = obj(v.parsed, "annotationLayerSettings");
      const comments = blob(props?.annotationComments);
      if (!Array.isArray(comments)) continue;
      comments.forEach((c, i) => {
        if (c && !("filterContexts" in c)) {
          out.push({ location: `${v.rel}:annotationComments[${i}].filterContexts` });
        }
      });
    }
    return out;
  },

  /**
   * View-mode comments live in a SharePoint workbook the visual reaches through
   * `annotationLayerSettings.annotationsStorageConfig`. Only Tables+ and Charts+ read it: the
   * certified visuals declare the identical property (schema diff 2026-08-14: 432 properties,
   * zero differences) and never open the workbook, so a certified visual carrying the link looks
   * configured and shows viewers nothing. Measured before shipping: zero of 1,705 visuals in the
   * reference-template corpus set the property, so this is silent on everything shipped.
   */
  "view-mode-storage-config-requires-plus-visual"(p) {
    const out = [];
    for (const v of p.visuals) {
      if (!isZebra(v.visualType) || isPlus(v.visualType)) continue;
      const props = obj(v.parsed, "annotationLayerSettings");
      if (props && "annotationsStorageConfig" in props) {
        out.push({ location: `${v.rel}:annotationLayerSettings.annotationsStorageConfig` });
      }
    }
    return out;
  },

  /**
   * The comment panel is where a viewer adds a comment. A storage link with the panel switched
   * OFF is a contradiction the visual accepts: existing rows still mark their data points and show
   * on hover, but nobody can write one. Fires only on an EXPLICIT `show: false` -- an absent
   * `commentBoxSettings` is the shape 73 of the 86 shipped visuals with authored comments use, so
   * absence is not a fault. Corpus: zero storage links at all, so zero hits.
   */
  "view-mode-storage-config-requires-comment-box"(p) {
    const out = [];
    for (const v of p.visuals) {
      if (!isZebra(v.visualType)) continue;
      const layer = obj(v.parsed, "annotationLayerSettings");
      if (!layer || !("annotationsStorageConfig" in layer)) continue;
      const show = lit(obj(v.parsed, "commentBoxSettings")?.show);
      if (show === "false") {
        out.push({ location: `${v.rel}:commentBoxSettings.show` });
      }
    }
    return out;
  },

  // --- numbers or story wrong --------------------------------------------------------------

  /** A computed row lands in the grand total unless it is also excluded. */
  "computed-row-must-be-excluded-from-total"(p) {
    const out = [];
    for (const v of p.visuals) {
      // CORRECTED 2026-08-05, after this fired 20 times across 4 shipped templates.
      //
      // `skipCalculationCategories` does not change how the row RENDERS. It excludes the category
      // from the calculations the visual performs. So the fault needs the visual to actually
      // compute an aggregate over categories -- with no total there is nothing for an unskipped row
      // to corrupt, and the verified two-arm result in the held catalogue measured it with
      // `chartSettings.showGrandTotal: true` for exactly that reason.
      //
      // The corpus is unambiguous: `showGrandTotal` is set on 79 of 152 vendor Zebra Tables
      // (63 true, 16 false) with a whole family around it -- `grandTotalLabel`, `grandTotalGap`,
      // `freezeGrandTotal` -- and it is ABSENT on all 11 tables that fired. Where the vendor turns
      // a total on, their formula rows are correctly skipped. `showTotals` is NOT a substitute:
      // `Zebra BI - Working capital` carries `showTotals: 1` and the vendor's own render of that
      // page shows no total row and no total column.
      //
      // Gating this way can only produce a FALSE NEGATIVE, which AGENTS.md explicitly prefers to a
      // warning on a correct report.
      const cs = obj(v.parsed, "chartSettings");
      const computesTotal = ["showGrandTotal", "showColumnGrandTotal"].some((k) => {
        const val = cs && k in cs ? lit(cs[k]) : null;
        return val !== null && val !== "false" && val !== "0";
      });
      if (!computesTotal) continue;

      const cm = obj(v.parsed, "categoriesMetadata");
      const added = blob(cm?.addedFormulas);
      if (!Array.isArray(added) || !added.length) continue;
      const skipped = blob(cm?.skipCalculationCategories) ?? [];
      const skippedNames = new Set(skipped.map((s) => s?.category).filter(Boolean));
      for (const f of added) {
        if (f?.identity && !skippedNames.has(f.identity)) {
          out.push({ location: `${v.rel}:addedFormulas[${f.identity}]` });
        }
      }
    }
    return out;
  },

  // --- looks fine and is wrong anyway -------------------------------------------------------

  /** Colour properties are ignored unless style is Custom. */
  "colour-property-requires-style-custom"(p) {
    const GATED = ["positiveColor", "negativeColor", "neutralVarianceColor", "neutralColor",
      "markerColor", "lineColor", "axisColor", "gridlineColor", "dotChartColor",
      "highlightColor", "previousYearColor", "planColor", "forecastColor"];
    const out = [];
    for (const v of p.visuals) {
      if (!isZebra(v.visualType)) continue;
      for (const name of ["designSettings", "design"]) {
        const d = obj(v.parsed, name);
        if (!d) continue;
        const setColours = GATED.filter((k) => k in d);
        if (setColours.length && lit(d.style) !== "4") {
          out.push({ location: `${v.rel}:${name}.style (${setColours.length} colour(s) set)` });
        }
      }
    }
    return out;
  },

  /** A textbox shorter than its font needs clips text to fragments. */
  "textbox-height-below-font-floor"(p) {
    const out = [];
    for (const v of p.visuals) {
      if (v.visualType !== "textbox") continue;
      const h = v.parsed?.position?.height;
      if (typeof h !== "number") continue;
      const paragraphs = v.parsed?.visual?.visualContainerObjects?.general
        ?? v.parsed?.visual?.objects?.general;
      const sizes = JSON.stringify(paragraphs ?? {}).match(/"fontSize"\s*:\s*"?(\d+(?:\.\d+)?)/g) ?? [];
      const pt = Math.max(0, ...sizes.map((s) => parseFloat(s.replace(/\D*([\d.]+)$/, "$1"))));
      // MEASURED 2026-09-06, replacing the derived `pt * 1.733 + 16`.
      //
      // History, because the shape of the mistake matters. On 2026-08-05 the floor was lowered to
      // `pt * 1.333` because the derived one fired on 118 of the 263 sized textboxes in the 20
      // shipped templates -- 45%. That lowering was reverted, correctly: it had the unstated premise
      // that all 263 render correctly, and the held catalogue records two render-confirmed clips
      // (a 9pt label at h:16 that rendered `- .` instead of `Region`; a 22pt title at h:40 that gets
      // Power BI's own scrollbar), the second of which `pt * 1.333` would have let through at 29.3px.
      // The comment that replaced it said the rule needed a render pass rather than another
      // re-derivation.
      //
      // That render pass was run. A grid of textboxes, one font size per row and height stepping
      // across the columns, each box carrying its own `pt/height` label plus `Rgyjpq` so a cut
      // descender is unmistakable; then a second grid at 2px granularity. Clean/clipped boundary:
      //   9pt 26 | 11pt 28 | 12pt 30 | 13pt 31 | 14pt 33 | 16pt 36 | 20pt 41 | 22pt 44
      // `ceil(pt * 1.45 + 12)` fits all eight. In the 2px grid every arm at or above it rendered
      // clean and every arm below it clipped, with none straddling.
      //
      // The measured floor is strictly LOWER than the derived one at every size (26 vs 31.6 at 9pt,
      // 44 vs 54.1 at 22pt), so it can only fire on a subset of what fired before -- and it still
      // catches both of the cases the 08-05 revert was defending, which this sweep re-observed as
      // genuinely clipped. Write-up: hub research/design-layer/2026-09-06-density-and-gridlines-render-lab.md
      if (pt && h < Math.ceil(pt * 1.45 + 12)) {
        out.push({ location: `${v.rel}:position.height=${h} for ${pt}pt (needs ${Math.ceil(pt * 1.45 + 12)})` });
      }
    }
    return out;
  },

  /**
   * A slicer whose header is showing needs ~22px more than one with it off, and the header is
   * showing BY DEFAULT: an absent `header.show` renders pixel-identical to `true`. Measured
   * 2026-09-06 -- Dropdown at 10pt, header showing, clipped at 24/30/43/46 and clean at 52.
   *
   * 43 is the trap. The vendor's own header-OFF median is 43.7, so it is the height most likely
   * to be copied, and it is below the floor for the state a slicer is in unless someone turned the
   * header off on purpose.
   *
   * Swept against the 408 shipped slicers before it was written: 270 header off, 24 on, 114 unset,
   * and ZERO of the 138 with the header showing sit below 52. Silent on everything the vendor ships.
   */
  "slicer-height-must-clear-its-header"(p) {
    const out = [];
    for (const v of p.visuals) {
      if (v.visualType !== "slicer") continue;
      const h = v.parsed?.position?.height;
      if (typeof h !== "number") continue;
      // `header.show` absent === showing. Only an explicit false takes the short floor.
      const header = obj(v.parsed, "header");
      if (lit(header?.show) === "false") continue;
      // A list slicer is sized by its item count, which the file does not carry, so only the
      // dropdown -- the default mode, and the one with a fixed chrome height -- is decidable here.
      const mode = lit(obj(v.parsed, "data")?.mode);
      if (mode && mode !== "Dropdown") continue;
      if (h < 52) out.push({ location: `${v.rel}:position.height=${h} with the header showing` });
    }
    return out;
  },

  /**
   * A fixed row height below 16px overlaps a Table's data labels with its in-cell bars: every row
   * present, none readable. Measured 2026-09-06 -- 12 collides, 16 is clean. The vendor writes
   * `categorySettings.height` only at 21/24/28, and the census sweep found zero hits.
   */
  "table-fixed-row-height-must-stay-legible"(p) {
    const out = [];
    for (const v of p.visuals) {
      if (!isTable(v.visualType)) continue;
      const cs = obj(v.parsed, "categorySettings");
      if (!cs) continue;
      // `height` is read by rowHeight 5 (Fixed) alone, so anything else is inert, not illegible.
      if (lit(cs.rowHeight) !== "5") continue;
      const px = parseFloat(lit(cs.height) ?? "");
      if (Number.isFinite(px) && px < 16) {
        out.push({ location: `${v.rel}:categorySettings.height=${px}` });
      }
    }
    return out;
  },

  /** After a Desktop save, a measure token in a title renders as its literal text. */
  "title-token-broken-by-save-bookkeeping"(p) {
    const out = [];
    for (const v of p.visuals) {
      const t = obj(v.parsed, "titleSettings") ?? obj(v.parsed, "title");
      const text = lit(t?.text);
      if (!text || !/\[[^\]]+\]/.test(text)) continue;
      const objects = v.parsed?.visual?.objects ?? {};
      if ("version" in objects && "previewSettings" in objects) {
        out.push({ location: `${v.rel}:visual.objects.version + previewSettings` });
      }
    }
    return out;
  },

  /** Tables ignore the standard sort definition and use their own sort object. */
  "table-uses-its-own-sort-object"(p) {
    return p.visuals
      .filter((v) => {
        const sd = v.parsed?.visual?.query?.sortDefinition;
        if (!isTable(v.visualType) || !sd) return false;
        // CORRECTED 2026-08-05, after this fired on 82 of 82 tables in the 20 shipped templates.
        // The rule says a table given ONLY the standard sort renders in value order "rather than
        // the order you asked for". `isDefaultSort: true` is Power BI recording the sort it chose
        // BY ITSELF, so nobody asked for an order and there is no fault to report. Every sampled
        // vendor template carries it. Without this the checker fires on the mere presence of the
        // key, which is not the rule it claims to enforce.
        return sd.isDefaultSort !== true;
      })
      .map((v) => ({ location: `${v.rel}:visual.query.sortDefinition` }));
  },

  /** A handful of properties accept a value and change nothing at all. */
  "property-accepts-value-and-does-nothing"(p) {
    // `chartSettings.chartLayout` was briefly removed from this list on 2026-08-05 and RESTORED the
    // same day. Removing it was wrong, and the reason is worth keeping.
    //
    // chartLayout RESTORED 2026-08-05, on review, and the revert is right. The argument for removing
    // it was that the 20 shipped templates author seven distinct values across 35 visuals, and a
    // vendor does not author seven values of a property that does nothing. That is a CENSUS, and
    // published correction 3 had already settled the question BY RENDER: all nine declared values
    // rendered and hashed, eight byte-identical to setting no chartSettings at all, only `Waterfall`
    // distinct. So `!== "Waterfall"` is exactly right and the vendor's seven values really do
    // nothing. Correction 3 also records the opposite one-pair experiment "proving" the property was
    // honoured -- both one-pair conclusions are artefacts of which pair you pick.
    //
    // Consequence for the corpus run: those 35 findings are TRUE. Noise on a correct report, not a
    // fault in it, which is a different problem needing a different fix.
    //
    // useCustomScenarioColors RESTORED the same day, and this one was a second census mistake, made
    // in the hour after the first was retracted. It was removed arguing that formatting.md's
    // caveat -- inert verdicts measured with PreviousYear and Forecast never bound are "suspect by
    // construction" -- reaches any scenario-dependent property. It does not reach this one, because
    // this one has a render: `gate-experiment-colors.charts.json` runs it as an a/b gate over
    // negativeColor and planColor and both come back `verdict: "identical"`, and CORRECTIONS.md's
    // H1 records it bisected out of Desktop's own working bag. Render beats caveat, the same way
    // render beats census.
    //
    // varianceType REMOVED, and this is the one removal that survives -- on a render, not on the
    // caveat I reached for. The 2026-07-15 encoding re-run scored `cards.card.varianceType`
    // **VERIFIED_TRUE**: it works, and the "8 values -> 1 render" verdict was an artefact of writing
    // `'1'` where Desktop writes `1D`. That is correction 8's mechanism confirmed by direct
    // measurement. A property that WORKS cannot be on a list of properties that do nothing.
    //
    // So the standing rule for this list: an entry needs a render that varied EVERY declared value,
    // with the bindings the property acts on actually bound. A census cannot put one on, a census
    // cannot take one off, and neither can a caveat.
    const INERT = [
      ["chartSettings", "chartLayout", (val) => val && val !== "Waterfall"],
      ["designSettings", "useCustomScenarioColors", () => true],
      ["grid", "compactCards", () => true],
    ];
    const out = [];
    for (const v of p.visuals) {
      if (!isZebra(v.visualType)) continue;
      for (const [objName, prop, fires] of INERT) {
        const o = obj(v.parsed, objName);
        if (o && prop in o && fires(lit(o[prop]))) {
          out.push({ location: `${v.rel}:${objName}.${prop}` });
        }
      }
    }
    return out;
  },

  // REMOVED 2026-08-05: `projection-rename-requires-displayname`, and it must not come back.
  //
  // It was the top false-positive producer twice -- 19 hits on one hand-built project (3 Aug) and
  // 122 across the 20-template corpus (5 Aug) -- and both corrections narrowed the predicate
  // rather than questioning it. The predicate cannot be narrowed enough, because the fault and the
  // ordinary shape are BYTE-IDENTICAL. Its own known-bad fixture was `queryRef:
  // "Financials.Value AC"` with `nativeQueryRef: "AC_"`. The vendor shape it fired on wrongly is
  // `queryRef: "MasterData.AC"` with `nativeQueryRef: "AC2"`. Qualified queryRef, divergent
  // nativeQueryRef, no displayName, in both. Nothing in the file separates them: the difference is
  // author intent, and Desktop generates the divergence ITSELF to keep two same-named fields apart.
  //
  // So this was never a rule. It is prose, and it ships as prose in
  // `skills/report-authoring/references/visuals.md` -- "What a projection's four keys do".
  // The fact is true and useful; a check on it is a warning on a correct report, which this file's
  // header and AGENTS.md both rank as worse than no rule at all.

  /** A table's sort must name a field that table already shows, or the whole table blanks. */
  /**
   * The design fault a reviewer catches by eye and no other check does: a native pie, donut, gauge,
   * funnel, treemap, KPI light or filled map encodes a quantity as an angle, an area or a colour,
   * which readers compare far less accurately than a length. Measured against the 20 shipped
   * templates' 1,705 visuals before it was written: ZERO hits, so it is silent on everything the
   * vendor ships. Severity `looks-fine` because the page renders; it only misleads.
   */
  "native-visual-type-is-an-anti-pattern"(p) {
    const BAD = new Set(["pieChart", "donutChart", "gauge", "funnel", "treemap", "kpi", "filledMap", "shapeMap"]);
    const out = [];
    for (const v of p.visuals) {
      const t = v.visualType ?? "";
      if (BAD.has(t)) out.push({ location: `${v.rel}:visualType=${t}`, detail: t });
    }
    return out;
  },

  "table-sort-field-must-be-projected"(p) {
    const out = [];
    for (const v of p.visuals) {
      // CORRECTED 2026-08-05. This loop had NO visual-type guard, while its sibling
      // `table-uses-its-own-sort-object` twelve lines up has one. So it judged a CARDS visual by a
      // Tables rule and reported severity `blank` -- telling the customer a table renders empty --
      // on `Zebra BI - Working capital`, a reference template. A Tables rule must only read Tables.
      if (!isTable(v.visualType)) continue;
      const sorts = v.parsed?.visual?.query?.sortDefinition?.sort;
      if (!Array.isArray(sorts)) continue;
      const shown = new Set();
      for (const well of Object.values(v.parsed?.visual?.query?.queryState ?? {})) {
        for (const pr of well?.projections ?? []) {
          if (pr?.queryRef) shown.add(pr.queryRef);
          if (pr?.nativeQueryRef) shown.add(pr.nativeQueryRef);
        }
      }
      sorts.forEach((s, i) => {
        const ref = s?.field?.Column?.Property ?? s?.field?.Measure?.Property ?? s?.queryRef;
        // Only decidable when the sort names something. An unresolvable shape is not a finding.
        if (ref && shown.size && ![...shown].some((q) => q.endsWith(ref) || ref.endsWith(q))) {
          out.push({ location: `${v.rel}:sortDefinition.sort[${i}]=${ref}` });
        }
      });
    }
    return out;
  },

  /** Every filterConfig entry needs a name. One without stops the report opening. */
  "filterconfig-entry-requires-name"(p) {
    const out = [];
    const scan = (f, where) => {
      for (const [i, e] of (f?.filters ?? []).entries()) {
        if (!e?.name) out.push({ location: `${where}:filterConfig.filters[${i}]` });
      }
    };
    for (const v of p.visuals) scan(v.parsed?.filterConfig, v.rel);
    for (const pg of p.pages) scan(pg.parsed?.filterConfig, pg.rel);
    const r = p.files.get("definition/report.json");
    if (r && !r.parseError) scan(r.parsed?.filterConfig, r.rel);
    return out;
  },

  /** A slicer's saved selection sits one level deeper than it looks: filter inside filter. */
  "slicer-selection-must-be-nested-twice"(p) {
    const out = [];
    for (const v of p.visuals) {
      const g = obj(v.parsed, "general");
      const f = g && g.filter;
      if (!f) continue;
      // Correct: { filter: { filter: { Version, From, Where } } }. Wrong: the inner keys sit
      // directly under `filter`, which renders as no selection and totals every period at once.
      const inner = f.filter ?? f;
      if (inner && ("Where" in inner || "From" in inner) && !f.filter) {
        out.push({ location: `${v.rel}:objects.general.filter` });
      }
    }
    return out;
  },

  /** A nested view object needs its full key set. Omit one and chart cells render solid black. */
  "nested-settings-object-requires-every-key"(p) {
    const REQUIRED = ["backgroundFill", "textColor", "markerStyle"];
    const out = [];
    for (const v of p.visuals) {
      const cs = blob(obj(v.parsed, "chartSettings")?.columnSettings);
      if (!cs || typeof cs !== "object") continue;
      for (const [key, col] of Object.entries(cs)) {
        const view = col?.chartView;
        if (!view || typeof view !== "object") continue;
        const missing = REQUIRED.filter((k) => !(k in view));
        if (missing.length) {
          out.push({ location: `${v.rel}:columnSettings.${key}.chartView (missing ${missing.join(", ")})` });
        }
      }
    }
    return out;
  },

  /** A card size written into the card data is accepted and then silently ignored. */
  "cards-sizing-not-settable-in-card-data"(p) {
    const out = [];
    for (const v of p.visuals) {
      if (!isCards(v.visualType)) continue;
      const u = blob(obj(v.parsed, "customData")?.uniformData);
      if (!u) continue;
      const cardCount = u.cards && typeof u.cards === "object" ? Object.keys(u.cards).length : 0;
      if (u.globalCardSize && cardCount === 0) {
        out.push({ location: `${v.rel}:customData.uniformData.globalCardSize` });
      }
    }
    return out;
  },

  /**
   * A page pinned to one period by a page filter, with no slicer for that field, can only ever show
   * that period. The report is a snapshot pretending to be a dashboard.
   *
   * Scoped tightly so it stays quiet on correct work: only TIME-shaped column names, only a
   * PAGE-level filter (a visual-level one is a deliberate scoping choice), and it is satisfied by any
   * slicer on the SAME page bound to the SAME column. Measured across the 20 shipped templates before
   * shipping: 1 firing page out of 197, in 1 template. The vendor pairs its page filters with slicers
   * essentially always, which is the pattern this encodes.
   */
  "page-filter-on-a-time-column-with-no-slicer-for-it"(p) {
    const TIME = new Set(["Year", "Date", "Month", "Month Name", "MonthName", "Period", "Quarter",
      "FY", "Fiscal Year", "YearMonth", "Month Start", "Fiscal year", "Years"]);
    const pageOf = (rel) => {
      const m = /definition\/pages\/([^/]+)\//.exec(String(rel).replace(/\\/g, "/"));
      return m ? m[1] : null;
    };
    // which columns does a slicer offer, per page
    const sliced = new Map();
    for (const v of p.visuals) {
      if (v.visualType !== "slicer") continue;
      const pg = pageOf(v.rel);
      if (!pg) continue;
      if (!sliced.has(pg)) sliced.set(pg, new Set());
      for (const proj of projections(v.parsed, "Values")) {
        const name = proj?.field?.Column?.Property ?? proj?.nativeQueryRef;
        if (name) sliced.get(pg).add(name);
      }
    }
    const out = [];
    for (const page of p.pages ?? []) {
      if (page.parseError) continue;
      const filters = page.parsed?.filterConfig?.filters;
      if (!Array.isArray(filters)) continue;
      const pg = pageOf(page.rel);
      const have = sliced.get(pg) ?? new Set();
      for (const f of filters) {
        const col = f?.field?.Column?.Property;
        if (!col || !TIME.has(col) || have.has(col)) continue;
        out.push({ location: `${page.rel}:filterConfig (${col}, no slicer for it on this page)` });
      }
    }
    return out;
  },

  /**
   * A `visual` member written at the visual.json ROOT is a will-not-open fault: Desktop refuses the
   * report and names the property and the file. It is worth catching from the text on disk, because
   * the alternative is a ~75s launch that ends in a modal a title check cannot even see.
   *
   * Deliberately a DENYLIST of five names that unambiguously belong to `visual`, not an allowlist of
   * legal root keys: an allowlist needs the full container schema and would fire on every key
   * Microsoft adds later, which is the shape of the gate-D2 false-positive run.
   *
   * CORPUS MEASUREMENT, 2026-08-14 — read this before re-running it and reading a zero as a pass.
   * This rule and `tooltip-page-schema-too-old-for-type` CANNOT be measured against the 20 shipped
   * templates: all 20 are PBIR-**Legacy** (`Report/Layout`, no `Report/definition/pages/` tree), so
   * there are no `page.json` or `visual.json` files for either rule to read. The sweep returns zero
   * because it reads nothing, which is exactly the "beautiful zero" AGENTS.md warns about — it is not
   * evidence of silence on the reference templates.
   *
   * What was measured instead, both directions:
   *   - 24 real PBIR projects (65 pages, 334 visuals): this rule 0 findings; the tooltip rule 1, and
   *     that one is a deliberately broken probe arm. No false positives.
   *   - Positive controls in the SAME invocation, so the sweep is provably live: a real inert arm
   *     fires the tooltip rule, and a copy with `visualContainerObjects` hoisted to the container
   *     root fires this one.
   * If the corpus is ever converted to PBIR, re-run it — that is the measurement this pair still owes.
   */
  "visual-json-root-must-not-carry-a-property-that-belongs-inside-visual"(p) {
    const INSIDE = ["visualType", "query", "objects", "visualContainerObjects",
      "drillFilterOtherVisuals"];
    const out = [];
    for (const v of p.visuals ?? []) {
      if (v.parseError) continue;
      const root = v.parsed;
      if (!root || typeof root !== "object") continue;
      for (const k of INSIDE) {
        if (Object.prototype.hasOwnProperty.call(root, k)) {
          out.push({ location: `${v.rel}: "${k}" is at the root; it belongs inside "visual"` });
        }
      }
    }
    return out;
  },

  /**
   * A tooltip page needs BOTH `pageBinding.type: "Tooltip"` and a top-level `type: "Tooltip"`.
   * `pageBinding` alone registers the page as a binding target and is accepted without complaint —
   * the page then simply never opens on hover, which is invisible to every other check here.
   *
   * The usual cause is the schema reference: top-level `type` does not exist before page schema
   * `2.0.0`, and earlier versions set `additionalProperties: false`, so on `1.0.0` the property
   * cannot be written at all. Reported with the version because that is the actual fix.
   *
   * A page counts as a tooltip page if it says so itself (`pageBinding.type`) OR if any visual
   * points at it with `visualTooltip.section` — the second half catches the case where the consumer
   * was authored and the page was never marked, which renders as "the tooltip does nothing".
   */
  /**
   * An actionButton's `text` object is an array of STATE-SCOPED entries. The label value has to sit
   * in an entry carrying a `selector` (normally {id:"default"}, sometimes {id:"hover"}); an entry
   * with no selector holds state-independent properties such as `show`. A label written into a
   * selector-less entry is dropped silently -- the button renders as a bare coloured rectangle,
   * validates clean, and looks deliberate.
   *
   * Deliberately narrow. It fires ONLY when a selector-less entry carries a `text` property, which
   * is the exact authoring mistake; a button with no label at all is legitimate (icon buttons), and
   * a label under {id:"hover"} alone is authored in shipped templates, so neither of those fires.
   */
  "action-button-text-has-state-selector"(p) {
    const out = [];
    for (const v of p.visuals ?? []) {
      if (v.parseError) continue;
      const vis = v.parsed?.visual;
      if (vis?.visualType !== "actionButton") continue;
      const entries = vis?.objects?.text;
      if (!Array.isArray(entries)) continue;
      const bad = entries.some(
        (e) => e && e.properties && "text" in e.properties && !e.selector
      );
      if (bad) out.push({ location: `${v.rel}: objects.text` });
    }
    return out;
  },

  "tooltip-page-must-declare-page-schema-2-0-0-or-later"(p) {
    // section holds a page name, so unwrap the quotes only -- lit() also strips a trailing D/L/M,
    // which would corrupt a page legitimately named e.g. "TrendM".
    const section = (prop) => {
      const raw = prop?.expr?.Literal?.Value;
      if (typeof raw !== "string") return null;
      return raw.replace(/^'/, "").replace(/'$/, "");
    };
    const targeted = new Set();
    for (const v of p.visuals ?? []) {
      const vt = v.parsed?.visual?.visualContainerObjects?.visualTooltip;
      if (!Array.isArray(vt)) continue;
      for (const entry of vt) {
        const s = section(entry?.properties?.section);
        if (s && s !== "___AUTO___") targeted.add(s);
      }
    }
    const out = [];
    for (const page of p.pages ?? []) {
      if (page.parseError) continue;
      const d = page.parsed ?? {};
      const name = d.name ?? page.pageName;
      const declares = d.pageBinding?.type === "Tooltip";
      if (!declares && !targeted.has(name)) continue;
      if (d.type === "Tooltip") continue;
      const m = /\/page\/(\d+)\.(\d+)\.(\d+)\/schema\.json/.exec(String(d.$schema ?? ""));
      const why = m && Number(m[1]) < 2
        ? `page schema ${m[1]}.${m[2]}.${m[3]} cannot express top-level "type" — bump it to 2.0.0`
        : `top-level "type": "Tooltip" is missing`;
      const how = declares ? "pageBinding says Tooltip" : "a visual points at it as a canvas tooltip";
      out.push({ location: `${page.rel}: ${why} (${how})` });
    }
    return out;
  },

  /**
   * A numeric-valued enum written in word form (`'3'` instead of `3D`) is not a declared value, so
   * it is dropped in silence and the visual keeps its default. On `chartType` that means the chart
   * you asked for is not the chart you get — one report in the field set `'2'` on both charts and got the
   * default waterfall.
   *
   * The property list is a WHITELIST derived from the 20 shipped templates, not a guess: every name
   * below is 100% D-suffixed there with zero quoted exceptions (chartType 139/139, orientation
   * 160/160, categorySort and chartSort 121 each, valueChart 97, displayOptions 90, and so on).
   * Deliberately excluded, because the corpus itself uses both forms and a rule cannot assert what
   * the vendor contradicts: `fontSize` (355 D vs 37 quoted), `axisBreakPercent` (4 vs 4),
   * `areaNeutralOpacity` (1 vs 5). Geometry properties are excluded too — a quoted number may well
   * coerce there, and this rule only claims the case it can prove.
   */
  "numeric-enum-must-not-be-quoted"(p) {
    const NUMERIC_ENUMS = new Set([
      "chartType", "style", "varianceType", "axisLabelDensity", "valueChart", "relativeChart",
      "absoluteChart", "referenceDisplayType", "cardDefaultChartType", "varianceDisplayType",
      "differenceLabelType", "varianceLabelType", "categorySort", "chartSort", "sort",
      "sortReferenceChart", "showTopNChartsOptions", "multiplesAxisLabelsOptions", "gridlineStyle",
      "displayOptions", "negativeValuesFormat", "orientation", "outlineStyle", "varianceIcon",
      "categoryLabelsOptions", "differenceHighlightArrowStyle", "labelDisplayUnits",
      // Added 2026-09-06 with the density layer. Corpus: rowHeight 46 visuals, labelDensity 39
      // across its two object groups, dotChartMarkerDensity 2 -- 87 in total, every one D-form,
      // zero quoted exceptions, so adding them fires on nothing the vendor ships. They were absent
      // for the same reason `chartType` was until 2026-08-05: the list grows by whatever the
      // session in front of it happened to touch, and `chartType`'s absence is how a tester's
      // report came to set '2' on both its charts.
      "rowHeight", "labelDensity", "dotChartMarkerDensity",
    ]);
    const out = [];
    for (const v of p.visuals) {
      if (!isZebra(v.visualType)) continue;
      const objects = v.parsed?.visual?.objects;
      if (!objects || typeof objects !== "object") continue;
      for (const [objName, entries] of Object.entries(objects)) {
        if (!Array.isArray(entries)) continue;             // its own rule
        for (const entry of entries) {
          for (const [prop, val] of Object.entries(entry?.properties ?? {})) {
            if (!NUMERIC_ENUMS.has(prop)) continue;
            const raw = val?.expr?.Literal?.Value;
            if (typeof raw !== "string") continue;
            if (/^'\d+'$/.test(raw)) {
              out.push({ location: `${v.rel}:${objName}.${prop} (${raw})` });
            }
          }
        }
      }
    }
    return out;
  },

  /*
   * REJECTED 2026-08-05: "a Category-bound Cards visual needs >=264px of height".
   *
   * Written after a Cards row in a field report (Category+Group+Values+Plan, 1248x200) rendered with a
   * scrollbar, reasoning that the render-verified 264px floor for the no-Category shape must be a
   * lower bound for the taller Category-bound one. Measured before shipping, against the 20
   * shipped templates: it fired on FOUR of them, and not because of the per-card sizing blob —
   * `Cost Management` (168px), `HR analytics` (226px), `Social media dashboard` (118px) and
   * `Working capital` (118px) all bind Category on Cards with NO `uniformData` at all.
   *
   * So the premise is false: the vendor ships Category-bound Cards at 118px. Whatever produced
   * that report's scrollbar, it is not "the container is under 264". Left unimplemented rather
   * than narrowed, because a threshold that four shipped templates violate is not a threshold.
   * The shape guidance (a series per tile is small multiples, not Cards) stands on its own and
   * needs no rule.
   */

  /*
   * REJECTED: "a textbox containing a year, month or period token hardcodes a data value".
   *
   * The guidance behind it is sound and ships as prose: a dashboard is read after the reader has
   * moved the slicers, so text stating a value goes stale silently. The natural rule is to flag a
   * textbox whose text carries a year (19xx/20xx), a month name, or Q1..Q4 / YTD / MTD / FY.
   *
   * Measured before shipping, over the 263 textbox visuals in the 20 shipped templates: 11 hits,
   * and ALL ELEVEN are false positives. Nine are the footer "(c)2024 Zebra BI" / "(c)2025 Zebra BI".
   * Two are page titles describing the report's STRUCTURE, not its data -- "MTD vs YTD vs Full-Year
   * with Forecasts" and " MTD, YTD & Full Year". Zero true positives.
   *
   * A year in a textbox is overwhelmingly a copyright line, and a period word is overwhelmingly a
   * column-layout description. Neither goes stale. The fault we actually care about -- a title
   * reading "FY2020" on a page whose slicer can move off 2020 -- does not appear in the corpus at
   * all, so there is no positive control to narrow against either. Shipping this would put a
   * warning on nine correct reports to catch a fault we cannot yet demonstrate.
   *
   * If it is revisited: exempt anything matching a copyright mark, require the token to be a
   * SPECIFIC period rather than a period-type word (2020 or "Jan 2024" but not "YTD"), and find a
   * real positive first -- a report in the field where the title went stale. Prose only until then.
   */

  /**
   * Percent units on a measure that is already percent-formatted scales it twice, so the number
   * renders confidently a hundred times too large. The only rule here that needs the model:
   * the report says "treat this as a fraction", and only TMDL says whether it already is one.
   */
  "percent-units-on-percent-formatted-measure"(p) {
    const out = [];
    if (!p.model || !p.model.present) return out;     // no model read, no claim
    const byName = tmdl.measureIndex(p.model);
    for (const v of p.visuals) {
      if (!isTable(v.visualType)) continue;
      const units = lit(obj(v.parsed, "dataLabelSettings")?.units);
      if (units !== "P") continue;
      for (const pr of projections(v.parsed, "Values")) {
        const ref = (pr?.nativeQueryRef || pr?.queryRef || "").toLowerCase();
        const m = byName.get(ref) || byName.get(ref.split(".").pop());
        if (m && tmdl.isPercentFormat(m.formatString || "")) {
          out.push({ location: `${v.rel}:dataLabelSettings.units='P' on ${m.table}[${m.name}]` });
        }
      }
    }
    return out;
  },

  /** Inside column settings the in-cell chart switch is a number, not a boolean. */
  "column-settings-showastable-is-an-enum"(p) {
    const out = [];
    for (const v of p.visuals) {
      const cs = blob(obj(v.parsed, "chartSettings")?.columnSettings);
      if (!cs || typeof cs !== "object") continue;
      for (const [key, col] of Object.entries(cs)) {
        for (const view of ["tableView", "chartView"]) {
          const val = col?.[view]?.showAsTable;
          if (typeof val === "boolean") {
            out.push({ location: `${v.rel}:columnSettings.${key}.${view}.showAsTable` });
          }
        }
      }
    }
    return out;
  },

  // ☠️ A relationship END on a CALCULATED table whose column is declared the IMPORTED way.
  //
  // On a calculated (DATATABLE) table a column binds to the DAX output via `isNameInferred` and a
  // BRACKETED `sourceColumn: [K]`. Write the imported-table form -- `sourceColumn: K` -- and the
  // table still loads and COUNTROWS still returns, so nothing looks wrong. It only breaks when a
  // RELATIONSHIP tries to resolve that column, and then it takes the WHOLE model down at cold open:
  //
  //   Relationship 'FactsToDim' uses an invalid column ID 17.   (PFE_TM_RELATIONSHIP_END_COLUMN_INVALID)
  //
  // The message names the relationship, so the instinct is to suspect the relationship. The
  // relationship is correct; the COLUMN is. Cost two modal dialogs and two dead cold opens.
  //
  // Scoped to related columns ON PURPOSE. An unbracketed sourceColumn on an unrelated calculated
  // table is harmless and extremely common, so flagging every one of them would be noise. The
  // relationship is what makes it fatal, so the relationship is part of the rule.
  "calculated-table-column-must-bind-by-inferred-name"(p) {
    if (!p.model || !p.model.present) return [];
    const calcCols = new Map();      // "Table.Column" -> { rel, ok }
    const ends = [];                 // { rel, relName, ref }

    for (const src of p.model.sources || []) {
      const lines = src.text.split(/\r?\n/);
      let table = null, isCalc = false, colName = null, colOk = false, colSeen = false;
      const flush = () => {
        if (table && colName && colSeen) calcCols.set(`${table}.${colName}`, { rel: src.rel, ok: colOk, isCalc });
        colName = null; colOk = false; colSeen = false;
      };
      let relName = null;
      for (const raw of lines) {
        const t = raw.trim();
        let m;
        if ((m = /^table\s+'?([^'\r\n]+?)'?\s*$/.exec(t))) { flush(); table = m[1].trim(); isCalc = false; continue; }
        if (/^partition\s+.*=\s*calculated\s*$/.test(t)) {
          isCalc = true;
          // columns are usually declared BEFORE the partition, so re-stamp what we already collected
          for (const [k, v] of calcCols) if (k.startsWith(`${table}.`)) v.isCalc = true;
          continue;
        }
        if ((m = /^column\s+'?([^'\r\n=]+?)'?\s*$/.exec(t))) { flush(); colName = m[1].trim(); colSeen = true; continue; }
        if (colSeen && /^isNameInferred\b/.test(t)) { colOk = true; continue; }
        if (colSeen && /^sourceColumn:\s*\[.+\]\s*$/.test(t)) { colOk = true; continue; }
        if ((m = /^relationship\s+'?([^'\r\n]+?)'?\s*$/.exec(t))) { relName = m[1].trim(); continue; }
        if ((m = /^(?:from|to)Column:\s*'?([^'\r\n]+?)'?\s*$/.exec(t))) {
          ends.push({ rel: src.rel, relName: relName || "(unnamed)", ref: m[1].trim().replace(/'/g, "") });
        }
      }
      flush();
    }

    const out = [];
    for (const e of ends) {
      const col = calcCols.get(e.ref);
      if (col && col.isCalc && !col.ok) {
        out.push({ location: `${col.rel}:${e.ref}`,
                   detail: `relationship '${e.relName}' points at a calculated-table column that binds by source name` });
      }
    }
    return out;
  },

  // --- the TMDL grammar, from the structural tree ---------------------------------------------
  //
  // Every rule below was produced ON PURPOSE against Power BI Desktop 2.157.879.0 on 2026-09-05,
  // one variant at a time through file.reload/v1 on a base model that itself loaded clean, and
  // the quoted messages are what Desktop returned. Each is screened against 850 real .tmdl files
  // (the 20 shipped templates and every model this project has built) with zero hits. They read
  // the tree in tmdl-tree.js rather than regexes, so a fault is located on a node with a line.

  /**
   * A property name TMDL does not know on that object. Desktop: "The keyword 'isHiden' is neither
   * a property nor an object in the current context!" A typo and an invented property look alike
   * to the parser, and both stop the cold open. `discourageReportMeasures` is a real TOM property
   * that this Desktop's reader still refuses, so it is named separately.
   */
  "tmdl-property-must-exist-on-its-object"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const n of s.tree.nodes) {
        const sch = T.SCHEMA[n.type];
        if (!sch || T.underCulture(n)) continue;
        for (const pr of n.props) {
          const k = pr.name.toLowerCase();
          if (sch.props.has(k) || sch.children.has(k)) continue;
          const detail = T.REJECTED_BY_DESKTOP.has(k)
            ? `'${pr.name}' is a Tabular Object Model property, and Power BI Desktop's TMDL reader still refuses it`
            : `'${pr.name}' is not a property of ${n.type}`;
          out.push({ location: `${s.rel}:${pr.line}:${n.type} ${n.name || ""}`.trim(), detail });
        }
        for (const c of n.children) {
          if (c.type === "ref" || c.type === "other") continue;
          if (!sch.children.has(c.type) && !T.SCHEMA[c.type] && !T.underCulture(c)) {
            out.push({ location: `${s.rel}:${c.line}:${n.type} ${n.name || ""}`.trim(),
                       detail: `'${c.typeRaw || c.type}' is not an object TMDL knows under ${n.type}` });
          }
        }
      }
    }
    return out;
  },

  /**
   * An enum property with a value outside the enum. Desktop: "Failed to convert the value 'total'
   * to the expected type AggregateFunction!" -- `int64` not `integer`, `dateTime` not `date`,
   * `sum` not `total`. Values are read case-insensitively, so only the spelling is judged.
   */
  "tmdl-enum-property-must-use-a-legal-value"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const n of s.tree.nodes) {
        if (!T.SCHEMA[n.type] || T.underCulture(n)) continue;
        for (const pr of n.props) {
          const k = pr.name.toLowerCase();
          if (!T.ENUMS[k] || pr.delim !== ":") continue;
          const v = pr.value.replace(/^"(.*)"$/, "$1").trim().toLowerCase();
          if (!T.ENUMS[k].includes(v)) {
            out.push({ location: `${s.rel}:${pr.line}`,
                       detail: `${pr.name}: ${pr.value} -- legal values are ${T.ENUMS[k].join(", ")}` });
          }
        }
      }
    }
    return out;
  },

  /**
   * The same property twice on one object. Desktop: "Duplicated property - dataType appears more
   * then once in the current context!" The exceptions are the genuinely repeatable ones
   * (`associatedColumn`, `groupByColumn`), which the schema marks.
   */
  "tmdl-property-declared-once-per-object"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const n of s.tree.nodes) {
        const sch = T.SCHEMA[n.type];
        if (!sch || T.underCulture(n)) continue;
        const seen = new Map();
        for (const pr of n.props) {
          const k = pr.name.toLowerCase();
          if (sch.repeatable.has(k) || k === "annotation" || k === "extendedproperty" || k === "changedproperty") continue;
          if (seen.has(k)) out.push({ location: `${s.rel}:${pr.line}`, detail: `${pr.name} already set on line ${seen.get(k)}` });
          else seen.set(k, pr.line);
        }
      }
    }
    return out;
  },

  /**
   * The same object declared twice in one collection, across files or within one. Desktop:
   * "TMDL objects cannot be merged because both declare the same property: expression /
   * 1st object: type=Measure, name='AC', path='./tables/Sales measures'". Partial declaration is
   * legal -- a table may be split over files -- so the collision is the child, not the table.
   */
  "tmdl-object-declared-once-per-parent"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    const seen = new Map();       // "table|kind|name" -> "rel:line"
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const t of s.tree.root.children) {
        if (t.type === "table") {
          for (const c of t.children) {
            if (!["measure", "column", "hierarchy", "partition", "calendar"].includes(c.type)) continue;
            const key = `${t.name.toLowerCase()}|${c.type}|${c.name.toLowerCase()}`;
            const where = `${s.rel}:${c.line}`;
            if (seen.has(key)) out.push({ location: where, detail: `${c.type} '${c.name}' of table '${t.name}' is also declared at ${seen.get(key)}` });
            else seen.set(key, where);
          }
        } else if (["relationship", "role", "perspective", "expression", "function"].includes(t.type)) {
          const key = `|${t.type}|${t.name.toLowerCase()}`;
          const where = `${s.rel}:${t.line}`;
          if (seen.has(key)) out.push({ location: where, detail: `${t.type} '${t.name}' is also declared at ${seen.get(key)}` });
          else seen.set(key, where);
        }
      }
    }
    return out;
  },

  /**
   * A relationship endpoint that names a table or column the model does not declare. Desktop:
   * "Cannot resolve all the paths while de-serializing Database. Property ToColumn of object
   * "relationship X" refers to an object which cannot be found" -- the whole project refuses to
   * open. The DAX bracket form `Calendar[Date]` fails the same way ("does not match the actual
   * path"): TMDL wants `Calendar.Date`, each part quoted only if it needs it.
   */
  "tmdl-relationship-endpoints-must-resolve"(p) {
    if (!p.model || !p.model.present) return [];
    const cols = new Set();
    let anyTable = false;
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const t of s.tree.root.children) {
        if (t.type !== "table") continue;
        anyTable = true;
        for (const c of t.children) if (c.type === "column") cols.add(`${t.name.toLowerCase()}.${c.name.toLowerCase()}`);
      }
    }
    if (!anyTable) return [];
    const out = [];
    const splitRef = (ref) => {
      const m = ref.trim().match(/^('(?:[^']|'')*'|[^.'\s][^.']*)\.('(?:[^']|'')*'|.+)$/);
      if (!m) return null;
      return { table: T.unquoteName(m[1]), column: T.unquoteName(m[2]) };
    };
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const r of s.tree.root.children) {
        if (r.type !== "relationship") continue;
        for (const end of ["fromColumn", "toColumn"]) {
          const pr = T.prop(r, end);
          if (!pr) { out.push({ location: `${s.rel}:${r.line}`, detail: `relationship '${r.name}' has no ${end}` }); continue; }
          if (/\[.+\]\s*$/.test(pr.value)) {
            out.push({ location: `${s.rel}:${pr.line}`, detail: `${end}: ${pr.value} is the DAX bracket form; TMDL wants Table.Column` });
            continue;
          }
          const ref = splitRef(pr.value);
          if (!ref) { out.push({ location: `${s.rel}:${pr.line}`, detail: `${end}: ${pr.value} is not Table.Column` }); continue; }
          if (!cols.has(`${ref.table.toLowerCase()}.${ref.column.toLowerCase()}`)) {
            out.push({ location: `${s.rel}:${pr.line}`, detail: `${end}: ${pr.value} -- no column '${ref.column}' is declared on table '${ref.table}'` });
          }
        }
      }
    }
    return out;
  },

  /**
   * A `///` description separated from its object by a blank line. Desktop: "Unexpected line
   * type: Empty!" at the blank line. The description binds to the very next line. The same
   * reader reports a ``` fence that is never closed, which swallows the rest of the file.
   */
  "tmdl-description-must-touch-its-object"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const f of s.tree.faults) {
        if (f.kind === "description-gap") out.push({ location: `${s.rel}:${f.line}`, detail: `the /// on line ${f.descLine} is followed by a blank line` });
        if (f.kind === "dangling-description") out.push({ location: `${s.rel}:${f.line}`, detail: "a /// description with no object after it" });
        if (f.kind === "unclosed-fence") out.push({ location: `${s.rel}:${f.line}`, detail: "a ``` fence that is never closed swallows the rest of the file" });
      }
    }
    return out;
  },

  /** `database.tmdl` must begin with the `database` line; a bare property fails with "Unexpected line type: Property!". */
  "tmdl-database-file-must-declare-database"(p) {
    if (!p.model || !p.model.present) return [];
    const db = (p.model.sources || []).find((s) => /(^|\/)database\.tmdl$/i.test(s.rel));
    if (!db || !db.tree) return [];
    if (db.tree.root.children.some((n) => n.type === "database")) return [];
    if (!db.text.trim()) return [];
    return [{ location: `${db.rel}:1`, detail: "the file has properties but no `database` line above them" }];
  },

  /**
   * Two objects in one collection sharing a lineageTag. Desktop: "An object with lineage-tag '...'
   * already exists in the collection." Tags are optional; when written they must be unique.
   */
  "tmdl-lineagetag-must-be-unique"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    const seen = new Map();
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const n of s.tree.nodes) {
        const pr = T.prop(n, "lineageTag");
        if (!pr || !pr.value) continue;
        const parentKey = n.parent && n.parent.type !== "root" ? `${n.parent.type}:${(n.parent.name || "").toLowerCase()}` : "model";
        const key = `${parentKey}|${n.type}|${pr.value.toLowerCase()}`;
        if (seen.has(key)) out.push({ location: `${s.rel}:${pr.line}`, detail: `lineageTag ${pr.value} is also on ${seen.get(key)}` });
        else seen.set(key, `${s.rel}:${pr.line}`);
      }
    }
    return out;
  },

  /**
   * An object the model's compatibility level does not allow. Desktop: "The database compatibility
   * level of 1606 is below the minimal compatability level of 1702 needed for [model Model].[function
   * AddTax]." A `calendar` object also needs the Enhanced DAX Time Intelligence preview: without it
   * Desktop 2.157 says "The model contains a custom calendar. This feature is not supported."
   */
  "tmdl-feature-needs-compatibility-level"(p) {
    if (!p.model || !p.model.present) return [];
    const level = p.model.compatibilityLevel;
    const out = [];
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const n of s.tree.nodes) {
        const min = T.MIN_COMPAT[n.type];
        if (!min) continue;
        if (n.type === "calendar") {
          out.push({ location: `${s.rel}:${n.line}`, detail: `calendar '${n.name}' needs compatibilityLevel ${min} and the Enhanced DAX Time Intelligence preview; without the preview Desktop refuses the model outright` });
          continue;
        }
        if (level !== null && level < min) out.push({ location: `${s.rel}:${n.line}`, detail: `${n.type} '${n.name}' needs compatibilityLevel ${min}; database.tmdl says ${level}` });
      }
      if (level !== null && level < T.MIN_COMPAT.formatstringdefinition) {
        for (const n of s.tree.nodes) {
          const pr = T.prop(n, "formatStringDefinition");
          if (pr) out.push({ location: `${s.rel}:${pr.line}`, detail: `formatStringDefinition needs compatibilityLevel ${T.MIN_COMPAT.formatstringdefinition}; database.tmdl says ${level}` });
        }
      }
    }
    return out;
  },

  /**
   * A calculation group on a model without `discourageImplicitMeasures`. Desktop: "The Model
   * 'Model' property DiscourageImplicitMeasures must be set to true in order to create any
   * calculation groups." Measured 2026-09-05; the flag is a bare line in model.tmdl.
   */
  "calculation-group-requires-discourageimplicitmeasures"(p) {
    if (!p.model || !p.model.present) return [];
    let flag = false; const groups = [];
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const n of s.tree.root.children) {
        if (n.type === "model" && T.propBool(n, "discourageImplicitMeasures")) flag = true;
        if (n.type === "table") for (const c of n.children) if (c.type === "calculationgroup") groups.push({ location: `${s.rel}:${c.line}`, detail: `table '${n.name}' is a calculation group` });
      }
    }
    return flag ? [] : groups;
  },

  /**
   * A measure with both `formatString` and `formatStringDefinition`. Desktop: "The Measure
   * 'Sales'['AC auto'] has both FormatString property and FormatStringDefinition property
   * defined which is not supported scenario."
   */
  "measure-must-not-carry-both-formatstring-and-definition"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const n of s.tree.nodes) {
        if (n.type !== "measure") continue;
        const a = T.prop(n, "formatString"), b = T.prop(n, "formatStringDefinition");
        if (a && b) out.push({ location: `${s.rel}:${b.line}`, detail: `measure '${n.name}' -- drop formatString (line ${a.line}) or the definition` });
      }
    }
    return out;
  },

  /**
   * `securityFilteringBehavior: bothDirections` on a relationship whose `crossFilteringBehavior`
   * is one-way. Desktop: "cannot have SecurityFilterBehavior set to BothDirections when the
   * CrossFilterBehavior is set to OneDirection."
   */
  "securityfiltering-both-requires-crossfiltering-both"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const r of s.tree.root.children) {
        if (r.type !== "relationship") continue;
        const sec = (T.propValue(r, "securityFilteringBehavior") || "").toLowerCase();
        const cross = (T.propValue(r, "crossFilteringBehavior") || "onedirection").toLowerCase();
        if (sec === "bothdirections" && cross !== "bothdirections") out.push({ location: `${s.rel}:${r.line}`, detail: `relationship '${r.name}'` });
      }
    }
    return out;
  },

  /**
   * An unquoted name containing a dot loads -- under the WRONG name. `measure AC.v2 = [AC]`
   * created a measure called `v2` (read back from TMSCHEMA_MEASURES, 2026-09-05), and every
   * report binding to `AC.v2` then fails to resolve. Quote it: `measure 'AC.v2'`.
   */
  "tmdl-name-with-a-dot-must-be-quoted"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const n of s.tree.nodes) {
        if (!["table", "column", "measure", "hierarchy", "level", "partition", "calculationitem", "role", "perspective", "expression"].includes(n.type)) continue;
        if (n.rawName && !n.rawName.startsWith("'") && n.rawName.includes(".") && !/^[0-9a-f]{8}-/.test(n.rawName)) {
          out.push({ location: `${s.rel}:${n.line}`, detail: `${n.type} ${n.rawName} loads as '${n.rawName.split(".").pop()}'` });
        }
      }
    }
    return out;
  },

  /**
   * A measure whose DAX swallowed the line after it. `measure X =` followed by a property on the
   * next line takes that property AS the expression, and so does a multi-line body written at
   * property depth; the engine then holds the measure in error state 5 ("The syntax for
   * 'formatString' is incorrect"). Both read back from TMSCHEMA_MEASURES, 2026-09-05.
   *
   * NOT flagged: `measure X` with no `=` at all. Desktop writes exactly that for a measure created
   * and left empty in the UI (one lives in a shipped template), it loads in state 1, and it returns
   * blank -- a dead measure, not a broken model.
   */
  "measure-must-have-an-expression"(p) {
    if (!p.model || !p.model.present) return [];
    const out = [];
    for (const s of p.model.sources || []) {
      if (!s.tree) continue;
      for (const n of s.tree.nodes) {
        if (n.type !== "measure" && n.type !== "calculationitem") continue;
        if (!n.hasDefault) continue;
        if (n.multiline && n.body.length === 0) out.push({ location: `${s.rel}:${n.line}`, detail: `${n.type} '${n.name}' = has nothing under it; the next property line becomes its DAX` });
      }
      // A body written at property depth swallows the property after it: `[AC] * 2` on one line
      // and `formatString: #,##0` on the next, both two tabs in, load as ONE expression and the
      // engine reports "The syntax for 'formatString' is incorrect". Read back 2026-09-05.
      for (const f of s.tree.faults) {
        if (f.kind === "property-in-body") {
          const o = f.owner.kind === "prop" ? f.owner.owner : f.owner;
          out.push({ location: `${s.rel}:${f.line}`, detail: `'${f.property}:' sits inside the DAX body of ${o.type} '${o.name}' -- indent the body one level deeper than the properties` });
        }
      }
    }
    return out;
  },
};

module.exports = { checkers, ZEBRA, isZebra, isTable, isCards, obj, lit, blob, projections };
