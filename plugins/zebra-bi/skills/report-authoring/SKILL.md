---
name: report-authoring
description: >-
  Plan, author and verify Zebra BI reports (Tables+, Charts+, Cards, certified Tables and Charts)
  in PBIP/PBIR from the terminal: frame the reader and the comparison (analyst layer), choose
  visual form, size, scale and sort (IBCS design layer), write the TMDL model, then bindings,
  variance semantics, formatting, small multiples, comment layers, pre-flight and the screenshot
  verify loop. Use when creating or editing a Power BI report with Zebra BI visuals, building from
  a saved .pbip or a flat spreadsheet, or debugging a Zebra visual that renders blank, black,
  wrong-numbered or ignores a property. Also answers which comparison, period, fiscal year or
  polarity a page needs, and what a P&L, cost-centre, sales, pipeline, cash, headcount or SaaS
  page should carry. Triggers: Zebra BI, zebraBiCards, ZebraBITables, ZebraBITablesPlus,
  ZebraBIChartsPlus, waterfall6C9ED82, Tables+, Charts+, Plus visuals, viewer commenting, IBCS
  report, variance chart, small multiples, publicCustomVisuals, PBIP, PBIR, TMDL, Desktop bridge.
---

# Authoring Zebra BI reports

Zebra BI is three custom visuals — **Charts**, **Tables**, **Cards** — that render IBCS-conformant
financial reporting. Charts and Tables each also ship a **Plus** variant, **Charts+** and **Tables+**,
identical to author and adding viewer commenting; **author the Plus visuals by default** and see
`references/visuals.md` for the GUIDs and the four conditions that send you back to the certified
track. All of them are fully authorable from PBIR text. Everything in this skill was proven by
rendering it; nothing here is read off a schema.

**The one rule that matters: the screenshot is the only evidence.** For Zebra visuals the validator
knows nothing — not the roles, not the properties, not the values. A wrong report validates clean.
A visual that renders empty, black, or beautifully-wrong is a *passing* validate. Look at it.

**The session, in order.** Every section in this file hangs on one of these lines; when the file is
long and the work is deep in a blob, this is the list to come back to.

1. **Cold start** — registration, Desktop closed, can the model express a variance, calendar, scope.
2. **Frame the brief** — reader, decision, period, comparison, conventions (`references/analyst.md`).
3. **Profile and enumerate** — every source, every dimension, the standard question set, the fraction
   and its denominator said out loud.
4. **Plan** — the story sentence, a question per visual, the page count derived, comments where a
   trigger fires, one comparison set for the page, what you are not building and why.
5. **Design** — form, size, scale, sort, title, colour, depth (`references/design.md`), then its check.
6. **Model, then report** — measures checked with `EVALUATE` before launch; the whole increment
   written, pre-flight and validate once, reload, screenshot, **read the screenshot**.
7. **Deliver** — the twelve-line handover (`references/analyst.md` §8): story, pages, what was left
   out, the assumed brief, what was verified and how, caveats, how to steer, how to read the notation.

## Cold start — someone points you at their own saved report

Most sessions now begin this way: a colleague saved a `.pbip` out of Desktop with their data in it
and said "build me something." They have not read this skill and should not have to. **Run these
five checks before authoring anything** — each one takes seconds and each catches a failure that is
expensive later. Report what you find in one short message, ask for what's missing, then build.

1. **Registration.** Read `definition/report.json` and any existing visual.
   - **If the report already uses Zebra visuals, copy that shape exactly** — GUIDs and mechanism
     both. Never mix mechanisms, and never "helpfully" add a GUID to `publicCustomVisuals` on a
     report that registers some other way.
   - **If the report has no Zebra visual at all, just author one.** Put the three AppSource GUIDs
     in `publicCustomVisuals` and go — **no human step, no payload, no licence key**. Proven
     on a report with `CustomVisuals/` deleted and every `CustomVisual` resource package
     stripped: a Table rendered a full IBCS variance view with correct data.
   - **Only if a visual comes back unresolved** ("add it to this report first", grey box): restart
     Desktop first — it loads its visual registry at startup; then *Get more visuals → Zebra BI →
     Add*, once per machine; the 60-second seed only for **organizational-store-only** tenants.
     Recovery, never a prerequisite. A Zebra visual in **Free** mode is a licence, not a
     registration, problem — a key the user pastes activates it from the file (`visuals.md`).
2. **Desktop must be closed while you write.** Ask, and say why: it does not watch the filesystem,
   so it will keep showing the old report *and* overwrite your edits when it next saves. Tell them
   explicitly when to open it and when to close it again. Do not edit files while it is open.

   ⚠️ **And a Desktop SAVE is an edit by another author — re-verify after one.** `.pbip` ships
   `enableAutoRecovery: true`, so **Desktop can save on its own** with nobody touching it; that
   happened once with nobody at the machine. A save writes three
   things you did not author, and two of them matter:
   - **It breaks `[Measure]` title tokens.** The trigger is `version` plus `previewSettings`.
     **Strip `proFeaturesSettings`, `version` and `migrationLog`** (the visual object, not
     `definition/version.json`), then confirm on one cold open — a reload lies about these tokens.
     ☠️ **Never strip `categoriesMetadata`**: it holds your computed rows and per-row inverts.
     `previewSettings` is the invert gate too — see `references/visuals.md`.
   - It also clears the *"calculated objects need to be manually refreshed"* banner and persists
     the data — but a save is no longer the only way to clear that banner: **the TMSL refresh in
     `references/model-layer.md` clears it too, with no human step.** Never leave any banner for
     the user to resolve; the refresh handles all three.
3. **The model — can it express a variance?** List tables, measures and relationships from the
   `.SemanticModel` TMDL. The blocker to look for: **`Values` and `Plan` are separate wells needing
   separate fields**, so scenarios-as-rows cannot feed both. If there is a `Scenario` column and no
   per-scenario measures, ask them to add these in Desktop — it is three lines and it is the
   difference between a table and an IBCS report:
   ```dax
   AC = CALCULATE(SUM(<fact>[<amount>]), <fact>[Scenario] = "AC")
   PL = CALCULATE(SUM(<fact>[<amount>]), <fact>[Scenario] = "PL")
   PY = CALCULATE([AC], DATEADD('Calendar'[Date], -1, YEAR))
   ```
   **You may write these yourself** — see `references/model-layer.md`. Measures, a calculated
   calendar table and relationships are all agent-authorable, verified against a DAX oracle with a
   cold-open control. Run **`references/preflight.md`** before you launch — it covers
   the whole project, model layer included: the mechanical TMDL errors (BOM, `//` comments, a
   `description:` property, name collisions, reserved table names) cause a cold-open failure, and a
   cold open has no instance to reload against, so each costs a cold open instead of ~1s.
4. **Time context.** Is there a Calendar table related to the fact and marked as the date table?
   Without one, `PreviousYear` and `Forecast` are *silently meaningless* — `PY ≡ AC`, `ΔPY` a flat
   0.0%, and it looks completely fine. Say so rather than shipping it. If there is no calendar,
   **author one** rather than reporting the gap — `references/model-layer.md` has the pattern.
4a. **Check every measure you write BEFORE you launch.** Against an already-open model an `EVALUATE`
   costs ~90ms and mutates nothing, so an uncertain measure is a question, not a gamble. Connection:
   `references/verify-loop.md` (or Microsoft's modelling MCP, the supported path to the same engine).
   What the answers mean, and the semantics most often guessed wrong — blank vs zero, `Infinity`,
   variance sign, house style — are in **`references/dax.md`**.

4b. **No plan does NOT mean no variance.** Before concluding a report can't show variance, check for
   a **prior period**. Actuals-only across two or more years still gives AC vs PY, which is a
   first-class Zebra well and is the product's core value. Shipping an actuals-only report when a
   comparative exists is the most expensive miss available — it silently omits the USP.

   **And an unusable prior period does not mean no variance either — that is the second half of the
   same mistake.** Having correctly ruled out AC-vs-PY, it is very easy to conclude "no comparison is
   honest here" and ship a report with no variance anywhere, throwing away the product's core value
   to avoid one bad comparison. When the time axis will not carry it, **compare each member against
   the population**: the segment's measure in `Values`, a selection-wide benchmark of the same
   measure in `Plan`. Zebra draws ΔPL with IBCS colour for free, and it is immune to the period
   problems that killed PY.

   ```dax
   Win rate benchmark = IF(NOT ISBLANK([Close %]), CALCULATE([Close %], ALLSELECTED()))
   ```

   ☠️ **The `IF(NOT ISBLANK(...))` wrapper is load-bearing — do not drop it.** A bare
   `CALCULATE([m], ALLSELECTED())` returns the benchmark for **every** member, including those with
   no rows under the current filter, and they come back from the dead: blank in a Zebra **Table**,
   still drawn in a Zebra **Chart** as a grey bar whose number is the *benchmark* and reads like the
   member's own value. Rendered symptom: **a table and the chart beside it, same filter state,
   listing different members.** Nothing errors and every number is correct, so DAX-verifying values
   misses it. Compare member counts.

   **Set the polarity while you are there.** A benchmark variance on cost, discount, churn or
   headcount must invert — `chartSettings.invert` on Charts/Tables, `card.cardDefaultInvert` on
   Cards — or beating the benchmark on discounting renders green when over-discounting is the thing
   you are warning about.
5. **Scope.** Build **one page** first and show it. The loop is slower than clicking for a single
   visual and pays off on the third page; a one-page first attempt tells everyone whether the whole
   thing works before anyone invests. **This is about increment size, not approval** — build the
   page, don't ask whether to build it. See the three modes in the next section.

   ⚠️ **One page FIRST is not one page TOTAL** — the sentence that gets misread. It licenses showing
   your work early, not stopping. Deliver the first page, then keep going to the count step 3b
   derived. Handing over a single page has to be because the *enumeration* came back thin, not
   because the increment did its job.

## PLAN THE REPORT BEFORE YOU AUTHOR A VISUAL

**Do this every time. The planning happens whether or not anyone sees it.** Skipping it is how you
end up with a page that is individually correct and collectively thin — technically verified, and
not the report anyone wanted. It happens like this: the model is clean and every number tied
to DAX, but the page had no KPI row, no variance, and used a fraction of the available data, because
it was assembled visual-by-visual with no plan.

### Which mode are you in? There are three, and the default is autonomous

**1. Default — AUTONOMOUS.** Someone points this skill at their data and asks for a report. **Decide
the plan, build it, and state in two lines what you decided and what you deliberately left out.** Do
not check in at each step. They asked for a report, not for a decision to adjudicate.

**2. Opt-in — WORK WITH ME.** If the user signals they want to collaborate — *"work with me"*,
*"let's do this together"*, *"check with me as you go"*, *"walk me through it"*, *"I want to steer
this"*, or they ask to see the plan before you build — switch to **proposing at each decision
point**: show the enumeration, show the candidate plan, confirm the story sentence, then build page
by page with a look after each. **Stay in this mode for the rest of the session** unless they say
otherwise. Collaborative means *showing the work and pausing at real decisions* — it does not mean
asking permission for every visual. Do not turn this into a questionnaire either.

**3. Forced escalation — regardless of mode.** Two narrow cases, both below, where you stop and ask
even in autonomous mode.

> **Say the default out loud when you deliver.** One sentence: *"I decided the structure myself —
> say 'work with me' if you'd rather steer it step by step."* It costs nothing and it prevents the
> failure that matters: a user who wanted to collaborate, did not know they could, and got a
> finished report they then had to unpick.

Five steps, ten minutes, no rendering:

**0. Frame the brief — who reads it, what they decide, which period, which comparison.** Read
**`references/analyst.md`** §1–§4 now, before you open a file. Four questions, each with a default:
the reader and the decision the page serves; the cadence and the period the page is about (the last
complete one, with year to date beside the month); the comparison that matters to *them* — against
plan says *are we delivering*, against last year says *are we growing*, forecast against plan says
*will we land*, and when both plan and prior year exist you bind both; and the conventions — polarity
per measure family, unit, currency, **fiscal year**, and the reader's own words for the scenarios in
`legendHeaderSettings`. In autonomous mode you **infer** these from the data, the file names and the
request, write them into the plan as assumptions, and repeat them in the delivery so a wrong one is a
one-word correction; in work-with-me mode you ask them, once, together. `references/analyst.md` §5
carries the analyst's prior for each report family — P&L, cost centre, sales, pipeline, cash, balance
sheet, headcount, marketing, operations, projects, SaaS: the reader, the KPI row, the cut, the
comparison, the polarity and the trap that ships — and §6 the decompositions (price × volume, rate ×
mix, like-for-like, constant currency, one-offs) a reader will ask for when a variance needs a *why*.
**Everything below reads from this step**: the dimensions that matter, the period, the polarity and
the story are all decided against the reader, not against the data.

**1. Profile the data — and FIRST, write down the list of everything there is to profile.**

☠️ **Start with the SOURCES, not with the model.** When someone points this skill at a folder rather
than at one saved `.pbip`, there is no model yet — so "everything there is to profile" quietly
becomes "the first file I opened", and every later count is computed against a denominator that is
wrong from the start. **List every file the user made available before you open any of them**, and
say which you are using and which you are not.

**Run `profile_source` on that folder first**, before any model exists: delimiter, joins and orphan
keys, the **fiscal year** (and whether the source column is consistent), the **last complete period**
and trailing stub, drifting postings, empty scenarios and plan reach, sign, parent-child, currency,
ownership (`references/analyst.md` §1b). Its `analystBrief` lines **are** the step 0 assumptions:
copy them into the plan and the delivery.

**Then look for the joins between them**, because that is what decides whether they are one model or
several unrelated ones. A column with the same name and the same member set in two files is a shared
dimension, and it usually is the report: a budget by department and a ledger by department are one
subject, and profiling either alone will look complete.

Now enumerate and **write out**:

- every **source** in scope, with one line on what it is and its grain,
- every **dimension table** in the model, or the columns that will become one, and
- every **categorical column on the fact table itself** — status, stage, rating, band, flag, type.
  These are the ones that get missed, because they are not in the relationship diagram.

**`profile_project` builds all three, with cardinality, the gaps and the denominator** — use it,
because a hand-written list cannot be complete: completeness is a property of the list being written.
`propose_pages` turns its ranking into a page spec, and `write_report` writes the whole `pages` tree
in one call instead of twenty hand-written files. Both refuse rather than invent: with no AC/PL/PY
pair `propose_pages` emits value-only pages and says so, and what it would not decide comes back in
`youMustStillDecide`. **You still own the story — read the ranking before you accept the pages.**

That list is the artefact the rest of the planning is checked against, and **steps 2 and 3b are not
finished until every name on it has either a number beside it or a one-line reason it was
excluded.** Without it there is nothing for "I covered the data" to be false about.

Then profile: cardinality of every dimension, the date range, and — always — **coverage per period**
(see the partial-actuals trap). You cannot choose visuals for data you have not looked at. Report
what you found, **including the excluded names and why**.

⚠️ **A dimension with cardinality 1 is a finding, not a filter.** Report it. A field named `Region`
holding one value means the report cannot answer anything regional, and the *name* will keep
suggesting otherwise to everyone who reads it — including you, an hour later.

**2. ENUMERATE what the data can answer, before you name any story.** This is the step that was
missing and it is the one that costs most when skipped. A story named straight off a
profile is a story named from a *template you already had in mind*, and it will be decoration.

Run the standard set against the fact table — **against every name on step 1's list, not against the
two or three you already have a story for.** It is mechanical, it is a handful of
`SUMMARIZECOLUMNS`, and it takes about two minutes:

| Ask | Query | Why it earns its place |
|---|---|---|
| **Profitability by EVERY dimension** | margin by segment, product, region, channel… | The single highest-yield query and the easiest to skip. See below. |
| Mix shift over time | share-of-total by dimension, per period | Distinguishes *"the mix moved"* from *"performance changed"* — they look identical in a total |
| Within-group trend | the same measure by period **inside** each group | If the total moved but the mix improved, the cause is inside the groups |
| Concentration | share of total held by the top 1-2 members | Decides whether a breakdown is worth a visual at all |
| Rate vs volume | price, units, discount rate as separate series | Separates *sold more* from *sold better* |
| Coverage per period | rows/value per period per group | The framing trap — see check 1 above |

**Then write the sentence**, and make it survive a challenge: *what would have to be true for this to
be wrong?* Ask that once, out loud, before you build.

> **How this goes wrong.** A page headlines *“discounting erodes margin”* and every number reconciles to DAX — while the discount **mix has improved** and margin is falling *within* bands instead. The headline is then a true fact presented as a false cause. In the same shape, a segment that is loss-making on a sixth of sales renders **green** in the KPI row on its variance alone. Both are one `SUMMARIZECOLUMNS` away, and **no oracle catches either**: DAX checks only what you thought to ask, so a wrong *story* carried by right *numbers* passes every check here.

**Always run profitability by every dimension.** Revenue-only breakdowns are how a loss-making
segment gets rendered as a success story.

#### The completeness gate — say the fraction out loud

**Before you name a story, state how many of step 1's names you actually queried: "profiled 9 of 9"
or "profiled 3 of 10, excluded 7 because …".** A fraction is checkable by a reader in one second;
"I profiled the data" is not, and it is what an agent writes when it has profiled three things.

☠️ **State the DENOMINATOR as well as the fraction, and count sources first.** *"3 of 3 dimensions"*
is a true sentence about one spreadsheet and a false one about the five the user put in the folder,
and the fraction gives no hint which it is. The honest form names both: **"5 sources, 4 used, 1
excluded because …; 11 of 11 dimensions across them"**. A fraction whose denominator is the file you
happened to open first passes this gate while defeating it — that is the failure this gate exists to
stop, wearing the gate's own clothes.

The enumeration set is indexed by **kind of question**, which is exactly how the step gets half-done:
you can run every row of it against three dimensions, produce a genuinely good page, and never
notice the other seven. **The rows are the questions. Step 1's list is the coverage.** Both have to
be complete.

> **How this goes wrong, and it is the most expensive failure in this section.** An agent profiles 3 dimensions out of about 10 on a 10-table model — say territory, product and manager — runs every row of the enumeration set against those three, finds a real and defensible story, and ships **one page**. It never queries the 45-member industry column, the 299 accounts, the individual reps, or six deal-quality columns. It then reports *“one page, because that is how many questions carried signal”* — which is **false, and confidently stated**. The true sentence is *“one page, because that is how many dimensions I profiled.”* One further enumeration pass can justify three more pages, including the strongest finding available.
>
> **Two things cause it, and both will recur.** A prompt that says *“fast”* is licence to cut render iterations, **never** to cut enumeration: enumeration is a handful of queries on one open connection, and the render loop is where the minutes actually go. And **finding a good story early** is itself the trap — being right about the first finding is what stops you looking for the second.

**3. List the questions the page answers, and pick a visual per question.** One row each:

| Question | Visual | Binding |
|---|---|---|
| How big, and vs last year? | Cards KPI row | `Group`=KPI dim · `Values`=AC · `PreviousYear`=PY · **no `Category`**, `suppressChart: true` |
| What happened through the year? | Charts, PY→AC bridge | `Category`=Month · `Values`+`PreviousYear` |
| Who drove it? | Tables | `Category`=dimension · `Values`+`PreviousYear` |
| What is the lever? | Tables | the structural cut - discount band, product, channel |
| The same trend **per member** | Charts small multiples | `Group`=dimension · `Category`=Month · `multipleLayout` |
| A dimension with more members than fit | any, **+ Top N** | see *Top N* below |
| How do they get from summary to detail? | Tables expand/collapse · drillthrough page · small multiples | `Category` **list** + `expansionStates` — a Table opens FULLY EXPANDED, so the job is usually collapsing to the parent level |
| The same measure over several time frames | a **calculation group**, not more measures | its name column on `Group` = one column block per item |

**That table names the visual. Its form, size, scale, sort, title and colour are decided in
`references/design.md` — read it whole before you write the first `position`**, and run its closing
checklist before the first render.

**Then decide density before you write the JSON** — `design.md` §15, computable in `recipes.md` §0.
The defaults suit a roomy box: past ~8 categories a Chart truncates every axis label to `2013…`.
Row or category count plus the visual's height and width decide it. It is the design layer a reviewer judges by eye: form, scale,
sort, title, the page grid, **how the reader reaches detail, several time frames from one measure**,
and the visuals never to build.

Three choices inside that table are the ones agents get wrong. All three are one-liners:

**A bridge across a TIME axis is PY→AC. A plan bridge is not a time series.** Binding `Category` to
a period and `Plan` to the comparison draws a bridge from the plan total to the actual total whose
steps are the per-period *variances* — arithmetically right and analytically a category error, because
it puts a variance decomposition on an axis the reader takes for time. Worse, with the period slicer
on *All* it bridges every year at once, so the two ends are multi-year totals nobody asked for.

- **Change over time** → `Category` = the period, `PreviousYear` = last year, **one year selected**.
  That is the bridge that answers *what happened*.
- **Deviation from plan** → keep the plan, and put it on a **structural** axis — department, product,
  channel — where a bridge from plan to actual is exactly the right picture.

☠️ **`chartType` will not rescue the wrong choice.** All six values the shipped templates use —
`0D 1D 2D 3D 4D 7D` — rendered the *identical* bridge when a comparison was bound: six arms, same
bindings, pixel-identical. Whatever selects the chart form with `Plan` bound, this property is not
it. Choose the binding, not the chart type.

**Every card scales its own chart, so the charts across a KPI row are NOT comparable** — a card at
36K and a card at 1M render the same bar height, while a row of tiles *reads* as a comparison. Cards'
*Scale groups* property (`interactions.viewModeGrouping`) is declared and changed nothing in the
authored render, so the dependable answers are small multiples or a chartless KPI row.

**So there are two rules, and they resolve almost every case:**

1. **A split by a group dimension belongs in small multiples, not in KPI cards.** If you are about to
   put one tile per *segment / region / product / rep* and show a series in each, that is a **Charts**
   small-multiples visual: `Group` = the dimension, `Category` = the time axis, `multipleLayout`. All
   panels share one scale, so they are comparable by construction — which is the whole reason to
   choose it.
2. **If you use Cards for that anyway, do not put charts in them.** Set
   **`card.suppressChart: true`**. The number and its variance are the job a tile does well; a
   per-card chart nobody can compare across tiles is decoration that actively misleads about
   magnitude.

**`card.cardDefaultAxisBreak` is not the answer either**: it works within one card and leaves every
card on its own maximum, so it makes a cramped tile readable without making two tiles comparable. Use
it only where each tile is read on its own; the scale rules are in `references/design.md`.

**A series per tile is small multiples, not Cards.** Cards answer *one number and its variance per
member*. The moment you want a **series** inside each tile you are asking for Charts small multiples
(`Group` = the dimension, `Category` = the time axis, `multipleLayout.layoutType` = `Auto`/`Rows`/
`LargestFirst`). Binding `Category` on a **Cards** visual is legal and does draw a per-point chart in
every card — but it is a different, much taller animal, and the KPI-row geometry does not cover it.

**And do not assume the fix is height.** The ≈264px figure is for `Values` + `PreviousYear` with
**no** `Category`, and there is no verified height for the Category-bound shape — Zebra BI's own
templates ship Category-bound Cards as short as **118px** with no scrollbar. So if one of yours
scrolls, reach for the shape first, not the container.

**Top N is a first-class choice, not a formatting afterthought.** **17 of the 20 shipped templates
use it, across 123 visuals.** Any category with more members than the box can show — a vessel list, a
customer list, an SKU list — wants Top N with an explicit *Others*, not a scrollbar. The enumeration
step already computes concentration; Top N is what you *do* about it. **The two visuals use different
property names**, which is the trap: Tables thin the **rows** through `categorySettings`
(`showTopNCategories`, the count inside the `topNSettings` blob, `topNOtherLabel`); Charts thin the
**small multiples** through `multipleLayout` (`showTopNChartsOptions` 0/1/2, `topNChartsToKeep` or
`topNChartsPercentage`, `topNChartsOthersLabel`). Both encodings are in `references/formatting.md`.

**Tables' Top N count lives in the `categorySettings.topNSettings` blob, and the bool alone does
nothing** — render-proven: `showTopNCategories: true` without the blob leaves every row showing. The
blob's key set (`category`, `level`, `number`, a separate `numberInFocusMode` for focus mode,
`columnName` paired with `sortSettings.columnName`, `type: 1`) is in `references/formatting.md`;
write every key, and an authored blob is honoured on a cold open.

**The Others row preserves the total, but only for an additive measure**: 15 vessels + *Other
vessels* summed to the grand total of all 20. **On a rate it silently does not** —
`references/dax.md`.


**They are not interchangeable.** Charts' Top N lives inside small multiples, so it needs a `Group`
bound and it limits *how many panels* you get — it does **not** thin a crowded category axis. A Charts
category axis with too many points is a different problem (aggregate the axis, or move the breakdown
to a Table with Top N). Always name the Others bucket — an unlabelled remainder is the same defect as
an unlabelled blank.


**Invert is a whole-report decision, taken once.** On a cost, headcount or churn report a rise is
bad, and the variance must be red **everywhere** — not on the tables only. Charts and Tables use
`chartSettings.invert`; **Cards use `card.cardDefaultInvert`**, a different property, which is exactly
how a report ends up with red overspend in its tables and green overspend in its cards. Decide it when
you plan the page, apply it to every visual that shows a variance, and if the page genuinely mixes
polarity (revenue *and* cost) say so out loud.

**When one visual mixes polarity, you have three levers and they are not interchangeable.** Whole
visual is `chartSettings.invert`. Per **group** is `groupsMetadata.inverted`, which does nothing
against a `Category` binding — the polarity split has to *be* the group. Per **row** is
`categoriesMetadata.invertCalculationCategoriesValues` on Tables, and it needs a
`previewSettings.migrationsLog` gate or it is accepted and silently ignored; `references/visuals.md`
carries the shape and the warnings. Reach for the row-level lever only for a genuine exception —
one cost row among revenue rows. If the split is a dimension, make it the group.

**So check it yourself before you finish:** list every visual that binds `Plan`, `PreviousYear` or
`Forecast`, and confirm each one's polarity is the one you intended. If some invert and some do not,
the same overspend renders red in one visual and green in another.

**You are building a DASHBOARD, not a one-time report — so it needs slicers.** Zebra BI's own
templates are emphatic about it: they carry **408 slicers, and 400 of those sit in a band across the
TOP** of the page (`y < 120`). The most-sliced field by a distance is **`Year`**, then Company, Month,
KPI, Region.

A page pinned to one period by a page filter, with no slicer for that field, can only ever show that
period — the reader cannot move. Put the period on a slicer and let them choose. `validate_report` catches this.


The house pattern:

| | |
|---|---|
| visual | plain native `"slicer"` — **408 of 408**, never a custom visual |
| position | a top band, `y = 16`, one row |
| **height** | **set by the header state.** Header showing → **64**. Header off → **44–48** |
| `data.mode` | `'Dropdown'` (word-valued) — **321 of 408**; `'Basic'` (86) for a short value list |
| `data.textSize` | **`10D`** — the dominant explicit size (`9D`/`8D` next). Numeric enum, so `D`-suffixed |
| `general.orientation` | `0D` / `1D` |
| selection | `general.filter.filter` — **double-nested**; rule `slicer-filter-double-nested` has the shape |

**Height is set by the header, not by a single house number.** Measured across all 408 shipped
slicers: header off runs ~44 (median 43.7), header shown 58–64, and 319 of the 408 are under 56px
because most turn the header off. Reading 64 as a blanket floor would therefore flag the large majority of slicers that are correct — the height only matters once the header is showing.

**Decide the header first, then take the height from it.** The header **shows unless you turn it
off**, and it costs ~22px. Off, and 44–48 is right; showing, the rendered floor is **52** and 64 is
comfortable. A header in a 46px box clips the dropdown — `slicer-height-clips-the-dropdown`.

And **do not also leave a hardcoded page filter on the same field** — a page filter ANDs with the
slicer, so the reader can never widen past it. Delete the filter, put the default on the slicer.

#### Give the slicer a DEFAULT, and put the same slicer on every page

Two separate omissions, both of which ship a dashboard that technically works and is wrong to open:

- **A slicer with nothing selected opens on "All".** On a model whose periods are not comparable —
  a partial current year, a prior-year stub, a future-dated pipeline — "All" is the one selection
  that blends them, and it is the one every reader gets by default. **Choose the period the report is
  about and write it into the slicer**, as a selection, not as a page filter:
  `general.filter.filter` → `Where` → `In`, with the value as a tagged literal (`2021L` for a
  whole-number year). ☠️ The selection is **double-nested** (`filter` inside `filter`) — a
  flat-nested one is accepted, renders a slicer that *looks* selected, and filters nothing.
- **A slicer on page 1 only is not a report control.** If a field is worth slicing it is worth
  slicing everywhere it applies; a reader who moves it on the overview and then tabs to page 2 is
  now looking at unfiltered data with no indication. Put it on every page it applies to — and where
  it genuinely does *not* apply, say so on the page and turn the interaction off rather than leaving
  a control that silently does nothing. **And the same default on every copy is not the same as the
  selection following the reader**: a choice made on page 1 stays on page 1 unless the copies are
  synced (Power BI's sync-slicers pane, which writes `syncGroup` on the slicer). Decide which the
  reader expects — a pack read page by page usually wants the selection to follow — and confirm it in
  the render by moving the slicer on one page and reading the number on the next.

⚠️ **A slicer added for ONE visual filters every visual on the page.** That mechanism is what makes
the stock-versus-flow rule easy to break: you add a year slicer so the flow visuals can show a
prior-year comparison, and it silently reaches the snapshot beside them. An
ageing row filtered to a past year puts every unsettled item in the oldest band — five bands render
as one, and it looks like the visual failed rather than like a filter did it. **Whenever you add a
slicer, name the visuals it should NOT reach.**

**The exception worth naming: a stock does not slice by a period.** Open pipeline, headcount,
balances and any other point-in-time snapshot are *as at now*, not *during 2021* — filtering one by
a historical year yields a legitimately empty visual that reads as broken. Bind the flow measures to
the slicer and set the snapshot visual's interaction to `NoFilter` in the page's
`visualInteractions`, then say which it is in the visual's own title.

#### Editing a slicer that is already there

Most sessions are on somebody's existing report, so **adding** a slicer is only half of it. Reading
and changing one has a shape worth knowing:

- **Find them by `visualType: "slicer"`**, not by name — slicer directories are named anything.
  Read `general.filter.filter` to see what is currently selected before you change anything.
- **The selection is double-nested** and that is where this goes wrong: the filter value sits inside
  a filter object inside the property. A flat-nested selection is *accepted*, renders a slicer that
  looks selected, and **silently filters nothing** — the page then shows all-years totals under a
  slicer reading "2020". Confirm by the number, not by the slicer's caption. Shape in the traps.
- **Changing which field a slicer binds** means updating the projection *and* clearing the old
  selection. A selection naming a value that no longer exists in the bound field leaves the slicer
  showing nothing selected and the page unfiltered.
- **Adding a slicer to an existing page: check for the page filter you are about to fight.** If the
  field already has a hardcoded page filter, the new slicer can only ever narrow within it. Remove
  the page filter and move its value to the slicer's default.
- **A new slicer directory is picked up by `file.reload/v1`** — no restart.

#### Never type a value that comes from the data into a textbox

A dashboard is read months after it is built, by someone who will move the slicers. **Any text that
states a value — a period, a year, a total, a segment name, "FY2020", "as at March" — is wrong the
moment the reader changes a filter, and nothing tells them.** It does not error, it does not blank;
it just quietly disagrees with the numbers beside it.

- **Static text is for what does not move**: the report name, the entity, the units, a definitional
  footnote.
- **Anything else goes in a measure token** resolved at render time —
  `titleSettings.text = 'Net sales by month, in USD · [Period label]'` — with the measure projected
  into the **`Filters`** role, which is the gate that makes the token resolve.
- **A period is the most common offender** and the one already written up, but the rule is not about
  periods. `Period label` is just the pattern: `FORMAT([First data date],"mmm yyyy") & " - " &
  FORMAT([Last data date],"mmm yyyy")`. The same trick carries a selected segment, a selected
  scenario, a row count, or the total the page is about.
- **If you catch yourself typing a number into a textbox, the question is which measure should have
  produced it.** There almost always is one, and if there is not, that is the finding.

**Check for overlap before you render, and know what the check misses.** Two visuals must not
intersect and nothing may run past the canvas — that is cheap arithmetic over `position`. But
**geometric non-overlap is necessary, not sufficient**: a 48px slicer passes the arithmetic while its
*rendered* dropdown still overflows past its own box and crowds whatever sits under it. Leave a real
gutter (16px) and give native controls their full height.

☠️ **The arithmetic cannot see the theme, and the theme owns real estate.** A report theme paints
furniture of its own — a logo, a watermark, a banner strip — and **none of it appears in any page's
JSON.** So a visual can clear every other visual on the page, pass the overlap check, and still land
on top of the report's branding, where it renders legibly for the file and badly for the reader.
This is not a fault an agent can find in the files it is editing: the region exists only in the
render.

**On somebody's existing report, read the reserved regions off a page you did not write.** Open an
existing page, note which bands are painted or conspicuously empty on *every* page, and treat them
as occupied. ⚠️ **This collides with the skill's own layout advice**, which is why it is worth
stating: the "top band, right-aligned" slicer convention and a top-right theme logo want the same
corner, so following the convention on a themed report is what puts the slicer under the
watermark.

**3b. DERIVE the page count. There is no default number, and four is not a target.**

The enumeration told you which questions the data can actually answer. **The page count is the
count of those that carry signal** — nothing else. Group the surviving questions into pages by the
decision they serve, and let the number be whatever it is:

| The data gives you | The report is |
|---|---|
| one question worth answering | **one page.** A single excellent page is a legitimate, common, and often correct outcome |
| an overview plus two or three real breakdowns | three or four pages |
| several dimensions each with a genuine internal story, or several audiences | **eight, nine, more.** A page per audience or per business unit is not padding if each one is used |

⚠️ **This step inherits step 2's coverage, silently — and the first row is the one that gets abused.**
The count is derived from the enumeration, so a *partial* enumeration yields a confident,
well-argued, too-small number that is indistinguishable from a deliberate one, because you will have
a real reason for every page you did build. **Re-read your "profiled N of M" line before you commit
to a count.** "One excellent page" is a legitimate outcome when M is the whole list and only one
question survived; it is a *failure wearing its clothes* when M was three of ten.

Two failure modes, and they are opposite:

- **Padding to a number.** A page that restates the overview by a dimension nobody acts on is worse
  than no page: it dilutes the report and it costs a reader's attention. If a candidate page's
  honest one-line summary is *"same story, sliced differently"*, it is not a page — at most it is a
  slicer on an existing one.
- **Cramming a real structure into too few tabs.** Nine business units on one page means nine
  unreadable visuals, or a Top N that hides six of them. If the structure is genuinely wide, the
  tabs are how you carry it.

**Say the number and the reason in your two-line summary** — *"Four pages: overview, the margin
story, the channel cut, and the vessel detail. No geography page; all five regions are within 20%
of each other."* The count is a decision you defend, not a shape you inherited. And where the split
is between *pages* and *one page plus a slicer*, prefer the slicer: it keeps the comparison in one
place and it is what a dashboard reader expects.

**3c. Decide where a COMMENT earns its place.** Zebra BI can anchor rich-text commentary to a
specific data point — a numbered bubble on the cell, the text in a panel beside the visual — and
**you can author it with no human step.** It is the narrative layer of the report, and it is the
part a reader quotes. Most agent-built reports ship without it, which is why a technically correct
page still reads as a data dump.

**Add one when a trigger fires — not on every page, and not for decoration.** The triggers, each of
which the enumeration step has already computed:

| Trigger | The comment says |
|---|---|
| **A member is loss-making, or moving against the total** | that it is, and how much of the base it carries. This is the one that matters most — it is the case where the KPI tile is green and the business is not |
| **An outlier big enough to change the read** | what it is, so the reader does not have to ask |
| **An inflection** — the point where a trend turns | when it turned, and what the two halves look like |
| **A composition change behind a headline** | that the mix moved, so the reader does not attribute it to performance |
| **A coverage or comparability caveat on a specific point** | that this point is not like-for-like |
| **A definitional surprise** — a negative that is credits, a bucket that is "unassigned" | what it actually contains |

**Bound it: at most two or three per page, and none that restate the number.** *"Revenue was
4.0M"* is not a comment, it is the cell. A comment carries what the cell cannot: cause, caveat,
consequence. If you cannot say why this point and not its neighbour, it has not earned the bubble.

**The comments you pick here go on the written plan, and one that does not ship needs a one-line
reason** — the same rule the enumeration list already applies to an excluded dimension. The realistic
failure is not picking badly, it is **debugging displacing coverage**: the mechanism fights you, you
spend the session getting *one* bubble to render, and "one comment works" quietly becomes the
finished page while the strongest trigger you had already identified never gets written. **Getting
the mechanism working is not the same as finishing the comment layer.** When the first one finally
renders, go back to the list.

⚠️ **A caveat in a comment has NOT been made.** An *insight* belongs in a bubble. A **caveat that
should change how the reader weighs the number** — not comparable, not significant, partial period —
has to be carried by the **encoding**: split the visuals, neutralise the formatting so a
non-significant move is not coloured like a real one, or leave the comparison off the page. A reader
takes colour and arrow first and prose last, if at all.

**First pick the mechanism. There are three, they are not interchangeable, and the fallback order is
fixed** — skip this and the comment lands where it cannot show, or where nobody can answer it.

| | **View-mode comments** — Plus visuals + a SharePoint workbook | **Authored annotation layer** — bubbles, highlights, CAGR arrows in `visual.json` | **`Comments` data role** — text from the model |
|---|---|---|---|
| What it is | Rows in an Excel table on a team site; viewers who can open it see, add and edit them in view mode, and so can an agent | Numbered bubbles on data points, rectangles or ellipses over Table cells, a growth arrow on a Chart; no model change | A text column or measure bound to the role; travels with the data |
| Tables+ / Charts+ | ✅ | ✅ | ✅ |
| Certified Tables / Charts | ❌ declared, ignored | ✅ | ✅ |
| Cards | ❌ | ❌ declares neither object | ✅ (max 2 fields) |
| Use it when | People with view access should add or answer the commentary | The narrative is *this* report's own — cause, caveat, consequence — and the author owns it | The text belongs to a member and should survive into every report that reads the data |
| Tool | `encode_storage_config` | `encode_annotations`, `encode_highlights`, `encode_cagr_arrows` | a DAX measure + `commentBoxSettings.show` |

**Fall back in that order.** View mode needs Plus visuals, a library the viewers can open and a tenant
that lets the visual reach it; when any is missing, write the same commentary as authored bubbles, and
when a bubble cannot be anchored — Cards, or a filter state you cannot pin — put it in the model.
Never drop the narrative because the first mechanism was unavailable.

☠️ **A comment cannot be authored onto a Cards visual** — it declares neither object, so nothing
appears. A KPI tile that needs words takes the **`Comments` role**, so the text must exist in the
model — decide it while writing the model layer.

**Which one by default: if the comment belongs to a category member, use the `Comments` role.** An
authored bubble has to match the visual's **live filter state** — `filterContexts`, plus
`categoryFields` on Charts — and every mismatch is silent: the visual renders, the panel says *"No
comments match this view"*, nothing names the reason. A per-row measure in the `Comments` role has
**no matching step at all**:

```dax
Region comment = IF(SELECTEDVALUE(Customers[Region]) = "Asia & Pacific", "<text>", BLANK())
```

bound to the `Comments` role with `commentBoxSettings.show: true`. The row it lands on is the row the
DAX picked, so there is no second place for it to disagree with the visual.

| The comment is | Use |
|---|---|
| *"say this when this member, or this condition, holds"* | **`Comments` role.** The common case, and the robust default |
| free-floating narrative not tied to any bound row — rich text, a caveat about the page | **authored bubble** |

The bubble keeps rich text and needs no model change, so this is a default, not a deprecation; but
reaching for it on a *"flag this member"* comment buys a filter-context matching problem for
nothing.

**How to author one.** Use `encode_annotations` — it *requires* the live filter state, because ☠️
**an absent `filterContexts` key blanks the entire visual** with no error, and an anchor pinned to a
state the page can never be in is invisible forever. Pair it with **`commentBoxSettings.show: true`**
or nothing is on screen. Anchor by **plain data values** off the binding — category value, group
value; the heading and arrow derive from the data point, so an authored `title` is ignored.

☠️ **`categoryFields` is EMPTY on Tables and NAMES THE CATEGORY FIELD on Charts. Get it wrong on
Charts and every comment is silently dropped.**

| | `categoryFields` |
|---|---|
| **Tables** | `[]` — always empty |
| **Charts** | the **display name of the category field**, e.g. `["Segment"]`, `["Year"]`. One entry **per level** on a hierarchical axis: `["Year","Quarter Name"]` |

Render-verified both ways on a Charts visual: with `[]` the visual renders fine and the comment panel
says **"No comments match this view"** — no error, no bubble, nothing naming the reason. Set it to the
category field name and the same comments render. **It is the only field that has to change**; a
Tables-shaped `dataProperty` and an extra `queryName` are both tolerated.

**`encode_annotations` takes `categoryFields` and enforces both shapes — use it rather than hand-authoring.**
On `target: "charts"` it **requires** a non-empty list and rejects the empty one; on `target: "tables"`
it requires the list to be omitted or empty. So a silently dropped comment is unreachable through the
tool, and the only way to hit it is to write the blob by hand.

**Detection tell:** bubbles number in array order **among the comments that actually render**. Seven
comments and a last bubble of ⑥ means one was silently dropped — almost always a `filterContexts`
that does not match the live state.

### Highlights and ellipses — a THIRD way to anchor a comment

Zebra Tables can draw a **rectangle or an ellipse over cells**, and a comment can attach to that
shape instead of to a data point: `annotationLayerSettings.annotationHighlights`, a blob beside
`annotationComments`, authorable from plain data values. **Use `encode_highlights`**: per entry the
rows and the columns it covers (one column across four rows, or one cell), the shape, the table's
scenario columns in display order, and the live filters. It returns `ids`; a comment hangs on a shape
by passing that id as `highlightId` to `encode_annotations` **with no cell** — the shape owns the
position. Still needs `commentBoxSettings.show: true`. **A highlight with no comment is legitimate** —
it draws the eye without spending a numbered bubble; numbering follows the comments.

⚠️ **Two vocabularies.** A highlight's `dataProperties` use the stable per-column index carried in
`orderOfColumnsContext` — `actual` 0, the comparison 1, `actual-<cmp>` 2, `actual-<cmp>-percent` 3,
measured for **one** comparison; anything else is `{name, index}` read from a Desktop save — not the
`7 + Values position` of `annotationComments`. Do not carry one across.

☠️ **Omit `sortByColumnContext` or `orderOfColumnsContext` and the WHOLE VISUAL goes blank** — not
the highlight, the visual; no error, no placeholder. The encoder writes both, always. If you author
the blob by hand, so must you, even on a table with no sort applied.

### View-mode comments — the Plus visuals' third source, and it is writable

On **Tables+ and Charts+**, `annotationLayerSettings.annotationsStorageConfig` links the visual to
an Excel workbook in a **SharePoint team-site library**; comments are rows there, so **viewers who
can open the workbook see, add and edit them in view mode**, and so can an agent that writes the
workbook. Use it when viewers are meant to add or answer the commentary. Author the link with
**`encode_storage_config`** plus `commentBoxSettings.show: true`; ☠️ **nothing checks
the path until the visual loads** — a wrong part is an empty panel with no error. Details:
`references/visuals.md`, *View-mode comments workbook*.

### CAGR arrows on Charts

`annotationLayerSettings.annotationCagrArrows` draws a growth arrow across a Charts series. It takes
**no data anchor at all** — one arrow, spanning the whole series, first point to last. **Use
`encode_cagr_arrows`** with the live filters and a label; the label is free text and renders verbatim.

⚑ **The label says CAGR and the number is compounded per CATEGORY STEP, not per year.** On a monthly
axis, 550.7K → 961.9K over 30 steps renders **+1.9%**, which is the compound *monthly* rate; the
annual equivalent is **+25.0%**. A reader who takes the label at its word is out by an order of
magnitude. **Put the arrow on a yearly axis, or say the period in the title.**

Do not expect it everywhere — the surface it is offered on is narrow, and a chart form that does not
support it is not a bug to chase.

**3d. Fix the comparison set ONCE, and give every visual on the page the same one.** Decide at
planning time which comparisons the page makes — ΔPY, ΔPL, both — and then every KPI tile carries
them, and two tables sitting side by side carry the same columns.

⚠️ **A missing measure does not read as a missing measure. It reads as a deliberate editorial
choice** — and the reader spends their attention working out what you meant by it instead of reading
the page. Three cards where two show ΔPY and ΔPL and the third shows only ΔPY says *"plan does not
apply to margin"*, which is a claim about the business. Usually the truth is that nobody wrote
`Margin % PL`.

That is the tell: the cause is nearly always upstream and mechanical, not editorial.

- **The measure does not exist in the model** — its siblings do, this one was missed. Write it, or
  say in that visual's title why it is absent.
- **The profiling was run for one dimension and not its neighbour** — a margin column lands on the
  business-unit table because margin-by-business-unit was profiled and had a story, while the region
  table stays revenue-only because margin-by-region was never looked at. The asymmetry in the page is
  really an asymmetry in the analysis.
- **So list the comparisons the page claims, then check each visual that could carry them does.**
  Where one genuinely cannot, make the scope explicit in the title instead of leaving it to be read
  as intent.

**This is not the cross-visual reconciliation check.** That one asks whether the numbers *agree*;
this asks whether the same measures are *present*. A page can reconcile perfectly on every value it
shows and still be inconsistent about what it shows — the two checks fail on different reports and
neither substitutes for the other.

**4. Say what you are NOT building and why.** *"No geography page — all five countries are within
20% of each other, so it carries no signal."* This is the step that turns a thin report into a
deliberate one, and it gives the human something to push back on.

**Then decide, say it in two or three lines, and build.** The story sentence, the page list, and
what you are deliberately not building and why — and when the report is done, the full handover
is the twelve lines in `references/analyst.md` §8, the assumed brief and the reading guide included. **Do not block on approval for ordinary report
structure** — a sensible default the user can redirect beats a menu of options they have to rank.
Planning is still the cheapest correction in the loop; the point is that *you* pay it, not that you
hand it over. (In **work-with-me** mode this is where you propose instead, and wait.)

**Mode 3 — escalate and ask even in autonomous mode, when one of these is true:**

- **Two readings of the data support materially different reports**, and the choice turns on
  business context you do not have (which segment is strategic, whether the reorganised channel is
  comparable to last year's).
- **A headline finding may be a data artefact**, and publishing it wrong would be costly — a segment
  showing negative margin that could be an allocation artefact, a collapse that could be a coverage
  gap (see the partial-actuals trap).
- **The user has already signalled they want to steer *this specific* decision** — even if they have
  not asked for work-with-me mode overall. A named preference is theirs, not yours to default.

**Always leave the iteration door open when you deliver.** One line, not a questionnaire: say plainly
what you decided and invite the correction — *"I led on margin rather than growth because the mix
story is where the money is; say the word and I'll reframe it."*

> **Say it in your own delivery message — do not assume something upstream has said it for you.**
> One sentence naming what you decided, and one inviting the correction. It is the cheapest line in
> the session and the easiest one to leave out.

**This does not conflict with cold-start check 5.** That check is about **increment size** — build
one page, then show it, because a one-page attempt tells everyone whether the whole thing works. It
is not an approval gate either. Deciding and building one page, then showing it, is both rules at
once.

**What you can build with what they have.** Actuals only, no plan → Tables, Charts, small multiples
and proper formatting, just no variance columns. Worth saying out loud rather than quietly producing
a thinner report than they expected. One flat table with no star → renders, but drilldown and
prior-year are limited. Missing date column *and* they asked for prior-year → that one is a real
blocker, name it.

## The loop

**Assume nothing is installed but Power BI Desktop.** That is the machine you are on far more often
than not, and the loop closes there completely. This is the default path; its mechanics are in
*The dependency-free loop* two sections down.

```
write the TMDL (if any) ─┐
                         ├─→ PRE-FLIGHT once → validate once → reload (or open) → screenshot each page
write ALL the PBIR JSON ─┘        ↑                                                        │
                                  └────────────── READ the screenshot ────────────────────┘
```

**Check the MODEL before the first open, not after it.** This is the highest-value check in the
loop and the easiest to skip, because on a from-scratch build there is nothing on screen yet to be
suspicious of. Every other fault costs a **reload** to fix — sub-second. A TMDL fault costs a **cold
open**, because a model Desktop refused is not a model you can reload against: 23 s on a small
project, 159–210 s measured on real ones, plus reading the error and rewriting. **Eight known faults are
mechanical** and take 0.2 s to find — BOM, `//` outside an expression, `///` on a relationship, a
`description:` property, an unquoted name containing a space, a measure and column sharing a name,
and a table called `Measures` or `Goal`. `validate_report` and the pre-flight in
`references/preflight.md` run all eight. A clean check is not a promise that it opens.

### Know what each step costs, and never pay for one you don't need

This is the difference between a loop that takes seconds and one that takes ten minutes, and it is
almost entirely about **not cold-restarting**. Measured on one 3-page, 19-visual project:

**Measured end to end**, on the pass you run most — *six edits made, now verify all three pages,
Desktop already open*: checking after every write and cold-restarting per page took **88.2 s**;
checking once, reloading once and switching tabs took **13.0 s**. **6.8×**, same evidence. **86.8 s
of the 88.2 s was the three cold restarts** — the routing table is the whole saving, and batching
the checks is worth about a second.

| Step | Cost | When you actually need it |
|---|---|---|
| Pre-flight | ~0.2 s | once per **batch** of writes, before you launch or reload |
| `validate_report` | ~0.2 s | once per batch, same point |
| `file.reload/v1` | **0.15–0.8 s** | any edit to a visual, a page, or a new directory of either |
| **Switch page (UI Automation)** | **~0.07 s** + settle | to look at a different page — **never restart for this** |
| Settle after reload or page switch | **~2.5 s** | before every screenshot. Not optional — see the skeleton trap |
| Settle for the **first page after a cold open** | **≥12 s** | the visuals get their query later than the page paints — see the landing-page trap |
| Screenshot (`PrintWindow`) | ~0.2 s | every time you want evidence |
| **Cold restart** | **23 s here; 159–210 s on real projects** | `definition/report.json`, or a model reload Desktop refused |

**A from-scratch build need not pay the cold open at all.** Keep one throwaway scaffold project open
and reload the real payload into it: **44.4 s → 15.8 s** and **50.2 s → 20.7 s**, each against a
cold-open control, same verified pages. The trap that makes it fail — a stale `activePageName`, which
Desktop refuses while the RPC still returns `success: true` — is in `references/verify-loop.md`.

**Author the whole increment, then check it once.** Pre-flight and validate read the project from
disk, so running them after each of twenty writes costs twenty times as much and tells you nothing
the single run would not. The exception is a write you expect to be risky — a hand-written blob, an
unfamiliar property — where checking now saves unpicking which write broke it.

**Measure your own cold restart once** and budget against that rather than either figure quoted
here: it moves with page count, visual count and whether the data is cached (23 s was a small
project opening from `cache.abf`).

### The render states that lie — read `references/verify-loop.md`

A Zebra visual has **three** render states, not two, and the third reads as *my bindings are wrong*
when nothing is wrong at all. A blank canvas after a force-kill is a paint failure, not a load
failure. Both are in **`references/verify-loop.md`**, with the settle thresholds and what may safely
overlap. **Read it before you trust a screenshot.**

### Launching, reloading and capturing — read `references/verify-loop.md`

Everything about driving Desktop lives in **`references/verify-loop.md`**: the dependency-free loop
in full, the in-box Desktop bridge (`file.reload/v1`, and what it does *not* re-read), and running
`EVALUATE` against the live model with no install. **Read it before you launch Desktop, reload it,
or take the first screenshot.**

Two rules from it change what you do *now*, while you are still writing:

- **Check the MODEL before the first open.** Every report-layer fault costs a reload — about a
  second, with the file and the reason named. A model fault costs a **cold open**, because a model
  Desktop refused is not a model you can reload against.
- **Author the whole increment, then check it once.** Pre-flight and validate read the project from
  disk, so running them after each of twenty writes costs twenty times as much and tells you nothing
  the single run at the end would not.

## Registration

`definition/report.json` → `publicCustomVisuals`: a **flat array of GUID strings**. No payload, no
`CustomVisuals/` folder, no "drag it onto the canvas first" — that step is unnecessary, proven from
a cold file. The visual must be installed on the **rendering machine**; registration only says which
installed visuals this report may use.

```json
"publicCustomVisuals": [
  "ZebraBITablesPlus3E6085701D7B426980C3859B16327993",
  "ZebraBIChartsPlusC3F2FD9F79054F76BD1B722E7666AC33",
  "zebraBiCards2C860CFAA9944091B75F0DBD117F20FA"
]
```

**That is the default set: Tables+, Charts+, and Cards** (which has no Plus variant). Swap the first
two for `ZebraBITablesBAE31B370F254F808553548EFB35BFA5` and
`waterfall6C9ED82ABD1F44C4A0D590CE01EB5EE7` when the certified track is called for —
`references/visuals.md` has the full table and the four conditions that decide it. **Register only
what the report uses**, and every GUID it uses.

**Author with those GUIDs.** Templates embed *different* GUIDs for the same products (they ship by
file-import at 6.0–7.8). A template's own GUIDs are for **reading** it; authoring with one produces a
visual Desktop cannot resolve. Charts' GUID says `waterfall` for historical reasons — it is the
whole Charts product, not "the waterfall visual" — and **Charts+ does not carry that prefix at all**.

☠️ **A `visualType` the rendering machine cannot resolve renders NOTHING — no error, no placeholder,
no dialog, just empty canvas where the visual should be.** A one-character typo in a GUID, or a Plus
visual on a machine without it installed, looks exactly like a visual you forgot to author. Verified
against a deliberately-unresolvable GUID: stable blank across two captures four seconds apart, one
visible top-level window, so the load-dialog check never fires either. **If a visual is simply absent from
the screenshot, suspect the GUID before you touch the bindings.**

### The other two registration mechanisms — read `references/visuals.md`

`publicCustomVisuals` is one of three. The other two use **different GUIDs for the same product**,
so a visual that comes back as a grey box is usually a mechanism mismatch rather than a binding
fault. **`references/visuals.md`** has both, and the two experiments that settled them.

## Bindings are the product

Roles are **uniform across every one of them**, so chart↔table is a one-line `visualType` swap with
the query untouched — and so is certified↔Plus, which is the same swap with the same query:

`Category` · `Group` · `Values` · `PreviousYear` · `Plan` · `Forecast` · `Tooltips` · `Comments` ·
`Filters` — plus `CategoryClass` (Tables) and `KPI Descriptions` (Cards).

Zebra derives scenario notation, variance calculation, delta labels and IBCS colour
**deterministically from the binding**. No DAX, no properties. Get the binding right and most of
the report is already correct.

- **`Values` and `Plan` are two separate wells needing two distinct fields.** Scenario-as-rows
  cannot feed both, so a visual-level filter pinning one scenario cannot work. Scenario logic
  lives in DAX (`CALCULATE([Value], Scenario[Scenario]="AC")`).
- **`PreviousYear`/`Forecast` need time in the grouping or the filter.** Without it a PY measure
  shifts a window still covering all data: **PY ≡ AC, ΔPY a flat 0.0%** — correct, empty, looks fine.
- **Time runs along Charts' X axis; a Table's `Category` is for STRUCTURE.** Months bound as the
  rows of a Zebra Table read as time on the Y axis, and a human reviewer called it out the one time
  it appeared. Periods → a Charts visual (`Category` = month). Accounts, products, regions → a
  Table. Only bind time as table rows when the user explicitly asks for that layout.
- **A role takes a LIST**: two `Category` projections = an expandable tree on **Tables**, but a
  stacked axis of the LEAF members on Charts and Cards, which cannot expand at all; two `Group`
  projections = 2D small multiples.
- **`Filters` takes MEASURES**, and is how a visual reaches a **data island** the relationships
  cannot. It is not the visual's `filterConfig`.

## Tooltips — read `references/visuals.md`

Two mechanisms: extra measures in the default bubble, and a whole report page on hover. Both are
authorable and both are written up in **`references/visuals.md`**, with the required key set for a
tooltip page. **Read it when you decide you want a tooltip.**

## The report layer computes more than you think

Before adding a measure to the model, check whether the report can already do it:

- **`categoriesMetadata.addedFormulas`** is a calculation engine — expressions over category names
  that do arithmetic and **chain**, so a whole KPI model can live in the report layer over raw
  accounts. Worked example in `references/recipes.md`.
- **A repeated time frame is a calculation group, not more measures** — one item re-times every
  scenario role at once. `references/design.md` §13.
- **`annotationLayerSettings`** authors the commentary — anchored to a data point and a filter
  state, rich text, numbered bubbles. No model measure needed. **Read back from a Desktop-written
  file and it is the one blob with no human step in it**: the `uuid` is a random **v4**
  GUID you mint, and the anchor is **plain data values** off the binding — unlike Cards `kpiInvert`,
  whose ids must be minted by Desktop first. Pair it with `commentBoxSettings.show: true` or nothing
  appears. **Authoring is PROVEN** — end to end, including on a brand-new agent-authored Table on a
  brand-new page with no Desktop step anywhere. `dataProperty` = **7 + the index of the
  projection in `Values`**. ⚠️ **`filterContexts` is mandatory and must match the live filter state —
  omitting the KEY blanks the entire visual.** `validate_report` checks the shape.
- **Variances, IBCS notation and colour** come from the binding. Never write DAX for a ΔPY.

**Do not hand-write a JSON-string property if the encoder tools are available.** A blob is JSON
inside a JSON string inside a quoted literal, three layers deep, and the mistakes it invites are
the expensive kind: an absent `filterContexts` key blanks the entire visual, and a computed row
lands in the grand total unless it is also excluded, which produces a bold, plausible, wrong
total. The encoders make both unreachable by requiring the field:

| Ask for | Tool |
|---|---|
| Per-column order, formatting, in-cell charts | `encode_table_columns`, after `encode_table_calculations` |
| Computed rows and ratios in the report layer | `encode_added_formulas` |
| The comment layer | `encode_annotations` |
| A rectangle or ellipse over Table cells, with or without a comment on it | `encode_highlights`, then `encode_annotations` with `highlightId` |
| A CAGR arrow on a Chart | `encode_cagr_arrows` |
| View-mode comments on a Plus visual: the link to the SharePoint workbook | `encode_storage_config` |
| Hatched forecast steps on ONE Chart series, without the `Forecast` role | `encode_category_scenarios` |
| One Card inverted rather than all of them | `plan_card_invert`, then `encode_card_invert` |
| Result rows, highlighted categories, inverted groups, collapsed groups | `encode_data_value_list` |

Each returns the property path and a `literal` to splice in unchanged; `write_visual` takes the same
inputs as spec keys. Read the `companion`: several need something set *outside* the blob before
anything renders — the commonest reason a correct blob shows nothing. Without the tools, hand-write
it from `references/formatting.md` and check twice.

The model owns the *facts*. The report layer owns rather more of the *reporting* than a
Power BI instinct expects.

## Where things live

| I want | It lives in |
|---|---|
| **Check it before you launch — BOM, mojibake, bad JSON, missing theme, dead title tokens, TMDL killers** | **`references/preflight.md`** — run after every write, whole project |
| **Write the model — measures, calendar, relationships, TMSL refresh** | **`references/model-layer.md`** — the write gate is open |
| **TMDL itself — grammar, every object and property, exact load errors, proven constructs** | **`references/tmdl.md`** |
| **Writing or debugging DAX — engine messages, blank/zero, variance sign, house style** | **`references/dax.md`** — check measures with `EVALUATE` before you launch |
| Roles, GUIDs, per-product differences; drillthrough, `expansionStates`, `loadStrategy` | `references/visuals.md` |
| Property names, literal encoding, the colour gate | `references/formatting.md` |
| Page archetypes that work — seven, incl. Excel → executive page | `references/recipes.md` |
| **The analyst layer — reader, comparison, period, fiscal year, polarity, report families, decompositions, handover** | **`references/analyst.md`** — plan step 0; §8 at delivery |
| **Which form, how big, what scale, what order, what title, which depth mechanism — the design layer** | **`references/design.md`** — read before the first `position` |
| **A property you set was ignored, or the page renders blank or wrong** | **`validate_report`** — the checks live in the tool, with the fix in the message |
| **Is X even possible? What does it depend on?** | **the Zebra BI knowledge base** — see below |

## The knowledge base — what the product can do

This skill tells you **how to write the file**. The knowledge base tells you **what is possible**,
in the words a report author uses.

It is at `https://help.zebrabi.com/`. Articles live at `/kb/<platform>/<article-slug>/`, and it has
a search you can reach directly:

```
https://help.zebrabi.com/kb/power-bi/search/<query>          # spaces become +
https://help.zebrabi.com/kb/power-bi/search/custom+formulas  # worked example
```

The results are rendered by the server, so a plain fetch reads the titles and article links. No
browser needed.

**It is an enrichment, not a dependency.** Everything needed to author a correct report is in this
skill and its `references/`. If you cannot reach the knowledge base, say so plainly and carry on
authoring. Never block a report on a lookup.


Three things from it that change how you author:

- **Text properties take measure tokens**, on the same `Filters`-role gate static text uses:
  `titleSettings.text = 'Revenue [Selected Year]'`, and `legendHeaderSettings.<scenario>` too —
  the answer to hand-written ΔPL labels.
- **Card size comes from `grid.cardsInRow` and the container height** (≈264px with `Values` +
  `PreviousYear`), not from `globalCardSize`. That blob is what Zebra BI writes into its own files,
  and it carries per-card entries keyed by content hashes an agent cannot compute; an authored one
  with an empty `cards{}` is accepted and changes nothing, so it is not an authoring lever.
- **`legendHeaderSettings` is not an opaque bag.** It is the
  same scenario-key vocabulary as `columnSettings`.

## Hit something this skill gets wrong? Write it down before you act on it

A single session's finding is a **hypothesis**, not a rule. Two kinds of claim look most convincing while being wrong most often.

So write down what you actually saw, as a dated file beside the report you were building:

```
./zebra-bi-findings/YYYY-MM-DD-<short-topic>.md
```

Say plainly which kind of evidence you have, then send it to Zebra BI support if you want it looked at. Nothing is sent anywhere on its own. Two lines matter most:

- **A negative result needs reproducing.** "X is impossible" / "Y is silently ignored" is the class
  of claim that is wrong most often, and it always looks convincing.
- **Number claims need an oracle, not internal consistency.** Say which check you actually ran.


## Non-negotiables

1. **Look at the screenshot.** A wrong conclusion almost always traces back to trusting something that was not a render. **But do not make the render do a regex's job** —
   run `references/preflight.md` after every write. Mojibake in a title, a BOM, a missing base
   theme and a TMDL name collision are all mechanically detectable in ~1s, and none of them is visible in a render. A mangled title still looks like a title.
2. **Don't guess property names.** Cards declares `design`; Charts and Tables declare
   `designSettings`. Same concept, different name. Guessing by analogy breaks the visual and
   nothing tells you. Look it up in `references/visuals.md` and `references/formatting.md`, which
   ship with this skill.
3. **Get the literal tag right.** Numeric-valued enum → `4D`. Integer → `2024L`. Word enum →
   `'Custom'`. A numeric enum written as a word is not a declared value and is silently ignored.
4. **Beautiful and wrong is the default failure.** Zebra renders a gorgeous statement from
   unfiltered data without complaint. Check a number against a known value before believing a page.
