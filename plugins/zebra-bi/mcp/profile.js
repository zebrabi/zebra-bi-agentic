// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";

/**
 * profile_project — the mechanical half of planning, done mechanically.
 *
 * WHY THIS EXISTS. `SKILL.md` step 1 says: enumerate every source, every dimension table, and
 * every categorical column ON THE FACT TABLE ("these are the ones that get missed, because they
 * are not in the relationship diagram"), then profile cardinality, the date range and coverage.
 * Step 2 says the enumeration that follows "is mechanical ... and it takes about two minutes".
 *
 * Two minutes is the cheap part. The expensive part is that it is done BY HAND and therefore
 * done PARTIALLY. The corpus records it as the most costly semantic failure there is: an
 * enumeration that ran on "3 of ~10 dimensions" produced a one-page report and the owner's reply
 * was *"You had such rich data and you decided to stop and build 1 tab/sheet?"* — then it recurred
 * against a different denominator in a later session.
 *
 * A hand-written enumeration cannot be complete, because completeness is a property of the LIST
 * and the list is the thing being written. So this tool builds the list from the model instead,
 * and returns the denominator with it. The agent still decides the story — that part is not
 * mechanical and this tool does not attempt it.
 *
 * WHAT IT CANNOT DO, and says so in `notProfiled` rather than implying otherwise: it reads FILES.
 * Where a table's rows are embedded (a DATATABLE partition) it can count members and ranges for
 * real. Where the data lives behind Power Query or DirectQuery there are no rows on disk, so it
 * reports structure only and names what still needs a DAX pass. A profile that silently mixed the
 * two would be exactly the "beautiful zero" this project keeps retracting.
 */

const tmdl = require("./tmdl.js");

// Columns whose NAME says they are a scenario/comment/technical column rather than a subject
// dimension. Used only to annotate, never to exclude: an excluded name that never appears is the
// failure mode step 1 is written to prevent.
const DATE_HINT = /(^|[\s_.\-])(date|month|year|quarter|week|day|period|fy)([\s_.\-]|$)/i;
const SCENARIO_HINT = /(^|[\s_.\-])(scenario|version|actual|plan|budget|forecast)([\s_.\-]|$)/i;

const NUMERIC = new Set(["double", "int64", "decimal"]);

/**
 * The TMDL text for one table.
 *
 * ☠️ The parsed model carries no partition source, and `p.files` carries no TMDL at all — it is
 * the REPORT layer. The text lives in `model.sources`, keyed by the same rel path the parser puts
 * on `table.file`. A checker in this plugin was already shipped once reading the wrong collection
 * and scoring a clean zero on 20 templates because it matched nothing.
 */
function tableSource(model, table) {
  const src = (model.sources || []).find((s) => s.rel === table.file);
  if (!src) return "";
  const text = src.text;
  // A file may hold several tables. Take from this table's own header to the next top-level one.
  const esc = table.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = text.search(new RegExp(`^table\\s+'?${esc}'?\\s*$`, "m"));
  if (start < 0) return text;
  const rest = text.slice(start + 1);
  const next = rest.search(/^table\s+/m);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

/** Pull the literal rows out of a DATATABLE partition. Returns null when there are none on disk. */
function datatableRows(src) {
  if (!/DATATABLE\s*\(/i.test(src || "")) return null;
  const rows = [];
  // Each row is a {...} group after the column declarations. Parsed by bracket depth rather than
  // by regex, because a string value may contain a brace.
  const body = src.slice(src.indexOf("{"));
  let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "{") { depth++; if (depth === 2) { cur = ""; continue; } }
    if (ch === "}") { depth--; if (depth === 1) { rows.push(cur); cur = ""; continue; } }
    if (depth >= 2) cur += ch;
  }
  return rows.length ? rows : null;
}

/** Split one DATATABLE row into values, respecting quoted strings. */
function splitRow(row) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') { if (q && row[i + 1] === '"') { cur += '"'; i++; } else q = !q; continue; }
    if (ch === "," && !q) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function profileTable(t, model) {
  const cols = (t.columns || []).map((c) => ({
    name: c.name,
    dataType: c.dataType || "unknown",
    looksLikeDate: DATE_HINT.test(c.name) || /date|time/i.test(c.dataType || ""),
    looksLikeScenario: SCENARIO_HINT.test(c.name),
  }));

  const rows = datatableRows(tableSource(model, t));
  if (!rows) return { columns: cols, rowCount: null, dataOnDisk: false };

  const parsed = rows.map(splitRow);
  for (let i = 0; i < cols.length; i++) {
    const vals = parsed.map((r) => r[i]).filter((v) => v !== undefined && v !== "");
    const uniq = new Set(vals);
    cols[i].distinct = uniq.size;
    cols[i].nulls = parsed.length - vals.length;
    if (NUMERIC.has(cols[i].dataType)) {
      const nums = vals.map(Number).filter((n) => Number.isFinite(n));
      if (nums.length) {
        cols[i].min = Math.min(...nums);
        cols[i].max = Math.max(...nums);
      }
    } else if (uniq.size && uniq.size <= 50) {
      cols[i].members = [...uniq].slice(0, 50);
    }
  }
  // Keep the parsed rows: rankQuestions needs them, and re-parsing would be a second read that
  // could disagree with the first.
  return { columns: cols, rowCount: parsed.length, dataOnDisk: true, rows: parsed };
}

/**
 * Rank candidate questions by MEASURED SIGNAL, so the agent reviews a ranked list instead of
 * deriving one.
 *
 * The enumeration says a model can be asked 903 questions. That is the completeness half. It does
 * not say which of them are worth a visual, and the skill is explicit that picking without looking
 * produces "a story named from a template you already had in mind, and it will be decoration".
 *
 * Where rows are on disk this is arithmetic, not judgement: group the numeric column by the
 * dimension, and measure how much it actually moves.
 *
 *   effect  = (max group mean - min group mean) / (the measure's total observed spread)   -- 0..1
 *   concentration = largest group's share of the total                                   -- worth drawing?
 *
 * Read it as "how much of everything this number does is explained by this dimension".
 * The same definition is computed against a LIVE model for Power Query / DirectQuery projects,
 * where the rows are not on disk to group: there the total spread comes from the values observed
 * across all dimensions rather than from the column. The definition is shared deliberately -- two
 * paths that scored the same question differently would be worse than one path that could not
 * score it at all.
 *
 * ☠️ TWO DEFECTS FOUND BY READING ITS OWN FIRST OUTPUT, both of which made it actively misleading:
 *
 *  1. Dividing by the OVERALL MEAN explodes when the mean is near zero. A sentiment score on
 *     -1..+1 has a mean of ~0, and the ranking reported `effect = 202.654`. Normalising by the
 *     column's RANGE instead is bounded, stable and readable as a fraction.
 *  2. A DERIVED dimension is a tautology and ranked first. "Economic_Sentiment_Score by Sentiment
 *     Band" tops any list, because the band was cut from that column -- it is the definition
 *     restated, not a finding. Detected by checking whether the members partition the column into
 *     non-overlapping ranges, and excluded from the ranking with the reason kept.
 *
 * ☠️ IT RANKS COLUMNS, NOT MEASURES. A measure is DAX and nothing here evaluates DAX, so a measure
 * that is not a plain aggregate of its column (a ratio, a time-intelligence shift, an ALL()
 * benchmark) will NOT track its column's ranking. The ranking is a reading order, never a result:
 * every number a report states still needs the DAX oracle. Reported in `notProfiled`.
 */
// log(n!) by summation. Exact enough at these sizes, no dependency, and no overflow — n! itself
// is Infinity in a double well before the row counts this sees.
const _logFactCache = [0, 0];
function logFactorial(n) {
  for (let i = _logFactCache.length; i <= n; i++) _logFactCache[i] = _logFactCache[i - 1] + Math.log(i);
  return _logFactCache[n];
}

function rankQuestions(tables, limit = 25) {
  const ranked = [];
  const derived = [];
  for (const t of tables) {
    if (!t.dataOnDisk || !t.rows) continue;
    const dims = t.columns.filter((c) => !NUMERIC.has(c.dataType) && !c.looksLikeDate
      && c.distinct > 1 && c.distinct <= 200);
    const nums = t.columns.filter((c) => NUMERIC.has(c.dataType) && c.min !== c.max);
    for (const d of dims) {
      const di = t.columns.indexOf(d);
      for (const n of nums) {
        const ni = t.columns.indexOf(n);
        const groups = new Map();
        for (const r of t.rows) {
          const k = r[di];
          const v = Number(r[ni]);
          if (k === undefined || !Number.isFinite(v)) continue;
          const g = groups.get(k) || { sum: 0, n: 0 };
          g.sum += v; g.n++; groups.set(k, g);
        }
        if (groups.size < 2) continue;
        const means = [...groups.entries()].map(([k, g]) => ({ k, mean: g.sum / g.n, total: g.sum }));
        // Concentration is a share, so its denominator must not net toward zero. On a mixed-sign
        // measure -- and a VARIANCE is mixed-sign by definition -- the signed grand total does
        // exactly that, and the documented 0..1 field read 13.3 on a four-row variance column.
        // Share of the absolute totals is bounded whatever the signs. Corrected 2026-09-01.
        const grand = means.reduce((s, m) => s + Math.abs(m.total), 0);
        // Bounded 0..1: how much of the measure's TOTAL observed spread this dimension explains.
        // Never the overall mean (blows up near zero), and never |max|+|min| -- that saturates at
        // 1.0 the moment two group values straddle zero, which made a -0.24 -> 0.01 move on a
        // -1..+1 scale outrank a genuine 25 -> 73. Tried, seen, reverted.
        const lo = means.reduce((a, b) => (a.mean < b.mean ? a : b));
        const hi = means.reduce((a, b) => (a.mean > b.mean ? a : b));
        const scale = n.max - n.min;
        if (!Number.isFinite(scale) || scale === 0) continue;
        const effect = Math.abs(hi.mean - lo.mean) / Math.abs(scale);

        // Is the dimension DERIVED from this column? If every member owns a disjoint slice of the
        // column's values, the "finding" is the band definition read back.
        const spans = new Map();
        for (const r of t.rows) {
          const k = r[di]; const v = Number(r[ni]);
          if (k === undefined || !Number.isFinite(v)) continue;
          const s2 = spans.get(k) || { lo: Infinity, hi: -Infinity };
          s2.lo = Math.min(s2.lo, v); s2.hi = Math.max(s2.hi, v); spans.set(k, s2);
        }
        const ordered = [...spans.entries()].map(([k, v]) => ({ k, ...v }))
          .sort((a, b) => a.lo - b.lo);
        let disjoint = ordered.length > 1;
        for (let z = 1; z < ordered.length; z++) if (ordered[z].lo < ordered[z - 1].hi) disjoint = false;

        // ☠️ DISJOINT IS NOT ENOUGH, and believing it was suppressed a real finding in this file's
        // own test: North={10,20} vs South={300,400} separates perfectly and is genuine signal, not
        // a derived band. With few rows, perfect separation happens by chance all the time.
        //
        // So ask how surprising it is. Under a null of random assignment, the chance that k groups
        // land in perfectly disjoint ordered blocks is k! * prod(n_i!) / n!: the k! counts the
        // orders the blocks can come in, and was missing until 2026-09-01 (the earlier worked
        // example "4/24 = 0.17" was therefore 8/24 = 0.33). For 2 groups of 2 that is
        // unremarkable. For 1,000 rows in 5 bands it is astronomically small, which is what a
        // band cut FROM the column looks like. Only the second is a tautology.
        if (disjoint) {
          const counts = [...groups.values()].map((g) => g.n);
          const total = counts.reduce((a, b) => a + b, 0);
          const logP = logFactorial(counts.length)
            + counts.reduce((s, c) => s + logFactorial(c), 0) - logFactorial(total);
          if (logP > Math.log(1e-6)) disjoint = false;   // plausibly chance: keep it as a finding
        }
        if (disjoint) {
          derived.push(`${n.name} by ${d.name} — the band partitions this column, so the "finding" `
            + "is its own definition");
          continue;
        }

        const top = means.reduce((a, b) => (Math.abs(a.total) > Math.abs(b.total) ? a : b));
        ranked.push({
          question: `${n.name} by ${d.name}`,
          dimension: `${t.name}[${d.name}]`,
          measureColumn: `${t.name}[${n.name}]`,
          members: groups.size,
          effect: Number(effect.toFixed(3)),
          concentrationTopMember: grand === 0 ? null
            : Number((Math.abs(top.total) / Math.abs(grand)).toFixed(3)),
          lowest: { member: lo.k, mean: Number(lo.mean.toFixed(2)) },
          highest: { member: hi.k, mean: Number(hi.mean.toFixed(2)) },
        });
      }
    }
  }
  ranked.sort((a, b) => b.effect - a.effect);
  // `derived` is reported, never silently dropped: "this pair is a tautology" is itself useful,
  // and a silent exclusion is indistinguishable from a pair the tool failed to consider.
  return { ranked: ranked.slice(0, limit), rankedCount: ranked.length, excludedAsDerived: derived };
}

function profileProject(project) {
  const model = project.model;
  if (!model || !model.present) {
    return { ok: false, error: "no semantic model was read, so there is nothing to profile" };
  }

  const tables = [];
  for (const t of model.tables) {
    const p = profileTable(t, model);
    tables.push({
      name: t.name,
      file: t.file,
      measureCount: (t.measures || []).length,
      measures: (t.measures || []).map((m) => m.name),
      // The DAX matters, not only the name: propose_pages has to map a ranked COLUMN back to the
      // measure that aggregates it, because Zebra's Values well takes a measure and binding a raw
      // column there renders "Something's wrong with one or more fields".
      measureExprs: (t.measures || []).map((m) => ({ name: m.name, expression: m.expression || "" })),
      ...p,
    });
  }

  // A dimension candidate is any non-numeric, non-date column, wherever it lives. Fact-table
  // columns are included DELIBERATELY -- the skill names them as the ones that get missed.
  const dimensions = [];
  const dateColumns = [];
  const scenarioColumns = [];
  for (const t of tables) {
    for (const c of t.columns) {
      const ref = `${t.name}[${c.name}]`;
      if (c.looksLikeDate) { dateColumns.push(ref); continue; }
      if (NUMERIC.has(c.dataType)) continue;
      dimensions.push({
        ref,
        onFactTable: t.measureCount === 0 && t.rowCount !== null && t.rowCount > 200,
        distinct: c.distinct ?? null,
        members: c.members,
      });
      if (c.looksLikeScenario) scenarioColumns.push(ref);
    }
  }

  // `t.measures` here is the PROFILED table, whose measures are already plain names — mapping
  // `m.name` over strings yields undefined, which reads as a measure called "undefined".
  const measures = [];
  const measureExprs = [];
  for (const t of tables) {
    for (const m of t.measures) measures.push(`${t.name}[${m}]`);
    for (const m of (t.measureExprs || [])) {
      measureExprs.push({ ref: `${t.name}[${m.name}]`, table: t.name, name: m.name,
                          expression: m.expression });
    }
  }

  const sc = tmdl.scenarioMeasures(model);
  const dt = tmdl.dateTable(model);

  // ⚠️ A dimension with cardinality 1 is a FINDING, not a filter: the NAME keeps promising an
  // answer the data cannot give, to everyone who reads it including the author an hour later.
  const singleValued = dimensions.filter((d) => d.distinct === 1).map((d) => d.ref);
  const unmeasured = dimensions.filter((d) => d.distinct === null).map((d) => d.ref);

  const usable = dimensions.filter((d) => d.distinct === null || d.distinct > 1);
  const denominator = usable.length * measures.length;

  const gaps = [];
  if (!dateColumns.length) {
    gaps.push("NO DATE COLUMN — there is no time axis, so PY/prior-period comparison is not "
      + "available at all. A trend page cannot be built from this model.");
  } else if (!dt.marked) {
    gaps.push("A date column exists but no table is MARKED as the date table — time intelligence "
      + "will not work until one is.");
  }
  if (!sc.hasComparative) {
    gaps.push("NO PLAN/PY/FORECAST MEASURE — a variance against a named scenario is not available. "
      + "If there is also no usable prior period, the documented fallback is benchmark-vs-"
      + "population: bind the sliced measure to Values and an ALL() population measure to Plan.");
  }
  if (!measures.length) {
    gaps.push("NO MEASURES — Zebra binds each scenario to its own field well, so a variance needs "
      + "measures, not raw columns.");
  }
  if (singleValued.length) {
    gaps.push(`CARDINALITY 1, and this is a finding rather than a filter: ${singleValued.join(", ")}`
      + " — the name will keep suggesting an answer the data cannot give.");
  }

  const notProfiled = [
    "Whether any number is RIGHT. Nothing here evaluates a measure; run the DAX oracle.",
    "Coverage per period — whether the actuals and the comparison cover the same window. A partial "
      + "trailing period produces a confident, completely wrong variance and no file check sees it.",
    "Which questions actually carry SIGNAL. This lists what CAN be asked, not what is worth asking; "
      + "that still needs the enumeration queries run against the data.",
  ];
  if (tables.some((t) => !t.dataOnDisk)) {
    notProfiled.unshift("Cardinality and ranges for "
      + tables.filter((t) => !t.dataOnDisk).map((t) => t.name).join(", ")
      + " — those partitions hold no rows on disk (Power Query or DirectQuery), so only their "
      + "STRUCTURE was read.");
  }

  const signal = rankQuestions(tables);

  return {
    ok: true,
    // `rows` is working state for the ranking, not output -- returning 1,000 raw rows would bury
    // the answer it exists to produce.
    tables: tables.map(({ rows, ...rest }) => rest),
    dimensions,
    dateColumns,
    scenarioColumns,
    // The scenario detection itself, not just the columns. tmdl.scenarioMeasures carries the
    // 2026-08-05 paired-actuals correction (the vendor convention is `Revenue` + `Revenue PY`,
    // where the actual is the BASE measure and is never called "AC"). It was computed above and
    // dropped here, so propose_pages re-derived it with the predicate that correction retired and
    // reported "no scenario pair" on models that have one. Corrected 2026-08-31.
    scenarios: sc,
    measures,
    measureExprs,
    // THE DENOMINATOR. The skill's completeness gate is "say the fraction out loud"; a fraction
    // needs a denominator, and this is it. Every one of these names must end up with either a
    // number beside it or a one-line reason it was excluded.
    enumeration: {
      usableDimensions: usable.map((d) => d.ref),
      measureCount: measures.length,
      candidateQuestions: denominator,
      note: `${usable.length} usable dimension(s) x ${measures.length} measure(s) = ${denominator} `
        + "candidate question(s). Step 2 is not finished until every dimension here has a number "
        + "beside it or a stated reason it was excluded.",
    },
    unmeasuredDimensions: unmeasured,
    // WHICH of the candidate questions actually move. Empty when no rows are on disk.
    signal,
    gaps,
    notProfiled,
  };
}

module.exports = { profileProject, datatableRows, splitRow, tableSource };
