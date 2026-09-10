// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";

/**
 * propose_pages — turn the ranked enumeration into a write_report spec.
 *
 * The last hand-written thing in the mechanical path. `profile_project` says which questions the
 * data can answer and which of them move; `write_report` turns a spec into PBIR. Between them the
 * agent was still hand-typing ~2,500 characters of spec that is almost entirely derivable from the
 * ranking plus the house page pattern.
 *
 * ☠️ WHAT THIS DELIBERATELY DOES NOT DO, because the corpus is unambiguous that it is where
 * reports go wrong: it does not decide what the report SAYS. It proposes one page per
 * high-signal dimension, in ranked order, using the pattern the templates already use. It does not
 * write a narrative, does not name a story, and does not choose which findings matter. The skill's
 * own warning is that "a story named straight off a profile is a story named from a template you
 * already had in mind, and it will be decoration" -- so this returns a STARTING POINT with its
 * reasoning attached, and every page carries the numbers that justified it so the agent can throw
 * one out on sight.
 *
 * It also refuses to paper over the two things that silently produce a beautiful wrong report:
 *   - No scenario measure -> it does NOT invent a comparison. It says so and emits value-only
 *     pages, because a variance column with nothing valid behind it is worse than no column.
 *   - A dimension it could not score -> reported in `notProposed`, never dropped, because a
 *     shrinking denominator is how a partial enumeration passes for a complete one.
 */

const ZEBRA_TABLE = "ZebraBITablesBAE31B370F254F808553548EFB35BFA5";
const ZEBRA_TABLE_PLUS = "ZebraBITablesPlus3E6085701D7B426980C3859B16327993";

/** `Entity[Column]` -> a binding, which is what write_visual wants. */
function bindingOf(ref) {
  const m = /^(.+)\[(.+)\]$/.exec(ref);
  if (!m) return null;
  return { entity: m[1], property: m[2], kind: "Column", active: true };
}

/**
 * `Table[Measure]` -> the OBJECT form write_visual resolves.
 *
 * Not the `Table.Measure` string form. write_visual splits a string binding on the last dot,
 * which is correct and documented, so a measure whose own name contains a dot -- `Avg. Score`,
 * `No. of Orders`, `Qty. Shipped` -- became entity `Model.Avg` and property ` Score`, resolved to
 * nothing, and rendered an empty visual. Nothing downstream catches it: the field-resolution rule
 * was deliberately rejected, so validate_report is silent too. `bindingOf` above already used the
 * object form for Category; this is the same fix for measures. Corrected 2026-08-31.
 */
function measureRef(ref) {
  const m = /^(.+)\[(.+)\]$/.exec(ref);
  if (!m) return ref;
  return { entity: m[1], property: m[2], kind: "Measure" };
}

function proposePages(profile, opts = {}) {
  const maxPages = Number.isFinite(opts.maxPages) ? opts.maxPages : 4;
  const usePlus = opts.usePlus !== false;         // Plus is the authoring default since 2026-08-14
  const visualType = usePlus ? ZEBRA_TABLE_PLUS : ZEBRA_TABLE;

  if (!profile || profile.ok === false) {
    return { ok: false, error: "propose_pages needs a successful profile_project result" };
  }
  const ranked = (profile.signal && profile.signal.ranked) || [];
  if (!ranked.length) {
    return {
      ok: false,
      error: "nothing was ranked, so there is no basis for a proposal. Either the rows are not on "
        + "disk (run the enumeration against the live model instead) or no dimension moves any "
        + "measure. Proposing pages from an unranked list would be exactly the template-first "
        + "failure this tool exists to avoid.",
    };
  }

  // Scenario measures, by name. Without a comparison there is no variance to draw, and inventing
  // one is the failure mode; say so instead.
  const measures = profile.measures || [];
  const find = (re) => measures.find((m) => re.test(m));

  // Prefer the model's STRUCTURAL detection over a name-shape guess. `profile.scenarios` comes
  // from tmdl.scenarioMeasures, which resolves the vendor convention `Revenue` + `Revenue PY` --
  // the actual is the base measure and is never named "AC", so the predicates below cannot see it.
  // The pairing is kept on ONE metric on purpose: a model carrying Revenue/Revenue PY and Units
  // Sold/Units Sold PY must not bind revenue against last year's units.
  const sc = profile.scenarios;
  const nameOf = (ref) => ref.replace(/^.*\[|\]$/g, "");
  const TOKEN = /(^|[\s_.\-])(ac|actual|actuals|py|previous ?year|prior ?year|ly|last ?year|pl|plan|budget|bu|fc|forecast)([\s_.\-]|$)/i;
  const baseOf = (ref) => nameOf(ref).replace(TOKEN, "$1").replace(/[\s_.\-]+$/, "").trim().toLowerCase();
  // Every coherent pair the model offers, one per metric. The CHOICE among them is made later,
  // once the ranked subject is known, so the subject's own comparison is preferred over whichever
  // metric happened to be declared first.
  const pairs = [];
  if (sc && sc.hasComparative) {
    for (const base of sc.pairedActuals || []) {
      const a = measures.find((m) => nameOf(m).trim().toLowerCase() === base.toLowerCase());
      if (!a) continue;
      const pl = (sc.found.plan || []).find((r) => baseOf(r) === base.toLowerCase()) || null;
      const pyr = (sc.found.previousYear || []).find((r) => baseOf(r) === base.toLowerCase()) || null;
      if (pl || pyr) pairs.push({ actual: a, plan: pl, py: pyr });
    }
    // A model that names its actuals (`Revenue AC`, `Units AC`). Pair by the metric the token was
    // stripped from: taking `[0]` of each list bound `Revenue AC` against `Units PY` on any model
    // with two metrics.
    for (const a of sc.found.actual || []) {
      if (pairs.some((x) => x.actual === a)) continue;
      const base = baseOf(a);
      const pl = (sc.found.plan || []).find((r) => baseOf(r) === base) || null;
      const pyr = (sc.found.previousYear || []).find((r) => baseOf(r) === base) || null;
      if (pl || pyr) pairs.push({ actual: a, plan: pl, py: pyr });
    }
  }
  if (!pairs.length) {
    // The name-shape guess, kept as the last resort for a model the structural pass reads nothing from.
    const a = find(/\[(ac|actual|actuals)\]$/i) || null;
    const pl = find(/\[(pl|plan|budget)\]$/i) || null;
    const pyr = find(/\[(py|previous ?year|prior ?year|ly|last ?year)\]$/i) || null;
    if (a && (pl || pyr)) pairs.push({ actual: a, plan: pl, py: pyr });
  }
  const hasComparison = pairs.length > 0;

  // ☠️ ONE MEASURE ACROSS ALL PAGES, and this is not a stylistic choice.
  //
  // Taking the best-scoring question per dimension independently produces a set of pages that each
  // show a DIFFERENT measure. They then cannot be compared with each other, which is a recorded
  // semantic failure: it "reads as an inconsistent, seemingly deliberate design choice, when it was
  // actually an oversight". The first version of this function did exactly that -- page 1 scored
  // the recommendation score and page 2 the sentiment score, and the two pages looked like a
  // comparison while being none.
  //
  // So: pick the measure with the strongest single result, then cut THAT measure by each dimension.
  // A report is a set of views of one subject, not a list of unrelated bests.
  // ☠️ THE RANKING SCORES COLUMNS. ZEBRA'S `Values` WELL TAKES A MEASURE.
  //
  // Binding a raw column there renders "Something's wrong with one or more fields" — caught by a
  // screenshot after 23 passing unit tests and a clean `validate_report`, which is the whole reason
  // this project's first rule is that the screenshot is the only evidence.
  //
  // So map each ranked column back to a measure that aggregates it, by reading the measure's DAX
  // for a reference to that column. No measure, no page: proposing an unbindable page is worse than
  // proposing fewer.
  const exprs = profile.measureExprs || [];
  const measureFor = (colRef) => {
    const m = /^(.+)\[(.+)\]$/.exec(colRef);
    if (!m) return null;
    const needle = `${m[1]}[${m[2]}]`.toLowerCase();
    const hit = exprs.find((e) => (e.expression || "").toLowerCase().includes(needle));
    return hit ? hit.ref : null;
  };

  const bindable = [];
  const unbindable = [];
  for (const q of ranked) {
    (measureFor(q.measureColumn) ? bindable : unbindable).push(q);
  }
  if (!bindable.length) {
    return {
      ok: false,
      error: "every ranked question scores a COLUMN with no measure aggregating it, and Zebra's "
        + "Values well takes a measure — binding a column renders \"Something's wrong with one or "
        + "more fields\". Add a measure (e.g. AVERAGE or SUM over the column) and run again. "
        + `Columns ranked but unbindable: ${[...new Set(unbindable.map((q) => q.measureColumn))].join(", ")}`,
    };
  }

  const subject = bindable[0].measureColumn;
  const subjectMeasure = measureFor(subject);

  // ☠️ BIND THE COMPARISON ONLY IF THE RANKED SUBJECT *IS* THE ACTUAL.
  //
  // Otherwise the page binds AC while `subject`, `subjectMeasure` and every `_why` still describe a
  // DIFFERENT measure: the page shows revenue and the numbers underneath it are sentiment. The
  // dimension set is cut by that other measure too (`forSubject`), so the page set is chosen by a
  // measure the pages never display -- the decoration failure this file opens by warning against.
  // A comparison whose actual is not the subject is reported in youMustStillDecide instead of
  // being drawn, which is the same refusal doctrine as "will not invent a comparison".
  //
  // This path first became reachable on 2026-08-31, when profile.scenarios started arriving and
  // hasComparison stopped being permanently false on the vendor naming convention.
  const same = (a, b) => nameOf(a).trim().toLowerCase() === nameOf(b).trim().toLowerCase();
  const chosen = pairs.find((x) => subjectMeasure && same(x.actual, subjectMeasure)) || pairs[0] || null;
  const actual = chosen ? chosen.actual : null;
  const plan = chosen ? chosen.plan : null;
  const py = chosen ? chosen.py : null;
  const subjectIsActual = Boolean(actual && subjectMeasure && same(subjectMeasure, actual));
  const bindComparison = hasComparison && subjectIsActual;
  const forSubject = bindable.filter((q) => q.measureColumn === subject);
  const otherMeasures = [...new Set(bindable.filter((q) => q.measureColumn !== subject)
    .map((q) => q.measureColumn))];

  const seen = new Set();
  const pages = [];
  const notProposed = unbindable.length
    ? [`${[...new Set(unbindable.map((q) => q.measureColumn))].join(", ")} — ranked, but no measure `
       + "aggregates these columns, and Zebra's Values well takes a measure. Add one to use them."]
    : [];
  notProposed.push(...otherMeasures.map((m) =>
    `${m} — a different measure from the chosen subject ${subject}; pages cut by different measures `
    + "cannot be compared with each other. Propose it as its own report if it matters."));
  for (const q of forSubject) {
    if (pages.length >= maxPages) { notProposed.push(`${q.question} — beyond maxPages=${maxPages}`); continue; }
    if (seen.has(q.dimension)) { notProposed.push(`${q.question} — same dimension as a page already proposed`); continue; }
    const binding = bindingOf(q.dimension);
    if (!binding) { notProposed.push(`${q.question} — could not parse ${q.dimension}`); continue; }
    seen.add(q.dimension);

    // Always a MEASURE, never the ranked column itself.
    const values = bindComparison ? [measureRef(actual)] : [measureRef(subjectMeasure)];
    const bindings = { Category: [binding], Values: values };
    if (bindComparison && plan) bindings.Plan = [measureRef(plan)];
    if (bindComparison && py) bindings.PreviousYear = [measureRef(py)];

    const name = `p${pages.length + 1}`;
    pages.push({
      name,
      displayName: binding.property,
      visuals: [{
        name: `${name}Table`,
        visualType,
        position: { x: 16, y: 16, z: 1000, width: 1248, height: 660, tabOrder: 1000 },
        bindings,
        properties: {
          "titleSettings.show": true,
          "titleSettings.text": bindComparison
            ? `${nameOf(subjectMeasure)} by ${binding.property} - actual vs comparison`
            : `${nameOf(subjectMeasure)} by ${binding.property}`,
          "chartSettings.suppressNulls": true,
          // A page justified by a ranking (the effect is max-vs-min member) is sorted by value,
          // descending, and Tables need BOTH keys: which column, and that it sorts at all.
          "sortSettings.columnName": "actual",
          "sortSettings.categorySort": 1,
        },
      }],
      // Why this page exists, carried WITH the page so it can be argued with.
      _why: `effect ${q.effect} — ${q.lowest.member} (${q.lowest.mean}) to `
          + `${q.highest.member} (${q.highest.mean}) across ${q.members} members`,
    });
  }

  const spec = { activePageName: pages[0] && pages[0].name, pages: pages.map(({ _why, ...p }) => p) };

  const decide = [
    "WHAT THE REPORT SAYS. These pages are ordered by measured effect, not by importance. Read the "
      + "numbers on each and throw out any page whose finding does not matter to the reader.",
    "Whether any of these numbers is RIGHT. Nothing here evaluated a measure against an oracle.",
    "Whether the actuals cover the same window as the comparison. A partial trailing period "
      + "produces a confident, completely wrong variance and no file check sees it.",
  ];
  if (hasComparison && !subjectIsActual) {
    decide.unshift(
      `A SCENARIO PAIR EXISTS BUT NOT ON THE SUBJECT. The pair found is ${actual}`
      + `${plan ? ` vs ${plan}` : ""}${py ? ` vs ${py}` : ""}, while the measure the data says carries `
      + `signal is ${subjectMeasure}. These pages show ${subjectMeasure} with no comparison, because `
      + "drawing a variance of one measure under a page chosen by another is a page justified by "
      + "numbers it does not display. Decide which you want: re-run against the actual, or accept "
      + "value-only pages for the subject.");
  }
  if (!hasComparison) {
    decide.unshift("NO SCENARIO MEASURE PAIR WAS FOUND, so these pages carry a value column and NO "
      + "variance — the thing Zebra is for. Either add AC/PL/PY measures, or add a benchmark "
      + "measure (an ALL() population average) and bind it to Plan yourself. This tool will not "
      + "invent a comparison.");
  }

  return {
    ok: true,
    subject,
    subjectMeasure,
    spec,
    rationale: pages.map((p) => ({ page: p.displayName, why: p._why })),
    // What was BOUND, not what exists. A pair that sits on another metric is reported in
    // youMustStillDecide and in comparisonAvailable, never here.
    comparisonBound: bindComparison ? { actual, plan: plan || null, previousYear: py || null } : null,
    comparisonAvailable: hasComparison && !bindComparison
      ? { actual, plan: plan || null, previousYear: py || null, onSubject: false } : null,
    notProposed,
    youMustStillDecide: decide,
  };
}

module.exports = { proposePages, ZEBRA_TABLE, ZEBRA_TABLE_PLUS };
