// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";
/**
 * Blob encoders.
 *
 * A "blob" is a Zebra property whose value is JSON inside a JSON string inside a quoted PBIR
 * literal. Three layers, and nothing else in the format stacks that way. Hand-writing one is
 * where the expensive mistakes live, so these exist to make the worst of them unreachable
 * rather than merely detectable.
 *
 * Two landmines carry the whole case, and both are eliminated by making one field mandatory:
 *
 *   An absent `filterContexts` KEY blanks the ENTIRE visual. Not the comment, the whole table.
 *   An empty array is fine. A missing key is not, and the two are one keystroke apart.
 *
 *   An `addedFormulas` row is swept into the grand total unless it is also excluded. The total
 *   renders in bold, looks entirely right, and is inflated by whatever the row contains.
 *
 * Eleven of the nineteen documented landmines are structurally preventable this way. The rest
 * are post-hoc, and these encoders do not pretend otherwise: where a caller can still get it
 * wrong, the return carries a `warnings` array or a `companion` instruction saying what else
 * must be true outside the blob.
 *
 * Every encoder returns the same shape:
 *
 *   { property, value, literal, companion?, warnings?, also? }
 *
 * `property` is the dotted path to write. `literal` is the PBIR expression object, ready to
 * splice in as-is. `value` is the inner string for inspection. `also` carries a second
 * property when one call must produce two, which is how the grand-total landmine is closed.
 */

/** The PBIR literal wrapper. Colour inside a blob is a plain hex string; outside it is this. */
const literalOf = (json) => ({ expr: { Literal: { Value: `'${json}'` } } });

class EncodeError extends Error {}
const need = (cond, msg) => { if (!cond) throw new EncodeError(msg); };

/**
 * Refused rather than escaped -- the same position writers.js takes, for the same reason. A PBIR
 * string literal is single-quoted, no file in the 511-report reference corpus contains a literal
 * with an apostrophe in either the raw or the doubled form, and one of the two is a silent
 * corruption. Until 2026-09-01 the encoders emitted the raw form without a word while the writer
 * refused it, and the skill told the agent to splice the encoder's literal in unchanged -- so a
 * category called `Women's wear` or a comment reading `doesn't` corrupted the visual on the path
 * the documentation recommends. The two workarounds are the writer's.
 */
function noApostrophe(json, property) {
  need(!json.includes("'"),
    `${property} contains an apostrophe (in a category, a comment or a label), and how a PBIR `
    + `literal escapes one is not established: no file in the reference corpus carries a literal `
    + `with one, raw or doubled, and one of the two forms corrupts the visual in silence. Use the `
    + `typographic apostrophe U+2019 (’) in the text instead, which reads better in a report `
    + `anyway, or verify the escaping against a render and pass the literal yourself.`);
  return json;
}

function emit(property, obj, extra = {}) {
  const value = noApostrophe(JSON.stringify(obj), property);
  return { property, value, literal: literalOf(value), ...extra };
}

/**
 * A stable id from the anchor rather than a random one.
 *
 * Zebra's own comment ids are v4, but a random id makes re-encoding the same input produce a
 * different blob every time, so an idempotent rebuild shows a spurious diff. This is a v4-shaped
 * digest of the anchor, which keeps the format and makes the output reproducible.
 */
function stableId(seed) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = (h1 ^ seed.charCodeAt(i)) * 16777619 >>> 0;
    h2 = (h2 + seed.charCodeAt(i) * (i + 7)) * 2654435761 >>> 0;
  }
  // Coerce to unsigned before stringifying. `^` returns a SIGNED 32-bit int in JavaScript, and a
  // negative one stringifies with a leading "-", which lands a dash inside a segment and produces
  // a malformed id: 4b9b59dc-cb49-4-7f-a196-16e4ebdc-6f4 rather than 8-4-4-4-12.
  const hex = (n, len) => (n >>> 0).toString(16).padStart(8, "0").slice(0, len);
  const a = hex(h1, 8), b = hex(h2, 4), c = hex(h1 ^ h2, 3), d = hex(h2 >>> 3, 3),
        e = hex(h1 + h2 >>> 0, 8) + hex(h2 ^ 0x5bf03635, 4);
  return `${a}-${b}-4${c}-a${d}-${e}`;   // version 4, variant 10xx
}

// --- Tables: per-column settings -------------------------------------------------------------

/**
 * `chartSettings.columnSettings`.
 *
 * The full key set is always emitted on the view object. Dropping a key from `chartView` does
 * not fall back to a default: Zebra reads undefined where it expects an empty string and the
 * chart cells render solid black. So a partial view object is not accepted, it is completed.
 *
 * `showAsTable` is never exposed. The same name is a BOOLEAN at `chartSettings` and an INTEGER
 * ENUM here, and the wrong type is silently ignored. The caller says `inCellChart` and the
 * encoder picks the type for the position it is writing.
 */
function encodeTableColumns({ columns, mode, legalKeys } = {}) {
  need(Array.isArray(columns) && columns.length, "columns is required and needs at least one entry");
  need(mode === "table" || mode === "chart",
    "mode must be 'table' or 'chart'. tableView is read only when chartSettings.showAsTable is "
    + "true, chartView only when it is false, so the encoder has to know which one you mean");

  const view = mode === "table" ? "tableView" : "chartView";
  const out = {};
  const warnings = [];

  for (const c of columns) {
    need(c && c.key, "every column needs a key: a scenario role or a measure name");
    if (legalKeys && !legalKeys.includes(c.key)) {
      warnings.push(`Column key '${c.key}' is not in the legal key set for the calculations you `
        + `declared, so it will be ignored. Legal: ${legalKeys.join(", ")}`);
    }
    if ("header" in c) {
      warnings.push("`header` was authored and dropped: it has no observed effect and the cause "
        + "is unknown, so emitting it would be a silent no-op.");
    }
    const col = {};
    if (typeof c.order === "number") col.order = c.order;
    for (const k of ["invert", "scaleGroup", "format", "useMeasureName", "suppressOthers",
                     "pbiFormatString"]) {
      if (k in c) col[k] = c[k];
    }
    if (c.hidden === true) col.hidden = true;
    if (Array.isArray(c.hideFromGroups)) {
      // Preserve the caller's JS types. Stringifying a numeric group value is the suspected
      // cause of hiddenFromGroups working on one scenario and not another.
      col.hiddenFromGroups = c.hideFromGroups;
    }
    // The full key set, always. Absent is not the same as empty here.
    col[view] = {
      showAsTable: c.inCellChart === "bar" ? 2 : 0,
      backgroundFill: c.backgroundFill ?? "",
      textColor: c.textColor ?? "",
      markerStyle: c.markerStyle ?? "",
      bold: c.bold === true,
    };
    out[c.key] = col;
  }

  return emit("chartSettings.columnSettings", out, {
    companion: `chartSettings.showAsTable must be ${mode === "table"} for ${view} to be read.`,
    ...(warnings.length ? { warnings } : {}),
  });
}

/**
 * `chartSettings.calculations` decides which keys are legal inside `columnSettings`, so one
 * caller owns both sides and the second call gets the key set handed to it.
 */
const SCENARIO_KEYS = ["actual", "plan", "previousYear", "forecast"];
const COMPARISONS = ["actual-plan", "actual-plan-percent", "actual-previousYear",
  "actual-previousYear-percent", "forecast-plan", "forecast-plan-percent"];

function encodeTableCalculations({ comparisons } = {}) {
  need(Array.isArray(comparisons) && comparisons.length,
    `comparisons is required. Choose from: ${COMPARISONS.join(", ")}`);
  const bad = comparisons.filter((c) => !COMPARISONS.includes(c));
  need(!bad.length, `unknown comparison(s): ${bad.join(", ")}. Choose from: ${COMPARISONS.join(", ")}`);
  return emit("chartSettings.calculations", comparisons, {
    legalColumnKeys: [...SCENARIO_KEYS, ...comparisons],
  });
}

// --- Tables: computed rows -------------------------------------------------------------------

/**
 * `categoriesMetadata.addedFormulas`, and `skipCalculationCategories` from the same call.
 *
 * This is the grand-total landmine. A computed row is summed into the total unless it is also
 * listed as skipped, and the wrong total is bold, plausible and unflagged. `aggregatesOtherRows`
 * is therefore mandatory and boolean, and both blobs come back together, so there is no call
 * shape that produces one without the other.
 */
function encodeAddedFormulas({ categoryField, formulas } = {}) {
  need(categoryField, "categoryField is required, e.g. 'Accounts.Account group'");
  need(Array.isArray(formulas) && formulas.length, "formulas is required and needs one entry");

  const added = [];
  const skip = [];
  const warnings = [];

  for (const f of formulas) {
    need(f && f.name, "every formula needs a name, which becomes its row label");
    need(f.expression, `formula '${f.name}' needs an expression, e.g. '[Gross profit] / [Revenue]'`);
    need(typeof f.aggregatesOtherRows === "boolean",
      `formula '${f.name}' needs aggregatesOtherRows: true or false. A row that aggregates other `
      + `rows must be excluded from the grand total, or the total is silently inflated by it.`);

    const entry = {
      identity: f.name,
      expression: f.expression,
      hierarchyIdentity: categoryField,
      position: f.insertAfter ?? "",
      bold: f.bold === true,
      italic: f.italic === true,
      percent: f.percent === true,
      decimalPlaces: typeof f.decimalPlaces === "number" ? f.decimalPlaces : 0,
      units: f.units ?? "Default",
      selectionId: null,
      fontColor: f.fontColor ?? "",
    };
    added.push(entry);
    if (f.aggregatesOtherRows) {
      skip.push({ hierarchyIdentity: categoryField, category: f.name, level: 0 });
    }
    if (f.insertAfter) {
      warnings.push(`'${f.name}' asks to sit after '${f.insertAfter}', but position loses to `
        + `sorting: if the table sorts by value the row lands wherever its value puts it.`);
    }
  }

  const result = emit("categoriesMetadata.addedFormulas", added,
    warnings.length ? { warnings } : {});
  // Emitted unconditionally when anything aggregates, rather than trying to detect whether a
  // grand total is on: showGrandTotal is itself an unresolved property, so conditioning on it
  // would make correctness depend on a measurement nobody trusts.
  result.also = skip.length
    ? emit("categoriesMetadata.skipCalculationCategories", skip)
    : null;
  return result;
}

// --- Tables and Charts: the comment layer ----------------------------------------------------

/**
 * `annotationLayerSettings.annotationComments`.
 *
 * `target` is mandatory because the shape differs by product. A Table carries its category in
 * `dataPointSelection` and emits `categoryFields: []`; a Chart must also name the bound category
 * field there. Given the Table shape, a Chart renders and drops every comment, and the panel
 * reports that none match the current view — which reads as a filter problem.
 *
 * `currentFilters` is mandatory. That is the point of this encoder. An absent `filterContexts`
 * key blanks the entire visual with no error, and an anchor pinned to a filter state the page
 * can never be in makes the comment invisible forever. Requiring the live filter state turns a
 * silent failure into a deliberate assertion by the caller.
 *
 * Emitted as a BARE ARRAY. A `{value:[...],Count:n}` envelope, which is what a PowerShell
 * round-trip produces, blanks the visual and in one observed case could not be recovered
 * without rebuilding it. Nobody needs to round-trip a blob to author one, so the encoder
 * removes the reason the mistake happens.
 */
function encodeAnnotations({ valuesOrder, currentFilters, comments, timestamp,
                            target, categoryFields } = {}) {
  need(target === "tables" || target === "charts",
    "target must be 'tables' or 'charts'. categoryFields is empty on a Table and names the bound "
    + "category field on a Chart; the wrong one drops every comment while the panel blames the "
    + "filters, so the encoder has to know which visual it is writing for");
  if (target === "charts") {
    need(Array.isArray(categoryFields) && categoryFields.length
      && categoryFields.every((f) => typeof f === "string" && f),
      "categoryFields is required on a Chart: name the bound category field, e.g. ['Year'], or "
      + "one entry per level on a hierarchy, e.g. ['Year','Quarter Name']. The empty list is the "
      + "Table shape and drops every comment");
  } else {
    need(categoryFields === undefined
      || (Array.isArray(categoryFields) && categoryFields.length === 0),
      "categoryFields must be omitted or empty on a Table: the category is carried by "
      + "dataPointSelection there, and every Table in the template corpus emits an empty list");
  }
  need(Array.isArray(currentFilters) && currentFilters.length,
    "currentFilters is required and must describe the LIVE filter state. A comment whose filter "
    + "context does not match what the page shows is silently dropped, and omitting the key "
    + "entirely blanks the whole visual");
  need(Array.isArray(comments) && comments.length, "comments is required and needs one entry");
  const anchored = comments.filter((c) => c && !c.highlightId);
  need(!anchored.length || (Array.isArray(valuesOrder) && valuesOrder.length),
    "valuesOrder is required when a comment anchors to a cell: the Values projections in binding "
    + "order, since a comment anchors to a column by its position in that list");

  for (const f of currentFilters) {
    need(f && f.fieldName && f.queryName && "value" in f,
      "every currentFilters entry needs fieldName, queryName and value");
  }
  const stamp = timestamp ?? "2026-01-01T00:00:00.000Z";
  const out = [];
  const filterContexts = () => currentFilters.map((f) => ({
    fieldName: f.fieldName, queryName: f.queryName, value: f.value,
  }));
  const opsOf = (text) => (typeof text === "string"
    ? [{ insert: text }]
    : text.map((r) => ({ insert: r.text, ...(r.bold || r.italic
        ? { attributes: { ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}) } }
        : {}) })));

  for (const c of comments) {
    need(c && c.text, "every comment needs text");
    if (c.highlightId) {
      // A comment attached to a highlight carries no anchor of its own: the shape owns the
      // position. commentType 0 is the form Desktop writes for these.
      need(!c.cell, "a comment attaches to EITHER a cell OR a highlightId, not both");
      need(typeof c.highlightId === "string" && /^[0-9a-f-]{36}$/i.test(c.highlightId),
        "highlightId must be the uuid of an entry encode_highlights returned (its ids map)");
      out.push({
        uuid: stableId(`highlight-comment|${c.highlightId}`),
        highlightId: c.highlightId,
        title: "",
        deltaContent: { ops: opsOf(c.text) },
        commentType: 0,
        filterContexts: filterContexts(),
        categoryFields: target === "charts" ? [...categoryFields] : [],
        createdAt: stamp,
        updatedAt: stamp,
      });
      continue;
    }
    need(c.cell, "every comment needs a cell (or a highlightId to attach to a highlight)");
    need(c.cell.category !== undefined && c.cell.category !== null,
      "cell.category is required: the row the comment anchors to");
    need(c.cell.column, "cell.column is required: which Values column the comment sits on");
    const idx = valuesOrder.indexOf(c.cell.column);
    need(idx !== -1,
      `cell.column '${c.cell.column}' is not in valuesOrder, so there is no column to anchor to`);

    const ops = opsOf(c.text);

    out.push({
      // The authored title is ignored by the product, which derives the heading from the
      // anchored cell. Writing the form Desktop writes avoids a diff that means nothing.
      title: `${c.cell.category} - null`,
      deltaContent: { ops },
      commentType: 1,
      filterContexts: filterContexts(),
      uuid: stableId(`${c.cell.category}|${c.cell.group ?? ""}|${c.cell.column}`),
      categoryFields: target === "charts" ? [...categoryFields] : [],
      dataProperty: 7 + idx,
      dataPointSelection: {
        identifier: {
          fullGroup: c.cell.group ?? null,
          fullCategory: c.cell.category,
        },
      },
      // Required. Omit them and the bubbles anchor but the panel silently drops the comment.
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  return emit("annotationLayerSettings.annotationComments", out, {
    companion: "commentBoxSettings.show must be true, or nothing appears.",
    expectedBubbleCount: out.length,
    warnings: ["Bubbles number in render order among the comments that actually render, so count "
      + `them: if the last bubble is below ${out.length}, a comment was dropped for a filter `
      + "context that does not match the live state."],
  });
}

// --- Tables: highlights (a rectangle or an ellipse over cells) ------------------------------------

/**
 * `annotationLayerSettings.annotationHighlights`.
 *
 * Two context keys, `sortByColumnContext` and `orderOfColumnsContext`, are required on EVERY
 * entry: omit either and the WHOLE VISUAL renders blank, with no error and no placeholder
 * (bisected over three arms, 2026-08-14). This encoder writes both from the column list, so the
 * fault cannot be authored.
 *
 * The column vocabulary here is NOT the one annotationComments uses. A comment anchors by
 * `7 + position in Values`; a highlight anchors by a stable per-column index carried in
 * `orderOfColumnsContext`, whose array ORDER is the left-to-right display order. Measured on
 * tables with one comparison scenario: `actual` 0, the comparison (`plan`, `previousYear` or
 * `forecast`) 1, `actual-<comparison>` 2, `actual-<comparison>-percent` 3. Any other column —
 * a second comparison, a forecast beside a plan — has no measured index, so it must be passed as
 * `{ name, index }` read back from a Desktop-saved visual, and the encoder refuses to guess.
 */
const HIGHLIGHT_COMPARISONS = ["plan", "previousYear", "forecast"];

function highlightColumnIndex(name, comparison) {
  if (name === "actual") return 0;
  if (name === comparison) return 1;
  if (name === `actual-${comparison}`) return 2;
  if (name === `actual-${comparison}-percent`) return 3;
  return null;
}

function encodeHighlights({ columns, sortByColumn, sortDirection, currentFilters, highlights } = {}) {
  need(Array.isArray(columns) && columns.length,
    "columns is required: the table's scenario columns in left-to-right display order, e.g. "
    + "['previousYear','actual','actual-previousYear','actual-previousYear-percent']");
  const names = columns.map((c) => (typeof c === "string" ? c : c && c.name));
  need(names.every((n) => typeof n === "string" && n), "every column is a name or {name, index}");
  const comparisons = names.filter((n) => HIGHLIGHT_COMPARISONS.includes(n));
  const comparison = comparisons.length === 1 ? comparisons[0] : null;
  const order = columns.map((c) => {
    if (typeof c !== "string") {
      need(Number.isInteger(c.index) && c.index >= 0, `column '${c.name}' needs an integer index`);
      return [c.name, c.index];
    }
    const idx = highlightColumnIndex(c, comparison);
    need(idx !== null,
      `column '${c}' has no measured index. The vocabulary is measured only for a table with ONE `
      + "comparison scenario (actual 0, comparison 1, actual-<cmp> 2, actual-<cmp>-percent 3); "
      + "for anything else pass {name, index} read from orderOfColumnsContext in a Desktop-saved "
      + "visual, because a wrong index highlights the wrong column in silence");
    return [c, idx];
  });
  const sortBy = sortByColumn ?? "actual";
  need(names.includes(sortBy), `sortByColumn '${sortBy}' is not one of the columns`);
  const dir = sortDirection ?? 1;
  need(dir === 0 || dir === 1, "sortDirection is 0 or 1");
  need(Array.isArray(currentFilters) && currentFilters.length,
    "currentFilters is required and must describe the LIVE filter state; an absent filterContexts "
    + "key is the same blank-visual fault the comment layer has");
  for (const f of currentFilters) {
    need(f && f.fieldName && f.queryName && "value" in f,
      "every currentFilters entry needs fieldName, queryName and value");
  }
  need(Array.isArray(highlights) && highlights.length, "highlights is required and needs one entry");

  const out = []; const ids = {};
  for (const h of highlights) {
    need(h && Array.isArray(h.rows) && h.rows.length,
      "every highlight needs rows: the category members it covers, e.g. ['Enterprise','SMB']");
    need(Array.isArray(h.columns) && h.columns.length,
      "every highlight needs columns: names from the columns list");
    for (const col of h.columns) need(names.includes(col), `highlight column '${col}' is not in columns`);
    const shape = h.shape ?? "rectangle";
    need(shape === "rectangle" || shape === "ellipse", "shape is 'rectangle' or 'ellipse'");
    const rows = h.rows.map((r) => (typeof r === "string" || typeof r === "number"
      ? { category: r, group: "" } : { category: r.category, group: r.group ?? "" }));
    const key = h.id ?? `${rows.map((r) => `${r.group}/${r.category}`).join(",")}|${h.columns.join(",")}|${shape}`;
    const uuid = stableId(`highlight|${key}`);
    ids[h.id ?? key] = uuid;
    out.push({
      uuid,
      highlightType: shape === "ellipse" ? 1 : 0,
      filterContexts: currentFilters.map((f) => ({
        fieldName: f.fieldName, queryName: f.queryName, value: f.value,
      })),
      sortByColumnContext: { categorySortDirection: dir, chartSortDirection: dir,
        columnNameToSortBy: sortBy, referenceChartToSortBy: null },
      orderOfColumnsContext: order,
      dataPointSelections: rows.map((r) => ({ identifier: { fullGroup: r.group, fullCategory: String(r.category) } })),
      dataProperties: h.columns.map((col) => order.find(([n]) => n === col)[1]),
    });
  }
  return emit("annotationLayerSettings.annotationHighlights", out, {
    ids,
    companion: "A highlight renders on its own. To put text on it, pass its uuid (from ids) as "
      + "highlightId to encode_annotations, and set commentBoxSettings.show to true.",
    warnings: ["Tables only: Charts and Cards declare no annotationHighlights.",
      "The highlight covers rows x columns. One entry boxes one column across several rows or one "
      + "cell; several cells that do not form a block are several entries."],
  });
}

// --- Charts: CAGR arrows ------------------------------------------------------------------------

/**
 * `annotationLayerSettings.annotationCagrArrows`. One arrow spans the whole series, first point
 * to last; there is no data anchor. `filterContexts` is required for the same reason as everywhere
 * in the annotation layer. The label is free text and renders verbatim, and the number is
 * compounded PER CATEGORY STEP, so on a monthly axis a label that says CAGR is a monthly rate.
 */
function encodeCagrArrows({ currentFilters, arrows } = {}) {
  need(Array.isArray(currentFilters) && currentFilters.length,
    "currentFilters is required and must describe the LIVE filter state");
  for (const f of currentFilters) {
    need(f && f.fieldName && f.queryName && "value" in f,
      "every currentFilters entry needs fieldName, queryName and value");
  }
  need(Array.isArray(arrows) && arrows.length, "arrows is required and needs one entry");
  const out = arrows.map((a, i) => {
    const label = a && a.label !== undefined ? String(a.label) : "CAGR";
    return {
      uuid: stableId(`cagr|${i}|${label}`),
      filterContexts: currentFilters.map((f) => ({
        fieldName: f.fieldName, queryName: f.queryName, value: f.value,
      })),
      settings: { arrowHeadType: a.headType ?? 0, arrowLineWidth: a.lineWidth ?? 2,
        connectingLineColor: a.color ?? "#C2C2C2", connectingLineStyle: a.lineStyle ?? 1,
        labelTitle: label },
    };
  });
  return emit("annotationLayerSettings.annotationCagrArrows", out, {
    warnings: ["The rate is compounded per CATEGORY STEP: on a monthly axis a label reading CAGR "
      + "shows a monthly rate. Put the arrow on a yearly axis or name the period in the label.",
      "Charts only, and not every chart form offers it; a form that does not draw it is not a "
      + "bug to chase."],
  });
}

// --- Cards: per-card inversion, which needs ids Desktop mints --------------------------------

/**
 * Card ids are UUID v5 under a Zebra-internal namespace: deterministic, but not reproducible
 * from the five standard namespaces, so they cannot be computed before a render. That forces two
 * steps, and the encoder's job in the first is to refuse to invent an id.
 */
function planCardInvert({ cardsToInvert } = {}) {
  need(Array.isArray(cardsToInvert) && cardsToInvert.length,
    "cardsToInvert is required: the card labels you want to read as costs");
  return {
    property: null,
    instruction: [
      "Card ids cannot be computed. Author the Cards visual with NO customData at all, open it in",
      "Power BI Desktop once and save, then read the minted ids back out of",
      "customData.uniformData.cards and call encode_card_invert with them.",
      `Cards to invert once you have the ids: ${cardsToInvert.join(", ")}.`,
    ].join(" "),
    cardsToInvert,
  };
}

function encodeCardInvert({ cardIds, instance } = {}) {
  need(Array.isArray(cardIds) && cardIds.length,
    "cardIds is required. Run plan_card_invert first: the ids are minted by Desktop and cannot "
    + "be computed ahead of a render");
  const cards = {};
  for (const c of cardIds) {
    need(c && c.id, "every cardIds entry needs an id read back from the saved report");
    need(typeof c.invert === "boolean", `card '${c.id}' needs invert: true or false`);
    cards[c.id] = { id: c.id, kpiInvert: c.invert };
  }
  // No globalCardSize, deliberately. An authored uniformData whose cards{} is empty is accepted
  // without error and silently ignored for sizing, so offering the parameter would offer a no-op.
  return emit("customData.uniformData",
    { instance: typeof instance === "number" ? instance : 0, cards, groups: {} },
    { companion: "Card size is not settable here. Use grid.cardsInRow and the container height: "
        + "a card auto-sizes to its content, about 264px with Values and PreviousYear." });
}

// --- The simple data-value lists -------------------------------------------------------------

const LIST_TARGETS = {
  chartResults: "categoriesMetadata.results",
  chartHighlighted: "categoriesMetadata.highlighted",
  groupsInverted: "groupsMetadata.inverted",
  tableGroupsCollapsed: "chartSettings.groupsCollapsed",
  tableCollapsedVirtually: "categoriesMetadata.collapsedVirtually",
};

function encodeDataValueList({ target, values } = {}) {
  need(target && LIST_TARGETS[target],
    `target must be one of: ${Object.keys(LIST_TARGETS).join(", ")}`);
  need(Array.isArray(values) && values.length,
    "values is required: the literal data values off the binding, exactly as they appear");
  const extra = {};
  if (target === "tableCollapsedVirtually") {
    extra.companion = "chartSettings.userChangedExpandCollapse must be true alongside this.";
  }
  if (target === "groupsInverted") {
    extra.companion = "This supersedes chartSettings.invert, which applies to the whole visual.";
  }
  // A data value can contain a real newline. JSON.stringify escapes it, which is correct: pass
  // the value as it appears in the data and do not pre-escape it.
  extra.warnings = ["Every data-value-keyed property breaks silently when the data changes, and "
    + "there is no validation for it. Re-check after a refresh that changes category names."];
  return emit(LIST_TARGETS[target], values, extra);
}

// --- Charts: per-category scenarios (solid actuals, hatched forecast, on ONE series) -----------

/**
 * `categoriesMetadata.scenarios` plus its three companions. A build-up whose banked part is solid
 * and whose projected steps are hatched does NOT come from binding the Forecast role -- that makes
 * the chart bridge total forecast down to actual, a red cascade, whatever `chartType` says. It
 * comes from naming individual CATEGORY VALUES as forecast: `[{"Forecast":3},{"Stage 2":3}]`, an
 * array of single-key objects mapping one data value to one scenario enum.
 *
 * Only `3` (Forecast) has been confirmed by render, so it is the only value accepted here; the
 * argument shape asks for the value and refuses anything else rather than letting a guess through
 * to a silent default. `floatingResults` marks the steps that read as components of the build-up
 * (no good/bad colour: they are not deviations), and `results` names every anchor and step. The
 * four keys were reproduced as one set; nothing establishes which alone is load-bearing.
 *
 * Every key here is a DATA VALUE, so the whole thing breaks silently when the data changes --
 * the same warning `groupsMetadata.inverted` carries.
 */
const SCENARIO_ENUM = { forecast: 3 };

function encodeCategoryScenarios({ scenarios, floating, results, highlighted } = {}) {
  need(scenarios && typeof scenarios === "object" && !Array.isArray(scenarios)
    && Object.keys(scenarios).length,
    "scenarios is required: an object mapping each category VALUE to a scenario, e.g. "
    + "{ 'Forecast': 'forecast', '2-Develop qualified': 'forecast' } (or the enum number 3)");
  const out = [];
  for (const [value, s] of Object.entries(scenarios)) {
    const code = typeof s === "string" ? SCENARIO_ENUM[s.toLowerCase()] : s;
    need(Object.values(SCENARIO_ENUM).includes(code),
      `scenarios['${value}'] is ${JSON.stringify(s)}; only 'forecast' (3) is confirmed by render. `
      + "Another enum value would be a guess the visual accepts and draws as something else");
    out.push({ [value]: code });
  }
  need(Array.isArray(results) && results.length,
    "results is required: every category value in the build-up, anchors and steps, in order -- "
    + "Zebra draws the series from this list");
  const named = new Set(Object.keys(scenarios));
  for (const v of named) {
    need(results.includes(v), `scenarios names '${v}' but results does not list it, so the hatch `
      + "would apply to a step that is not drawn");
  }
  need(floating === undefined || (Array.isArray(floating)
    && floating.every((v) => results.includes(v))),
    "floating must list values that are also in results: the steps that read as components of "
    + "the build-up rather than as variances");
  need(highlighted === undefined || Array.isArray(highlighted),
    "highlighted, when given, is a list of category values");

  const chain = (property, values, rest) =>
    ({ ...emit(property, values), ...(rest ? { also: rest } : {}) });
  const also = chain("categoriesMetadata.results", results,
    chain("categoriesMetadata.floatingResults", floating ?? [],
      chain("categoriesMetadata.highlighted", highlighted ?? [])));

  return emit("categoriesMetadata.scenarios", out, {
    also,
    companion: "stackedChartSettings.stackedWaterfallChartEnabled: true alongside this, and "
      + "chartSettings.showGrandTotal: false when the first result IS the total. Bind Values "
      + "only -- the Forecast role must stay EMPTY, or the chart bridges forecast down to actual.",
    warnings: ["Every key is a data value: the hatch disappears without an error when a category "
      + "is renamed. Re-check after any refresh that changes members.",
      "Only Forecast (3) is render-confirmed. The four keys were proven as one set; do not drop "
      + "one and expect the rest to hold."],
  });
}

// --- Plus visuals: where viewer comments live --------------------------------------------------

/**
 * `annotationLayerSettings.annotationsStorageConfig` — the link from a Tables+ or Charts+ visual
 * to the Excel workbook on SharePoint that holds its view-mode comments.
 *
 * The visual resolves it as `/sites/{siteId}{folderPath}/{fullFileName}:/workbook` on Microsoft
 * Graph, so all three parts are load-bearing and none is checked by Desktop: a wrong one shows
 * the comment panel's loading skeleton and then nothing, with no error. `siteId` is the site
 * COLLECTION id, the first of the three GUIDs packed into a Graph driveId, and the encoder
 * derives it from a driveId when given one so nobody has to decode base64 by hand.
 *
 * Render-verified 2026-09-05 with a control: the same visual pointed at a workbook with two
 * comments showed both; pointed at an empty workbook it showed "No comments match this view".
 */
function siteIdFromDriveId(driveId) {
  need(typeof driveId === "string" && driveId.startsWith("b!"),
    "driveId must be a Graph drive id, which starts with b!");
  const b64 = driveId.slice(2).replace(/-/g, "+").replace(/_/g, "/");
  const raw = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
  need(raw.length === 48, `driveId decodes to ${raw.length} bytes, not the 48 of three GUIDs`);
  // The three GUIDs are little-endian in their first three groups, as SharePoint packs them.
  const g = raw.subarray(0, 16);
  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [hex(g.subarray(0, 4).reverse()), hex(g.subarray(4, 6).reverse()),
    hex(g.subarray(6, 8).reverse()), hex(g.subarray(8, 10)), hex(g.subarray(10, 16))].join("-");
}

function encodeStorageConfig({ siteId, driveId, folderPath, fileName } = {}) {
  need(siteId || driveId, "siteId or driveId is required: the site collection the workbook is in");
  const site = siteId ?? siteIdFromDriveId(driveId);
  need(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(site),
    `siteId must be the site collection GUID, not '${site}'. From a hostname,guid,guid triple `
    + "take the FIRST guid; from a driveId pass driveId instead and it is derived");
  need(typeof folderPath === "string" && folderPath.startsWith("/drive/root:"),
    "folderPath must start with /drive/root: — the library root is '/drive/root:' and a folder "
    + "is '/drive/root:/Folder/Sub', which is how the visual's own file picker writes it");
  need(!folderPath.endsWith("/"), "folderPath must not end with a slash; the file name is joined "
    + "with one");
  need(typeof fileName === "string" && /\.xlsx$/i.test(fileName),
    "fileName must end in .xlsx: the visual accepts no other workbook format");
  need(!fileName.includes("/"), "fileName is the bare file name; the folder goes in folderPath");
  const cfg = { storageBackend: "sharePointExcel",
    storageOptions: { siteId: site, folderPath, fullFileName: fileName } };
  return emit("annotationLayerSettings.annotationsStorageConfig", cfg, {
    companion: "commentBoxSettings.show must be true, or nothing appears. The visual must be "
      + "Tables+ or Charts+: the certified twins declare the property and ignore it. The "
      + "workbook must exist at that path before the report is opened, with an 'Annotation' "
      + "sheet holding one table headed UUID, Type, Tenant ID, User ID, User Name, Content, "
      + "CreatedAt, UpdatedAt, Status.",
    warnings: ["Nothing checks the path until the visual loads. A wrong site, folder or file "
      + "name shows the loading skeleton, then an empty panel, with no error anywhere.",
      "Viewers see the comments only if they can open the workbook on SharePoint; report access "
      + "alone shows them nothing."],
  });
}

module.exports = {
  encodeTableColumns, encodeTableCalculations, encodeAddedFormulas, encodeAnnotations,
  planCardInvert, encodeCardInvert, encodeDataValueList, encodeStorageConfig, siteIdFromDriveId,
  encodeHighlights, encodeCagrArrows, encodeCategoryScenarios,
  EncodeError, stableId, literalOf, COMPARISONS, SCENARIO_KEYS, LIST_TARGETS, SCENARIO_ENUM,
};
