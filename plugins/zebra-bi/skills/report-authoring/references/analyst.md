<!-- Summary: The analyst layer — who the report is for and what they decide from it, which comparison answers which question, which period the page is about, the sign and polarity check, what a seasoned analyst knows about each report family, the decompositions that explain a variance, and how to hand the report over. Read at plan step 0, before profiling; return to §8 when you deliver. -->
# The analyst — reader, decision, comparison, period, domain

The rest of this skill tells you how to write a correct Zebra BI visual and, in `references/design.md`,
which form to give it. This file is about what the report is *for*. A page can be bound right,
verified against the model, laid out on the grid, and still be the wrong report, because it answers
the question the data made easy instead of the one the reader has. Two failures live here, and both
are invisible to every check in the loop: the technically correct report nobody asked for, and the
genuinely interesting finding delivered to a reader who needed a different one.

Read it once, at plan step 0, before you profile anything. In autonomous mode you do not stop to ask
these questions: you infer the answers from the data, the file names and the request, state them in
the delivery, and let the reader correct you. In work-with-me mode you ask them, once, together, and
never more than the four in §1. Either way the answers are written into the plan, because every later
step — which dimensions matter, which comparison, which period, which polarity — reads from them.

## 1. The brief — four questions, each with a default

| Ask | Why it changes the report | Default when nobody answers |
|---|---|---|
| **Who reads it, and what do they decide from it?** | A board wants five numbers and one message per page; a cost-centre manager wants their lines against budget; a sales manager wants who is behind and by how much. Same data, three different reports. The *decision* fixes the KPI row, the structural cut and how deep the depth mechanism goes | The manager who owns these numbers, reviewing them monthly to decide where to act. Title the pages for that reader |
| **What cadence, and which period is the page about?** | Monthly management reporting is about the last closed month **and** the year to date; a weekly operations page is about last week against the run rate; a board pack is about the year and the full-year outlook. The period fixes the slicer default, the time axis and which time-intelligence measures you write (§3) | The last complete period in the data, with year to date beside it; slicer defaulted to that period's year |
| **Which comparison matters to them?** | Against plan says *are we delivering what we committed*; against last year says *are we growing*; forecast against plan says *will we land the year*. A reader who holds a budget reads ΔPL first; a reader who steers a business reads ΔPY first; both want both when both exist (§2) | Every comparison the model can honestly carry, plan first if there is a plan, previous year first if there is not — and an explicit line saying which the page leads with |
| **Conventions** — polarity, unit, currency, fiscal year, vocabulary | A cost report coloured like a revenue report is wrong on every visual; a fiscal year starting in April makes every calendar-year YTD wrong; a reader who says *Budget* and *Last Year* should not meet *PL* and *PY* as headers; a model in thousands displayed as units is out by a thousand | Polarity from the measure family (§4); unit chosen so a cell carries three or four digits; fiscal year = calendar year unless the calendar table or the plan says otherwise; the reader's own words for scenarios in `legendHeaderSettings` |

**How to infer them when you cannot ask.** The data usually says who it is for: a ledger with an
account scheme is for finance; an opportunities table with stages and owners is for a sales manager;
headcount by org unit is for HR or a business-unit head. The request says the cadence — *board*,
*monthly review*, *my team*, *weekly* — and the file or folder name often names the audience.
A `Budget` or `Plan` column tells you which comparison they hold themselves to. A calendar table
with a `Fiscal Year` column, or a plan whose months start in April or July, tells you the fiscal
year. **Write each inference down as an assumption in the plan and repeat it in the delivery**, in
one line each: *"I built this for a monthly management review, led with plan, calendar fiscal year;
tell me if any of those is wrong and I will re-cut it."*

**What you must not do** is turn this into an intake form. Four questions, asked together, in
work-with-me mode only. An autonomous run that stops to ask who the reader is has misread the mode.

### 1b. Before you trust the data — six checks a seasoned analyst runs on every source

The profiling step counts members and periods. These six ask whether the numbers can be believed, and
each one, missed, ships as a visible defect a reader spots in the first minute. On flat files,
`profile_source` runs all six in one call and adds the §3 signals — fiscal year, last complete
period, drifting posting dates, scenario coverage; against a live model each is one query
(`references/verify-loop.md` has the connection; `references/dax.md` the semantics). Each has a fix
that is chosen once, in the plan.

| Check | Query shape | What it does to the page if missed | Fix |
|---|---|---|---|
| **Orphan keys** — fact rows whose dimension key has no match | `COUNTROWS(FILTER(Fact, ISBLANK(RELATED(Dim[Key]))))` | a **(Blank)** row in every Zebra Table on that dimension, often the largest row; a chart series with an unnamed member | fix the relationship or the key; if the rows are genuinely unassigned, give them a member named *Unassigned* in the dimension, never a blank |
| **Future-dated rows** — postings after the real close | `MAX(Fact[Date])` against today and against the plan horizon | *last data date* lands in the future, the period label lies, YTD runs past the close, and the current month shows a stub of a stub | filter the calendar's *last data date* measure to dates with substantive volume; report the stray rows |
| **Duplicates** — the same transaction twice | `COUNTROWS(Fact)` vs `COUNTROWS(DISTINCT(Fact[Id]))`, or a `SUMMARIZE` on the natural key | every total is high by the duplicate share, every variance with it, and the page reconciles to itself | de-duplicate in the query or flag it; never fix it with a divided measure |
| **Reconciliation to a known total** | one `SUM` against a figure the reader already trusts — a statutory total, last month's pack, the source workbook's own total row | a report the reader disbelieves in the first minute and never reads again | find the difference before you build; a source total row loaded as data is the commonest cause and is a duplicate of everything |
| **Sign and unit consistency** | `MIN`/`MAX` per account or measure; a sample of values against the source | costs signed one way in actuals and the other in the plan, a plan in thousands beside actuals in units | §4 for the sign; scale the measure once in DAX and say the unit in the title |
| **Grain mismatch across sources** | the same key at two grains — plan by quarter against actuals by month, budget by cost centre against ledger by account | a monthly ΔPL that is nonsense for two months and right in the third | compare at the coarser grain, and say so in the title; never spread the coarse one evenly and call it a monthly plan |

Report what each check found in the same message as the profile, in one line per check, including
*"none found"* — a reader who sees the checks were run trusts the numbers that follow.

## 2. The comparison grammar — which pair answers which question

Zebra BI draws a variance from the pair of roles you bind, so choosing the comparison *is* choosing
what the page says. Every pair answers exactly one question, and each is honest under conditions you
can check before you bind it.

| The reader asks | Bind | It is honest when | It lies when | Notes |
|---|---|---|---|---|
| **Are we growing?** | `Values` = AC, `PreviousYear` = PY | both windows are the same length and the perimeter is the same (same entities, same product set, same currency basis) | the current period is partial and last year's is full; an acquisition, disposal or reorganisation changed what is being compared; prices or FX moved and nobody said so | The default comparison when there is no plan, and the second comparison when there is. Never omit it because a plan exists |
| **Are we delivering what we committed?** | `Values` = AC, `Plan` = PL | the plan was set for this period at this perimeter and is phased the way the business actually runs | the plan is spread evenly across twelve months while actuals are seasonal (every summer month "misses"); the plan was re-based mid-year and the file still holds the original | The lead comparison for anyone who holds a budget. Say in the title which plan version it is if there are several |
| **Will we land the year?** | `Values` = full-year outlook (AC to date + FC for the rest), `Plan` = full-year PL | the forecast covers exactly the months after the last actual, and both sides are the whole year | the outlook double-counts a month that has both an actual and a forecast; the forecast is stale (made before the latest close) | The board's question. One KPI tile or one row, not a whole page: *"Outlook 12.4M vs plan 12.0M, +3%"* |
| **Was the forecast any good?** | `Values` = AC, `Forecast` = the forecast made at the time | the forecast is the one that was current before the period closed, not a later re-forecast | the "forecast" column is really a rolling re-plan updated with actuals, so it agrees with AC by construction | Polarity is neutral: a big miss in either direction is bad. Colour it neutral (the neutral band in `references/formatting.md`) or show absolute deviation, or the page rewards over-cautious forecasting |
| **What is the momentum?** | `Values` = AC, `PreviousYear` = **prior period** (a prior-month or prior-quarter measure, bound to the same role) | the measure is a run rate without seasonality — MRR, headcount, cash balance, open pipeline | the flow is seasonal (retail, travel, energy, anything with a year-end), so month-on-month is mostly calendar | Rename the header — `legendHeaderSettings` for the scenario — because the role's default label says previous **year** and the column would be lying |
| **How do we compare with the rest?** | `Values` = the member's measure, `Plan` = a selection-wide benchmark of the same measure | the benchmark is computed under the same filters and guarded so members with no rows stay blank | the benchmark returns for every member (the resurrected-members fault named in SKILL.md, cold-start check 4b) | The comparison that survives when the time axis cannot carry one |
| **Are we above the line?** | `Values` = AC, `Plan` = a target, threshold or service level | the target is one the reader is accountable for and is constant or phased explicitly | a threshold is presented as a plan (a 95% service level is not a budget) | Common in operations, quality and HR. Say *target* in the header, not *plan* |

**When both plan and previous year exist, bind both.** ΔPL without ΔPY lets a soft plan look like a
good year; ΔPY without ΔPL lets a good year hide a missed commitment. The reader needs both to
judge either. **Exist means exist for the same periods.** Check the coverage of each scenario
before you promise a comparison: a budget that stops two years before the actuals, or that covers
six of nine entities, or that ends at operating profit, exists in the model and not on the current
page. Then the current pages carry ΔPY, the plan gets its own page scoped to the window and
perimeter it covers with both printed in the title, and the handover says why — a plan bound where
it does not reach renders as a blank column that reads like a miss. Column order is scenarios in time order (PY · PL · AC) then the variances, the lead
comparison's variance first (`references/design.md` §3); the KPI row carries the same pair.

**Month and year to date belong side by side**, because they answer different questions about the
same number: a month far from plan with a year to date close to it is a timing difference — an
invoice booked early or late — and not a performance one. A page that shows only the month invites
a false alarm every quarter-end; a page that shows only the year to date hides the month the reader
is actually reviewing. A Zebra Table carries both as two column blocks from one calculation group
bound to `Group` (`references/design.md` §13), which is also how the definitions stay identical.

## 3. Which period the page is about

**The default period is the last complete one in the data**, not the current calendar month and not
"all". A month with three days of postings is not a month; find the last period whose coverage matches
its neighbours (the coverage-per-period query in the enumeration set) and make it the slicer's
default. Say which it is in a `[Period label]` measure token, never in typed text.

**Year to date, rolling twelve months, full-year outlook.** Three time frames, three questions, and a
seasoned analyst offers the one the cadence calls for rather than all three:

| Frame | Answers | Measure shape | Use when |
|---|---|---|---|
| **Year to date** | how the year is going so far | `TOTALYTD([AC], 'Calendar'[Date])`, with the fiscal year-end as the third argument when the year is not calendar (`"03-31"`) | any monthly management page; always beside the month |
| **Moving annual total** (rolling 12) | the underlying run rate with seasonality removed | `CALCULATE([AC], DATESINPERIOD('Calendar'[Date], MAX('Calendar'[Date]), -12, MONTH))` | trend pages, anything seasonal, anything where the fiscal-year reset would hide the shape |
| **Full-year outlook** | where the year lands | actuals up to the last closed period plus forecast for the months after it, both filtered on the calendar, never summed over overlapping months | board and steering pages, together with the full-year plan |

Write the base measures once (AC, PY, PL, FC) and re-time them with a **calculation group**, so
every scenario role moves together and Zebra's variance columns stay coherent — the grammar is in
`references/tmdl.md`, the design choice in `references/design.md` §13. Check every time-intelligence
measure with `EVALUATE` against the open model before you launch (`references/dax.md`): the moment a
window is off by a month, every variance on the page is confidently wrong.

**The fiscal year is a question you ask, or infer, before you write the calendar.** Many organisations
close their year in March, June or September, and every year-to-date, every year slicer and every
"previous year" then follows the fiscal calendar, not the civil one. Signs: a plan whose months run
April to March; a `Fiscal Year` or `FY` column anywhere; a year label like `FY25` or `2024/25`. When
the year is fiscal, the calendar table needs `Fiscal Year` and `Fiscal Period` columns, the year
slicer binds the fiscal year, and `TOTALYTD` takes the year-end date. One shape that works, named
for the calendar year in which the fiscal year **ends**, which is the commoner convention — say
which one you used, because some organisations name it for the start year:

```dax
Fiscal Year = YEAR(EDATE('Calendar'[Date], MOD(13 - <FY start month>, 12)))
Fiscal Period = MOD(MONTH('Calendar'[Date]) - <FY start month>, 12) + 1
```

A fiscal year of April gives `MOD(9, 12)` = 9, so March 2025 lands in FY2025 and April 2025 in
FY2026. The `PreviousYear` role is unaffected — `DATEADD(..., -1, YEAR)` shifts twelve months
whatever the year is called — but every label, slicer and YTD is.

**A fiscal column in the source's date table is the answer, not a curiosity.** When the source ships
a date dimension with `FiscalYear` or `FiscalQuarter` columns, read which month the fiscal year rolls
over in and whether it is named by its start or its end year, and use that — do not infer "calendar"
while the column sits in the folder. And when you replace that date table with your own calendar
(because the postings drift around month end, or because it is not marked as a date table), **carry
its fiscal columns across**: the fiscal year does not stop existing because you rebuilt the
calendar, and dropping the source table is how two careful builds on the same ledger both shipped a
calendar-year YTD over a July fiscal year and never noticed.

**A stock is not a flow, and the period means something different for each.** Revenue, cost, cash
flow, hires and orders are *flows*: they happen *during* a period and add up across periods. Cash,
debt, headcount, open pipeline, inventory and receivables are *stocks*: they exist *as at* a date, and
adding them across months is meaningless. A stock is compared with its own earlier snapshot (the
balance a year ago, the pipeline last week), not with a period total, and a year slicer set to a
past year does not filter it — it either shows the balance as at that year's end or it should not
respond at all (`visualInteractions` set to `NoFilter`, and the title saying *as at*). The trap and
its mechanics are in SKILL.md under the slicer rules; the decision belongs here, in the plan.

**The source's own fiscal column can be wrong, and then it is derived, not bound.** A date table
whose fiscal year is named by its end year up to one point and by its start year after it — one
widely used sample warehouse does exactly this — cannot be bound as it stands: a year slicer on it
puts the same July in two different years. `profile_source` reports the switch; the fix is to
derive the fiscal year from the date with the `YEAR(EDATE(...))` formula and one stated convention,
and to say in the handover that the source column was set aside and why.

**Postings that drift around month end are periods, not dates.** A ledger that posts once per
period, on the 27th of one month or the 1st of the next, gives calendar months with zero postings
and months with two, and every monthly comparison built on the calendar month is then wrong in a
way that reconciles perfectly. Do not shift the dates by a guessed number of days. The period is
the source's own period key where one exists (a `DateKey`, `Period` or `FiscalPeriod` column, or
the date table's month); where none does, the rule you choose is stated in the plan together with
its control — exactly one posting per period, twelve per full year — and the fact joins the
calendar on the derived period, never on the posting date.

**Partial periods are marked in the encoding.** The current month with a week of postings, a
previous year with four months of data, a forecast that starts mid-quarter: every one is a
like-for-like problem, and a caveat in a footnote does not fix it. Either restrict the comparison to
the comparable window (the like-for-like measure in `references/recipes.md` recipe 7), or turn off the
difference highlight and neutralise the variance colouring for the partial point, or leave the
comparison off that visual. The reader takes the colour first and the footnote never.

## 4. Sign and polarity — read the data's convention before you set `invert`

Two separate facts, and a wrong report needs only one of them wrong.

**How are costs stored?** In a ledger export, costs are often *negative* numbers so that the
accounts sum to profit; in a budget workbook they are usually *positive* amounts under a cost
heading. Check with one query before you write a measure: if `SUM` of a cost account is negative,
the data is signed. Then decide the presentation once for the whole report:

- **Signed scheme** (revenue positive, costs negative, subtotals sum): the income-statement form,
  rows in calculation order, result rows marked with `CategoryClass` (`references/recipes.md`
  recipe 1). Nothing is inverted, because a "cost went up" is already a more-negative number and
  Zebra colours the variance by its arithmetic effect on the total.
- **Unsigned amounts** (every measure positive, costs shown as the cost they are): the cost-centre and
  KPI form. Here polarity must be *told* to the visual — `chartSettings.invert` on Charts and Tables,
  `card.cardDefaultInvert` on Cards — or a cost overrun renders green.

Flipping the sign in DAX (`-SUM(...)`) to move between the two is legitimate; doing it for some
measures and not others on one page is how a scheme stops adding up.

**Which way is good?** Decided per measure family, applied to every visual that carries the measure,
and stated in the plan. The family, not the number, decides:

| Up is good | Up is bad | Neither — both directions are findings |
|---|---|---|
| revenue, order intake, gross margin, margin %, EBIT, cash, free cash flow, NRR, win rate, conversion, on-time delivery, yield, OEE, coverage ratio, NPS | cost, opex, COGS, cost per unit, headcount *cost*, churn, attrition, DSO, DIO, cycle time, lead time, defects, scrap, incidents, discount %, CAC, days late | headcount vs plan (over *and* under are problems), inventory vs target, forecast vs actual, working capital vs target, utilisation near capacity |

For the third column, colour is a lie in either direction: use the neutral formatting or show
absolute deviation, and say why in the title. For a page that genuinely mixes the first two columns
— a P&L in unsigned form, revenue rows over cost rows — the polarity split has to be the `Group`, or
the per-row lever on Tables (SKILL.md, the three levers); one `invert` for the whole visual cannot
express it. **Before you finish, list every visual that binds a comparison and say its polarity out
loud** — the check is in SKILL.md and it is the one that catches the red-in-tables, green-in-cards
report.

## 5. What a seasoned analyst knows about each report family

Eleven families cover most of what people ask for. Each row is the analyst's prior: who reads it,
what they are trying to decide, the five or six numbers they look at first, the cut that explains them,
the comparison that is honest, the polarity, and the mistake that ships most often. Use the row as the
starting hypothesis for the plan, then let the enumeration (SKILL.md plan step 2) confirm or overturn
it — a prior is not a template.

| Family | Reader, decision | KPI row | Structural cut | Comparison | Polarity | The trap that ships |
|---|---|---|---|---|---|---|
| **Income statement / P&L** | finance and business-unit leadership, monthly: where to act on margin | Revenue · Gross margin · GM % · Opex · EBIT(DA) · EBIT % | the account scheme as rows; business unit, segment or entity as columns or a slicer | AC vs PL **and** PY, month **and** YTD | signed scheme, or per-row for cost rows | ratios averaged instead of recomputed at the total; a computed subtotal counted again in the grand total; costs signed one way in the ledger and the other in the plan |
| **Cost centre / opex** | the budget holder, monthly: where spend is running away | Total cost · ΔPL · ΔPL % · headcount · cost per FTE · full-year outlook vs budget | cost type × cost centre; Top N cost types with *Other* | AC vs PL YTD; outlook vs full-year PL | inverted, whole report | a month under budget that is an unposted invoice (show YTD beside it); one-off items read as run-rate savings |
| **Sales revenue** | sales leadership, monthly or weekly: where to push, whom to help | Revenue · ΔPY % · ΔPL % · volume · average price · margin % | region, segment, product line, rep; Top N customers with *Other* | AC vs PY and PL | up is good | a revenue-only page that never shows margin, so a loss-making segment reads as a success; revenue and pipeline mixed on one axis (different tenses) |
| **Sales pipeline / CRM** | sales managers, weekly: which deals to work, is coverage enough | Open pipeline · weighted pipeline · coverage (pipeline ÷ remaining quota) · win rate · average deal · cycle length | stage × owner × segment; age bands | **vs the prior snapshot** and vs quota, not vs PY | coverage and win rate up good; cycle length up bad | a snapshot sliced by a historical year goes blank; win rate averaged across reps instead of weighted by deals; a funnel visual where bars by stage were wanted |
| **Cash flow** | CFO and treasury, monthly: liquidity and where cash is tied up | Operating cash flow · free cash flow · closing cash · DSO · DPO · DIO · cash conversion cycle | the cash scheme (EBITDA → working-capital movements → capex → FCF) as a vertical bridge | AC vs PL and PY | cash in good; DSO, DIO up bad | outflows shown positive in a scheme that is meant to sum; cash conversion metrics computed from averages of ratios |
| **Balance sheet** | CFO and board, quarterly: leverage, working capital, solvency | Net debt · net debt ÷ EBITDA · equity ratio · working capital · cash | the statement's own scheme as rows | **as-at vs prior period-end and vs PY period-end**, never a period total | debt up bad, equity up good | balances summed over months; a year slicer treated as a range instead of a date |
| **Headcount / HR** | HR and business-unit heads, monthly: capacity and cost of people | FTE · hires · leavers · attrition % · cost per FTE · open vacancies | org unit × job family; tenure or grade bands | FTE vs planned FTE; attrition vs PY | headcount *cost* and attrition up bad; FTE vs plan neutral | FTE (a stock) and hires/leavers (flows) on one axis; attrition averaged across small units |
| **Marketing / funnel** | marketing and growth, monthly: where the money converts | Leads · qualified leads · conversion % by stage · CAC · spend · pipeline sourced | channel × campaign; stage as columns | AC vs target and PY | conversion up good; CAC up bad | an attribution change that makes PY non-comparable; tiny bases producing huge relative variances (show absolutes, use the neutral band); a funnel shape instead of bars |
| **Operations / production / quality** | plant and operations managers, daily or weekly: is the line on target | Output · OEE · yield · scrap % · on-time delivery · lead time · incidents | line, plant or shift as small multiples on one scale | AC vs target and PY | scrap, lead time, incidents up bad | a threshold presented as a plan; different scales per plant that hide the worst one |
| **Projects / portfolio** | PMO and sponsors, monthly: which projects are in trouble | Budget · spend to date · estimate at completion · ΔEAC vs budget · % complete · milestones due | project as rows; workstream beneath (expand/collapse) | spend vs budget (`Plan`); EAC vs budget (`Forecast`) | cost up bad | % complete and % spent read as one measure; a project's EAC missing so it reads as on budget |
| **SaaS / subscription** | founders, CRO, board, monthly: is the run rate compounding | MRR or ARR · net new MRR · NRR · GRR · logo churn · CAC payback | plan, segment, cohort; the MRR bridge (opening → new → expansion → contraction → churn → closing) | **month on month is legitimate here**, plus PY | churn up bad | MRR (a month-end stock) summed over months; the bridge drawn as a stacked column; cohort retention as one spaghetti chart instead of small multiples |

Three shapes recur across the table and are worth naming, because each maps to one Zebra form:

- **A scheme** (P&L, cash flow, balance sheet) is a **Table** in calculation order with result rows,
  or a vertical **Charts** waterfall when the message is *how the total was built*.
- **A ranking with a remainder** (customers, products, cost types, reps) is a **Table** sorted by the
  measure with Top N and a named *Other*, bars in the value column.
- **The same shape per member** (plants, regions, cohorts) is **Charts** small multiples on one shared
  scale, `Group` = the member.

## 6. Explaining a variance — the decompositions a reader will ask for

A variance is a number; an explanation is what the reader came for. Five decompositions cover most
*why* questions, and each one becomes a bridge on a **structural** axis — the drivers as the steps —
which is exactly the plan-bridge form `references/design.md` §2 reserves for non-time axes.

| Decomposition | Splits a variance into | Arithmetic (one convention; say which you used) | Build |
|---|---|---|---|
| **Price × volume** | how much came from selling more, and how much from selling dearer | volume effect = (Q₁ − Q₀) × P₀ · price effect = (P₁ − P₀) × Q₁ | a driver table with one row per effect and a `SWITCH` measure per driver (`references/recipes.md` recipe 6 has the disconnected-table pattern); Charts waterfall, `Category` = driver |
| **Rate × mix** | whether a ratio moved because the members changed or because their weights did | rate effect = Σ share₁ × (m₁ − m₀) · mix effect = Σ (share₁ − share₀) × m₀ | the same driver-table pattern; the mix-shift query in the enumeration set is the test that says this decomposition is needed |
| **Like-for-like × perimeter** | organic change from acquisitions, disposals, new and lost customers, new stores | existing members in both periods vs members present in only one | a member-status column (existing / new / lost) as `Group`, or three measures; the comparable window for partial periods is the like-for-like measure in recipe 7 |
| **Constant currency** | performance from exchange-rate movement | restate the current period at the prior period's rates | needs a rate table with a period and a currency; **without one the multi-currency total must not be computed at all** (`references/model-layer.md`) |
| **Recurring × one-off** | the run rate from items that will not recur | tag one-offs in a category and show the underlying series beside the reported one | a flag column, two measures, both bound; the one-off named in a comment on the point |

**The like-for-like perimeter is two calculated columns and one filter.** The entity dimension
learns when each member first posted, and a status follows from it; every measure then has a
like-for-like twin that filters on the status. Verified against an oracle on a ledger where one
division joined eleven months into the comparison window:

```dax
First period = CALCULATE ( MIN ( Fact[Period] ) )                       // calculated column, entity dimension
Status = IF ( ISBLANK ( [First period] ), BLANK (), IF ( [First period] > <PY window start>, "New", "Existing" ) )
Operating profit AC LFL = CALCULATE ( [Operating profit AC], Entity[Status] = "Existing" )
```

Bind the LFL pair to `Values` and `PreviousYear` on the like-for-like visual and the reported pair
on the one beside it, and say in the title which members the perimeter excludes and why. A member
that *left* is the mirror: a `Last period` column and a `Lost` status.

And the one that is not a decomposition but is asked as often: **timing.** A month against plan that
the year to date does not confirm is timing, not performance, and the side-by-side month/YTD block
in §2 is how you show it without a word of prose.

**Ratios are recomputed at the total, never averaged.** Margin % for the company is total margin over
total revenue, not the mean of the segments' percentages; a win rate for the team is won over closed,
not the average of the reps' rates. A DAX measure does this by construction when it is `DIVIDE` of two
sums; a Zebra Table computes a ratio row from its own rows through `categoriesMetadata.addedFormulas`
(`references/recipes.md` recipe 1), and a ratio *column* from two `Values` measures. What you never
do is aggregate a column that is already a percentage.

## 7. From finding to message — materiality, cause, rank

**A variance is a finding when it is material by more than one yardstick.** Three, and a seasoned
analyst checks all three before writing a sentence:

- **Relative to its own base** — beyond the threshold the reader uses to act. Five or ten percent
  is a common management convention; say which you used, and do not colour smaller moves as if they
  were findings (the neutral band in `references/formatting.md` exists for exactly this).
- **Relative to the total** — does it move the page's headline number? A 40% rise in a line that is
  one percent of cost is a curiosity; a 3% move in the largest line is the story.
- **Relative to its own history** — is it outside the month-to-month noise of that measure? A line
  that swings ±15% every month has not moved when it moves 10%.

**Rank the findings by their effect on the total, then by direction against it.** The biggest
absolute contributor to the headline variance goes first. Then the members moving *against* the total
— the segment shrinking while the company grows, the cost rising while the rest fall — because
those are what the total hides, and they are the comment triggers SKILL.md plan step 3c names.

**A cause is a claim; test it once before you write it.** The story sentence has to survive *what
would have to be true for this to be wrong?* (SKILL.md plan step 2). The usual ways a right number
carries a wrong cause: a mix shift read as a performance change (§6 has the arithmetic that tells them
apart); a timing difference read as a miss (month vs YTD); a perimeter change read as growth; a
partial period read as a collapse. Where two readings survive and the choice turns on business context
you do not have, that is the escalation case in SKILL.md — say both and ask.

**Then write the message the way `references/design.md` §9 says**: one sentence, at the top, with a
quantity and a verb, the cause where the data supports one, and at least one element on the page
pointing at the evidence.

### 7b. The arc of a multi-page report

A pack is read in order, and the order is the argument. When the plan derives more than one page
(SKILL.md plan step 3b), arrange them so a reader who stops after any page has the most important
thing they could have learned by then:

1. **The overview** — the KPI row, the message sentence, and the one visual that proves it. A
   reader who reads nothing else has the answer.
2. **The driver pages**, in the order of the story — the cut that explains the headline first
   (margin by segment if margin is the story), then the next-largest cause. Each page's title
   names the question it answers.
3. **The detail and lookup pages** — the full income statement, the customer list, the reps: tables
   a reader consults rather than reads, pre-positioned at the level that matters
   (`expansionStates`), with Top N where the list is long.
4. **Definitions and source** — a short last page or a footnote block: how each non-obvious measure
   is computed (*gross margin = revenue less cost of sales; NRR = …*), the plan version, the source
   system and the extraction date as a measure token. Static text is right here, because none of it
   comes from the data that moves.
5. **Hidden pages last** — drillthrough targets and tooltip pages, hidden from the tab bar, each
   with its back button (`references/design.md` §12).

**Name every tab for its question**, in two or three words a reader would say — *Overview*, *Margin
by segment*, *Cost centres*, *Pipeline* — never *Page 1* or the name of the visual on it. The tab
bar is the table of contents, and it is the first thing a reader sees after the title.

**Interactions are a decision, not a default.** Power BI cross-filters every visual on a page from a
click on any other. That is usually right between a table and the chart beside it, and usually
wrong from a table onto the KPI row (the headline should not change because someone clicked a row)
or onto a stock, a benchmark or a page-level bridge. Set the page's `visualInteractions` for the
pairs where a click would mislead, and leave the rest.

**The slicer set is the same on every page, in the same place, with the same default** (SKILL.md,
the slicer rules), and whether a selection follows the reader across pages is decided once, not
discovered.

## 8. The handover — what you say when you deliver

The delivery message is part of the report. A reader who cannot tell what was decided, what was
checked and what to doubt will either trust everything or nothing. Twelve lines, in this order, and
every one of them is already in the plan:

1. **The story, one sentence per page**, with the headline quantity.
2. **The page list and the count**, with the reason for the count (SKILL.md plan step 3b).
3. **What you did not build and why** — the dimensions with no signal, the comparisons the data
   cannot carry honestly, in one line each.
4. **The brief you assumed** (§1): reader, cadence and period, lead comparison, fiscal year,
   polarity, unit and currency. One line, phrased so a wrong assumption is a one-word correction.
5. **What was verified, and how**: which headline figures were checked against the model with
   `EVALUATE` and what they returned; which pages were screenshot; the coverage per period you found.
   A structural pass, a clean render and a number that matches the model are three different claims —
   name the one you reached for each figure.
6. **The caveats that change how a number should be weighed**: partial periods, non-comparable
   sets, a plan version, a benchmark used in place of a prior year. Each of these is *also* in the
   encoding; the line here says where.
7. **The visual track**: Tables+ and Charts+ by default, with the one-line offer to switch
   (`references/visuals.md`).
8. **How to steer**: *"I decided the structure — say 'work with me' to steer it step by step."*
9. **Where the slicers are and what the defaults mean**, in one line, so the first thing the reader
   does is not to change a filter and lose the story.
10. **How to read the notation**, for a reader new to it — three lines, once per report, and worth
    every word because it is what makes the report legible without you:
    > AC is actual, PY previous year, PL plan, FC forecast. Dark bars are actuals, light bars last
    > year, outlined bars plan, hatched bars forecast. Δ is the difference, Δ% the relative one;
    > green is good for the business and red is bad whatever the sign, so a cost rise is red. Thin
    > pins are percentages, full bars are amounts, every bar starts at zero, and every visual's bars
    > share one scale.
11. **What to look at first**: the one page, or the one visual, that carries the finding you would
    open with in the meeting.
12. **The findings file**, if anything in the session disagreed with this skill (SKILL.md, the last
    section before the non-negotiables).

Keep it to those lines. A delivery message that is longer than the page it describes has replaced
the report with a memo.

## 9. The analyst check, before the plan is final

Answer each in the plan; a reviewer who knows the business will ask them in this order.

1. The reader and the decision are named, and every page's title would make sense to that reader.
2. The period the page is about is the last complete one, defaulted on the slicer, labelled by a
   measure token; year to date sits beside the month on any monthly management page.
3. The fiscal year has been asked or inferred, and every YTD, year slicer and year label follows it.
4. Every comparison the model can honestly carry is bound; where plan and previous year both exist,
   both are shown, and the plan says which one leads.
5. Each comparison passes its honesty conditions in §2 — same window length, same perimeter, a plan
   phased the way the business runs, a forecast that is not a re-plan.
6. Stocks are compared as-at with earlier snapshots and do not respond to a period slicer as if
   they were flows; the title says *as at*.
7. The sign convention of the data is known, the presentation (signed scheme or unsigned amounts)
   is chosen once, and polarity is set per measure family on every visual that binds a comparison —
   including the Cards.
8. Ratios are recomputed at the total and never averaged; every ratio has its volume beside it or
   sorting it.
9. The report-family prior (§5) was used as a hypothesis and then confirmed or overturned by the
   enumeration — the KPI row is the reader's five or six numbers, not the first six measures found.
10. Every headline variance has been tested against the decompositions in §6 that could explain it
    away — mix, timing, perimeter, currency, one-offs — before its cause is stated.
11. Findings are ranked by effect on the total and by direction against it; nothing below the
    materiality yardsticks is coloured or commented as if it mattered.
12. The delivery message has the twelve lines in §8, including the assumed brief and the reading
    guide.
