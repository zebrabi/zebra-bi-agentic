<!-- Summary: Literal encoding, the colour gate, companion gates, and the formatting objects that actually do something. -->
# Formatting

## Literal encoding — the tag is load-bearing

```js
const L    = (v) => ({ expr: { Literal: { Value: v } } });
const num  = (n) => L(`${n}D`);      // number / NUMERIC-VALUED enum
const int  = (n) => L(`${n}L`);      // integer
const word = (s) => L(`'${s}'`);     // text / WORD-VALUED enum
const bool = (b) => L(String(!!b));  // bare true/false
```

`type: "enum"` does **not** tell you the form — the **value domain** does. Measured across the
Zebra BI's own templates: 1,401 of 1,401 numeric-valued enum settings D-suffixed; 373/373 word-valued quoted; no
exceptions either direction.

- enumValues are **numeric strings** → `num()` → `4D`
  **`chartType`** · `style` · `varianceType` · `axisLabelDensity` · `valueChart` · `relativeChart` ·
  `absoluteChart` · `referenceDisplayType` · `cardDefaultChartType` · `varianceDisplayType` ·
  `differenceLabelType` · `varianceLabelType` · `categorySort` · `chartSort` · `sort` ·
  `sortReferenceChart` · `showTopNChartsOptions` · `multiplesAxisLabelsOptions` · `gridlineStyle` ·
  `displayOptions` · `negativeValuesFormat` · `orientation` · `outlineStyle` · `varianceIcon` ·
  `categoryLabelsOptions` · `differenceHighlightArrowStyle` · `labelDisplayUnits` ·
  **`rowHeight`** · **`labelDensity`** · **`dotChartMarkerDensity`**

- enumValues are **words** → `word()` → `'Rows'`
  `layoutPreset` · `cardSort` · `sortScenario` · `rowsTitleWidthType` ·
  `conditionalVarianceSettings.unit` · `chartSettings.types` · `chartLayout` · `multipleLayout.layoutType`

A setting whose values are numbers must be written as a number (`3D`), not as text (`'3'`). Text is
not a declared value for it, so the visual keeps its default with no error — for a chart type, that
means the default chart instead of the one you chose. `validate_report` catches this.

Writing a numeric enum as a word (`'Custom'` instead of `4D`) is **not a declared value** and is
silently ignored.

**`fill` is not a bare literal:**
```jsonc
{ "solid": { "color": { "expr": { "Literal": { "Value": "'#232D6E'" } } } } }   // '#000' shorthand works
{ "solid": { "color": { "expr": { "ThemeDataColor": { "ColorId": 7, "Percent": -0.25 } } } } }
```
But inside a **blob**, colour is a plain hex string (`"fontColor": "#0078D4"`). Two conventions,
same concept — do not cross them.

Numbers can be **negative and load-bearing**: `chartSettings.minChartHeight: -103.375` is what
squeezes nine small multiples into 649px. Omit it and the ninth is clipped off the canvas.
Some numbers are **quoted strings** despite reading as numbers: `commentBoxSettings.size: '0.748'`.
☠️ **`size` is the share of the visual left to the CHART, not the width of the comment panel.** It
reads like a panel width and behaves as its complement, so a plausible-looking `0.30` starves the
chart to a third of its box and inflates the comments — which is why every shipped template sits
near `0.748`. Raise it to widen the chart, lower it to widen the comments.

## The colour gate

**Set `style` to Custom (`4`) on any visual whose colour properties you write.** Authored colours
apply only under the Custom style; under any other value the visual renders in that style's own
palette, with none of the authored colours, and no error says so. `validate_report` catches this.

**`0` does not pass them either**, which is the value most likely to look safe: it is the Zebra
default, and a default sounds like "no preset in the way". Measured by a two-arm render over three
Charts differing only in `style`, sampled by pixel: at `0` the canvas is Zebra's default green
`#7ACA00` and **not one authored colour appears**; at `4` the authored colours render exactly.
**Only `4` yields to your colours.**

| value | means |
|---|---|
| `-1` | Company style |
| `0` | Zebra *(default ≡ setting nothing)* |
| `1` | Zebra Light |
| `2` | Dr. Hichert |
| `3` | Power BI |
| **`4`** | **Custom — the gate** |
| `5` | Colorblind-friendly |

**Write the value D-suffixed — `4D`, not `'4'` and not `"4"`.** `style` is a numeric-valued
enum, so the quoted forms are not declared values and are silently ignored, which leaves the
gate shut and your colours off. Two lines in this file used to show the quoted form, and a report
built from either would have had exactly the fault this gate exists to prevent.

Object name differs by product: Cards **`design`**, Charts/Tables **`designSettings`**.

Gated: `positiveColor` · `negativeColor` · `neutralVarianceColor` · `neutralColor` · `markerColor` ·
`lineColor` · `axisColor` · `gridlineColor` · `dotChartColor` · `highlightColor` ·
`previousYearColor` · `planColor` · `forecastColor`.

**`useCustomScenarioColors` is a red herring** — named exactly like the switch you want, irrelevant.

Verified live: the gate is real on **Charts**. On **Cards** the values −1/0/4 form one equivalence
class (`sameAsDefault: true`) and the colours are **UNTESTED**.

## Companion gates — half of "works" needs something else held true

**21 of 45 honoured properties are conditional.** Setting the property alone gets nothing.

| object | needs |
|---|---|
| `multipleLayout.*` | a **`Group`** role bound — no Group, no small multiples |
| `stackedChartSettings.*` | `Group` bound **and** `show: true` — but **not** `stackedWaterfallChartEnabled`, which rendered with neither (per-category scenarios, further down) |
| `*LineSettings.*` (average/median/constant/percentile) | that object's own `show: true` (+ `showLabel` for label props) |
| every `titleSettings.*` | `titleSettings.show: true` |
| `conditionalVarianceSettings.*` | `designSettings.style: 4D` — the numeric form, not `'4'` |
| `commentBoxSettings` panel content | the `Comments` role **or** `annotationLayerSettings` |

## IBCS neutral band

Variances within ±threshold render grey instead of red/green — required for a conformant variance
chart.

```jsonc
"designSettings":              { "style": "4D", "neutralVarianceColor": "<grey>" },
"conditionalVarianceSettings": { "unit": "'P'", "cvLowerThreshold": "0D", "cvUpperThreshold": "10D" }
```

`unit` is letter-valued → quoted (`'P'` = percent; also `None|K|M|G`). Thresholds numeric → `D`.
Per-column bands are settable **only** in the `columnSettings` blob; `conditionalVarianceSettings`
is visual-wide.

☠️ **On Tables and Tables+ the visual-wide object does not exist** — `conditionalVarianceSettings`
is declared on Charts only. A per-column band is the whole mechanism there, and because it lives
inside a text blob it appears in no property list.

On **Charts** the visual-wide object is the right route and it is render-confirmed — but **only with
`designSettings.style: 4D`**. Without it the object is accepted and nothing changes, which reads
exactly like the feature not working: a paired control had the same variances green while the
`style: 4D` arm turned the two in-band ones neutral. It is the same dependency the property-versus-
prerequisite table records for `conditionalVarianceSettings.*`.

The per-column shape on Tables, one column of the blob:

```jsonc
"actual-plan-percent": {                 // or "actual-plan" for the ABSOLUTE variance column
  "format": 2,
  "conditionalVariance": {
    "cvLowerThreshold": 0, "cvUpperThreshold": 3,
    "unit": "P",                         // "None" = raw value units, for an absolute column
    "style": 0,
    "positiveColor": "#7aca00", "negativeColor": "#ff0000",
    "neutralVarianceColor": "#dcdcdc", "neutralColor": "#404040",
    "markerColor": "#000", "lineColor": "#404040", "gridlineColor": "#ccc"
  }
}
```

Note the values here are **raw JSON inside the blob** — plain `0`, `3`, `"P"` — not the `0D` / `'P'`
literal forms the visual-level object takes. Three things that decide whether it works:

- **The band is a signed range `[lower, upper]`, not `|v| <= t`.** With `0 … 3` a `-0.7%` variance
  renders **red**, because it is below the lower bound. Write a negative lower bound for a symmetric
  tolerance.
- **It applies to absolute variance columns as well as percent ones**, with `unit: "None"` and the
  band in value units.
- **The neutral colour comes from the visual-level `designSettings.neutralVarianceColor`**, not from
  the block's own colour keys. Set it there, together with `designSettings.style: 4D`.

`neutralVarianceColor` and `neutralColor` are **different properties**: the first colours a neutral
variance, the second is *"Base color"*. Setting the wrong one changes the bars and leaves the
variance untouched.

**Threshold colouring on a plain VALUE column.** The band is not limited to derived variance
columns, and **retyping the column is what makes conditional formatting available on it**. Bind two
or more measures to `Values`, set `format: 1` on the one you want coloured, give it a
`conditionalVariance` band **in display units**, and set `chartView.showAsTable: 2` so the colour has
a bar to land on. With `unit: "K"` and `0 … 300`, spend of `432.8K` and `307.7K` renders green while
`241.7K` and `154.4K` renders neutral — a data bar with thresholds, on a measure that is not a
variance. `unit` takes `K` as well as `P` and `None`.

☠️ **Two gates, each proved by changing one thing in a file that worked.** `format: 0` makes the
band inert — same block, no colouring. And a **lone `Values` measure** makes `format: 1` itself
inert: a variance needs something to be a variance against, so the extra measure has to be bound
even when you hide it. **The tell for both is the column header** — it shows your measure name when
the settings apply and falls back to the scenario name `AC` when they do not.

## Objects that do something (screenshot-verified)

```js
// Charts — small multiples
multipleLayout:  { layoutType: word('Rows'),           // or 'Auto' — Zebra picks the grid
                   showMultiplesGrid: bool(true),
                   gridlineStyle: num(1), multiplesAxisLabelsOptions: num(3), sort: num(0),
                   // Top N PANELS (needs a Group). 0 Off / 1 Items / 2 Percentage; the count is a
                   // plain scalar here, unlike Tables' topNSettings blob; always name the remainder.
                   showTopNChartsOptions: num(1), topNChartsToKeep: int(6),
                   topNChartsOthersLabel: word('Other regions') }   // or num(2) + topNChartsPercentage: int(83)
// chartType — the values look interchangeable and are NOT. Same bindings, different grammar.
// The SIX declared values, with Zebra BI's own display names (they are the names in the formatting pane):
//   0 Waterfall  cascading bar-to-bar bridge (PY -> deltas -> AC). The trend-bridge recipe.
//   1 Area       filled series.
//   2 Bar        plain bars/columns. Orientation is chartSettings.showVerticalCharts, NOT this.
//   3 Variance   AC as plain columns, with the variance as a floating bridge glyph ABOVE each
//                column. Reads as "the number, and how it moved" — not a cascade.
//   4 Line       points/lines. Two series = two lines (see legendHeaderSettings to rename them).
//   7 Pin        pin/lollipop.
// There is no 5 or 6. Picking a value the pane does not offer is how you get a silent fallback.
//
// CHOOSING one: 0 and 3 are the two that CARRY the variance grammar. 1, 2 and 4 are ordinary
// Power BI shapes that happen to be drawn by a Zebra visual. If you bind a comparison, pick a type
// that draws it.
//
// ENCODING, and this one bites hardest: chartType is a NUMERIC enum. num(3) -> "3D". Writing the
// word form "'3'" is NOT a declared value, so it is silently ignored and the visual falls back to
// its DEFAULT type — which is 0, the waterfall. You do not get an error and you do not get the
// chart you asked for; you get a PY->AC bridge over whatever is on the axis.
chartType:       { chartType: num(0) }   // "0D" -- NEVER "'0'"
chartSettings:   { showVerticalCharts: bool(true),     // rotate the bridge
                   invert: bool(true),                 // whole visual: a rise is BAD (costs)
                   minChartHeight: num(-103.375) }
// rename the scenario legends — Zebra says actual/plan, your page may say something else
legendHeaderSettings: { actual: word('Gross margin'), plan: word('Operating margin') }
// style the dot-chart overlay (see "two projections in one role", below)
dotChartDataLabelSettings: { units: word('P'), labelDensity: num(7) }
axisBreakSettings: { show: bool(true) }
// Data-label thinning. 6 Highest(Auto) · 9 High(Auto) · 8 Medium(Auto) · 7 Low(Auto) · 0 Full ·
// 1 None · 2 Last · 3 First,last · 4 Min,max · 5 First,last,min,max.  DEFAULT IS 6.
// The four Auto tiers descend 6 > 9 > 8 > 7 -- reading the numbers as a scale gets it backwards.
// 0 Full labels every point however narrow the chart is, so it is the collision setting, not the
// default. Choosing between them is design.md §15.4.
dataLabelSettings: { labelDensity: num(8) }
categorySettings:  { axisLabelDensity: num(2), axisLabelDensityEveryNthLabel: int(6),   // numeric enum: num(), never word()
                     // 0 All (the DEFAULT, and it truncates) · 1 First and last · 2 Every N-th.
                     // N unset behaves as ~5. Pick N so (categories - 1) % N == 0: the LAST label
                     // always draws whatever the step is, so 16 points at N=2 collide 15 with 16.
                     categoryWidth: num(1), minWidth: num(22),
                     displayOptions: num(1), gapBetweenColumnsPercent: int(25) }
differenceHighlightSettings: { show: bool(true), differenceLabelType: num(2),
                               showDifferenceHighlightSubtotals: bool(true) }
dataLabelSettings: { decimalPlaces: int(1), varianceLabelType: num(1), fontSize: num(14) }
// Title: text takes [Measure] tokens; fontSize is NUMERIC (Zebra BI's own templates write 16D on
// every titled visual, 15 of 15). The design layer asks for 12 on a dense page.
titleSettings:   { show: bool(true), text: word('Net sales by month · [Period label]'),
                   fontSize: num(12), alignment: word('left'), wrapLongTitle: bool(false) }
// labelDisplayUnits is a NATIVE Power BI property (native visuals, columnFormatting, totals), not a
// Zebra one: 0 Auto · 1 None · 1000 Thousands · 1000000 Millions, D-suffixed. Zebra visuals take
// their units from the model's formatString and from the units keys in their own blobs.

// Tables
chartSettings:   { valueChart: num(5), relativeChart: num(1), absoluteChart: num(2),
                   showAsTable: bool(false),
                   calculations: word('["actual-plan","forecast-plan"]'),
                   columnSettings: /* blob — the key set is in its own section */ }
// ROW RULES. Zebra calls these gridlines and they are NOT value gridlines: they are horizontal
// rules between rows, drawn across every column. Both switches default to ON.
//   showGridlines      "Minor" -- a rule every gridlineDensity rows
//   showMajorGridlines "Major" -- the rule under a HIERARCHY PARENT row. Nothing to draw on a
//                      flat Category, which is why it reads as inert there.
//   gridlineDensity    every N rows, DEFAULT 5. N > row count draws NOTHING, silently.
chartSettings:   { showGridlines: bool(true), showMajorGridlines: bool(true),
                   gridlineDensity: int(5),
                   // the TABLE-VIEW twins, read ONLY when showAsTable is true -- the same view
                   // scoping columnSettings uses. Default there is a rule on EVERY row.
                   showGridlinesTable: bool(true), gridlineDensityTable: int(5),
                   minChartWidth: num(80) }
// ROW HEIGHT. 0 Auto (default) · 1 Font sized · 2 Font sized x1.1 · 3 Font sized x1.5 ·
// 4 Stretch (the only value that distributes rows to the container) · 5 Fixed.
// `height` is read by 5 ALONE. Choosing a value is design.md §15.1; 16 is the legible floor.
categorySettings: { rowHeight: num(3), height: num(24),
                    displayOptions: num(2), width: num(120),   // 0 Auto · 1 Full · 2 Fixed
                    gapBetweenColumnsPercent: int(25) }        // in-cell bar thickness
// SORTING A TABLE NEEDS TWO KEYS. columnName says WHICH column; categorySort says SORT AT ALL.
// columnName ALONE does nothing visible -- the table renders in model/alphabetical order and looks
// deliberate, so this is a silent miss rather than a broken visual.
sortSettings:    { columnName: word('actual'),   // 'actual' = the FIRST Values projection
                   categorySort: num(1),          // 1D = descending. 0D = none. 2D = ascending
                   chartSort:    num(1) }         // shipped templates set both, 121 of 152 Tables
//   columnName also takes a measure's DISPLAY NAME, not just a scenario key -- render-proven with
//   'Won revenue'. That is how you sort by one column while the variance sits on another, which is
//   the case worth knowing: a rate sorted descending puts tiny-denominator members on top
//   (100% on 2 deals), so bind the rate to Values[0] for the variance and sort by the volume column.
dataLabelSettings: { decimalPlaces: int(0), decimalPlacesPercentage: int(0) }
// Top N on a TABLE lives in categorySettings and thins the ROWS. Different object group and
// different names from the Charts form (multipleLayout.showTopNChartsOptions), which thins
// small-multiple PANELS and needs a Group. Do not reach for one expecting the other.
// The COUNT is in the blob, not a scalar. showTopNCategories alone renders every row - verified.
categorySettings: { showTopNCategories: bool(true), showTopNForm: bool(false),
                    topNOtherLabel: word('Other vessels'),   // always name the remainder
                    topNSettings: word(JSON.stringify([{ category: 'Vessel', dataProperty: 0,
                      level: 0, number: 15, numberInFocusMode: 20, type: 1,
                      columnName: 'actual' }])) }
//   category+level target it · number is inline, numberInFocusMode is FOCUS MODE (set both) ·
//   columnName is what "top" means, pair with sortSettings.columnName · type 1 = Top.
//   The Others row keeps the grand total whole: 15 rows + Others == all 20 -- on an ADDITIVE
//   measure. On a rate the aggregate is nonsense and nothing flags it; see dax.md item 4.

// Cards  -- NOTE the object names: `dataLabels`, not `dataLabelSettings`; `design`, not
//            `designSettings`. Cards renames things and ignores the name you expected.
grid:       { cardsInRow: num(4) }                      // NOT layoutPreset
            //   ^ the ONLY reliable lever for cards-per-row
card:       { cardDefaultInvert: bool(true), cardDefaultAxisBreak: bool(true),
              suppressChart: bool(true) }               // KPI row: number + variance, no chart
            //   cardDefaultInvert is ALL cards. For ONE card, write kpiInvert into the
            //   customData.uniformData blob
            //   suppressChart is Zebra BI's own dominant setting on KPI rows; it hides the chart
            //   without reclaiming its height, so size the container for the number alone.
legend:     { actual: word('2024'), previousYear: word('2023'), plan: word('Budget') }
            //   Cards' scenario headers: legend.show · actual · previousYear · plan · forecast ·
            //   actualPreviousYear(Percent) · actualPlan(Percent) · actualForecast(Percent) ·
            //   forecastPreviousYear(Percent) -- camelCase, where Charts/Tables write
            //   legendHeaderSettings.actual-plan-percent
dataLabels: { numberFormat: word('P') }                 // raw fraction -> "32.6%"
// cardSize DOES NOT SIZE CARDS. An authored
//   customData.uniformData with an empty cards{} is accepted and silently ignored.
//   Card height comes from the CONTAINER (the card auto-sizes to content: ~264px with
//   Values + PreviousYear).
```

`chartSettings.types` (Tables) is the clean control that proves enum encoding works: every one of
its declared values produces a distinct render, with none silently ignored.

## The `columnSettings` key set — write every key, always

`chartSettings.columnSettings` is a **blob**: a JSON object serialised into a string and quoted as a
literal. One entry per column, keyed by a scenario role (`actual`, `plan`, `previousYear`,
`forecast`), a comparison key, or a measure name.

**Absent is not the same as empty.** Omit one of these keys and the cells render **solid black** —
not a default, not blank. Write all of them, using `""` where you want nothing.

```jsonc
// per column. `tableView` when chartSettings.showAsTable is TRUE, `chartView` when it is false —
// the other one is not read, so writing the wrong one is silently ignored.
{ "actual": { "order": 1,
              "tableView": { "showAsTable": 2, "backgroundFill": "", "textColor": "",
                             "markerStyle": "", "bold": false } } }
```

`showAsTable` is an **integer enum**, not a boolean — `2` is the in-cell chart. Inside a blob colour
is a plain hex string (`"#0078D4"`), never the nested `solid`/`expr` shape used outside one.

**`chartSettings.calculations` decides which column keys are legal**, so set it first: a key that
names a comparison the calculations do not declare is dropped.

If the checker tools are available, `encode_table_columns` emits this key set for you and warns on an
illegal key — prefer it. But the key set is here so the blob is writable without it.

## Density properties that accept a value and do nothing

Each of these was reached for, rendered, and found inert with the companion missing. None of them
errors and none of them looks wrong in the JSON — the visual simply keeps the setting it had.

| Written | Read only when | Otherwise |
|---|---|---|
| `categorySettings.height` | `categorySettings.rowHeight` is **`5D`** (Fixed) | ignored, in both views. One vendor template ships it beside `rowHeight: 0D`, where it does nothing |
| `showGridlinesTable` · `gridlineDensityTable` | `chartSettings.showAsTable` is **`true`** | ignored |
| `showGridlines` · `gridlineDensity` | `chartSettings.showAsTable` is **false or absent** | ignored. Three vendor templates ship them on table-view visuals, where they do nothing |
| every `designSettings` colour, incl. `gridlineColor` · `majorGridlineColor` | `designSettings.style` is **`4D`** | ignored — the colour gate, in its own section |

The `showAsTable` split is the same one `columnSettings` uses for `tableView` / `chartView`, and it
catches people the same way: the visual renders, the property is in the file, and nothing happened.
**Set the view first, then the properties for that view.**

Two more, both measured:

- ☠️ **`gridlineDensity` larger than the row count draws no rules at all.** The first would fall at
  row N. On a six-row table, `10L` reads as "sparser" and means "off".
- ☠️ **`designSettings.style: 4D` with no `neutralColor` renders the actual bars black.** Going
  Custom to unlock one colour costs the base colour; set it in the same block.

None of these is a validator rule. Each fires on one to three of Zebra BI's own templates, which
render correctly with the dead property in place, and a checker that flags a correct report is worse
than no checker. The one density rule that *is* enforced is the legible floor on a fixed row
height — `table-row-height-below-legible`.

## Per-category scenarios (Charts) — solid actuals and HATCHED forecast on ONE series

A build-up where the banked part is solid and the projected part is hatched does **not** come from
binding the `Forecast` role. It comes from naming the individual **categories** as forecast inside
`categoriesMetadata`. Render-proven on a pipeline bridge (won to date + three qualified stages):

```js
categoriesMetadata:   { results:         word('["Forecast","2-Develop qualified","3-Propose qualified","4-Close qualified","Won to date"]'),
                        floatingResults: word('["2-Develop qualified","3-Propose qualified","4-Close qualified"]'),
                        scenarios:       word('[{"Forecast":3},{"2-Develop qualified":3},{"3-Propose qualified":3},{"4-Close qualified":3}]'),
                        highlighted:     word('[]') }
stackedChartSettings: { stackedWaterfallChartEnabled: bool(true) }
chartSettings:        { showGrandTotal: bool(false) }   // the anchor row already IS the total
```

**Use `encode_category_scenarios`** (or `categoryScenarios` in a `write_visual` spec) rather than
hand-writing the four blobs: it takes the value → scenario map, the floating steps and the results list,
emits all four keys together, accepts only the render-confirmed enum, and refuses a step that `results`
does not draw. Its companion names the two plain properties that go with it.

- `scenarios` is an array of **single-key objects**, one data value to one scenario enum. **`3` =
  Forecast is the only value confirmed by render.**
- `floatingResults` is what makes those steps read as **components of a build-up** rather than
  variances, so they carry no good/bad colour — which is right, they are not deviations.
- `designSettings.applyPatterns` was never set and the hatch appeared regardless.
- `stackedWaterfallChartEnabled` rendered here with **no `Group` bound and no `show`**, so the
  companion-gate row for `stackedChartSettings.*` does not hold for this key.
- All four keys were authored and **reproduced as one set**. Nothing here establishes which single
  key is load-bearing; if you need one on its own, test it on its own.

☠️ **Do not reach for the `Forecast` role to get the hatch.** Binding `Values` = the banked step and
`Forecast` = the projected steps made Zebra bridge **total forecast down to actual** — a red-stepped
cascade from 66.2M to 26.4M rather than a build-up. On a waterfall the **binding** decides the form,
and `chartType` does not override it.

## Untested / known-inert

`grid.compactCards` (nothing) · `showGrandTotal` on **Charts** (measured as ignored there). On
**Tables** it is not on this list: `chartSettings.showGrandTotal` with `grandTotalLabel` is
render-verified — a labelled Total row appeared on four tables and reconciled. The "unresolved"
verdict this list once carried was a Charts measurement read as a Tables one.

⚠️ **Read this section as "not confirmed working" — not as "confirmed broken."** A property listed
here may work perfectly and simply have been set the wrong way. The usual culprit is the numeric-enum
encoding at the top of this file: writing `'1'` where PBIR needs `1D` makes a working property look
inert, because the value is discarded and the visual falls back to its default. **So if you set one of
these and it works, that is a normal outcome — trust the render, not this list.**

**Two properties that look like they belong on that list and do not:**

- **`legendHeaderSettings` is NOT an "opaque bag of 157 props".** It is the same scenario-key
  vocabulary as `columnSettings` — `actual` · `plan` · `previousYear` · `forecast` ·
  `actual-plan` · `actual-plan-percent` · `actual-previousYear` · `actual-previousYear-percent` ·
  `forecast-plan(-percent)`, plus `show`, `switchReferenceScenarios`, `useAliasesInTooltips`
  (Tables also `absoluteDifferenceHeader`/`secondAbsoluteDifferenceHeader`). It renames the
  scenario labels, it takes `[Measure]` tokens, and it is set by 6 Charts and 6 Tables
  templates. 157 is the *declared* count; the *used* surface is ~10 obvious keys. Cards uses
  `legend.*` in camelCase for the same thing.
  **Two keys worth knowing beyond the scenario list:** `additionalMeasure1Header` ..
  `additionalMeasure20Header` rename the plain measure columns that follow `Values[0]`, and
  `useMeasureNamesInEligibleHeaders` (bool) makes Zebra use the measure's own display name wherever
  it can instead of the scenario shorthand. Render-proven on a 4-column variance table: the
  `[Measure]` token in a header resolves **only if that measure is projected on the visual**, and
  projecting it into `Filters` is enough (`visuals.md`). This is the fix for a table full of
  `AC`/`PY`/`ΔPY` — see `design.md` section 9 for what to write instead.
- **`chartSettings.chartLayout` is still measured inert, but the measurement is suspect.**
  All 9 values were tested on a binding where **`PreviousYear` and `Forecast` were never
  bound** — and every one of its 7 values in those templates names a *scenario-comparison* layout
  (`'Responsive'`×16 · `'Waterfall'`×8 · `'Absolute / Relative'` · `'Integrated'` · `'Actual'` ·
  `'Actual / Absolute'` · `'Relative'`, across 9 templates). A variance-layout property tested
  with no variance bound is "suspect by construction" per the caveat below. Re-test with
  `Plan` and `PreviousYear` bound before calling it inert.

**Text properties take measure tokens.** `titleSettings.text` and `legendHeaderSettings.*`
resolve `[Selected Year]`, `[Calendar Table.Selected Month]`, `[Min(Table.Column)]` at render
time — **gated on the measure being projected into the `Filters` role** (94 of 94 tokens in those templates
obey it; Zebra's docs state the same gate). Charts and Tables only: **Cards declares no
`titleSettings` object at all** — the same object authored on a Cards visual produced no title —
and its header vocabulary is `legend.*`.

**A caveat on every "does nothing" above.** Those results were measured on a single binding where
**`PreviousYear` and `Forecast` were never bound, and there was no date hierarchy.** So any claim
that a *scenario-, reference- or period-dependent* property is inert is **suspect by
construction**: the property may work perfectly and have had nothing to act on. Re-test with a
comparison bound before you believe one.
