<!-- Summary: The design layer — which visual form carries which message, how big it is, what scale it shares, how it is sorted, titled, coloured and labelled. Read at plan step 3, before the first `position` is written. -->
# Design — choosing the visual, its form, its size and its scale

The rest of this skill tells you how to *write* a Zebra BI visual. This file tells you which one to
write, how big, and in what form — the decisions a reviewer catches by eye and no validator can. It is
written for the moment in the plan when every question on the page has a row and you are about to pick
a visual for it. Read it then, whole, once per report; afterwards come back to the checklist at the end
before the first render.

Two ideas carry everything here. **A table is for looking numbers up; a chart is for carrying one
message.** And **a reader compares lengths well, positions well, and areas, angles and colours badly** —
so the honest forms are columns, bars and pins on a common baseline, and everything else has to earn
its place. Zebra BI's three visuals are built around exactly those forms and around a comparison
(actual against plan, previous year or forecast) drawn with the standard business notation, so most of
what follows is choosing the right one of the three and then not undoing what it does for free.

## 1. Start from the question, not from the data

Each row of the question table in the plan names a visual. The questions themselves come from the
brief — the reader, the decision, the period and the comparison fixed at plan step 0
(`references/analyst.md` §1–§3) — so if a row cannot be traced to that reader, it is not a question
yet. Decide the visual in this order:

1. **Is there a message, or is this a lookup?** A lookup — "let me see every account for every month" —
   is a table, and a table needs no chart type, no highlight and no message sentence. A message — "we
   are behind plan because of two regions" — is a chart plus, usually, a table that proves it.
2. **What is on the category axis: time or structure?** Time (months, quarters, years) runs
   left-to-right on a horizontal axis: **Charts**, `Category` = the period. Structure (accounts,
   products, regions, customers, reps) runs top-to-bottom: **Tables**, or Charts turned vertical with
   `chartSettings.showVerticalCharts`. Never bind time as table rows unless the reader asked for that
   layout, and never draw a structure dimension as a line — a line says "continuous", and products are
   not continuous.
3. **What is the measure type?** An amount (currency, units, headcount) is a full column or bar. A ratio
   or percentage (margin %, share, per-head) is a *thinner* mark — a pin, or a thin line — so the eye
   never reads a percentage as an amount. Absolute variances are columns or bars at the **same scale as
   their base**; relative variances (ΔPL%, ΔPY%) are **pins**, never full columns. Zebra draws all of
   this from the binding; your job is not to override it.
4. **Is there a reference?** If the data has plan, previous year or forecast, never show the actual
   alone — bind the comparison. A bare actual series is a Power BI habit, and it removes the one thing
   that lets a reader judge the number. Where there is genuinely no reference, say so in the title
   rather than quietly shipping a thinner page.
5. **How many members?** The count decides between one chart, a Top N with an *Others* row, small
   multiples, or a table. The thresholds are in the sections that follow, and none of them is "as many
   as fit".
6. **Does the page already carry the same answer?** A table that repeats the labels of the chart beside
   it is decoration; keep the one that carries the message and give the other a different job (more
   measures, more detail, the next level down).

| The reader asks | Build | Binding | Not this |
|---|---|---|---|
| How big is it, and against what? | **Cards** KPI row, one tile per KPI | `Group` = KPI, `Values` = AC, `PreviousYear`/`Plan` | one giant card; a card per *segment* |
| What happened through the year? | **Charts**, months on the axis, AC against PY or PL | `Category` = month, `Values` + comparison | months as table rows; two years end to end |
| Who or what drove it? | **Tables**, structure rows with variance columns | `Category` = dimension, `Values` + comparison | a pie; a native bar chart with no variance |
| How does the total move from A to B? | **Charts** waterfall (bridge) | `Category` = the contributing members, `Values` | a stacked column; a line |
| The same trend for every member? | **Charts** small multiples, one panel each | `Group` = dimension, `Category` = month | one chart with eight crossing lines; a tile per member |
| What is the calculation scheme? (sales → EBIT, cash) | **Tables** income-statement form, or a vertical waterfall | `Category` = accounts with `CategoryClass` | a chart per account |
| How do A and B relate across members? | a **scatter** (native) — Zebra has none | | a dual-axis combo |
| Too many members for the box | the same visual **+ Top N** with a named *Others* | | a scrollbar; dropping the tail |

## 2. Chart form by message (Charts)

**Time on the axis.** One amount over a few periods (up to a year of months, a handful of years) is
columns; the reader can label every one. When the periods are so many that labelled columns no longer
fit — long weekly or multi-year monthly series, in practice somewhere past fifteen to twenty periods —
switch to a line, label only the peaks, troughs and the last point, and put the series name in the
title, not a legend. Do not use a line for a few points: four quarters as a line implies a trend
between them that nobody measured. More history is better, not worse: three years of months read as
fast as one, and the pattern only appears with the extra points, so do not cut the series to
"declutter". Columns take about two thirds of their slot, so the gap is about half a bar; a line
panel needs roughly 25 px of height before its values can be read at all and gains nothing past
about 80, which is the floor small-multiple panels must respect.

**Actual against a reference over time.** The comparison lives on **one** axis of periods: `Category`
= month, `Values` = AC, `PreviousYear` = PY (one year selected), or `Plan` = PL. Zebra draws the
reference behind and lighter (PY) or outlined (PL), the actual in front, and signed variances with the
good/bad colouring. The canonical full form is three tiers on the same axis — the two scenarios, then
the absolute variance at the same scale, then the relative variance as pins — and a table carries the
same three tiers as columns. When there is no room for tiers, the integrated form (actual columns with
the variance drawn against each one) is the fallback, not the first choice. **Do not** put two years
end to end with a comparison bound, and **do not** bind a plan as the comparison on a time axis
expecting a trend: that draws a bridge from total plan to total actual with the months as steps, which
is arithmetic, not a trend. A plan bridge belongs on a structural axis.

**Waterfalls.** A waterfall answers exactly one question: *how did the total get from here to there?*
Two kinds. A **variance waterfall** decomposes the gap between two totals of the same measure —
PY to AC by month, plan to actual by region — and its steps are variances. A **calculation
waterfall** walks a scheme — sales, minus costs, equals margin — with subtotal bars, and it is
vertical (accounts top to bottom) because accounts are structure. Anything else drawn as a waterfall
is wrong: a plain trend is not a waterfall, and Zebra's default chart type is the waterfall, so an
unforced default on a monthly comparison must be checked against the message before it ships.

**Stacked columns and bars** have two hard gates: every value must have the same sign, and more than
about five parts only works when the parts barely vary. Put the part that matters most on the
baseline, because only that segment sits on a common scale — the others float and cannot be
compared by eye. When the gates fail, use small multiples or a table. Area charts follow the line
rule (many points) and are almost only worth it as small multiples.

**Bars for structure.** Members of a dimension for one period are horizontal bars on a vertical
axis, sorted for the analysis (descending for a ranking), labelled at the bar end, with the series
name in the title. In Zebra this is a **Table with a bar column** for most pages — the row header,
the bar, and the variance columns come together — or a Charts visual with
`chartSettings.showVerticalCharts: true` when there is one measure and the ranking is the message.

**Too many members.** Show the important ones sorted descending and gather the rest into one named
remainder — *Other vessels*, *Rest of world* — separated by a slightly wider gap and **excluded from
ranking and averaging**. Zebra's Top N does this and keeps the grand total whole. How many is "too
many": a Charts category axis beyond roughly a year of months or a dozen members is crowded; a Table
carries twenty to thirty rows before it scrolls; small multiples beyond eight or nine panels want a
Top N, and beyond about twenty-five panels always.

**Relationship between two measures.** Zebra has no scatter; use a native scatter chart with
members as points, one unit per axis, or two bar tables sorted by the first measure with the second
beside it. A bubble's *area*, never its diameter, carries the third value.

**The Zebra levers.** `chartType` is a numeric enum: `0` waterfall, `1` area, `2` bar, `3` variance,
`4` line, `7` pin — written `3D`, never `'3'`, or you silently get the waterfall. `0` and `3` carry
the variance grammar; `1`, `2`, `4` are plain shapes. With a comparison bound, **which form Zebra
draws is decided first by the binding**, and one controlled render found six chart-type values drawing
the same bridge with a plan bound — so choose the binding for the message, set the type, and read the
render before you trust the type did anything. Orientation is `chartSettings.showVerticalCharts`, not
the type. The difference highlight (`differenceHighlightSettings.show`) is on by default and draws
the change between the first and last point as the biggest number on the chart — turn it off whenever
the endpoints are not comparable, above all when the last period is partial.

## 3. When a table wins, and how to build it (Tables)

A table wins when the reader needs exact values, more than two or three measures at once, many
scenarios and variances side by side, or numbers that would need more than three digits as chart
labels. A chart wins when there is one message about a shape, a ranking or a gap. Both on one page
is right only when they show *different* data — the table goes a level deeper, or carries the
measures the chart cannot.

**Axes.** Periods, scenarios and variances are always **columns**; measures and structure members
are **rows**. A long measure list (an income statement) is rows in calculation order with result
rows marked (`CategoryClass`), children above their subtotal, the subtotal in bold with a rule.

**Column order**, left to right: the row header (wide), then the scenarios in time order with the
same-period scenarios by when they were made (PY · PL · AC, or AC · PL when there is no PY), then the
variances that compare them — absolute first, relative second — then any further measures. A totals
or parent column sits to the *right* of its group; an "of which" column sits immediately right of its
parent, smaller, with no gap. Zebra computes the variance columns from the binding and pairs them
with the **first** `Values` projection, so the measure you want the variance on goes first; the order
of the columns is `columnSettings.order` (the key set is in `references/formatting.md`).

**Widths and rules.** All columns of one type share a width set by the digits, never by the header —
abbreviate or wrap the header to two lines instead. No vertical lines: right-aligned numbers and two
gap sizes (narrow within a type, wider between groups) do the separating. Light horizontal rules
between rows, a solid rule above totals. Percent-of and of-which rows in a smaller font.

**Embedded charts.** A variance column carries its bars — signed, coloured by impact — and a
relative-variance column carries pins; that is what makes a Zebra table faster to read than a
matrix, and it is the expected form, not an option. The value column may carry bars when the rows
are a ranking. Turn the in-cell charts *off* only when the reader asked for a plain numeric table.
Sparklines in cells are honest only on one common or indexed scale; individually scaled sparklines
make a small wobble and a large swing look identical, so omit them rather than mislead.

**Sorting.** Structure rows sort for the analysis — descending by value for a ranking, calculation
order for a scheme, the model's order for a hierarchy the reader knows. A Zebra Table ignores the
report's `sortDefinition` and sorts by its own `sortSettings` (`columnName` **and** `categorySort`,
both), and two tables of the same dimension on one page will disagree in order unless you set the
same sort on both. A rate sorts by its volume column, never by itself — one hundred percent on two
deals sorts to the top otherwise. The remainder row is always last.

**Top N.** Any category with more members than the box shows gets Top N with a named *Others*, not a
scrollbar. Tables' count lives in the `categorySettings.topNSettings` blob (the bool alone shows every
row); the mechanics are in `references/formatting.md`. Pick N from the concentration the enumeration
already computed: the members that carry roughly four fifths of the total, capped by what the height
shows without scrolling, and never fewer than the members the message names.

**Digits.** A table cell carries at most four digits; choose the unit (k, M) so that it does, keep
the same decimals down a column, and put the unit in the title, not on every cell.

## 4. KPI rows (Cards)

A KPI row answers *how big, and against what?* for a handful of headline measures — five or six
across at full width, each tile one measure with its variance. It is the first thing read and it
filters the rest of the page, so it goes at the top under the header band.

- **One measure per tile, and the tiles are different measures.** A tile per *member* of a dimension
  (a card per region showing revenue) is a ranking wearing tiles; that is a Table with bars, or small
  multiples if the trend matters.
- **No charts inside the tiles unless each tile is read alone.** Every card scales its own chart, so a
  row of card charts promises a comparison the encoding cannot keep: a 36K series and a 1M series draw
  the same height. Bind no `Category`, or set `card.suppressChart: true`. Cards' *Scale groups*
  property (`interactions.viewModeGrouping`) is declared but changed nothing in the authored render,
  so do not lean on it.
- **The variance is the tile's job.** Bind the comparison; a bare number in a tile is decoration. Invert
  the colouring for costs and other measures where down is good (`card.cardDefaultInvert`, or per
  card).
- **Height follows content.** A tile with a value and one comparison and no chart sits around 120–130
  px; with an in-card chart around 200; with comments around 270 or more. Set `grid.cardsInRow` to the
  member count so the row does not wrap, and read the render — a scrollbar on a Cards row is a
  *shape* problem (a `Category` bound, a missing `cardsInRow`) before it is a height problem.
- **No title on the Cards visual** — it steals card room; the field name is the card title and the
  page title carries the context.
- **Twelve KPIs is a table.** Beyond six or seven headline measures the row stops being scannable
  (the constraint is attention, not a magic number — the reader holds a handful of things at once);
  use a rows-layout Cards column at the left edge (roughly 210–350 px wide, full height) or a Table
  with the KPIs as rows.

## 5. Small multiples

The same chart, repeated once per member, on **one shared scale** — that is the whole point, and it
is what makes a grid of panels comparable where a row of card charts is not. Use it when the message
is *the shape per member*: the same trend for every region, every product's AC against PL by month.

- **Threshold.** More than three or four series that cross on one chart is spaghetti; from that point
  small multiples, one series per panel. Keep a multi-line chart only when the reader must compare
  exact heights at one point in time.
- **Count.** Up to eight or nine panels read at a glance; beyond that use Top N on the panels
  (`multipleLayout.showTopNChartsOptions` with `topNChartsToKeep` and a named *Others* panel), and
  beyond about twenty-five panels always. Charts' Top N thins panels, not the category axis.
- **Grid.** Zebra lays the grid out (`multipleLayout.layoutType` `Auto` or `Rows`); the vendor's own
  containers are full width and about 2:1, with panels as wide strips and a floor of roughly 160–175
  px per panel (`chartSettings.minChartHeight`). `LargestFirst` gives the dominant member a bigger
  panel — which is the right answer when one member dwarfs the others: **enlarge its panel, never give
  it its own scale.** Order the panels so the ones the reader should compare are neighbours — by
  size, or by the change the page is about — not alphabetically.
- **Labels.** Gridlines are allowed here, because the panels are too small for every value to carry a
  label; label the last point and the extremes. The percentage floating at a panel's right edge is
  the change at the **last point**, not the panel total — with a partial trailing month it is a
  calendar artefact and the most prominent number on the page, so turn the difference highlight off.
- **Not a card.** A series per tile is small multiples. Cards are for one number and its variance.

## 6. Scale integrity

Everything below is what a reviewer means by "the chart lies".

1. **Value axes start at zero.** Always, for columns and bars. The one honest exception is an indexed
   series (reference period = 100%) with small deviations, zoomed, with the labels on the 100% line.
   Lines are not exempt in business charts: a line chart of revenue with a cut axis exaggerates like
   a column chart does.
2. **Same unit on one page, same scale.** Two charts of revenue side by side share a maximum; a Table's
   bar column and the chart beside it are read against each other and should agree. Small multiples
   share one scale by construction; Cards do not, which is why card charts are not a comparison.
3. **When magnitudes differ, change the size, not the scale.** In order of preference: keep the scale
   and let the chart with the small values be physically smaller; keep the truthful full chart and add
   a linked zoom panel for the small variances; accept different scales but mark them with a scale
   band at the same numeric value in every chart (usually a factor of ten apart, and honest up to about
   thirty to one); clip one unimportant outlier — a huge percentage on a tiny base — with an outlier
   marker and scale to the rest. **Never a broken column, never a cut axis.**
4. **Axis breaks are a last resort, off by default.** Charts' `axisBreakSettings.show` and Cards'
   `card.cardDefaultAxisBreak` truncate the base to make small deltas legible. The standard-conformant
   answer to "small variances on a huge base" is to show the variance as its own tier — a variance
   chart or the variance columns of a table — with the base intact. Use a break only when the variance
   *is* the message, the base is the same for every element, and the break marker is visible in the
   render; never on a row of cards, where a per-tile baseline makes the cross-tile read worse.
5. **Areas and volumes.** A bubble's area, an icon's area, a treemap's area carry the value; a
   diameter or a height scaled to the value lies by the square. Prefer a length.
6. **No logarithmic axes** for business readers, and **no dual value axes** except the one sanctioned
   case — an amount as columns and a ratio as a line on the same category axis, both labelled. Zebra
   draws that from two `Values` projections (the second becomes a dot-chart overlay). Never two column
   series on two axes.
7. **Percent versus percentage points.** The difference of two ratios is in percentage points (50%
   against 40% is +10 pp); the relative change of an amount is a percent. Zebra formats a percent
   measure itself — asking for percent units on a measure already formatted as a percent scales it
   twice on a Table.
8. **Expose what the scale hides.** A long series in a currency that moved, or across years of
   inflation, needs the constant-currency or real series as a second scenario; a cumulative chart
   hides the period movement it is supposed to show, so keep the period series beside it.

## 7. Sorting and order

- **Time is chronological**, left to right, always — never sorted by value.
- **Structure follows the analysis.** A ranking sorts descending by the measure that answers the
  question; a scheme (accounts) keeps calculation order; a hierarchy the reader knows (org units,
  regions) keeps its natural order. Say which in the title or header when it is a ranking.
- **The same dimension sorts the same way on every visual of the page and every page of the report.**
  Two Zebra visuals of the same members will disagree unless you set the sort on both; a Cards row
  and a Table of the same KPIs is the common case.
- **Scenarios in time order, then by creation:** PY before AC; PL before FC before AC within one period.
  Actual and forecast in front, references behind.
- **Members must be disjoint and exhaustive.** No aggregate beside its own parts (no *Scandinavia*
  next to Norway and Sweden); when the members shown do not sum to the total, a remainder row makes
  them do so, and it goes last.

## 8. The page: layout, grid and sizing

**Reading order.** Readers scan top-left first and then across and down. Put the key message and the
KPI row at the top, the visual that proves the message in the middle, and the detail (tables, drill
visuals) at the bottom or right. One question per page; one page holds everything needed for its
answer, read without scrolling — a scrollbar inside a visual or on the page is a layout defect, not a
feature.

**Density.** Make each visual as small as its labels stay legible, not as large as the space allows;
a KPI with one number does not get a quarter of the page, and a chart whose data region fills less
than half its frame should shrink. Prefer objects that combine two dimensions (time × scenario,
structure × variance) over one-dimensional objects. Related visuals only: an unrelated chart on the
page adds nothing and costs comparability.

**The grid, on a 1280 × 720 canvas.** These are the dimensions Zebra BI's own shipped report pages
use; start from them and change them only for a reason you can name.

| Role | Geometry | Notes |
|---|---|---|
| Header band | y 0–64 | page title textbox at the left, slicers to its right, nothing else |
| Page title (textbox) | x 0–10, y 0, w 330–800, **h 55** | one line; report name and entity only, never a value from the data |
| Slicer | h 46 with the header **off**, **≥ 52** with it on (64 comfortable), w 90–190 | dropdown, 10 pt; two to four per page, never more than five. The header shows unless you turn it off |
| First content visual | **y 64–74** | 106–124 only when there is a second header row |
| KPI row (Cards) | x 0, y 64, w 1272–1280, h ~130 without charts / ~200 with | 5–6 tiles, `cardsInRow` = the count, no title |
| One big visual (chart or table) | x 0–10, y 64–74, w 1270–1280, h to the bottom edge (≈650) | the vendor's modal page: one Zebra visual, title, slicers |
| Table + chart side by side | table left ≈57% (w ~740), chart right ≈43% (w ~530), both to the bottom | zero or 8–11 px gutter; 50/50 when neither leads |
| Visual under a KPI row | y ≈ 265–270, w 1280, h to the bottom (≈450) | |
| Stand-alone half-page chart | ≈ 590 × 320 | aspect around 2:1; one series |
| Small-multiples container | full width, ≈ 1270 × 590–650, aspect ≈ 2:1 | panels are wide strips, not squares; `minChartHeight` ≈ 160–175 |
| KPI side column (Cards, rows layout) | x 0, w 212–353, full height | dense scorecards |
| Gutters | 0 between touching Zebra visuals (their padding is the gutter), 8–11 px otherwise | right edge at 1280, bottom at 720 |
| Objects per page | 1–2 Zebra visuals, optionally a KPI row, a title, 2–4 slicers | 6–11 objects including chrome; nine visuals of data is a scrolling wall |

Check the arithmetic before you render: no two visuals intersect, nothing runs past the canvas, and
native controls keep their full rendered height (a 48 px slicer with its header on overflows its box
even though the numbers pass). The theme may paint a logo or a band the JSON does not show; read an
existing page's reserved regions before you place anything in the top-right corner.

**Consistency across pages.** The same slicer set in the same place on every page, the same
dimension in the same order and colour everywhere, the same title layout, the same visual type for
the same kind of analysis. A reader who learned page one should not have to relearn page three.

## 9. Titles, the key message, comments and footnotes

**Every title describes and never judges.** Three parts, in this order: *who* — the reporting unit
or scope (with the filter when the members are not all of them: "top ten clients"); *what* — the
measure with its unit, the measure in bold if the visual allows it ("Net sales in mEUR", "by
country, sorted ↓"); *when* — the period and the scenarios ("2024 AC and PL", "Jan–Jun AC vs PY").
On a page with several visuals, the page title carries what they share and each visual's title
carries only what differs. Anything that comes from the data — the period, the entity, a total —
is a `[Measure]` token resolved at render time, never typed text. Keep titles ASCII (a hyphen, not
a typographic dash or dot), because the preflight rejects non-ASCII bytes and a save can mangle them.

**Strip the words that say nothing:** "Sum of", "Total", "chart", "analysis", "overview", "trend",
"report", "development". A token every category label shares ("2024" in twelve month labels,
"Division" in every division name) moves to the title once.

**A column header names the subject, not the notation.** Zebra's defaults — `AC`, `PY`, `ΔPY`,
`ΔPY%` — are the vendor's shorthand for scenarios, not a description of your data, and a table of
them makes the reader translate every column. Write what the column *is*: "Won 2021", "Won 2020",
"Change", "Change %"; on a rate, "Win rate 2021" and "Change in pp", because percentage points are
not percent and a header that says `ΔPY%` on a rate column is actively wrong. Where the header
carries a period, the period is a `[Measure]` token like any other — "Won [Year label]" — so the
table re-labels itself when the window moves. Set them per scenario in `legendHeaderSettings`
(`formatting.md`); leaving them at the defaults is the single most common reason an otherwise
correct variance table reads as a raw extract.

**The key message is a sentence, at the top, and it evaluates.** "Sales fell 8% below plan in Q3,
driven by Germany" — a complete sentence with a checkable quantity, a verb, and the cause where the
data supports one. Same position on every page: above the title, or right of it on a landscape page.
The visuals on the page are the evidence, and at least one element on the page **points at** that
evidence — a highlighted value, a difference marker, a comment anchored to the data point. A page
with numbers and no highlighted element is a statistic, not a report; if you cannot write the
sentence, the page has no message yet and is a lookup table — label it as one rather than dress it up.

**Comments** are numbered, anchored to the element they explain, few (two or three per page), and
never restate a number the visual already shows. A caveat that matters — a partial month, a
non-comparable set — belongs in the *encoding* (neutral colouring, a split visual, the difference
highlight off), not only in a footnote; a footnote nobody reads has not been made.

**Footnote.** Source system and extraction date at the bottom of the page, small, as a measure token
where the date comes from the data.

## 10. Numbers, labels and type

- **Three digits in a chart label, four in a table cell.** Choose the unit — k, M, bn — so that
  holds, once per visual, and name it in the title. Never mix units on one axis or in one column.
- **Same decimals down a column and across a KPI row**; zero or one decimal for amounts, one for
  percentages unless the differences are in the second decimal. Two *effective* digits — the first two
  that vary across the numbers being compared — are what a reader can hold; 3.8M, never 3,848,306.
- **A plus sign on positive variances**, none on absolute values; Zebra does this. Negative values
  with a minus, not parentheses, unless the house style is accounting.
- **Dates and periods** in one format per report, unambiguous (2024-06, Jun 2024), never 06/07/24.
- **Labels are horizontal and integrated.** Data labels next to their elements (above positive
  columns, below negative; right of positive bars, left of negative) make value axes and gridlines
  redundant, so leave those off unless the visual is too dense to label. *(On Zebra BI visuals there
  is nothing to leave off: Charts exposes no gridline switch at all, and what Tables calls a gridline
  is a horizontal rule between rows — §15.2.)* Never rotate category labels
  — if they do not fit horizontally, the axis wants horizontal bars or fewer categories. Do not label
  tiny elements or every point of a dense line; extremes and the last point are enough.
- **Legends inside the plot, or none.** One series: the name is the title. Several: label the line at
  its end, the segment beside the stack. No external legend box.
- **Type.** One family (the theme's; Segoe UI in Zebra's own pages), plain weight, bold only for the
  measure in a title and for totals. Sizes that match the vendor's pages: 12 pt for a visual title,
  11–12 pt data labels, 10 pt slicer text and card chart labels, 16–20 pt card values, a page title
  around 16–20 pt in a 55 px box. Nothing under 9–10 pt on a screen report.
- **A textbox clips from the bottom, and it does it silently.** The measured floor is
  **`ceil(pt × 1.45 + 12)`** px for a single line — 26 at 9 pt, 30 at 12, 33 at 14, 36 at 16, 41 at
  20, 44 at 22. Below it the descenders go first, so the text still reads at a glance and looks
  unfinished on inspection; well below it, Power BI adds its own scrollbar. Add a line's worth
  (about pt × 1.4) for every extra line, and round up rather than down — nothing on a page reads as
  more careless than a cropped caption.
- **Every number on a page reconciles.** Members sum to the total shown; the same measure agrees
  across the visuals that show it; a partial period is marked as one.

## 11. Colour

**Colour means something or it is grey.** Actuals are dark grey, previous year lighter grey, plan an
outline, forecast hatched — scenario is coded by *pattern*, not hue, so it survives greyscale and
colour-blindness. Green and red are reserved for variance impact — green good, red bad, blue for
neutral or ambiguous — and *impact* is not sign: a cost that rose is red although the number is
positive. Set the polarity once for the whole report (`chartSettings.invert`,
`card.cardDefaultInvert`, per-group or per-row inverts) and confirm it on every visual that binds a
comparison. Small variances inside a neutral band render grey rather than shouting; the band is what
keeps a ±0.3% wobble from being a red flag.

Everything else on the page is black, white and grey: no coloured backgrounds, header bands, frames,
shadows or brand fills on data marks. Brand colour lives in the chrome — a logo, a title accent — and
in at most three to five colours per page counting the variance pair. A palette that colours each
member of a dimension differently says nothing a label does not say better, and it steals the meaning
of colour from the variances.

Zebra's defaults are the standard's colours; every colour property is gated behind
`designSettings.style: 4D`, and the visuals also carry the sign and the hatching, so colour is never
the only cue — keep it that way when you customise. A colour-blind-friendly style is declared in the
`style` enum; render it before relying on it. Whatever colours you choose, the same green, red and
grey mean the same thing on every page of the report. About one reader in twelve is red-green
deficient, and East Asian markets read red as *up* — one more reason the sign glyph stays and the
convention is fixed once per audience in the theme, never mixed on one report.

## 12. Depth — how the reader gets from the summary to the detail

Every report has more detail than fits. There are **five** ways to offer it, they are not
interchangeable, and the choice is the single biggest reason two reports built from the same model
read completely differently. Reaching for the same one every time is what makes a pack look
generated.

Start from what the reader has to hold in their head:

| The reader needs | Use | It costs them |
|---|---|---|
| Parent **and** child on screen at once — "Europe is behind, and it is Germany" | **Tables, expand/collapse** — a `Category` **list**, positioned with `expansionStates` | rows; the page gets taller |
| To scan many members at one level and spot the odd one | **Small multiples** — a `Group` projection (§5) | space; ~6–12 members before each is too small |
| One level, then *replace* it with the next | **Drill** — the visual's own drill controls | **the parent disappears.** They lose the comparison they were making |
| Everything about the **one** member they picked | **Drillthrough** to a target page (usually hidden) | a click, and a page they must find their way back from |
| A fact or two more about a point, in passing | **Report-page tooltip** (`references/visuals.md`) | nothing — but it is invisible until hovered, so nothing load-bearing goes there |

Four rules follow, and they are the ones a reviewer catches:

1. **Prefer expand/collapse over drill whenever the comparison spans levels.** Drill *replaces* the
   level, so the moment the reader drills into Europe, Americas is gone and the comparison that
   raised the question is gone with it. Zebra Tables can show both — bind the `Category` role a
   **list** of fields and ship the visual already at the level that makes the point, using
   `expansionStates` (see `references/visuals.md`). A page that opens at the right depth beats one
   that makes the reader perform three clicks to reach it.
2. **Do not put a hierarchy on a Chart and expect a hierarchy.** A `Category` list on Zebra Charts
   renders as a **stacked multi-level axis of the leaf members** — every city, with its country and
   region printed underneath — not as a collapsible tree. That is a legitimate and often good form
   for 6–12 leaves, and unreadable at 200. If the message is "which parent is the problem", that is
   a Table, or two visuals side by side.
3. **A drillthrough target is a page, so it obeys every rule in this file.** Give it a comparison,
   not a bare actual: a target carrying one value column ships a Zebra visual without the thing
   Zebra is for. Title it with the member it is showing, and put a **back button** on it
   (`visualLink.type: 'Back'`) — a reader who cannot get back does not use it twice.
4. **Make the way in visible.** Right-click drillthrough is undiscoverable. Put an explicit button
   on the source page (`visualLink.type: 'Drillthrough'` + `drillthroughSection`), and set
   `disabledTooltip` to say what to select — the button is greyed until a point is chosen, and
   without the tooltip that reads as broken.

> **Vary this deliberately.** A four-page pack where every page is a table plus a bar chart and no
> page offers depth at all is the default an agent falls into. So is the opposite — putting drill on
> everything. Pick per question: an overview page usually wants expand/collapse pre-positioned one
> level down; a "who is responsible" page wants small multiples; an investigation page wants
> drillthrough from the one visual a reader will interrogate. If two pages in a report use the same
> depth mechanism for the same reason, one of them probably does not need it.

## 13. One measure, several time frames — reach for a calculation group first

The instinct is to write `AC YTD`, `PY YTD`, `PL YTD`, `FC YTD`, then again for the moving annual
total. That is four measures per time frame per scenario, and every one is a place for the
definitions to drift apart.

A **calculation group** re-times a measure at query time, so it applies to **every** scenario role in
a Zebra visual at once — `Values`, `PreviousYear`, `Plan` and `Forecast` are all transformed by one
item, and the variance columns Zebra derives stay coherent. Write `AC`, `PY`, `PL`, `FC` once. The
grammar is in `references/tmdl.md`; the two shapes worth knowing are here:

- **A page-level toggle.** Bind the calculation group's name column to a slicer and the whole page
  re-times together. ⚠️ Restrict what the slicer **offers** as well as what it selects, or an item
  you added for another page appears as a spurious extra button. **And give it a default selection**:
  with no item selected no item applies, so a title promising *year to date* sits over a plain month
  and nothing on the page says so.
- **Side-by-side time frames.** The `Group` role already turns a field into column blocks; point it
  at the calculation group's name column and each *time frame* becomes its own block, with its own
  full variance set — `Current | YTD | MAT`,
  each showing PY, AC, ΔPY, ΔPY%. This is a complete IBCS time-comparison cross-table from two base
  measures and no extra DAX, and it is the most under-used pattern in this file. Order comes from the
  group's `Ordinal` column via `sortByColumn`, so items appear as you declared them.

When **not** to:

- **Budget the width before you choose it.** Three items × four columns overflows a full-width visual
  into a horizontal scrollbar. Allow roughly 300–350 px per item at four columns each — so two or
  three items across a page, not six. `Group` takes at most 2 projections on Charts and 4 on Tables.
- **A calculation group is not a menu.** Six items in a slicer is a control nobody reads. Two or
  three named for the decision — `Current`, `YTD`, `Full year` — beat an exhaustive time-intelligence
  library.
- ☠️ **If an item changes the measure's *unit* — a share, an index, a per-unit rate — set the number
  format on the Zebra visual, not on the calculation item.** A Zebra visual formats numbers with its
  own engine and does not take its format from a calculation item, so a share authored only as a
  dynamic format string renders as `1.0` where the reader expects `100.0%`. Arithmetically right,
  and wrong on the page.

## 14. Never build these — and what to build instead

A pie, donut, gauge, funnel, treemap, KPI-light or filled map draws a quantity as an angle, an area or
a colour, which a reader compares far less accurately than a length; replace it with a Zebra Table
with bars for a share or a ranking, a variance chart against the target where a gauge was, bars by
stage where a funnel was, and bars by region instead of a coloured map. `validate_report` catches this.


| Do not build | Why | Build instead |
|---|---|---|
| Pie, donut | angles compare badly; one dimension | bars for one period; stacked columns over time; a share column in a table |
| Gauge, speedometer, KPI traffic light | a metaphor for live monitoring, little information per pixel | a tile with the variance; a bar against the target |
| Radar, funnel, treemap, sized icons | the drawn area is not the value | bars; a stage-by-stage variance waterfall for drop-offs |
| Filled map (choropleth) for sales, margin, share | colour by area shows area, not the measure | bars by region; a map only when the question is geographic, with equal bars at points |
| Spaghetti (more than three or four crossing lines) | trends unreadable | small multiples, one line each |
| Two column series on two value axes | the eye compares heights that share nothing | one axis; or amount as columns + ratio as a line |
| Cut axis, broken bar, log axis | the picture contradicts the numbers | zero baseline; size the chart to the data; variance tier; scale band; outlier marker |
| A chart in every card of a KPI row | each tile has its own scale | small multiples, or tiles without charts |
| Stacked with mixed signs or many volatile parts | segments unreadable | grouped, small multiples, a table |
| A line or area down a structure axis | implies a continuum between products | horizontal bars |
| Individually scaled sparklines | small and large swings look alike | one indexed scale, or none |
| A table that repeats the chart's labels | redundant | give it the next level down or more measures, or drop it |
| A period, entity or total typed into a textbox | goes stale silently | a `[Measure]` token |
| Nine business units as nine visuals on one page | unreadable, or a Top N that hides six | a page per unit, a slicer, or small multiples with Top N |
| Decorative colour, gradients, 3-D, shadows, coloured backgrounds | dilutes the colour that means something | flat, grey, white |
| An actual with no reference when one exists | nothing to judge by | bind PY, PL or FC |

## 15. Density — fitting the content to the box the visual actually gets

A visual is legible or it is not, and that is decided by how much content is competing for how many
pixels. Zebra BI exposes that as a handful of properties, and **their defaults are tuned for a
comfortable box**. Put the same content in a narrow or short one and the defaults produce collided
labels, an ellipsised axis and a scrollbar — none of which the JSON shows and all of which the
screenshot does.

So density is a **plan-time decision keyed to numbers you already have**: how many rows, how many
categories, how many pixels. Make it once, deliberately, per visual. What follows are the four
decisions worth making and the arithmetic for each.

### 15.1 Table rows — `categorySettings.rowHeight`

The ladder, from tightest to airiest: `1D` Font sized · `0D` Auto (the default) · `2D` Font sized
×1.1 · `3D` Font sized ×1.5 · `4D` Stretch · `5D` Fixed, which is the only value that reads
`categorySettings.height`.

Work out the body height first — the visual's height less about 30 px of column header, less
another ~24 px if the visual carries a title — then:

| Condition | Choose |
|---|---|
| rows × 28 ≤ body height | `3D` **Font sized ×1.5**. Space is not scarce, so spend it: this is the readable end and it is what makes a table look considered rather than crammed |
| rows × 20 ≤ body height | leave `rowHeight` unset — the default is already the compact end |
| rows × 16 ≤ body height | `5D` Fixed with `height: "16D"` |
| the table exactly fills its box and rows are few | `4D` **Stretch** — the only value that distributes rows to the container instead of ignoring it |
| rows × 16 > body height | **stop compacting.** Cut rows (Top N with a named Others), split the table, or grow the visual |

Keep a table's fixed row height at 16 pixels or more. Under that the data labels and the in-cell
bars share the same pixels: every row is present and none of them can be read, so the table looks
full rather than broken. `validate_report` catches this.

**16 px is a floor, not a target.** At a fixed height of 12 the data labels overlap the in-cell
bars — the rows are all there and the visual is unreadable. Zebra BI's own templates write
`categorySettings.height` only at 21, 24 and 28.

**A scrollbar is a layout defect** (§8), so the ladder is for choosing how to spend space that
exists — never for making unbounded content fit.

### 15.2 Table row rules — `chartSettings.gridlineDensity`

Zebra BI's "gridlines" on a Table are **horizontal rules between rows**, not value gridlines behind
the bars. `gridlineDensity` is *"draw a rule every N rows"*, and it defaults to **5**.

| Rows | Choose |
|---|---|
| ≤ 7 | set `gridlineDensity` higher than the row count. One arbitrary rule after row 5 of six is noise that implies a grouping the data does not have |
| 8–25 | leave it unset. Every fifth row is the banding a reader actually uses to track across |
| > 25, or a dense financial grid | `"5L"` is still right; `"10L"` if the rows are tall |
| a P&L or any table whose rows must be read across many columns | `"1L"` — a rule per row, the classic ledger look |

☠️ **A density larger than the row count silently draws nothing.** The first rule falls at row N,
and on a shorter table there is no row N. That is how a reasonable-looking `10` turns the feature
off without an error.

**Turning them off** on a flat table is `showGridlines: false`. On a table with a **hierarchy** in
`Category` it needs `showMajorGridlines: false` as well, because that second property draws the rule
under a parent row and is doing real structural work — think before switching it off.

### 15.3 Chart axis labels — `categorySettings.axisLabelDensity`

**This is the highest-value legibility setting in the product, and its default is the bad one.**
The default draws every category label and lets them truncate, so sixteen months on a 630 px chart
render as `2013… 2013… 2013… 2014…` — sixteen labels, none of them readable. A Zebra chart that
looks amateurish is usually this.

- **`1D` First and last** — two labels, always readable, always fits. This is the safe answer and
  the right one whenever the axis is a continuous run and the reader needs the span, not the ticks.
- **`2D` Every N-th** with `axisLabelDensityEveryNthLabel` — when intermediate ticks earn their
  place. Aim for **four to six labels drawn**; N unset behaves as about 5.
- **`0D` All** — only when the labels are short and few enough to sit side by side.

☠️ **Choose N so `(category count − 1)` divides by N**, or the last label collides with the one
before it: the final category is always drawn regardless of the step. Sixteen months with `N: "2L"`
puts a label on the 15th *and* the 16th. `N: "4L"` does not.

You will rarely know the rendered label width at plan time. Estimating it is fine as long as it is
treated as an estimate — and when the estimate is close, take `1D`, which cannot overflow.

### 15.4 Chart data labels — `dataLabelSettings.labelDensity`

Four **Auto** tiers thin the labels to the width the chart actually gets, and the enum numbers are
not in density order: `6D` Highest · `9D` High · `8D` Medium · `7D` Low. The default is `6D`.

- **A chart whose width you do not control** — inside small multiples, or a visual that may be
  resized — wants an Auto tier. Step down `6D` → `9D` → `8D` → `7D` as the points-per-pixel rises.
- **A chart making one point** wants `3D` First, last or `5D` First, last, min, max. Labelling the
  extremes and the ends is §10's "do not label every point of a dense line", made mechanical.
- **`0D` Full is not the default and is rarely right.** It is the one value that guarantees
  collisions, because it labels all of them however narrow the chart is.
- `1D` None only where a value axis or a table beside it carries the numbers.

### 15.5 One property changes the whole look — `designSettings.style`

`0D` Zebra (the default), `1D` Zebra Light, `2D` Dr. Hichert, `3D` Power BI. Same bindings, same
numbers, four different characters: Zebra Light trades the dark actual bars for pale ones and reads
much airier at high density; Dr. Hichert uses olive variances and square relative-variance markers;
the Power BI style uses teal. Pick one for the report and hold it on every visual — §8's
consistency rule applies to style before it applies to anything else.

☠️ **`4D` Custom is the gate for every colour property, and passing through it is not free**: with
no `neutralColor` set alongside, the actual bars render black. If a visual goes Custom to unlock one
colour, set the base colour in the same block.

## 16. The design check, before the first render

Say each answer out loud in the plan; a reviewer will ask them in this order.

1. Every visual on the page has a question in the plan and answers it; no visual is there because
   the data existed.
2. Time is on a horizontal axis, structure is vertical; no line down a structure axis; no time as
   table rows unasked.
3. Every visual that can carry a comparison does, with the polarity set for cost-type measures.
4. Amounts are full columns, ratios and relative variances are pins; absolute variances share the
   base scale.
5. Depth is a choice, not a habit: every page that offers detail says which of expand/collapse,
   small multiples, drill, drillthrough or a tooltip it uses and why, and no two pages use the same
   one for the same reason. A hierarchy that must show parent and child together is a Table, not a
   Chart.
6. Any drillthrough target carries a comparison, names its member in the title, and has a back
   button; its way in is a visible button with a `disabledTooltip`, not a right-click.
7. A repeated time frame is a calculation group, not a second set of measures — and if an item
   changes the unit, the format is set on the visual.
8. No waterfall where the message is not "from A to B"; the difference highlight is off wherever
   the endpoints are not comparable.
9. Zero baselines; same unit → same scale on the page; no axis break unless argued; no chart in a
   card unless the card is read alone.
10. Member counts: Top N with a named Others where the box cannot show them all; small multiples
   above three or four crossing series; nothing scrolls.
11. Sort: time chronological; structure per the analysis; the same order for the same dimension on
   every visual and page; remainder last.
12. Layout: header band 0–64, first content at 64–74, edges at 1280 and 720, no overlap, one
   question per page, the KPI row on top. **Nothing is cropped from the bottom**: every textbox is
   at least `ceil(pt × 1.45 + 12)` tall, and every slicer that shows its header — which is every
   slicer you did not explicitly turn it off on — is at least 52.
13. Titles describe (who, what with unit, when) and evaluate nowhere; the key message is one
    sentence at the top with a quantity; at least one element highlights its evidence.
14. Labels: at most three digits in charts and four in tables, one unit per visual, same decimals,
    horizontal, integrated; no legend box; no rotated axis labels.
14b. **Density was decided, not defaulted (§15).** Every Table says why its row height and its row
    rules are what they are, and no fixed row height is below 16. Every Chart on a time axis with
    more than about eight categories sets `axisLabelDensity`, with N chosen so the last step lands
    on the last category. Every Chart narrower than its point count sets an Auto label-density tier
    rather than leaving `0D` Full to collide. One `designSettings.style` across the report.
15. Colour only on variances and scenario patterns; the rest grey; the same colour means the same
    thing everywhere; nothing decorative.
16. Nothing from the never-build table; no native pie, gauge, funnel, treemap, KPI light or filled
    map — the validator flags these, but it cannot see the other faults in this checklist, and the
    screenshot is still the only evidence.


