<!-- Summary: Page archetypes proven against Zebra BI's own templates — copy the shape, swap the model vocabulary. -->
# Recipes

Each of these was authored from scratch and matched a page in a Zebra BI template, number for number.

Swap the model vocabulary; keep the shape.

**On the notation.** These are written as a spec object, not as a library you install. Two
prefixes, and that is the whole convention:

- **`V.*`** builds a thing: `V.zebraTables`, `V.zebraCharts`, `V.zebraCards`, `V.slicer` for a
  visual, and `V.columnSettings` / `V.addedFormulas` for one of the JSON-string properties.
- **`P.*`** builds a value: `P.projMeasure` / `P.projCol` / `P.projAgg` for a projection into a
  well, and `P.num` / `P.word` / `P.int` / `P.bool` for an encoded literal.

Read a recipe for the bindings, the roles and the geometry, then write the JSON yourself.
`references/formatting.md` gives the literal encoding each value needs, and the encoder tools
write the JSON-string properties for you if they are available.

---

## 0. The density block — apply it to every recipe below

A recipe fixes the *shape*: which roles, which comparison, which geometry. It cannot fix the
**density**, because that depends on how many rows and categories your model actually has and how
big you made the box. Every recipe here therefore ships with its bindings and its geometry, and
leaves this block for you to compute.

**Do it as the last step before you write the JSON**, from three numbers you already have: the row
or category count, the visual's height, and the visual's width. The reasoning behind each branch is
`references/design.md` §15; this is the mechanical form.

```js
// TABLES — rows R, visual height H, `titled` = whether the visual carries a title
const body = H - 30 - (titled ? 24 : 0);          // column header, then the title band
const categorySettings = {};
if      (R * 28 <= body) categorySettings.rowHeight = P.num(3);   // Font sized x1.5 — spend the room
else if (R * 20 <= body) { /* leave rowHeight unset; the default is already compact */ }
else if (R * 16 <= body) { categorySettings.rowHeight = P.num(5); categorySettings.height = P.num(16); }
else    throw new Error('R rows will not fit legibly: Top N with a named Others, or a taller box');
// exactly-fill instead of top-align, when rows are few:
// categorySettings.rowHeight = P.num(4);          // Stretch

// row rules: a rule every N rows, N defaults to 5, and N > R draws NOTHING
const chartSettings = {};
if (R <= 7)       chartSettings.gridlineDensity = P.int(R + 1);  // i.e. none — one rule on six rows is noise
else if (R > 25)  chartSettings.gridlineDensity = P.int(5);      // explicit; the default, held on purpose
// a ledger-style P&L read across many columns wants a rule per row:
// chartSettings.gridlineDensity = P.int(1);

// CHARTS — categories N, plot width W
const cat = {};
if (N > 8) {                                       // below that the default fits
  const step = [5, 4, 3, 2].find(s => (N - 1) % s === 0 && (N - 1) / s + 1 <= 6);
  if (step) { cat.axisLabelDensity = P.num(2); cat.axisLabelDensityEveryNthLabel = P.int(step); }
  else      { cat.axisLabelDensity = P.num(1); }   // First and last — always fits, never collides
}
// data labels: an Auto tier whenever the points crowd the width. ~34 px per label is an ESTIMATE,
// not a measurement — when it is close, step one tier down rather than up.
const dataLabelSettings = {};
const perLabel = W / N;
if      (perLabel >= 34) { /* leave it; the default 6D Highest is right */ }
else if (perLabel >= 26) dataLabelSettings.labelDensity = P.num(9);   // High
else if (perLabel >= 20) dataLabelSettings.labelDensity = P.num(8);   // Medium
else                     dataLabelSettings.labelDensity = P.num(7);   // Low
// a chart making ONE point ignores the arithmetic and takes:
// dataLabelSettings.labelDensity = P.num(5);      // First, last, min, max
```

**The `step` line is the part worth reading twice.** The last category is always labelled whatever
the step is, so a step that does not divide `N − 1` puts a label on the second-to-last category and
another right beside it. Sixteen months at `N: 2` collide; at `N: 4` they do not. When no step in
the list divides cleanly, `1D` First and last is the answer — it fits at any width.

**And one look decision, once per report, not per visual:** `designSettings.style` — `0D` Zebra,
`1D` Zebra Light (pale bars, much airier at high density), `2D` Dr. Hichert, `3D` Power BI. Set the
same one everywhere. `4D` Custom is the colour gate and needs `neutralColor` set with it or the
bars go black.

---

## 1. The income statement (Tables)

*Full P&L across MTD / YTD / Full year, with variance columns and ratio rows.*

```js
V.zebraTables({
  name: 'PnLTable', x: 0, y: 72, w: 1272, h: 649, z: 6000,
  category: [P.projCol('Accounts', 'Account group'), P.projCol('Accounts', 'Account')], // hierarchy
  values:   [P.projMeasure('Financials', 'Value AC')],
  plan:     [P.projMeasure('Financials', 'Value PL')],
  forecast: [P.projMeasure('Financials', 'Value FC')],
  group:    [P.projCol('Period Calculation', 'Period Calculation')],  // MTD | YTD | Full year
  categoryClass: [P.projAgg('Accounts', 'Category Class', P.AGG_FN.Max)], // IBCS row semantics
  title: 'Company ABC, in USD',
  objects: {
    chartSettings: [{ properties: {
      valueChart: P.num(5), relativeChart: P.num(1), absoluteChart: P.num(2),
      calculations: P.word('["actual-plan","forecast-plan"]'),
      columnSettings: V.columnSettings({
        forecast:      { order: 0, hiddenFromGroups: ['MTD', 'YTD'] },   // FC only on Full year
        actual:        { order: 1, hiddenFromGroups: ['Full year'] },    // AC only on MTD/YTD
        plan:          { order: 4, hidden: true },
        'actual-plan':   { order: 5, format: 1, hiddenFromGroups: ['Full year'] },
        'forecast-plan': { order: 6, format: 1, hiddenFromGroups: ['MTD', 'YTD'] },
        'actual-plan-percent':   { order: 9, format: 2, hidden: true },
        'forecast-plan-percent': { order: 9, format: 2 },
      }, { view: 'chart' }),
    } }],
    categoriesMetadata: [{ properties: { addedFormulas: V.addedFormulas([
      { identity: 'Gross margin %', expression: '[Gross profit] / [Revenue]', position: 'Gross profit' },
    ], { hierarchyIdentity: 'Accounts.Account group' }) } }],
    dataLabelSettings: [{ properties: { decimalPlaces: P.int(1), decimalPlacesPercentage: P.int(1) } }],
  },
});
```

**Why it works:** `CategoryClass` gives `+/−/=` and subtotals free. `Group` gives the three period
columns. `hiddenFromGroups` gives AC-here/FC-there. `addedFormulas` gives ratio rows with no model
change. Exclude non-P&L rows with a page filter (`Cash BOP`/`Cash EOP` double-count otherwise).

**A computed row is summed into the grand total unless you also exclude it.** The total renders in
bold, looks right, and is inflated by the ratio row. Every `addedFormulas` entry that aggregates
other rows needs a matching entry in `categoriesMetadata.skipCalculationCategories` —
`[{"hierarchyIdentity":"Accounts.Account group","category":"Gross margin %","level":0}]` — and
`encode_added_formulas` emits both blobs from one call so the pair cannot come apart. Render-proven
on a from-scratch income statement with three margin rows.

**`addedFormulas` chains.** An expression may reference another formula by name, so a KPI model
builds up in the report layer while the model holds only raw accounts —
`DSO = [Account receivable] / [Revenue] * 365` where `Revenue` is itself a formula, then
`CCC = [DSO] + [DIO] - [DPO]`. Zebra BI's own working-capital KPIs are built this way.

## 2. Trend bridges as small multiples (Charts)

*One PY→AC waterfall per account group, in a grid.*

```js
V.zebraCharts({
  name: 'TrendsChart', x: 1, y: 72, w: 1257, h: 649, z: 6000,
  category:     [P.projCol('Calendar', 'Month')],        // time axis -> PY is meaningful
  values:       [P.projMeasure('Financials', 'Value AC')],
  previousYear: [P.projMeasure('Financials', 'Value PY')],
  group:        [P.projCol('Accounts', 'Account group')], // -> nine charts
  comments:     [P.projMeasure('Comments hierarchical', 'Comments measure all levels')],
  objects: {
    chartType:      [{ properties: { chartType: P.num(0) } }],
    multipleLayout: [{ properties: { layoutType: P.word('Rows'),
                                     // showMultiplesGrid draws a BORDER BOX around each panel and
                                     // gridlineStyle is that border's line style (0 solid, 1 dotted,
                                     // 2 dashed). Neither is a value gridline. Default is OFF, and
                                     // switching it on costs panel width — the axis labels truncate
                                     // one character further, so weigh it against `axisLabelDensity`.
                                     showMultiplesGrid: P.bool(true), gridlineStyle: P.num(1),
                                     multiplesAxisLabelsOptions: P.num(3),
                                     sort: P.num(0) } }],
    chartSettings:  [{ properties: { minChartHeight: P.num(-103.375) } }],  // or the 9th clips
    groupsMetadata: [{ properties: { inverted: P.word('["COGS","Operating expenses"]') } }],
    axisBreakSettings:  [{ properties: { show: P.bool(true) } }],   // justified here only: small ΔPY on a large base, per panel; the default is OFF — design.md, scale integrity
    commentBoxSettings: [{ properties: { show: P.bool(true), size: P.word('0.748') } }],  // size = the CHART's share, not the panel's; lower it to widen the comments
  },
});
```

**Why it works:** `Category = Month` + `PreviousYear` = a bridge per group. `Group` + `multipleLayout`
= the grid. `groupsMetadata.inverted` = IBCS cost semantics. `Comments` role + `commentBoxSettings`
= the narrative panel, driven by data.

## 3. The cash-flow bridge (Charts, vertical)

*Opening balance → movements → closing balance, with a net-change callout.*

```js
V.zebraCharts({
  name: 'CashFlowChart', x: 7, y: 75, w: 1265, h: 635, z: 4000,
  category: [P.projCol('CashFlow', 'CashFlowAccount')],
  values:   [P.projMeasure('CashFlow', 'CashFlow Data')],
  // CashFlow is a data island — the page slicers cannot reach it by relationship.
  filters: [ P.projMeasure('Support measures', 'Selected Period_'),
             P.projMeasure('Support measures', 'Selected Months_'),
             P.projMeasure('Support measures', 'Selected Years_') ],
  objects: {
    chartType:          [{ properties: { chartType: P.num(0) } }],
    chartSettings:      [{ properties: { showVerticalCharts: P.bool(true) } }],
    categoriesMetadata: [{ properties: { results: P.word('["Cash BOP","Cash EOP"]') } }],
    differenceHighlightSettings: [{ properties: { show: P.bool(true), differenceLabelType: P.num(2),
                                                  showDifferenceHighlightSubtotals: P.bool(true) } }],
  },
});
```

**Why it works:** `results` promotes the two balances to anchor bars. `differenceHighlight` draws the
net change. `showVerticalCharts` rotates it. `Filters` carries the slicer state to the island.

## 4. The slicer row

```js
V.slicer({ name: 'Year',  x: 566, y: 8, w: 92,  h: 49, entity: 'Calendar', prop: 'Year',
           select: [2025], lit: P.I })                        // integer -> I
V.slicer({ name: 'Month', x: 658, y: 8, w: 87,  h: 49, entity: 'Calendar', prop: 'Month',
           select: ['Mar'], lit: P.T })                       // text -> T
V.slicer({ name: 'Report',x: 745, y: 8, w: 155, h: 49, entity: 'Accounts', prop: 'ReportType',
           select: ['Income Statement'], singleSelect: true }) // one statement at a time
V.slicer({ name: 'Period',x: 743, y: 13, w: 145, h: 33, entity: 'Period Calculation',
           prop: 'Period Calculation', select: ['MTD'], mode: 'Basic', orientation: 1 }) // MTD|YTD buttons
V.slicer({ name: 'Months',x: 662, y: 7, w: 92, h: 50, entity: 'Calendar', prop: 'Month',
           exclude: ['Oct','Nov','Dec'], orientation: 1 })    // "select all but" -> shows "Multi..."
```

Titles are **off by default** and should stay off — a wrapped title eats the dropdown. `mode: 'Basic'`
+ `orientation: 1` is a button group; `Dropdown` is a dropdown; `exclude` is inverted selection.

**Those heights — 49, 50, 33 — are header-OFF heights, and that is why they are short.** Across
the 408 shipped slicers the split is clean: header explicitly off → median **43.7**; header showing
or left at default → median **58–64**. So if you turn the header on to label the field, these boxes
must grow to ~64 or the dropdown clips. `mode: 'Basic'` runs shorter again (median 38.8) because a
button group has no dropdown to clip. **Take the height from the header decision, not from a
constant** — see the slicer table in `SKILL.md`.

## 5. A KPI row (Cards)

*Proven: an agent with only this skill matched all 5 KPI values and all 10 deltas of a Zebra BI template
baseline.*

```js
V.zebraCards({
  name: 'Kpis', x: 0, y: 72, w: 1280, h: 264,   // HEIGHT IS THE SIZING LEVER - see below
  category: [P.projCol('Accounts', 'Account')],
  group:    [P.projCol('Regions', 'Region')],   // WITHOUT Group -> exactly ONE card, full width
  // `display` sets displayName — on a Card the field name IS the card title. Without it a
  // measure called AC_ renders "AC_" with deltas "ΔPY_"/"ΔPL_".
  values:      [P.projMeasure('Financials', 'Value AC', 'Revenue')],
  plan:        [P.projMeasure('Financials', 'Value PL', 'PL')],
  previousYear:[P.projMeasure('Financials', 'Value PY', 'PY')],
  objects: {
    grid:       [{ properties: { cardsInRow: P.num(5) } }],
    card:       [{ properties: { cardDefaultInvert: P.bool(true) } }],  // ALL cards - see below
    dataLabels: [{ properties: { numberFormat: P.word('P') } }],        // Cards: NOT dataLabelSettings
    // NO cardSize: an authored    // customData.uniformData with an empty cards{} is accepted and SILENTLY IGNORED.
  },
});
```

**Sizing.** `cardsInRow` sets cards-per-row and is the only reliable lever;
everything else comes from the **container**, because the card auto-sizes to its content. With
`Values` + `PreviousYear` bound a card needs **≈264px of height** — a shorter container gives the
vertical scrollbar people keep trying to fix with `globalCardSize`, which does nothing. Width from
those templates: **5 across wants w≈1272** (1232 wraps the fifth). And **give the visual no
`titleSettings`** — a title steals the room the cards need; Zebra BI's own 5-across has none.

> **≈264px is for THIS role set — `Group` + `Values` + `PreviousYear`, with no `Category`.** Add a
> `Category` and every card gains a per-point chart. There is **no verified height** for that shape,
> and it is **not simply taller**: Zebra BI's own templates ship Category-bound Cards at **118px**
> without a scrollbar. So do not read 264 as a floor that rises — if a Cards row scrolls, the
> question is whether it should have been Cards at all. When what you want inside each tile is a
> *series* rather than one number and its variance, the answer is **Charts small multiples** —
> recipe 2 above.

**Inverting one card, not all of them.** `cardDefaultInvert` flips *every* card. For a single cost
KPI in an otherwise higher-is-better row, write `kpiInvert` into the `customData.uniformData` blob
against the card id Desktop mints — one Desktop save, then a ~1s reload. Splitting into two Cards visuals is still the right
move when the KPI set is slicer-driven.

For a **uniform grid** use `cardsInRow` — *not* `grid.layoutPreset: 'uniform-layout'`,
which clips (and ignores the blob's size). But for the **dense row form**
(label left, value right, several cards stacked in a short visual) `layoutPreset: 'rows-layout'`
**does** work and is the only way to get it:

```js
objects: {
  grid: [{ properties: { layoutPreset: P.word('rows-layout') } }],
  card: [{ properties: { suppressChart: P.bool(true) } }],
  // no cardSize — rows-layout sizes itself
}
```

### There is a THIRD `layoutPreset`, and it is the one a human reaches for

`grid.layoutPreset` has a value the rest of this file does not mention: **`'custom-layout'`**. It is
what Desktop writes when someone sizes the cards **by hand**, and it produces the shape that reads
best for a KPI row — **label and big number on the left, the variance chart on the right**, one card
per member, rather than the tall stacked form you get by default.

Harvested by asking the owner to resize an agent-authored Cards row and diffing the save. What he
changed, on a 3-member row:

| | agent's guess | after the resize |
|---|---|---|
| height | 300 | **218** |
| `grid.layoutPreset` | *(unset)* | **`'custom-layout'`** |
| `grid.gutterSize` | — | `8D` |
| `grid.compactCards` · `grid.suppressNullCards` | — | `true` · `true` |
| `card.cardPadding` · `card.cardDefaultChartType` | — | `1D` · `0D` |
| `card.cardDefaultAxisBreak` · `card.wrapTitle` | — | `true` · `true` |
| `design.varianceDisplayType` | — | `1D` |

**The height is the immediately usable part: 218, not 264.** Reaching for ~264 on a
`Group`+`Values`+`Plan` row produced a box 38% too tall *and* a scrollbar, at both 264 and 300.

⚠️ **Untested: whether `custom-layout` works without its blobs.** The save also wrote
`customData.gridData`, `rowsData` and `uniformData`, ~2 KB each — the same family as the
`uniformData` that is *accepted and silently ignored* when authored with an empty `cards{}`. So do
not assume the preset alone is enough; render it before treating it as a recipe. If it turns out to
need the blobs, this is a **one-Desktop-save property**, like per-card invert.

**And this is the pattern, not just the property.** A Cards row that renders correct numbers in an
obviously wrong box is the cheapest possible thing to ask a human to fix: it took two minutes and
returned a property name nobody would have guessed. Probing would not have found `custom-layout`.

`cardsInRow` is a hard **cap**, not a wrap: six cards at `cardsInRow: 5` lose the sixth.

> **But do NOT respond to that by leaving it unset — that is what causes the scrollbar.** Render-proven:
> a Cards row with **6** `Group` members, `Values`+`Plan`, 1248×264 and **no `cardsInRow`**
> laid out **4 per row → 2 rows → ~528px of content in a 264px box → vertical scrollbar**, with two
> members unreachable. Setting `cardsInRow: 6D` put all six in one row and the scrollbar vanished.
> **Count the members and set it.** If you genuinely cannot know the count before the render, give the
> container height for two rows and narrow it afterwards — do not leave the lever unset.

## 6. The disconnected parameter table (Cards, and anywhere)

*How one generic measure serves cards that show completely unrelated metrics.*

A `KPIs` table with **no relationships to anything** holds one row per metric. A generic measure
`SWITCH`es on it:

```dax
[Selected value] = SWITCH ( MIN ( KPIs[ID] ), 1, [Costs], 2, [PnL], 3, [Gross Margin %], … )
```

Each visual then picks its branch with a **visual-level `filterConfig`** on `KPIs[KPI]` — a
categorical filter, no role binding at all:

```js
V.zebraCards({
  name: 'RevenueCard',
  values: [P.projMeasure('_Measures', 'AC_', 'Revenue')],
  visualFilters: [P.catFilter('kpi', 'KPIs', 'KPI', ['Revenue'], P.T)],   // selects the branch
  …
});
```

**This is not the `Filters` role.** Same instinct — reach a table the relationships cannot — but a
different technique: the `Filters` role takes measure projections and lives in `queryState`; this is
a plain categorical `filterConfig` on a disconnected dimension. Recognise it when you see a tiny
unrelated table and a measure full of `SWITCH`.

⚠️ **The filter is not always required.** `MIN(KPIs[ID])` over a *completely unfiltered*
disconnected table just returns the smallest ID — so the SWITCH resolves to branch 1 for free. If
branch 1 is the branch you want, the page works with no `filterConfig` at all, and you will not
notice the mechanism exists. It only bites when you want a *different* branch. Read the SWITCH
before assuming a page is broken *or* that it is right.

## 6b. Commentary anchored to a data point (Tables)

*The narrative layer. Two properties and a blob; no model change, no human step.*

⚠️ **Check you want this recipe first.** If the comment belongs to a **category member** — *"say this
when this member, or this condition, holds"* — the `Comments` **data role** is the easier mechanism
and the one `SKILL.md` 3c makes the default: a per-row measure
(`IF(SELECTEDVALUE(<dim>) = "<member>", "<text>", BLANK())`) plus `commentBoxSettings.show: true`,
with **no filter-context matching anywhere in it**. Recipe 6b is for the other case — rich text that
is *this report's* narrative and is not tied to a row the model can key on. Everything under it is a
matching problem, and every way of getting the match wrong is silent.

☠️ **And this recipe is Tables-shaped. Do not copy it onto a Charts visual as-is.** Its blob omits
`categoryFields`, which is **correct for Tables and wrong for Charts** — on Charts it must name
the display name of the category field, one entry per level, or **every comment is silently
dropped** and the panel reads *"No comments match this view."* There is no Charts variant of this
recipe; see the `categoryFields` table in `SKILL.md` 3c before authoring one.

```js
V.zebraTables({
  name: 'SegmentTable',
  category: [P.projCol('financials', 'Segment')],
  group:    [P.projCol('Calendar', 'Year')],
  values:   [P.projMeasure('_Measures', 'Sales AC'), P.projMeasure('_Measures', 'Profit AC')],
  // the token measure ALSO gives the annotation a filter context to anchor to
  filters:  [P.projMeasure('_Measures', 'Period label')],
  objects: {
    commentBoxSettings:     [{ properties: { show: P.bool(true) } }],   // or nothing appears
    annotationLayerSettings:[{ properties: { annotationComments: V.annotations([
      { cell: { category: 'Enterprise', group: 2013, column: 'Sales AC' },
        text: 'Sells below cost and is the fastest-growing segment - margin dilution is structural.' },
    ], { currentFilters: [                                   // MUST match the live filter state
        { fieldName: 'Period label', queryName: 'financials.Period label',
          value: 'Sep 2013 - Dec 2014' } ] }) } }],
  },
});
```

**Why it works, and the three things that break it:**

| | |
|---|---|
| `commentBoxSettings.show` | omit it and the comment is in the file with nothing on screen. On a **narrow** visual set it `false` on purpose: the marker and the hover text survive and the chart keeps its width (`visuals.md`) |
| `filterContexts` **key absent** | ☠️ **the whole visual renders blank** — no error. `encode_annotations` makes this unreachable by requiring the field |
| `filterContexts` value ≠ live state | that comment is **silently dropped**; the remaining bubbles renumber, so a last bubble of ⑥ out of seven is the tell |

The anchor is **plain data values** off the binding — `fullCategory: 'Enterprise'`,
`fullGroup: 2013` — plus `dataProperty` = **7 + the index of the column in `Values`**. Zebra derives
the bubble's heading and arrow from the cell itself, so an authored `title` is ignored. Rich text
works: bold and italic runs render.

**Do not comment on every page.** See the trigger list in `SKILL.md` — a comment that restates the
number is noise, and a *caveat* about comparability belongs in the encoding, not in a bubble.

## Page-level

```js
{ id: 'MtdYtdFy', displayName: 'MTD/YTD/FY view',
  filters: [ P.catFilter('fAcct', 'Accounts', 'Account', ['Cash BOP','Cash EOP'], P.T, { negate: true }) ],
  visuals: [ … ],
  interactions: [ { source: 'YearSlicer', target: 'Waterfall', type: 'NoFilter' } ] }
```

`interactions` are written **after** their targets exist — write the page's visuals first and its interactions last; writing them early crashes Desktop. A slicer→waterfall link usually needs `NoFilter`, or the selection
collapses the year axis to a single bar.

---

## 7. The executive summary page, from a flat spreadsheet

*Built end to end from `Financial Sample.xlsx` with no human Desktop step; every figure DAX-verified.
Use when someone hands you one flat table and asks for "an executive report".*

**Canvas 1280×720. Align everything to x=4, w=1272** — Cards need that width for 5 across.
(The title moved from `y=16 h=40` to `y=8 h=56` when the textbox-height rule was established — 40px
clipped a 22pt title, and the taller box has to start higher to clear the Cards row at y=68.)

| Visual | Box | Binding |
|---|---|---|
| Title (`textbox`) | 24,**8** 900×**56** | static report name only — **never a period, see below**. 56, not 40: a 22pt title in a 40px box gets Power BI's own scrollbar and clips (`h >= pt × 1.333 × 1.3 + 16`) |
| Cards KPI row | 4,68 **1272×264** | `Group`=dimension · `Values`=AC · `PreviousYear`=PY · `grid.cardsInRow:"5D"` · **no title** · **no `cardSize`** · **no `Category`** (that makes it a chart-per-card and 264 no longer holds) |
| Variance bridge (Charts) | 4,340 1272×160 | `Category`=`Calendar[Month]` · `Values`=AC(year-pinned) · `PreviousYear`=PY · `differenceHighlightSettings.show:false` |
| Variance table (Tables) | 4,508 624×186 | `Category`=dimension · `Values`=AC · `PreviousYear`=PY · `columnSettings` for column order |
| Structure table (Tables) | 652,508 624×186 | `Category`=dimension · `Values`=AC,Profit · `Group`=Year |

### The three things that make it executive rather than merely correct

**1. Bind `PreviousYear` everywhere.** *No plan does not mean no variance.* Two periods is enough,
and a Zebra visual without variance is a Power BI habit. This is the single highest-value binding on
the page.

**2. Probe coverage before you frame anything.** On this data 2013 held **four months** and 2014 held
twelve, so a year-on-year total read as *"sales grew 3.5×"*. Nothing in the render would have shown
it — every visual would have agreed with every other and all been wrong the same way. Derive the
comparable window instead:

```dax
Sales AC LFL =
    VAR CurYear = YEAR([Last data date])
    VAR StartMonth = MONTH([First data date])
    RETURN CALCULATE([Sales AC], ALL('Calendar'), 'Calendar'[Year] = CurYear,
                     'Calendar'[MonthNo] >= StartMonth)
```

**3. Never type a period into a textbox.** It goes stale silently. Use a measure token resolved at
render time, with the measure projected into the **`Filters`** role:

```dax
Period label = FORMAT([First data date],"mmm yyyy") & " - " & FORMAT([Last data date],"mmm yyyy")
```
→ `titleSettings.text = 'Net sales by month, in USD · [Period label]'`

### Chart choice on this page

| Purpose | Choose |
|---|---|
| AC vs PY across months | **PY→AC bridge**: `Category`=`Month`, `Values`+`PreviousYear`. Signed variance per month, negatives red |
| Trend, one measure, no comparative | column · line · area |
| Contribution / subtotals | waterfall — *only* here |
| Ranked non-time categories | a Table with bars, not a chart |

**Do not** put `Category = Calendar[YearMonth]` across a multi-year span with `PreviousYear` bound —
Zebra auto-picks a waterfall bridging *total* PY to *total* AC, which is meaningless when the two
windows differ in length.
