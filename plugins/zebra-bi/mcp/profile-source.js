// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";

/**
 * profile_source — the analyst's first hour on a folder of flat files, done mechanically.
 *
 * WHY THIS EXISTS. `profile_project` reads a MODEL. Most sessions start one step earlier: someone
 * points the skill at a folder of CSVs and there is no model yet. The skill's analyst layer then
 * asks for six data-quality checks (orphan keys, future dates, duplicates, reconciliation, sign,
 * grain), the fiscal year, the last complete period and the scenario coverage — and every one of
 * those was being computed by hand, in ad-hoc pandas, by each agent, each time.
 *
 * Hand-computed is also SKIPPED. A controlled two-arm test on a finance ledger had both arms find
 * every data trap the file held — the empty scenario, the budget window, the trailing stub, the
 * unsigned amounts — and both arms ship a calendar-year YTD over a July fiscal year, with the
 * `FiscalYear` column sitting in the folder and the rule that names it sitting in the reference
 * they had read. A rule that must be remembered is not a rule; a fact printed on screen is. So this
 * tool prints the facts.
 *
 * WHAT IT DOES NOT DO, and says so in `notProfiled`: it does not evaluate a measure, decide what
 * the report says, or read a binary workbook. It reads delimited text and JSON arrays. Where a
 * signal needs judgement it reports the evidence and the analyst's default, never a verdict.
 */

const fs = require("fs");
const path = require("path");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

const MAX_FILE_BYTES = 96 * 1024 * 1024;
// High enough that a row id on a mid-sized fact is still seen as unique; a Map of this many
// strings is tens of megabytes at most, and the alternative is a duplicate check that cannot run.
const MAX_DISTINCT_TRACKED = 250000;
const MEMBERS_LISTED = 50;

const TEXT_EXT = new Set([".csv", ".txt", ".tsv", ".psv", ".dat"]);
const JSON_EXT = new Set([".json"]);
const BINARY_EXT = new Set([".xlsx", ".xls", ".xlsb", ".parquet", ".pbix", ".accdb"]);

// Name hints. Used to LABEL columns, never to exclude them: a hint that misses only costs a label.
const FISCAL_YEAR_HINT = /^(fiscal[\s_.\-]*(year|yr)|fy|fiscalyear|fin(ancial)?[\s_.\-]*year)$/i;
const FISCAL_COMPANION_HINT = /fiscal|^fy[\s_.\-]?(q|quarter|period|month|semester|week)/i;
const CALENDAR_YEAR_HINT = /^(calendar[\s_.\-]*year|year|yr|cal[\s_.\-]*year)$/i;
const SCENARIO_NAME_HINT = /^(actual|actuals|budget|plan|forecast|fc|pl|py|ac|bu|previous year|prior year|estimate|target|outlook)$/i;
const SCENARIO_COL_HINT = /(^|[\s_.\-])(scenario|version|scenariokey|scenario_key)([\s_.\-]|$)/i;
const STOCK_HINT = /balance|inventory|stock|on[\s_]?hand|headcount|fte\b|receivable|payable|pipeline|backlog|open[\s_]?(orders|items)|cash\b|debt|equity|assets|liabilit/i;
const CURRENCY_HINT = /^(currency|currencykey|currency_key|currencycode|currency_code|ccy|iso[\s_]?currency)$/i;
const RATE_HINT = /(exchange|fx|conversion)[\s_.\-]*rate|^rate$|averagerate|endofdayrate|closingrate/i;
const OPERATOR_HINT = /^(operator|sign|unary[\s_]?operator|aggregation|rollup)$/i;
const AMOUNT_HINT = /amount|value|sales|revenue|cost|expense|qty|quantity|units|price|margin|profit|total|net|gross|count/i;
// A flag or indicator is not a measure even when its name says "sales" (SalesPersonFlag).
const FLAG_HINT = /flag|indicator|^is[A-Z_]|status|type$/i;
// Sign convention is a question about MONETARY amounts that can carry both revenue and cost, not
// about a quantity, a price or a count, which are positive by nature.
const SIGNED_AMOUNT_HINT = /amount|value|revenue|cost|expense|margin|profit|net|gross|result|balance|total|sales$/i;
const NEVER_SIGNED_HINT = /price|qty|quantity|units|count|rate|level|number|weight|hours|days/i;

// --- reading ------------------------------------------------------------------------------

function listFiles(root) {
  const st = fs.statSync(root);
  if (st.isFile()) return [root];
  const out = [];
  const walk = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 2) walk(full, depth + 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (TEXT_EXT.has(ext) || JSON_EXT.has(ext) || BINARY_EXT.has(ext)) out.push(full);
    }
  };
  walk(root, 0);
  return out.sort();
}

/** Pick the delimiter whose count is constant across the first lines and largest. */
function sniffDelimiter(lines) {
  const cands = [",", "|", "\t", ";"];
  let best = null;
  for (const d of cands) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0];
    if (!first) continue;
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const score = consistent * 1000 + first;
    if (!best || score > best.score) best = { d, score, consistent, first };
  }
  return best ? best.d : ",";
}

function countOutsideQuotes(line, d) {
  let n = 0, q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

/** Quote-aware split of one delimited line. */
function splitLine(line, d) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
      continue;
    }
    if (ch === d && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const INT_RE = /^[+-]?\d+$/;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?$/;
const SLASH_YMD_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const SLASH_DMY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Returns 'YYYY-MM-DD' or null. `dayFirst` resolves the ambiguous slash form. */
function toIsoDate(s, dayFirst) {
  let m = ISO_DATE_RE.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = SLASH_YMD_RE.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = SLASH_DMY_RE.exec(s);
  if (m) return dayFirst ? validYmd(+m[3], +m[2], +m[1]) : validYmd(+m[3], +m[1], +m[2]);
  return null;
}
function validYmd(y, mo, d) {
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function isDateKey(s) {
  return /^\d{8}$/.test(s) && validYmd(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)) !== null;
}

function readTextTable(file) {
  const size = fs.statSync(file).size;
  let sampled = false;
  let raw;
  if (size > MAX_FILE_BYTES) {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(MAX_FILE_BYTES);
    fs.readSync(fd, buf, 0, MAX_FILE_BYTES, 0);
    fs.closeSync(fd);
    raw = buf.toString("utf8");
    raw = raw.slice(0, raw.lastIndexOf("\n"));
    sampled = true;
  } else {
    raw = fs.readFileSync(file, "utf8");
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { rows: [], header: [], delimiter: null, headerless: false, sampled };
  const delimiter = sniffDelimiter(lines.slice(0, Math.min(25, lines.length)));
  const first = splitLine(lines[0], delimiter);
  // A header row is text, distinct, and not a plausible data row.
  const headerless = first.every((c) => c === "" || NUM_RE.test(c) || toIsoDate(c, false))
    || new Set(first).size !== first.length;
  const header = headerless ? first.map((_, i) => `col${i + 1}`) : first.map((h) => h.trim());
  const rows = [];
  for (let i = headerless ? 0 : 1; i < lines.length; i++) {
    const r = splitLine(lines[i], delimiter);
    if (r.length === 1 && r[0].trim() === "") continue;
    rows.push(r);
  }
  return { rows, header, delimiter, headerless, sampled, sizeBytes: size };
}

function readJsonTable(file) {
  const size = fs.statSync(file).size;
  if (size > MAX_FILE_BYTES) return { unreadable: `JSON over ${MAX_FILE_BYTES} bytes is not sampled` };
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); }
  catch (e) { return { unreadable: `not valid JSON: ${e.message}` }; }
  if (!Array.isArray(data)) {
    // {"rows":[...]} / {"data":[...]} — one level of wrapping is common.
    const k = Object.keys(data || {}).find((key) => Array.isArray(data[key]));
    if (!k) return { unreadable: "JSON is not an array of records" };
    data = data[k];
  }
  if (!data.length || typeof data[0] !== "object") return { unreadable: "JSON array holds no records" };
  const header = [];
  const seen = new Set();
  for (const rec of data.slice(0, 200)) for (const key of Object.keys(rec)) if (!seen.has(key)) { seen.add(key); header.push(key); }
  const rows = data.map((rec) => header.map((h) => (rec[h] === null || rec[h] === undefined ? "" : String(rec[h]))));
  return { rows, header, delimiter: null, headerless: false, sampled: false, sizeBytes: size };
}

// --- per-column profiling -----------------------------------------------------------------

function profileColumns(header, rows) {
  const n = header.length;
  const cols = header.map((name) => ({
    name, blanks: 0, ints: 0, nums: 0, dates: 0, dateKeys: 0, texts: 0,
    distinct: new Map(), overflow: false,
    min: null, max: null, dmin: null, dmax: null, negatives: 0, positives: 0, zeros: 0,
    slashDayFirstEvidence: 0, slashMonthFirstEvidence: 0,
  }));
  // Slash dates: decide day-first from the whole column before parsing.
  for (const r of rows) for (let i = 0; i < n; i++) {
    const m = SLASH_DMY_RE.exec((r[i] || "").trim());
    if (!m) continue;
    if (+m[1] > 12) cols[i].slashDayFirstEvidence++;
    if (+m[2] > 12) cols[i].slashMonthFirstEvidence++;
  }
  for (const r of rows) {
    for (let i = 0; i < n; i++) {
      const c = cols[i];
      const v = (r[i] === undefined ? "" : String(r[i])).trim();
      if (v === "" || v.toUpperCase() === "NULL" || v === "NaN") { c.blanks++; continue; }
      if (!c.overflow) {
        if (c.distinct.size < MAX_DISTINCT_TRACKED) c.distinct.set(v, (c.distinct.get(v) || 0) + 1);
        else if (!c.distinct.has(v)) c.overflow = true;
        else c.distinct.set(v, c.distinct.get(v) + 1);
      }
      const iso = toIsoDate(v, c.slashDayFirstEvidence > c.slashMonthFirstEvidence);
      if (iso) {
        c.dates++;
        if (c.dmin === null || iso < c.dmin) c.dmin = iso;
        if (c.dmax === null || iso > c.dmax) c.dmax = iso;
        continue;
      }
      if (INT_RE.test(v)) {
        if (isDateKey(v) && /date|day|period|key/i.test(c.name)) c.dateKeys++;
        c.ints++;
        const x = Number(v);
        if (c.min === null || x < c.min) c.min = x;
        if (c.max === null || x > c.max) c.max = x;
        if (x < 0) c.negatives++; else if (x > 0) c.positives++; else c.zeros++;
        continue;
      }
      if (NUM_RE.test(v)) {
        c.nums++;
        const x = Number(v);
        if (c.min === null || x < c.min) c.min = x;
        if (c.max === null || x > c.max) c.max = x;
        if (x < 0) c.negatives++; else if (x > 0) c.positives++; else c.zeros++;
        continue;
      }
      c.texts++;
    }
  }
  const total = rows.length;
  return cols.map((c) => {
    const filled = total - c.blanks;
    let type = "empty";
    if (filled > 0) {
      if (c.dates >= filled * 0.98) type = "date";
      else if (c.dateKeys >= filled * 0.98 && c.dateKeys > 0) type = "dateKey";
      else if (c.ints + c.nums >= filled * 0.98) type = c.nums > 0 ? "number" : "integer";
      else type = "text";
    }
    const distinct = c.overflow ? null : c.distinct.size;
    const members = (!c.overflow && c.distinct.size <= MEMBERS_LISTED)
      ? [...c.distinct.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k) : undefined;
    return {
      name: c.name, type, rows: total, blanks: c.blanks, distinct,
      unique: distinct !== null && distinct === filled && filled > 0,
      min: type === "number" || type === "integer" ? c.min : (type === "date" ? c.dmin : undefined),
      max: type === "number" || type === "integer" ? c.max : (type === "date" ? c.dmax : undefined),
      negatives: type === "number" || type === "integer" ? c.negatives : undefined,
      positives: type === "number" || type === "integer" ? c.positives : undefined,
      members,
      _distinct: c.distinct, _overflow: c.overflow,
    };
  });
}

// --- file roles ---------------------------------------------------------------------------

function keyColumnOf(tableName, cols) {
  const base = tableName.replace(/^(dim|fact|tbl|d_|f_)/i, "");
  // Prefer `<Table>Key` / `<Table>Id`, then any unique integer/text column ending in Key/Id.
  const byName = cols.find((c) => c.unique && new RegExp(`^${escapeRe(base)}[\\s_]?(key|id)$`, "i").test(c.name));
  if (byName) return byName.name;
  const anyKey = cols.find((c) => c.unique && /(key|id)$/i.test(c.name) && !/^parent/i.test(c.name));
  if (anyKey) return anyKey.name;
  // A unique amount is not a key: 24 distinct amounts on 24 rows made a ledger a "dimension".
  const firstUnique = cols.find((c) => c.unique && (c.type === "integer" || c.type === "text")
    && !/^parent/i.test(c.name) && !AMOUNT_HINT.test(c.name));
  return firstUnique ? firstUnique.name : null;
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function classifyFile(name, cols, rows) {
  const dateCols = cols.filter((c) => c.type === "date");
  const hasYearMonth = cols.some((c) => CALENDAR_YEAR_HINT.test(c.name)) && cols.some((c) => /month/i.test(c.name));
  const uniqueDate = dateCols.some((c) => c.unique);
  if (uniqueDate && (hasYearMonth || cols.some((c) => FISCAL_YEAR_HINT.test(c.name)) || /date|calendar/i.test(name))) return "date";
  const nameCol = cols.find((c) => c.type === "text" && c.members && c.members.length <= 12
    && c.members.filter((m) => SCENARIO_NAME_HINT.test(m)).length >= Math.max(2, Math.ceil(c.members.length / 2)));
  if (nameCol && rows.length <= 20) return "scenario";
  const measures = cols.filter((c) => (c.type === "number" || (c.type === "integer" && !/(key|id)$/i.test(c.name)))
    && AMOUNT_HINT.test(c.name) && !FLAG_HINT.test(c.name) && !(c.distinct !== null && c.distinct <= 2));
  const foreignKeys = cols.filter((c) => /(key|id)$/i.test(c.name) && !c.unique && !/^parent/i.test(c.name));
  const ownKey = keyColumnOf(name, cols);
  // The file's own name is evidence: a warehouse export says Dim/Fact and means it.
  if (/^(dim|d_)/i.test(name) && ownKey) return "dimension";
  if (/^(fact|f_)/i.test(name) && measures.length) return "fact";
  // Otherwise: a fact carries an amount and points at other tables. A table whose own key is named
  // after it (Product -> ProductKey) is a dimension even with a price column and a couple of
  // foreign keys; a flat file with no key of its own but a date or a foreign key beside the amount
  // is a fact (a ledger, a JSON series).
  const namedKey = ownKey && new RegExp(`^${escapeRe(name.replace(/^(dim|fact|tbl|d_|f_)/i, ""))}[\\s_]?(key|id)$`, "i").test(ownKey);
  if (namedKey && foreignKeys.length <= 2 && !dateCols.length) return "dimension";
  if (measures.length && (foreignKeys.length >= 2 || (!namedKey && (foreignKeys.length >= 1 || dateCols.length)))) return "fact";
  if (ownKey) return "dimension";
  return measures.length ? "fact" : "unknown";
}

// --- signals ------------------------------------------------------------------------------

function fiscalSignal(tables) {
  for (const t of tables) {
    const fy = t.columns.find((c) => FISCAL_YEAR_HINT.test(c.name) && (c.type === "integer" || c.type === "text"));
    if (!fy) continue;
    const dateCol = t.columns.find((c) => c.type === "date") || null;
    const calYear = t.columns.find((c) => CALENDAR_YEAR_HINT.test(c.name) && c.type === "integer") || null;
    const monthCol = t.columns.find((c) => /^(monthnumber|monthnumberofyear|month[\s_]?no|month[\s_]?num|monthofyear|month)$/i.test(c.name) && c.type === "integer") || null;
    const fyi = t.header.indexOf(fy.name);
    const di = dateCol ? t.header.indexOf(dateCol.name) : -1;
    const yi = calYear ? t.header.indexOf(calYear.name) : -1;
    const mi = monthCol ? t.header.indexOf(monthCol.name) : -1;
    if (di < 0 && (yi < 0 || mi < 0)) {
      return { table: t.table, column: fy.name, startMonth: null, namedBy: null,
        note: `${t.table}[${fy.name}] exists but the table has no date or year+month column to read the roll-over from. Ask which month the fiscal year starts.` };
    }
    // For every (calendar year, month) find the fiscal year label.
    const byYm = new Map();
    for (const r of t.rows) {
      let y, m;
      if (di >= 0) {
        const iso = toIsoDate((r[di] || "").trim(), false);
        if (!iso) continue;
        y = +iso.slice(0, 4); m = +iso.slice(5, 7);
      } else { y = +r[yi]; m = +r[mi]; if (!Number.isFinite(y) || !Number.isFinite(m)) continue; }
      const label = String(r[fyi]).trim();
      if (!label) continue;
      const k = `${y}-${String(m).padStart(2, "0")}`;
      if (!byYm.has(k)) byYm.set(k, { y, m, labels: new Map() });
      const e = byYm.get(k).labels;
      e.set(label, (e.get(label) || 0) + 1);
    }
    const keys = [...byYm.keys()].sort();
    if (keys.length < 2) continue;
    const fyNum = (label) => { const mm = /(\d{4})/.exec(label); return mm ? +mm[1] : null; };
    const dominant = (k) => [...byYm.get(k).labels.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // Roll-over: the month where the label changes from the previous month.
    const rollMonths = new Map();
    for (let i = 1; i < keys.length; i++) {
      if (dominant(keys[i]) !== dominant(keys[i - 1])) {
        const m = byYm.get(keys[i]).m;
        rollMonths.set(m, (rollMonths.get(m) || 0) + 1);
      }
    }
    if (!rollMonths.size) {
      return { table: t.table, column: fy.name, startMonth: 1, startMonthName: "January", namedBy: "calendar",
        companions: fiscalCompanions(t, fy.name),
        note: `${t.table}[${fy.name}] never changes within the span read, so it cannot be distinguished from the calendar year here.` };
    }
    const startMonth = [...rollMonths.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const sm = MONTHS[startMonth - 1];
    const em = MONTHS[(startMonth + 10) % 12];
    // Named by start or end year: in each fiscal year's first month, does the label carry that
    // calendar year (start) or the next one (end)? Decided PER YEAR, because a source's own fiscal
    // column can switch convention part-way through -- one shipped sample does exactly that, and a
    // majority vote would report one convention with confidence over a column that holds two.
    const byConvention = { start: [], end: [], other: [] };
    let sampleKey = null;
    for (const k of keys) {
      const e = byYm.get(k);
      if (e.m !== startMonth) continue;
      const lab = dominant(k);
      const n = fyNum(lab);
      if (n === null) { byConvention.other.push(`${k}: ${lab}`); continue; }
      if (n === e.y) byConvention.start.push(e.y); else if (n === e.y + 1) byConvention.end.push(e.y); else byConvention.other.push(`${k}: ${lab}`);
      if (!sampleKey) sampleKey = k;
    }
    let namedBy;
    if (startMonth === 1) namedBy = "calendar";
    else if (byConvention.start.length && byConvention.end.length) namedBy = "inconsistent";
    else if (byConvention.start.length) namedBy = "start";
    else if (byConvention.end.length) namedBy = "end";
    else namedBy = "unknown";
    let example = null;
    if (sampleKey && namedBy !== "calendar") {
      const e = byYm.get(sampleKey);
      example = `${fy.name} ${dominant(sampleKey)} = ${sm} ${e.y} to ${em} ${e.y + 1}`;
    }
    const carry = `If you rebuild the calendar, carry ${[fy.name, ...fiscalCompanions(t, fy.name)].join(", ")} across — the fiscal year does not stop existing because the date table was replaced.`;
    let note;
    if (startMonth === 1) note = `The fiscal year in ${t.table}[${fy.name}] is the calendar year.`;
    else if (namedBy === "inconsistent") {
      const yrs = (a) => a.length ? `${a[0]}${a.length > 1 ? `–${a[a.length - 1]}` : ""}` : "none";
      note = `The fiscal year starts in ${sm}, but ${t.table}[${fy.name}] does NOT name it consistently: named by the END year for fiscal years starting ${yrs(byConvention.end)}, by the START year for those starting ${yrs(byConvention.start)}. The source column cannot be bound as it stands — derive the fiscal year from the date with one stated convention, and say which. ${carry}`;
    } else {
      note = `The fiscal year starts in ${sm} and is named by its ${namedBy.toUpperCase()} year${example ? ` (${example})` : ""}. Every year-to-date, year slicer and year label follows it. ${carry}`;
    }
    return {
      table: t.table, column: fy.name, startMonth, startMonthName: sm, namedBy, example,
      yearsNamedByStart: byConvention.start, yearsNamedByEnd: byConvention.end,
      companions: fiscalCompanions(t, fy.name),
      consistent: rollMonths.size === 1 && namedBy !== "inconsistent",
      note,
    };
  }
  return null;
}
function fiscalCompanions(t, fyName) {
  return t.columns.filter((c) => c.name !== fyName && FISCAL_COMPANION_HINT.test(c.name)).map((c) => c.name);
}

/** Coverage per period, trailing stub, and posting-date drift for one date column on one table. */
function periodSignal(t, col, scenarioLabel) {
  const di = t.header.indexOf(col.name);
  const isKey = col.type === "dateKey";
  const perDate = new Map();
  const perMonth = new Map();
  const dayHist = new Array(32).fill(0);
  let n = 0;
  for (const r of t.rows) {
    const v = (r[di] || "").trim();
    const iso = isKey ? (isDateKey(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null) : toIsoDate(v, false);
    if (!iso) continue;
    n++;
    perDate.set(iso, (perDate.get(iso) || 0) + 1);
    const ym = iso.slice(0, 7);
    perMonth.set(ym, (perMonth.get(ym) || 0) + 1);
    dayHist[+iso.slice(8, 10)]++;
  }
  if (!n) return null;
  const dates = [...perDate.keys()].sort();
  const months = [...perMonth.keys()].sort();
  const boundaryShare = (dayHist[1] + dayHist[2] + dayHist[27] + dayHist[28] + dayHist[29] + dayHist[30] + dayHist[31]) / n;
  // Periodic posting: the gaps between consecutive posting dates are about a month (or longer).
  // Measured on the gaps rather than on dates-per-month, because a fact that posts on the 29th
  // and the 1st in turn has two postings in every other calendar month and none between.
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000);
  const medianGap = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
  const grainIsPeriodic = dates.length >= 6 && medianGap >= 25;
  const drift = grainIsPeriodic && boundaryShare >= 0.8 && dates.length !== months.length
    ? driftDetail(dates, months, perMonth) : null;

  // Period = distinct posting date when the fact posts once per period, otherwise the month.
  const periodic = grainIsPeriodic;
  const periods = periodic ? dates.map((d) => ({ period: d, rows: perDate.get(d) }))
    : months.map((m) => ({ period: m, rows: perMonth.get(m) }));
  const sorted = periods.map((p) => p.rows).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const stubs = [];
  for (let i = periods.length - 1; i >= 0 && periods[i].rows < median * 0.25; i--) stubs.unshift(periods[i]);
  const leading = [];
  for (let i = 0; i < periods.length - stubs.length && periods[i].rows < median * 0.25; i++) leading.push(periods[i]);
  const lastComplete = periods.length > stubs.length ? periods[periods.length - 1 - stubs.length].period : null;
  const today = new Date().toISOString().slice(0, 10);
  const future = dates.filter((d) => d > today);

  const out = {
    table: t.table, column: col.name, rowsWithDate: n,
    first: dates[0], last: dates[dates.length - 1],
    distinctDates: dates.length, distinctMonths: months.length,
    grain: periodic ? "one posting per period" : (dates.length > months.length * 20 ? "daily or finer" : "several postings per month"),
    periodsRead: periods.length, medianRowsPerPeriod: median,
    trailingStubs: stubs, leadingStubs: leading, lastCompletePeriod: lastComplete,
    futureDated: future.length ? { count: future.reduce((s, d) => s + perDate.get(d), 0), first: future[0] } : null,
    drift,
  };
  if (scenarioLabel) out.byScenario = scenarioLabel(t, di, isKey);
  return out;
}

function driftDetail(dates, months, perMonth) {
  // Under a calendar-month bucketing, which months get 0 postings and which get 2?
  const first = months[0], last = months[months.length - 1];
  const all = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    all.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  const empty = all.filter((k) => !perMonth.has(k));
  // "Double" months: two distinct posting dates in one calendar month.
  const datesPerMonth = new Map();
  for (const d of dates) { const k = d.slice(0, 7); datesPerMonth.set(k, (datesPerMonth.get(k) || 0) + 1); }
  const doubled = [...datesPerMonth.entries()].filter(([, c]) => c > 1).map(([k]) => k);
  return {
    postingDaysOfMonth: [...new Set(dates.map((d) => +d.slice(8, 10)))].sort((a, b) => a - b),
    calendarMonthsWithNoPosting: empty.slice(0, 12), calendarMonthsWithTwoPostings: doubled.slice(0, 12),
    note: `Postings sit at period boundaries, so bucketing by calendar month gives ${empty.length} empty month(s) and ${doubled.length} month(s) with two postings. Do not shift the dates by a guessed number of days. Use the source's own period key if one exists (a DateKey, Period or FiscalPeriod column, or the date table's month), and if none does, state the rule you chose and its control: exactly one posting per period, twelve per full year.`,
  };
}

/** Scenario coverage: declared members, rows per scenario, first/last period, entity coverage. */
function scenarioSignal(tables, joins) {
  const facts = tables.filter((t) => t.role === "fact");
  const scenarioTables = tables.filter((t) => t.role === "scenario");
  for (const f of facts) {
    // A scenario column on the fact itself, or a key that joins to a scenario table.
    let col = f.columns.find((c) => SCENARIO_COL_HINT.test(c.name) || (c.type === "text" && c.members && c.members.length <= 12
      && c.members.filter((m) => SCENARIO_NAME_HINT.test(m)).length >= 2));
    if (!col) continue;
    const ci = f.header.indexOf(col.name);
    let labelOf = (v) => v;
    let declared = null;
    const j = joins.find((x) => x.fromTable === f.table && x.fromColumn === col.name);
    if (j) {
      const st = tables.find((t) => t.table === j.toTable);
      const nameCol = st && st.columns.find((c) => c.type === "text" && c.name !== j.toColumn);
      if (st && nameCol) {
        const ki = st.header.indexOf(j.toColumn), ni = st.header.indexOf(nameCol.name);
        const map = new Map(st.rows.map((r) => [String(r[ki]).trim(), String(r[ni]).trim()]));
        labelOf = (v) => map.get(v) || v;
        declared = [...map.values()];
      }
    } else if (scenarioTables.length && col.type === "text") {
      const st = scenarioTables[0];
      const nameCol = st.columns.find((c) => c.type === "text");
      if (nameCol) declared = st.columns.find((c) => c.name === nameCol.name).members || null;
    }
    const dateCol = f.columns.find((c) => c.type === "date") || f.columns.find((c) => c.type === "dateKey");
    const di = dateCol ? f.header.indexOf(dateCol.name) : -1;
    const isKey = dateCol && dateCol.type === "dateKey";
    const otherKeys = f.columns.filter((c) => c.name !== col.name && /(key|id)$/i.test(c.name) && !c.unique && c.distinct !== null && c.distinct <= 500);
    const per = new Map();
    const overall = new Map(otherKeys.map((k) => [k.name, new Set()]));
    for (const r of f.rows) {
      const s = labelOf(String(r[ci] || "").trim());
      if (!s) continue;
      if (!per.has(s)) per.set(s, { rows: 0, first: null, last: null, entities: new Map(otherKeys.map((k) => [k.name, new Set()])) });
      const e = per.get(s);
      e.rows++;
      if (di >= 0) {
        const v = (r[di] || "").trim();
        const iso = isKey ? (isDateKey(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null) : toIsoDate(v, false);
        if (iso) { if (!e.first || iso < e.first) e.first = iso; if (!e.last || iso > e.last) e.last = iso; }
      }
      for (const k of otherKeys) {
        const ki = f.header.indexOf(k.name);
        const kv = String(r[ki] || "").trim();
        if (kv) { e.entities.get(k.name).add(kv); overall.get(k.name).add(kv); }
      }
    }
    const withRows = [...per.entries()].map(([name, e]) => ({
      name, rows: e.rows, first: e.first, last: e.last,
      coverage: otherKeys.map((k) => ({ column: k.name, members: e.entities.get(k.name).size, of: overall.get(k.name).size }))
        .filter((c) => c.members !== c.of),
    })).sort((a, b) => b.rows - a.rows);
    const empty = declared ? declared.filter((d) => !per.has(d)) : [];
    const notes = [];
    for (const e of empty) notes.push(`${e} is declared and has ZERO rows — bind nothing to it; a bound-but-empty scenario renders as a blank column that reads like a miss.`);
    for (const s of withRows) for (const c of s.coverage) notes.push(`${s.name} covers ${c.members} of ${c.of} ${c.column} members — a comparison against it exists only for those.`);
    if (withRows.length >= 2) {
      const a = withRows[0], b = withRows[1];
      if (a.first && b.first && (a.last < b.first || b.last < a.first)) notes.push(`${a.name} (${a.first} to ${a.last}) and ${b.name} (${b.first} to ${b.last}) never overlap in time — they cannot be compared on one page.`);
      else if (a.first && b.first && (a.first !== b.first || a.last !== b.last)) notes.push(`${a.name} runs ${a.first} to ${a.last}; ${b.name} runs ${b.first} to ${b.last}. A variance exists only where both have rows; print the window in the title.`);
    }
    return { table: f.table, column: col.name, declared, withRows, empty, notes };
  }
  return null;
}

function joinSignals(tables) {
  const joins = [];
  const dims = tables.filter((t) => t.keyColumn);
  for (const f of tables) {
    for (const c of f.columns) {
      if (c.unique && f.role !== "fact") continue;
      for (const d of dims) {
        if (d === f) continue;
        const sameName = d.keyColumn.toLowerCase() === c.name.toLowerCase();
        const dimBase = d.table.replace(/^(dim|d_)/i, "").toLowerCase();
        // `<Dim>Key` / `<Dim>Id` on the fact joins the dimension's key. A bare `Date` column does
        // not join a `DimDate` -- it is a date, and the first run of this tool reported all 39,409
        // rows of a fact as orphans on exactly that mismatch.
        const roleName = /(key|id)$/i.test(c.name) && c.name.toLowerCase().replace(/(key|id)$/i, "") === dimBase;
        if (!sameName && !roleName) continue;
        const dk = d.columns.find((x) => x.name === d.keyColumn);
        if (!dk || dk._overflow) continue;
        const numeric = (x) => x.type === "integer" || x.type === "dateKey" || x.type === "number";
        if (numeric(dk) !== numeric(c)) continue;
        const keys = dk._distinct;
        let orphans = 0; const examples = new Set();
        const ci = f.header.indexOf(c.name);
        const seen = new Set();
        for (const r of f.rows) {
          const v = String(r[ci] === undefined ? "" : r[ci]).trim();
          if (!v || seen.has(v)) { if (v && !keys.has(v)) orphans++; continue; }
          seen.add(v);
          if (!keys.has(v)) { orphans++; if (examples.size < 5) examples.add(v); }
        }
        joins.push({ from: `${f.table}[${c.name}]`, to: `${d.table}[${d.keyColumn}]`,
          fromTable: f.table, fromColumn: c.name, toTable: d.table, toColumn: d.keyColumn,
          orphanRows: orphans, orphanExamples: [...examples],
          note: orphans ? `${orphans} row(s) in ${f.table} carry a ${c.name} that ${d.table} does not have — every Zebra Table on this dimension will show a (Blank) row, often the largest. Fix the key, or add an Unassigned member; never leave a blank.` : null });
      }
    }
  }
  return joins;
}

function parentChildSignals(tables) {
  const out = [];
  for (const t of tables) {
    if (!t.keyColumn) continue;
    const parent = t.columns.find((c) => /^parent/i.test(c.name) && c.name.toLowerCase().replace(/^parent[\s_]?/, "") === t.keyColumn.toLowerCase());
    if (!parent) continue;
    const ki = t.header.indexOf(t.keyColumn), pi = t.header.indexOf(parent.name);
    const parentOf = new Map();
    for (const r of t.rows) parentOf.set(String(r[ki]).trim(), String(r[pi] || "").trim());
    let roots = 0, maxDepth = 0;
    for (const k of parentOf.keys()) {
      let d = 1, cur = k, guard = 0;
      while (parentOf.get(cur) && parentOf.has(parentOf.get(cur)) && guard++ < 64) { cur = parentOf.get(cur); d++; }
      if (!parentOf.get(k)) roots++;
      if (d > maxDepth) maxDepth = d;
    }
    const operator = t.columns.find((c) => OPERATOR_HINT.test(c.name));
    out.push({
      table: t.table, key: t.keyColumn, parent: parent.name, roots, depth: maxDepth,
      operatorColumn: operator ? { name: operator.name, members: operator.members } : null,
      note: `${t.table} is a parent-child hierarchy (${maxDepth} levels, ${roots} root${roots === 1 ? "" : "s"}). Zebra hierarchies come from level columns, so flatten it first: PATH(${t.keyColumn}, ${parent.name}) then one PATHITEM column per level, filled down for ragged branches.`
        + (operator ? ` The ${operator.name} column (${(operator.members || []).join(" ")}) carries the roll-up sign: an account with "-" subtracts from its parent, so a signed measure must apply it, and "~" marks a heading that does not sum.` : ""),
    });
  }
  return out;
}

function signSignals(tables) {
  const out = [];
  for (const t of tables) {
    if (t.role !== "fact") continue;
    for (const c of t.columns) {
      if (!(c.type === "number" || c.type === "integer") || /(key|id)$/i.test(c.name) || c.unique) continue;
      if (!SIGNED_AMOUNT_HINT.test(c.name) || NEVER_SIGNED_HINT.test(c.name)) continue;
      const filled = c.rows - c.blanks;
      if (!filled) continue;
      const negShare = (c.negatives || 0) / filled;
      const pct = `${(negShare * 100).toFixed(1)}% of values negative`;
      const convention = negShare < 0.05
        ? `unsigned (${pct}) — if this column carries cost accounts as well as revenue, they are stored positive, so polarity must be TOLD to the visual: invert on cost rows or cost visuals, or a cost overrun renders green`
        : negShare > 0.2
          ? `signed (${pct}) — costs stored negative so the scheme sums; nothing is inverted`
          : `mixed (${pct}) — check per account which convention holds before choosing`;
      out.push({ table: t.table, column: c.name, negatives: c.negatives, positives: c.positives, min: c.min, max: c.max, convention });
    }
  }
  return out;
}

function stockSignals(tables) {
  const out = [];
  for (const t of tables) {
    for (const c of t.columns) {
      if ((c.type === "number" || c.type === "integer") && !/(key|id)$/i.test(c.name) && STOCK_HINT.test(c.name)) {
        out.push({ table: t.table, column: c.name, note: `${c.name} reads like a point-in-time balance. If it is, it is compared as-at with an earlier snapshot and never summed across periods; a year slicer should not filter it as if it were a flow.` });
      }
    }
    if (STOCK_HINT.test(t.table) && !out.some((o) => o.table === t.table)) {
      out.push({ table: t.table, column: null, note: `${t.table} reads like a stock (balance, inventory, headcount). Its measures are as-at, not additive across time.` });
    }
  }
  return out;
}

function currencySignal(tables, joins) {
  const rateTable = tables.find((t) => t.columns.some((c) => RATE_HINT.test(c.name)) || /rate|exchange|fx/i.test(t.table));
  for (const t of tables) {
    const cur = t.columns.find((c) => CURRENCY_HINT.test(c.name));
    if (!cur || cur.distinct === null || cur.distinct <= 1) continue;
    const reaches = t.role === "fact" || joins.some((j) => j.toTable === t.table);
    if (!reaches) continue;
    return {
      table: t.table, column: cur.name, distinct: cur.distinct, members: cur.members, rateTable: rateTable ? rateTable.table : null,
      note: rateTable
        ? `${cur.distinct} currencies and a rate table (${rateTable.table}): restate to one reporting currency in the model before any total.`
        : `${cur.distinct} currencies reach the amounts and there is NO rate table. Summing across them is a plausible, meaningless number. Either the amounts are already in one reporting currency — say so as an assumption and show the currency members on a definitions page — or guard every amount measure with HASONEVALUE on the currency and lead with the measures that have no currency (counts, days, rates). Do not invent rates.`,
    };
  }
  return null;
}

/** A consolidation perimeter: an ownership share below 100% on an entity dimension. */
function perimeterSignal(tables) {
  for (const t of tables) {
    const c = t.columns.find((x) => (x.type === "number" || x.type === "integer") && /ownership|percent.*own|own.*percent|share.*held|stake/i.test(x.name));
    if (!c || c.min === null || c.min === undefined) continue;
    const scale = c.max > 1 ? 100 : 1;
    if (c.min >= scale) continue;
    const ni = t.header.indexOf(c.name);
    const nameCol = t.columns.find((x) => x.type === "text" && x.unique) || t.columns.find((x) => x.type === "text");
    const partial = [];
    for (const r of t.rows) {
      const v = Number(r[ni]);
      if (Number.isFinite(v) && v < scale && v > 0) partial.push(`${nameCol ? r[t.header.indexOf(nameCol.name)] : r[0]} ${scale === 100 ? v : Math.round(v * 100)}%`);
    }
    return { table: t.table, column: c.name, partiallyOwned: partial.slice(0, 12),
      note: `${t.table}[${c.name}] holds ownership below 100% (${partial.slice(0, 6).join(", ")}${partial.length > 6 ? ", …" : ""}). Check whether the amounts are consolidated at 100% or at share — a group total that adds a 25%-owned entity in full is a perimeter caveat the reader must see.` };
  }
  return null;
}

function duplicateSignals(tables) {
  const out = [];
  for (const t of tables) {
    if (t.role !== "fact" || t.rows.length < 2) continue;
    const seen = new Set(); let dups = 0;
    for (const r of t.rows) { const k = r.join(""); if (seen.has(k)) dups++; else seen.add(k); }
    if (dups) out.push({ table: t.table, exactDuplicateRows: dups, note: `${dups} exact duplicate row(s) — every total is high by their share. De-duplicate in the query or flag it; never fix it with a divided measure.` });
    // Also: an id column that should be unique and is not.
    const id = t.columns.find((c) => new RegExp(`^${escapeRe(t.table.replace(/^fact/i, ""))}[\\s_]?(key|id)$`, "i").test(c.name));
    if (id && !id.unique && id.distinct !== null) out.push({ table: t.table, column: id.name, distinct: id.distinct, rows: t.rows.length, note: `${id.name} looks like the row id and repeats: ${t.rows.length - id.distinct} repeat(s).` });
  }
  return out;
}

// --- the profile ----------------------------------------------------------------------------

function profileSource(args = {}) {
  const root = args.path;
  if (typeof root !== "string" || !root) return { ok: false, error: "path is required: a folder of flat files, or one file" };
  if (!fs.existsSync(root)) return { ok: false, error: `${root} does not exist` };

  const files = listFiles(root);
  if (!files.length) return { ok: false, error: `no .csv/.txt/.tsv/.psv/.json files under ${root}` };

  const tables = [];
  const notProfiled = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const table = path.basename(file, ext);
    if (BINARY_EXT.has(ext)) {
      notProfiled.push(`${path.basename(file)} — a binary file. This tool reads delimited text and JSON. Export the sheet to CSV, or profile it through the model once it is loaded.`);
      continue;
    }
    const t = JSON_EXT.has(ext) ? readJsonTable(file) : readTextTable(file);
    if (t.unreadable) { notProfiled.push(`${path.basename(file)} — ${t.unreadable}`); continue; }
    if (!t.rows.length) { notProfiled.push(`${path.basename(file)} — empty`); continue; }
    const columns = profileColumns(t.header, t.rows);
    const rec = { table, file: path.basename(file), delimiter: t.delimiter, headerless: t.headerless, sampled: t.sampled,
      sizeBytes: t.sizeBytes, rows: t.rows, header: t.header, columns };
    rec.keyColumn = keyColumnOf(table, columns);
    rec.role = classifyFile(table, columns, t.rows);
    if (rec.role === "fact") rec.keyColumn = rec.keyColumn && columns.find((c) => c.name === rec.keyColumn && c.unique) ? rec.keyColumn : null;
    tables.push(rec);
    if (t.headerless) notProfiled.push(`${path.basename(file)} has no header row — columns are named col1..col${t.header.length}. Find the schema before you bind anything.`);
    if (t.sampled) notProfiled.push(`${path.basename(file)} is over ${MAX_FILE_BYTES / 1048576} MB, so only its first ${MAX_FILE_BYTES / 1048576} MB were read. Counts and ranges below are a sample.`);
  }
  if (!tables.length) return { ok: false, error: "nothing readable was found", notProfiled };

  const joins = joinSignals(tables);
  const fiscal = fiscalSignal(tables);
  const scenarios = scenarioSignal(tables, joins);
  // Coverage is read on every dated table that is not the calendar itself: facts first, then an
  // unclassified series (a JSON export with date + count and nothing else is still the data).
  const periods = [];
  for (const t of tables) {
    if (t.role === "date" || t.role === "scenario" || t.role === "dimension") continue;
    const dateCols = t.columns.filter((c) => c.type === "date");
    const keyCols = t.columns.filter((c) => c.type === "dateKey");
    const col = dateCols[0] || keyCols[0];
    if (col) { const p = periodSignal(t, col); if (p) periods.push(p); }
  }
  const parentChild = parentChildSignals(tables);
  const signs = signSignals(tables);
  const stocks = stockSignals(tables);
  const currency = currencySignal(tables, joins);
  const perimeter = perimeterSignal(tables);
  const duplicates = duplicateSignals(tables);
  const dateTables = tables.filter((t) => t.role === "date");

  // The analyst's defaults, phrased as one-line assumptions the reader can correct in a word.
  const brief = [];
  // The brief speaks about the main fact: the largest table that got a period signal.
  const rowsOf = (name) => (tables.find((t) => t.table === name) || { rows: [] }).rows.length;
  const lead = periods.slice().sort((a, b) => rowsOf(b.table) - rowsOf(a.table))[0];
  if (lead && lead.lastCompletePeriod) {
    brief.push(`Period: the last complete period in the data is ${lead.lastCompletePeriod}` +
      (lead.trailingStubs.length ? ` — ${lead.trailingStubs.map((s) => `${s.period} has ${s.rows} rows against a median of ${lead.medianRowsPerPeriod}`).join("; ")}, so it is a stub, not a period; exclude it from every comparison and say so` : "") + ".");
  }
  if (fiscal && fiscal.namedBy === "inconsistent") brief.push(`Fiscal year: starts ${fiscal.startMonthName}, and the source's ${fiscal.column} column names it two different ways — derive the fiscal year from the date with one stated convention rather than binding the column.`);
  else if (fiscal && fiscal.startMonth && fiscal.startMonth !== 1) brief.push(`Fiscal year: starts ${fiscal.startMonthName}, named by its ${fiscal.namedBy} year${fiscal.example ? ` (${fiscal.example})` : ""}. Not the calendar year.`);
  else if (fiscal && fiscal.startMonth) brief.push(`Fiscal year: ${fiscal.table}[${fiscal.column}] equals the calendar year.`);
  else if (fiscal) brief.push(`Fiscal year: ${fiscal.note}`);
  else brief.push("Fiscal year: no fiscal column found — assume calendar, and say so; a plan whose months run April to March or July to June overrides this.");
  if (scenarios) {
    const names = scenarios.withRows.map((s) => s.name);
    const hasPlan = names.some((n) => /budget|plan|target/i.test(n));
    const hasFc = names.some((n) => /forecast|outlook|estimate/i.test(n));
    brief.push(`Comparison: scenarios with rows are ${names.join(", ") || "none"}${scenarios.empty.length ? `; declared but EMPTY: ${scenarios.empty.join(", ")}` : ""}. ` +
      (hasPlan ? "Lead with plan where it reaches, previous year everywhere." : "No plan: lead with previous year.") + (hasFc ? " Forecast is present: the full-year outlook (actuals to date plus forecast) against the full-year plan is the board's line." : ""));
  } else if (lead && lead.distinctMonths >= 13) brief.push("Comparison: no scenario column; at least two years of actuals, so previous year is the comparison. No plan does not mean no variance.");
  else brief.push("Comparison: no scenario column and under two years of data — a variance needs a benchmark or a target; do not invent one.");
  // The sign convention matters where one column carries revenue AND cost: a ledger with an
  // account dimension, or a column that is already signed or mixed. A sales fact's all-positive
  // SalesAmount is not a finding.
  const hasAccounts = tables.some((t) => /account|ledger|gl\b|chart/i.test(t.table));
  for (const s of signs.filter((x) => hasAccounts || !/^unsigned/.test(x.convention)).slice(0, 2)) brief.push(`Sign: ${s.table}[${s.column}] is ${s.convention}.`);
  if (currency) brief.push(`Currency: ${currency.note}`);
  if (perimeter) brief.push(`Perimeter: ${perimeter.note}`);
  for (const p of parentChild) brief.push(`Hierarchy: ${p.table} is parent-child, ${p.depth} levels — flatten with PATH before binding.`);
  for (const s of stocks.slice(0, 3)) brief.push(`Stock: ${s.note}`);

  const gaps = [];
  if (!tables.some((t) => t.columns.some((c) => c.type === "date" || c.type === "dateKey"))) gaps.push("NO DATE COLUMN in any file — there is no time axis, so PY and YTD are unavailable. A trend page cannot be built from this.");
  if (!dateTables.length && lead) gaps.push("No date table among the files — build a calendar in the model (and carry any fiscal columns into it).");
  if (!scenarios && lead && lead.distinctMonths < 13) gaps.push("NO COMPARATIVE — no scenario column and under two years. Zebra draws a variance from a pair; the documented fallback is benchmark-vs-population.");
  for (const j of joins) if (j.orphanRows) gaps.push(`ORPHAN KEYS: ${j.from} → ${j.to}: ${j.orphanRows} row(s) with no match (e.g. ${j.orphanExamples.join(", ")}).`);
  for (const p of periods) {
    if (p.futureDated) gaps.push(`FUTURE-DATED ROWS in ${p.table}[${p.column}]: ${p.futureDated.count} row(s) from ${p.futureDated.first}. The last-data-date measure must ignore them or the period label lies.`);
    if (p.drift) gaps.push(`POSTING DATES DRIFT in ${p.table}[${p.column}]: postings on days ${p.drift.postingDaysOfMonth.join(", ")} of the month. ${p.drift.note}`);
  }
  if (fiscal && fiscal.namedBy === "inconsistent") gaps.push(`FISCAL YEAR COLUMN INCONSISTENT: ${fiscal.note}`);
  if (scenarios) for (const n of scenarios.notes) gaps.push(`SCENARIO COVERAGE: ${n}`);
  for (const d of duplicates) gaps.push(`DUPLICATES: ${d.note}`);
  const single = [];
  for (const t of tables) for (const c of t.columns) if (c.distinct === 1 && c.type === "text" && t.rows.length > 1) single.push(`${t.table}[${c.name}]`);
  if (single.length) gaps.push(`CARDINALITY 1, a finding not a filter: ${single.join(", ")}.`);

  notProfiled.push(
    "Whether any number is RIGHT. Nothing here aggregates a measure against a figure the reader trusts — run the reconciliation check against a known total yourself.",
    "Which findings matter to the reader. This is the data's shape; the brief (who reads it, what they decide) still comes from the request, the file names and your judgement.",
    "Text encodings other than UTF-8, and dates in a form other than ISO, yyyy/mm/dd or a slash form with a four-digit year.",
  );

  return {
    ok: true,
    root,
    files: tables.map((t) => ({
      file: t.file, table: t.table, role: t.role, delimiter: t.delimiter === "\t" ? "tab" : t.delimiter, headerless: t.headerless,
      rows: t.rows.length, sizeBytes: t.sizeBytes, sampled: t.sampled, keyColumn: t.keyColumn,
      columns: t.columns.map(({ _distinct, _overflow, ...c }) => c),
    })),
    joins: joins.map(({ fromTable, fromColumn, toTable, toColumn, ...j }) => j),
    fiscal, periods, scenarios, parentChild, signs, stocks, currency, perimeter, duplicates,
    analystBrief: brief,
    gaps,
    notProfiled,
  };
}

module.exports = { profileSource, sniffDelimiter, splitLine, toIsoDate, profileColumns, fiscalSignal, periodSignal };
