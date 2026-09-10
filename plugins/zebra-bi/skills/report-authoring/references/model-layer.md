<!-- Summary: Authoring the semantic model in TMDL — the write gate, the pre-flight lint, refresh, measure conventions and the calendar table. Everything here was verified against a DAX oracle with a cold-open control. -->
# The model layer — you may write it

**This supersedes "Do not write these yourself. Desktop owns the model."** That rule was true when
written; its stated reason was loop cost (one error per ~60s restart, no headless TMDL check), and
the Desktop Bridge — now an official Microsoft preview, on by default since June 2026 — removed it.

Verified with predictions registered before each query and a **cold-open control**:
measures, a calculated calendar table (incl. `dataCategory: Time` and `sortByColumn`), and a
relationship were all accepted by Desktop and returned values exact to the last digit.

- **`lineageTag` is optional** on measures, tables and columns. You need not mint GUIDs.
- **Relationship names need not be GUIDs** — a readable identifier works.

## Run the pre-flight lint BEFORE you launch

> **`references/preflight.md` is the one to run.** It checks the whole project — this model lint
> **plus** the report layer (BOM, mojibake, unparseable JSON, missing pages, missing base theme,
> unresolvable title tokens) and the `compatibilityLevel` reload blocker. The script below is the
> model-only subset, kept here because this is the file you are reading when you write TMDL. If you
> only run one, run `preflight.md`.

Mechanical errors in TMDL cause a **cold-open failure**, and a cold open has no running instance
to `file.reload/v1` against — so each one costs a cold open (23 s on a small project, minutes on a
real one) instead of ~1s. Run a check after every model write.

⚠️ **This file's PowerShell block is the OLD five-check subset**, kept because this is the file you
are reading while you write TMDL. `references/preflight.md` checks **twelve** and is the complete
one: it adds `description:` used as a property, an unquoted name containing a space, a table
named `Goal`, and four grammar checks (duplicate object, description gap, unresolved relationship
endpoint, missing `database` line). `validate_report` runs all of them and more. If you have either,
use it — the block here is the fallback of the fallback, and it misses faults sessions actually hit.

```powershell
$root = "<Project>.SemanticModel\definition"
$issues = @(); $measures = @{}; $columns = @{}
foreach ($f in (Get-ChildItem $root -Recurse -Filter *.tmdl)) {
    $b = [System.IO.File]::ReadAllBytes($f.FullName)
    if ($b.Length -ge 3 -and $b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191) {
        $issues += "BOM: $($f.Name) - TMDL requires UTF-8 without BOM" }
    $lines = [System.IO.File]::ReadAllLines($f.FullName); $tbl = ""
    $inFence = $false; $exprIndent = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $ln = $lines[$i]; $t = $ln.Trim()
        $ind = (($ln -replace "`t", '    ') -replace '\S[\s\S]*$', '').Length
        # `//` is legal DAX. Only a `//` OUTSIDE an expression body is a TMDL fault, so the body
        # has to be tracked: a fence OPENS at the end of an assignment line, and a bare `=` opens
        # an indented body. Skip this and every commented line of DAX is reported as a fault.
        if ($inFence) { if ($t -eq '```') { $inFence = $false; $exprIndent = -1 }; continue }
        if ($t.EndsWith('```') -and $t -ne '```') { $inFence = $true; continue }
        $inExpr = $false
        if ($exprIndent -ge 0) {
            if ($t -eq '') { $inExpr = $true } elseif ($ind -gt $exprIndent) { $inExpr = $true } else { $exprIndent = -1 }
        }
        if (-not $inExpr -and $ln -match "^\s*(?:[A-Za-z_]\w*\s+)?(?:'[^']*'|[A-Za-z_][\w .\-]*)\s*=") { $exprIndent = $ind }
        if ($inExpr) { continue }

        if ($t -match '^//(?!/)') { $issues += "COMMENT: $($f.Name):$($i+1) - '//' is not TMDL" }
        if ($t -match '^///') {
            for ($j = $i + 1; $j -lt $lines.Count; $j++) {
                $n = $lines[$j].Trim()
                if ($n -eq '') { continue }
                if ($n -match '^///') { break }
                if ($n -match '^relationship\b') {
                    $issues += "DESC ON RELATIONSHIP: $($f.Name):$($i+1) - relationships take no /// description; model load fails" }
                break
            }
        }
        if ($ln -match '^table\s+(.+)$') { $tbl = $Matches[1].Trim().Trim("'")
            if ($tbl -eq 'Measures') { $issues += "RESERVED NAME: $($f.Name) - 'Measures' is a reserved table name; Desktop refuses the model. Use '.Measures'" } }
        if ($t -match "^measure\s+'?([^'=]+?)'?\s*=") { $measures["$tbl|$($Matches[1].Trim())"] = 1 }
        if ($t -match "^column\s+'?([^'\r\n]+?)'?\s*$") { $columns["$tbl|$($Matches[1].Trim())"] = 1 }
    }
}
foreach ($k in $measures.Keys) { if ($columns.ContainsKey($k)) {
    $issues += "NAME COLLISION: $k - measure and column share a name; Desktop will refuse to open" } }
if ($issues.Count -eq 0) { "PASS ($($measures.Count) measures, $($columns.Count) columns)" }
else { $issues | ForEach-Object { "  - $_" } }
```

### The eight we check

Each of these is a **cold-open** failure, which is the expensive kind: there is no running
instance to `file.reload/v1` against, so the fix costs a restart rather than a second. All eight are
checked by `validate_report` and by the pre-flight in `references/preflight.md` (which also carries
four of the grammar checks from `references/tmdl.md`), and all eight stay
silent on the 20 shipped Zebra BI templates and on a 1,325-file corpus of real models.

**These are the eight that are known and mechanical, not a complete list of ways TMDL can fail** —
so a clean check means these eight are absent, not that the model opens.

**1. UTF-8 BOM.**

A TMDL file must be UTF-8 with **no** byte-order mark. One BOM makes Power BI Desktop reject the
whole semantic model, not just that file, and the message names an encoding problem rather than the
file you last edited. `validate_report` catches this.

`Set-Content -Encoding utf8` in **PowerShell 5.1 writes a BOM** and `utf8NoBOM` does not exist
there. Use
`[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`.
Claude's Write/Edit tools are BOM-free; only the PowerShell hop introduces it.

**2. `//` is not a TMDL comment.**

Outside a measure's expression, a line starting with `//` is not a comment in TMDL and the model
fails to load with *"Parsing error type - InvalidLineType — Unexpected line type: Other!"* naming
the line. Use `///`, which is a description attached to the object on the next line. `validate_report` catches this.

**Inside** a DAX expression `//` is perfectly legal and extremely common, so the check only looks
outside expression bodies.

**3. A `///` description above a relationship.**

A relationship takes no `///` description. One attached to a `relationship` block fails the model
load. The same line is correct and useful on a measure, a column or a table. `validate_report` catches this.

Never leave a blank line between `///` and the object it describes either.

**4. Measures and columns share one namespace.**

Within one table a measure and a column cannot share a name. Desktop refuses the model with *"The
'Sales' measure cannot be created because a column with the same name already exists."* The same
name in two **different** tables is fine. `validate_report` catches this.

Rename the raw column (`Sales Amt`), hide it, and expose the clean name as the measure — which is
better modelling anyway.

**5. `Measures` is a reserved table name.**

A table named exactly `Measures` fails the whole model load with `ModelSchemaValidationFailed:
Unsupported Table name "Measures"`. Name your measure-holder table something else — `.Measures`
works, and the leading dot also sorts it first in the Data pane. `validate_report` catches this.

It is a long-standing convention, not a workaround invented here.

☠️ **`Calculations` is the other name to avoid, and it bites in DAX rather than at load.**

`Calculations` is a reserved word in DAX. A table with that name loads fine, but **every unquoted
reference to it in an expression fails** — `Calculations[x]` and `COUNTROWS(Calculations)` both give
*"The syntax for 'Calculations' is incorrect"*, a message that sends you looking at your brackets.
Single-quote it (`'Calculations'[x]`) or, better, name the measure-holder table something else. `validate_report` catches this.



**6. `description:` is not a TMDL property.**

TMDL has no `description:` property. A line like `description: Revenue actuals` under a measure,
column or table fails the model load with *"Unsupported property - description is not a supported
property in the current context!"*. Descriptions are written as a `///` line **above** the object. `validate_report` catches this.

This is the one an agent invents rather than copies: `description:` is a property name in almost
every other schema, and nothing about the TMDL a model already contains suggests otherwise.


**7. A name containing a space must be quoted.**

An object name containing a space must be single-quoted: `table 'Financial Data'`, not `table
Financial Data`. Unquoted, TMDL reads the second word as the start of the body and reports an
**indentation** error on a line whose indentation is correct — so the message sends you to the
wrong place. Applies to every declaration: `table`, `column`, `measure`, `partition`, `hierarchy`. `validate_report` catches this.

Only the **name** needs quoting. Spaces inside the expression after `=` are ordinary DAX and need
nothing.

**8. `Goal` is a reserved table name, and it fails silently.**

A table named `Goal` loads without complaint and then breaks every visual bound to it: each renders
*"Something's wrong with one or more fields"* while the table itself looks perfectly healthy in the
Data pane. Rename it — `Goals` or `Target` both work. `validate_report` catches this.

Unlike `Measures` in rule 5, this one **opens**. That is what makes it worse: the model is fine, the
report is broken, and nothing connects the two.

**The reserved names, in one place.** The list is not intuitive, and each fails differently:

| Name | What happens | Fix |
|---|---|---|
| table `Measures` | the model does not open | `.Measures` |
| table `Goal` | opens; every visual bound to it shows *Something's wrong with one or more fields* | `Goals`, `Target` |
| table `Calculations`, `Measure` | opens; every **unquoted** DAX reference to it is a syntax error | quote it, or rename |
| a `VAR` named after a DAX function (`Filter`, `Sum`, `Date`, `Rank`, `Value`, …) | the measure errors and the visual blanks | add a noun: `SalesValue` |

Anything not on this list has been loaded without incident; a name that fails and is not here is a
finding worth filing.


### `compatibilityLevel` is reported, not flagged

A model at `compatibilityLevel: 1600` is **not** broken — 17 of the 20 shipped templates are at
1600 and 3 at 1601, and every one of them opens. It matters for exactly one thing: Desktop raises
the level **in memory** when it opens the project (to 1606 on a 2.156 build; a 2.157 build accepts
1606 through 1702 as written and runs at 1700 when `database.tmdl` is missing), so `file.reload/v1`
against a file still saying 1600 is refused as a downgrade. Every PBIP authored this way hits this.

So `validate_report` and the pre-flight **report the number** rather than raising a finding. If you
intend to use reload, set `compatibilityLevel: 1606` in `database.tmdl` first — but know the cost:
a 1606 file **refuses to open on an older Desktop**, so do not raise it on a file you are handing
to someone else without asking.

## Refresh — YOU run it. Never the user, never a keystroke

A **calculated** table computes on load. A **Power Query** partition does **not**, and Desktop does
not refresh on open — you get a structurally perfect model with every table empty and a banner
reading *"Some of the tables have incomplete or no data."* That is expected, and **it is yours to
fix, not the user's**. The bridge cannot do it (`bridge.manifest` exposes no refresh — the manifest lists exactly four methods, and none of them is refresh or DAX), and on
Desktop builds before **2.155 (June 2026)** there is no bridge at all. The refresh below needs
neither — it works on any Desktop that has the model open, nothing installed.

Three rules, each of which replaces a failure that actually shipped:

- **Never end a session telling the user to "click Refresh now."** The banner click is not even
  reliable: Desktop is documented as unaware of files changed outside it, and a first click after an
  external write has been observed to do nothing until the file was reopened.
- **Never send keystrokes (F5, Ctrl+R) to refresh.** The foreground lock belongs to whatever the
  user last touched; the keystroke lands in another window and nothing tells you.
- **After every cold open of a PQ-backed model, run the TMSL refresh yourself**, then verify through
  the engine — the whole loop is ~5s and needs no human.

The complete recipe, in-box PowerShell, verified end to end twice (cold open → refresh → exact
oracle match → visuals repainted on their own, banners cleared, zero clicks):

```powershell
# 1. Find the right Desktop instance. msmdsrv is a CHILD process of its PBIDesktop,
#    so the mapping is exact even with several Desktops open.
$pbi  = Get-Process PBIDesktop | Where-Object { $_.MainWindowTitle -match '<your project>' }
$msm  = Get-CimInstance Win32_Process -Filter "Name='msmdsrv.exe'" |
        Where-Object { $_.ParentProcessId -eq $pbi.Id }
$srv  = Get-Process -Id $msm.ProcessId
$port = (Get-NetTCPConnection -OwningProcess $msm.ProcessId -State Listen |
         Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -First 1).LocalPort

# 2. Load the ADOMD client that ships INSIDE Desktop's own package. Nothing to install.
$dll  = Join-Path (Split-Path $srv.Path) 'Microsoft.PowerBI.AdomdClient.dll'
$asm  = [Reflection.Assembly]::LoadFrom($dll)
$t    = $asm.GetExportedTypes() | Where-Object { $_.Name -eq 'AdomdConnection' }
$conn = [Activator]::CreateInstance($t, @("Data Source=localhost:$port")); $conn.Open()

# 3. TMSL full refresh. $conn.Database is the generated GUID, so this is model-agnostic.
$c = $conn.CreateCommand(); $c.CommandTimeout = 300
$c.CommandText = '{"refresh":{"type":"full","objects":[{"database":"' + $conn.Database + '"}]}}'
[void]$c.ExecuteNonQuery()

# 4. Verify THROUGH THE ENGINE, not the eye: row count, then a real aggregate you predicted.
$q = $conn.CreateCommand(); $q.CommandText = 'EVALUATE ROW("n", COUNTROWS(<FactTable>))'
$r = $q.ExecuteReader(); while ($r.Read()) { $r.GetValue(0) }; $r.Close()
```

⚠️ **`type: "full"` re-imports every partition, so on a model whose SOURCE is unreachable it is
the wrong verb.** A `.pbix` whose Power Query points at a workbook nobody can reach still holds its
data in `cache.abf`, and a full refresh throws that away trying to fetch it again. When your edit
only added measures, calculated columns or a calculated table, use `"type":"calculate"` instead: it
recomputes the calculated objects against the data already loaded and touches no source. Measured at
1.4s materialising two new calculated columns on an import table with a dead SharePoint source.

Measured 5–6.7s for the refresh at 720 and at 47,040 fact rows; budget more for a genuinely large
fact. On an **unprocessed** table the count comes back **blank (DBNull), not 0** — that is the
before-state signature, and seeing it confirms you connected to the right instance. Desktop's
visuals repaint by themselves after the refresh, and **every warning banner clears** — the grey
*"incomplete or no data"*, the *"relationships have been modified"* bar, **and the red "calculated
objects need to be manually refreshed"** (verified by before/after captures of the banner strip;
that last one tracks Desktop's compute state, not the partition type, so it shows on any
agent-authored model and this same refresh clears it in ~1s). Understand them, then clear them —
never end your work with a banner on screen for the user to resolve.

**But verify the repaint by screenshot, not by the refresh return code**: in 2 of 24 verified runs
a single Charts visual stayed blank after the repaint while the engine demonstrably held its data
(the visual's own 12-row query returned perfect values; the other 22 runs — including 17 distinct
generated projects — painted fully). If a visual is blank and the engine has the data, it is a
render-side hiccup, not your model: reopen the file (or use a report-only reload where the bridge exists)
and refresh again.

**This is Microsoft's own agentic architecture, not a house hack.** Their official
`semantic-model-authoring` skill routes Desktop refresh to the **Power BI Modeling MCP server**
(`github.com/microsoft/powerbi-modeling-mcp`), which does exactly this — connects to Desktop's
local Analysis Services instance and issues the refresh — wrapped in TOM and distributed via
npx/exe. The recipe above is the same operation without the Node dependency. (One older Learn page,
*External tools in Power BI Desktop*, still calls processing commands against Desktop unsupported;
Microsoft's own MCP shipping refresh is the current word. Cite the MCP repo if anyone asks.)

⚠️ **In-memory only** — no `cache.abf` is written, so the data dies with the process. Re-issue
after every cold open (~5s, no human), and when the report is final, have Desktop save once so the
data persists for the next human who opens it.

### ⚠️ And on a PQ-backed model, `file.reload/v1` is unavailable — budget cold restarts

Reproduced twice on Desktop 2.156.951.0, on two different projects: every `file.reload/v1` against a
model whose fact table is an **M/Power Query partition** raised a **modal**:

> `InvalidPackageReferenceException — Could not find a PackageSession for the given sessionID`
> (`MashupContextProvider.OnEvaluationPreamble`)

Two things make this worse than a plain failure:

1. **The RPC still returned `{"result":{"success":true}}`** with the dialog on screen. This is the
   reload-false-green family with a new face — not a stale render, a *success code over a failed
   operation*.
2. **A modal is invisible to every non-visual probe.** `MainWindowTitle` stayed correct, the pipe
   kept answering, ADOMD kept serving queries. Nothing in a text-only loop can see it.

Reload-as-validator was verified on a model of **calculated
tables and measures only**. It bounds it. **On a PQ-backed model, treat reload as unavailable, batch
your edits, and budget a cold restart (your own first open's time, plus the refresh) per model change.**

**And screenshot the screen after any state-changing bridge call**, not only when something already
looks wrong. A modal wedges the bridge, and the CLI can neither see nor dismiss it; a return code is not evidence that it didn't happen.

### ☠️ After a model-SHAPE change, reload then refresh — and if the refresh does not return, cold restart, never reconnect

The instruction is at the end of this section; the paragraphs before it are the evidence, including
the hang that was first read as "never reload a model change". Reproduced twice in one session on
Desktop 2.156.951.0. Remove a table and its relationship from
TMDL, call `file.reload/v1` with `reloadModelDefinition: true`, then run the TMSL refresh. The bridge
answers `{"success":true}` at once and `application.state.get/v1` reports no unsaved-change problem.
**The refresh then never returns** — no exception, no timeout, and `CommandTimeout` is ignored.

Two details are what make this the most expensive single move in the loop:

1. **The hang holds a server-side lock.** A second, independent process opening its own connection
   hangs identically until the first one is killed, so the obvious recovery — reconnect — does not
   work. Only killing the caller and cold-restarting Desktop clears it, after which the same refresh
   completes in its usual few seconds.
2. **Recovery costs a force-kill, and a force-kill cascades.** A force-killed Store-app Desktop
   leaves stale AutoRecovery files that raise a banner on the next open, and can relaunch into a
   blank Report view. One reload decision turns a few minutes of authoring into an hour of recovery.

**So: batch the model edits, then cold restart before the next refresh.** Reload stays the right
instrument for report-layer changes, and `reloadModelDefinition: false` is not affected.

⚠️ **The cause named here is WRONG, and the arm that settles it has now been run.**

The hang was reproduced by **removing a table AND its relationship**, and a project whose entire
table set was **replaced** reload+refreshed cleanly. Those two observations differ in **two** ways,
not one — the operation changed at the same time as the relationship did — so "relationships cause
it" was an untested guess that happened to fit.

Four cells over one base model, each axis moved on its own, each cell on its own cold instance, two
passes, verdict rule fixed in advance (HANG = the refresh does not return within 60 s):

| | remove a table | replace table set |
|---|---|---|
| **with a relationship** | **CLEAN** 789–928 ms | **CLEAN** 793–1023 ms |
| **no relationship** | **CLEAN** 773–785 ms | **CLEAN** 780–855 ms *(positive control)* |

**8/8 clean.** The positive control — the already-observed clean case — came back inside its known
0.3–1.6 s band on every pass, so the instrument reproduces the result it should before anything is
read off the other cells.

**Two conclusions, and the second matters as much as the first.**

1. **A relationship does not cause it.** The cell that matches the reported hanging shape exactly —
   with a relationship, remove a table — refreshed in under a second, twice.
2. **The original hang did not reproduce at all**, on any cell. So this is not "relationships are
   innocent, mystery solved"; it is "the stated cause is refuted and the hang is unexplained." The
   observation was real and reproduced twice when it happened. What differs is the *project*: the
   hang was on a real model, and this was two three-row DATATABLE tables. Scale, partition type
   (a PQ-backed table is already known to break reload) and measure dependencies are all still
   candidates and none has been tested.

**So the instruction is unchanged in practice, and its reason is now honest:** a model change needs
`reload` + TMSL refresh, and **if the refresh does not return within a few seconds, kill and cold
restart** — the hang holds a server-side lock, so reconnecting will not save you. Do not spend a
cold open in advance on every model edit; the refresh usually returns in about a second. Do not
delete this warning on the strength of eight clean cells on a toy model.



### ☠️ A relationship onto a CALCULATED table needs the column bound by inferred name

On a calculated (`DATATABLE`) table, a column binds to the DAX output through **`isNameInferred` and
a bracketed `sourceColumn: [K]`**. Written the imported-table way — `sourceColumn: K` — the column
does not bind, and any **relationship** onto it fails the entire model at cold open with
*"Relationship 'X' uses an invalid column ID 17."* The message names the relationship, so the
relationship is what gets rewritten; the relationship is correct and the **column** is the fault. `validate_report` catches this.


```
	column K
		dataType: string
		summarizeBy: none
		isNameInferred          ← both of these
		sourceColumn: [K]       ← and the brackets
```

**Why this one is worth a rule rather than a sentence: without a relationship it is invisible.** The
table loads, `COUNTROWS` returns the right number, the report renders. Nothing is wrong until
something relates to that column, and then the failure is a **cold open** — no running instance to
reload against, and a modal on screen rather than a message in your terminal. Verified by four
cells: with the imported form the two related arms would not open at all, and with the inferred form
all eight passes loaded and refreshed in under a second.

## Do not bake a computed value into a column just because you can compute it while writing

When the agent is generating the rows anyway, it is very easy to compute *days past due*, an ageing
band, a margin, or a flag in the generator and embed the answer as a column. It renders. It matches
the oracle. **And it is not a model** — it is a picture of one moment, and it is the difference
between something a BI developer would ship and something they would reject on sight.

**The test is: does the value depend on anything outside the row?** A settlement date either exists
on the row or it does not, so a `Settled` flag is a fact and storing it is correct. *Days past due*
depends on an **as-at date**, so storing it freezes the ageing at build time: the report shows the
same bands next month, next year, and after a refresh that adds a hundred invoices. Nothing errors.

So:

- **Derive the as-at date in DAX** from the data itself — `CALCULATE ( MAX ( 'AR'[InvoiceDate] ),
  ALL ( 'AR' ), ALL ( 'Calendar' ) )` — and compute the age from it in the measure.
- **Put band boundaries in a disconnected dimension**, not in a chain of `IF`s. A table of
  `Band / MinDays / MaxDays / Sort` that the measure reads with `MIN` and `MAX` is editable by a
  human, sortable, and bindable to `Category` or `Group`. Thresholds buried in an expression are
  none of those things.
- **A category with a rule behind it belongs in a dimension too.** Deriving an account type from
  `IF ( [AccountNumber] < 5000, "Revenue", "Expense" )` invents a chart-of-accounts convention and
  hides it inside a measure. Build the account dimension, put the type on it as an attribute, and
  derive the attribute from what the accounts actually **do** — the revenue accounts post only to
  Credit and the expense accounts only to Debit — rather than from a numbering convention nobody
  stated.

## Several currencies and no rate: the total is the wrong answer, so do not let it be computed

A ledger, a receivables book or an expense file with a `Currency` column and **no exchange-rate
column anywhere** cannot be summed. Nothing stops it: `SUM([Amount])` returns a large, plausible,
meaningless number, and every consistency check agrees with it because every visual is adding up the
same wrong thing.

**Make it unreachable rather than documenting it.** Guard every amount measure:

```dax
AR amount = IF ( HASONEVALUE ( 'Currency'[Code] ), SUM ( 'AR'[Amount] ) )
```

It returns blank until exactly one currency is in context, so a cross-currency total cannot be
rendered even by someone who drags the field onto a new visual later. Pair it with a currency slicer
carrying a default, and lead the page with the measures that **have no currency at all** — counts,
days outstanding, ageing, rates. Those carry most of the story, and they are true regardless.

**And do not invent rates to make the total work.** If the business needs one number, that is a
question for the data owner, not a gap for the author to fill.

**The middle case: the currency sits on the entity, not on the transaction.** A group ledger whose
organisation table carries a `CurrencyKey` per subsidiary and whose amounts are already
consolidated is not a multi-currency book, and guarding every total would blank every page of a
report that is right. Read which it is before you guard: if the amounts reconcile to a group total
the reader already has, or every account is typed as one reporting currency, treat the currency
column as a **perimeter fact** — state *"amounts assumed to be in one reporting currency; the
organisations carry four currency keys and no rate table exists"* in the plan and the handover,
list the members on the definitions page, and keep the `HASONEVALUE` guard only for pages sliced
by entity. Blanking a consolidated total and summing unrestated local amounts are both wrong; the
assumption, stated where the reader will see it, is the analyst's answer.

## Want a `.pbip` that opens anywhere? Embed the fact table as a `DATATABLE`

The counterpart to the section above. **A Power Query partition is the right answer for live data and
the wrong answer for a report you hand to somebody**, because it drags four problems with it. Embedding
the rows as a **calculated table** removes all four at once.

| Power Query partition | `DATATABLE` calculated table |
|---|---|
| absolute path into somebody's `Downloads` — breaks on every other machine | no external reference at all |
| does **not** refresh on open → structurally perfect, **EMPTY** model + a banner | computes on load |
| needs `.pbi/cache.abf` to survive the copy, or a TMSL refresh per cold open | nothing to carry |
| **`file.reload/v1` raises a modal** (above) → a cold restart per model change | **reload works** — measured below |

Proven on Microsoft's `Financial Sample.xlsx`: **700 rows × 14 columns**, cold open,
computed first try, four Zebra visuals rendering values exact against a DAX oracle.

```tmdl
partition financials = calculated
	mode: import
	source =
			ADDCOLUMNS (
			    DATATABLE (
			        "Segment", STRING, "Country", STRING, "Units Amt", DOUBLE,
			        "Year", INTEGER, "MonthNo", INTEGER,
			        {
			            {"Government","Canada",1618.5,2014,1},
			            {"Government","Germany",1321,2014,1}
			        }
			    ),
			    "Date", DATE ( [Year], [MonthNo], 1 )
			)
```

**Reload was measured on this model, not inferred** — both arms, then screenshotted to rule out the
success-code-over-a-modal case:

| arm | result | elapsed |
|---|---|---|
| `file.reload/v1` `reloadModelDefinition: false` | `{"success":true}`, no modal, data intact | **935 ms** |
| `file.reload/v1` `reloadModelDefinition: true` | `{"success":true}`, no modal, data intact | **928 ms** |

So the ~1s loop is available on a calculated model, including the **model** arm that dies on a PQ
partition. That is the whole reason to prefer this shape while iterating.

**Encoding rules, each of which cost something:**

- **No `DATETIME` literal.** Pass `Year` + `MonthNo` as `INTEGER` and derive the date in the wrapping
  `ADDCOLUMNS`. Sidesteps the question of what counts as a DATATABLE constant.
- Every column of a calculated table needs `isNameInferred` + `sourceColumn: [Name]`.
- **Every data row must sit at ≥ the partition expression's base indent** (4 tabs) or TMDL raises
  *"Invalid indentation was detected!"*.
- **Emit numbers with `InvariantCulture` and `'0.####'`.** A culture-formatted double injects thousands
  separators into the DAX.
- **Assert the generated rows before writing.** A multi-line PowerShell `@(...)` literal fed to
  `-join ','` produced 700 **space**-separated rows — valid-looking and completely wrong. Use
  `List[string]` + `[string]::Join`, then count the separators on row 0.

**Portability was TESTED, not inferred.** "No absolute path" is necessary and not sufficient, so:
the project folder was **byte-copied to a different path**, its `.pbi/` (and therefore `cache.abf`)
**deleted**, and cold-opened. All 24 visuals on 4 pages rendered with correct values and resolved title
tokens. That is the claim — a copy of this project opens and works with no cache, no source workbook,
and no path fixing.

⚠️ **But copy it BEFORE Desktop saves, or delete `.pbi/` in the copy.** Once Desktop saves, the folder
carries a ~100 KB `cache.abf`, so *"nothing to carry"* stops being true of the file as it stands — and
a copy made after a save no longer tests the DATATABLE at all, because the cache alone would open it.

**Limits, stated plainly.** Three facts on two machines: the 700-row `Financial Sample` workbook; an
**18,760-row, 1.1 MB `DATATABLE`** (15 columns) that cold-opened, TMSL-refreshed in under five
seconds across four cold opens, and rendered 32 visuals on four pages with every figure agreeing
with a Python oracle computed before the model existed; and a **39,409-row, 1.1 MB ledger** (five
narrow columns) that cold-opened first time, refreshed in 4.7 s, and rendered four Zebra Tables
whose every figure matched an oracle computed from the CSV to the cent. So the ceiling is **at
least 39,409 rows**; beyond that it is unknown, and a fact of a hundred thousand rows is a question
you settle with one cold open, not one you assume. It is a **snapshot**: it does not refresh, by
design. The
*"calculated objects need to be manually refreshed"* banner still appears on cold open — it tracks
whether Desktop has computed and persisted the model, not the partition type, and shows on any
agent-authored model. **The TMSL refresh clears it, no human step** — verified by before/after captures of the banner strip on a fully-calculated
model (~1s, data already computed; the refresh exists here purely to clear the banner and recompute).
So run the refresh after a cold open **even on a DATATABLE model**, and every warning banner — this
one, *"incomplete or no data"*, and *"relationships have been modified"* — is gone without the user
touching anything. A Desktop save remains the way to **persist** the computed data.

## A parent-child chart of accounts: flatten it in the model, sign it from the operator

A warehouse ledger ships its accounts as a **parent-child** table — `AccountKey`,
`ParentAccountKey`, and an `Operator` column reading `+`, `-` or `~` that says how each account
rolls into its parent. Zebra hierarchies come from level columns, and a P&L needs the subtotals
signed, so both are made in the model. Verified against an oracle computed from the source file on
a 99-account, six-level tree: every node figure matched to the cent.

```dax
ParentKey = IF ( Accounts[ParentAccountKey] = 0, BLANK (), Accounts[ParentAccountKey] )  // PATH wants BLANK at the root
Path      = PATH ( Accounts[AccountKey], Accounts[ParentKey] )
Level1    = LOOKUPVALUE ( Accounts[AccountDescription], Accounts[AccountKey], PATHITEM ( Accounts[Path], 1, INTEGER ) )
Level2    = VAR k = PATHITEM ( Accounts[Path], 2, INTEGER )                 // and so on to the deepest level
            RETURN IF ( ISBLANK ( k ), Accounts[Level1], LOOKUPVALUE ( Accounts[AccountDescription], Accounts[AccountKey], k ) )
Sign      = VAR p = Accounts[Path]                                           // +1 or -1 relative to the root
            RETURN PRODUCTX ( GENERATESERIES ( 1, PATHLENGTH ( p ) ),
                       IF ( LOOKUPVALUE ( Accounts[Operator], Accounts[AccountKey], PATHITEM ( p, [Value], INTEGER ) ) = "-", -1, 1 ) )
```

Three rules that make it hold together:

- **Fill a ragged branch down** (`IF ( ISBLANK ( k ), Accounts[Level1], … )`), or a leaf two levels
  above its neighbours shows as a blank member on every deeper level.
- **A leaf's sign relative to any node is `Sign(leaf) × Sign(node)`**, because both are relative to
  the root. So one measure serves every subtotal row of a scheme:
  `Node AC = SUMX ( VALUES ( PnL[NodeKey] ), VAR k = PnL[NodeKey] RETURN CALCULATE ( [Signed AC], FILTER ( ALL ( Accounts ), PATHCONTAINS ( Accounts[Path], k ) ) ) * LOOKUPVALUE ( Accounts[Sign], Accounts[AccountKey], k ) )`,
  with `Signed AC = SUMX ( Fact, Fact[Amount] * RELATED ( Accounts[Sign] ) )`. A cost node then
  reads as the positive cost it is, and a result node as revenue less cost.
- **`~` is a heading, not a sum.** Statistical accounts (headcount, units, square footage) sit under
  it and must never reach a money total; filter them out of every amount measure by `AccountType`.

Bind the scheme rows to `Category` from a small `PnL` table (`Node`, `NodeKey`, `Category Class`,
a `Sort` column) and the class to `CategoryClass` — `references/visuals.md` has the value domain —
and the statement draws itself.

## Measure conventions — follow the house style

Zebra's own KB (`help.zebrabi.com/kb/power-bi/basic-measures/`) names measures
`<metric> AC | PL | FC | PY` — *Revenues AC*, *Costs PL*, *Revenues PY*. The **binding** drives the
variance, not the name, but **the name renders on the visual**, so it is what the reader sees.

```dax
Sales AC = SUM(financials[Sales Amt])
Sales PY = CALCULATE([Sales AC], DATEADD('Calendar'[Date], -1, YEAR))   // ⚠️ see below
Profit Margin = DIVIDE([Profit AC], [Sales AC])     // ratios take no scenario suffix
```

Always set `formatString` — Charts and Tables take **axis and label formatting from the model**, and
the report layer cannot override it.

### ☠️ A measure that RANKS its own dimension needs `REMOVEFILTERS`, not `ALL(one column)`

Any measure that decides something by ranking — a comment anchored to the worst month, a
conditional highlight, a "top product" label — has to see the whole dimension from inside a single
row. `ALL` over one column does not give you that: the **sibling sort column** (a `MONTH NUMBER`
behind `sortByColumn`) and, on a hierarchy, the **parent level** stay filtered, and Zebra sends both
in its query. The ranking table collapses to one row, every value ties, `TOPN(1)` returns all of
them, and the anchor test is true on **every** row — twelve numbered comments each claiming to be
the exception. Clear the dimension instead:

```dax
Comment month =
VAR tbl   = CALCULATETABLE(ADDCOLUMNS(VALUES('Calendar'[MONTH]), "@lost", [Lost deals AC]),
                           REMOVEFILTERS('Calendar'))          // not ALL('Calendar'[MONTH])
VAR spike = TOPN(1, tbl, [@lost], DESC)
RETURN IF(SELECTEDVALUE('Calendar'[MONTH]) IN SELECTCOLUMNS(spike, 'Calendar'[MONTH]), "…")
```

☠️ **`REMOVEFILTERS` is a CALCULATE filter, never a table.** Put it anywhere a TABLE is expected —
`RANKX(REMOVEFILTERS(T), …)`, an iterator's first argument, or the right-hand side of a `VAR` — and
the measure fails with *"REMOVEFILTERS function cannot be used as a table expression. It can appear
only as a filter in CALCULATE"*. Where you need a table, write **`ALL(Table)`**, which clears the
whole table and is the table-valued equivalent. Inline `REMOVEFILTERS` in each
`CALCULATE`/`CALCULATETABLE` instead. **On the page it reads as *"Something's wrong with one or more
fields"* on a grey card, and it takes the WHOLE visual down** — every other field in it, however
correct, disappears with it. `validate_report` catches this.


```dax
RANKX ( REMOVEFILTERS ( Territories ), [Revenue Won] )   // ERROR
RANKX ( ALL          ( Territories ), [Revenue Won] )    // correct — table position
CALCULATE ( [Revenue Won], REMOVEFILTERS ( Territories ) ) // correct — filter position
```

**`ALL(Table)` is not a retreat to `ALL(one column)`** — the ranking rule targets the *column*
form, and `ALL(Table)` clears everything the same way `REMOVEFILTERS` does. A windowed
measure re-applies its own date window internally, so clearing the whole dimension is safe.



A blank `avgOther`-style companion measure is the tell that this is happening. The test that catches
it is in `verify-loop.md`: a plain `SUMMARIZECOLUMNS` on the display column passes clean while the
render is wrong.

### ⚠️ A PY measure over-reaches when the PAGE frames a whole period but the data stops mid-period

The `Sales PY` line in the measure conventions is the idiomatic form, and it is **wrong whenever
your data ends mid-month** — which is most real extracts. Measured on a marketplace export ending
**16 Jun 2025**: with the page framed on that window, `SAMEPERIODLASTYEAR` returned **1 Jan – 30 Jun
2024**, not 1 Jan – 16 Jun. It compared 16 days of June against 30.

**The function is not what rounds.** Given an explicit mid-month window, `SAMEPERIODLASTYEAR` and
`DATEADD` return exactly the shifted days — measured to the digit against a hand-built window:

```
window 1 Jan – 9 Nov 2021          SAMEPERIODLASTYEAR  5,647,755
                                   DATEADD -1 YEAR     5,647,755
                                   hand-built window   5,647,755   ← all three agree
```

The fault is the **asymmetry between the filter and the data**: the page asks for all of May, the
data stops on the 1st, and the prior year honestly returns all of May. Measured: `AC May 2022 =
BLANK`, `PY = 1,499,841`, honest clipped PY = `21,975` — a **68× over-reach** rendering as −100%.

☠️ **`PARALLELPERIOD` and `PREVIOUSYEAR` DO round, by design** — they return whole periods whatever
window you give them, so they carry the fault even when the page is framed correctly:

| window 1–10 Mar 2021 (AC 229,632) | returns | |
|---|---|---|
| `DATEADD(…, -1, YEAR)` | 88,133 | = hand-built 1–10 Mar 2020 ✅ |
| `PARALLELPERIOD(…, -12, MONTH)` | 325,747 | = **whole** March 2020 ⚠️ |

**Use `DATEADD`, or the day-aligned `PY date` pattern in this section; never `PARALLELPERIOD` for
a like-for-like PY.**



Reported decline **−35.4%**; the honest like-for-like figure **−29.6%**.

It is the partial-actuals trap wearing a time-intelligence hat, and it has the same signature:
arithmetically correct, invisible in PBIR, `validate` clean, and **every consistency check passes** —
months sum to the total, groups sum to the total, everything reconciles, because every visual reads
the same wrong window.

**Use a day-aligned PY date instead.** Add to the calendar's `ADDCOLUMNS`:

```dax
"PY date", IF ( MONTH([Date]) = 2 && DAY([Date]) = 29, BLANK(),
                DATE ( YEAR([Date]) - 1, MONTH([Date]), DAY([Date]) ) )
```
```dax
Sales PY =
VAR PYDates = VALUES ( 'Calendar'[PY date] )
RETURN CALCULATE ( [Sales AC], REMOVEFILTERS ( 'Calendar' ), TREATAS ( PYDates, 'Calendar'[Date] ) )
```

29 Feb maps to `BLANK()` rather than rolling into 1 Mar, so a leap day has no counterpart. That keeps
the measure **additive** — monthly PY values sum to the PY total exactly. A `DATESBETWEEN` over a
contiguous shifted range does not: it sweeps 29 Feb into the total but not into any month.

Verified against an independent oracle on three groups, six months and the total, all to the digit.

### ☠️ A PY measure returns BLANK when the visual groups by a calendar ATTRIBUTE column

Time intelligence replaces the filter on the **date column** and leaves every other column of the
calendar filtered. So when the page groups by `'Calendar'[YEAR MONTH]` — which is what Zebra visuals
normally send, not `[Date]` — the shifted dates and the still-standing attribute filter intersect to
nothing and the measure returns **blank**. Add `REMOVEFILTERS('Calendar')` alongside the time
intelligence so the whole date table is cleared before the shift is applied.

```dax
// page filtered on 'Opportunity Calendar'[YEAR MONTH NUMBER] = 202104
CALCULATE ( [Revenue Won], SAMEPERIODLASTYEAR ( 'Opportunity Calendar'[Date] ) )
                                                          // → BLANK
CALCULATE ( [Revenue Won], SAMEPERIODLASTYEAR ( 'Opportunity Calendar'[Date] ),
                           REMOVEFILTERS ( 'Opportunity Calendar' ) )
                                                          // → 1,499,841
```

It reads as missing data rather than as a broken measure, which is why it survives review. The
day-aligned `PY date` pattern already carries `REMOVEFILTERS('Calendar')` and is immune.


## The calendar table

```tmdl
table Calendar
	dataCategory: Time          // this + isKey IS "Mark as date table"

	column Date
		isKey
		formatString: General Date
		summarizeBy: none
		isNameInferred
		sourceColumn: [Date]

	column Year
		formatString: 0          // without this Power BI renders 2,014
		...
	column Month
		sortByColumn: MonthNo    // else it sorts Apr, Aug, Dec...
	column Quarter
		sortByColumn: QuarterNo  // "Q1".."Q4" sorts right only by luck - wire it
```

Partition (Zebra BI's own pattern, extended from `help.zebrabi.com/kb/power-bi/calendar-table/`):

```dax
ADDCOLUMNS ( CALENDARAUTO (),
    "Year", YEAR([Date]), "MonthNo", MONTH([Date]), "Month", FORMAT([Date],"mmm"),
    "QuarterNo", QUARTER([Date]), "Quarter", FORMAT([Date],"\QQ"),
    "YearMonth", FORMAT([Date],"YYYY-MM") )
```

`CALENDARAUTO()` derives the range from the model. Use `CALENDAR(start, end)` when you need to pin
it. `YearMonth` as `"YYYY-MM"` sorts correctly as text, so it needs no sort column.

### ⚠️ `CALENDARAUTO()` CANNOT see a DATATABLE fact — pair calculated models with guarded `CALENDAR`

`CALENDARAUTO` scans **non-calculated** tables for date columns. On a model whose only date column
lives in a calculated (`DATATABLE`) fact, it has nothing to scan and the calendar dies with
*"The query referenced calculated table 'Calendar' which does not hold any data because there is an
error in its expression."* Two-arm verified on one model, everything equal but the calendar:
`CALENDARAUTO` → dead calendar; the guarded `CALENDAR(MIN/MAX)` below → correct values.
So: **`CALENDARAUTO` is for models with a Power Query fact; a DATATABLE model takes the guarded
`CALENDAR` pattern** (which is also the shape that pins the range honestly).

### ⚠️ A calculated calendar that reads a POWER QUERY table kills the cold open

The obvious self-maintaining calendar is a **silent, total** failure on a PQ-backed model:

```dax
CALENDAR ( DATE ( YEAR ( MIN ( 'Fact'[Date] ) ), 1, 1 ), MAX ( 'Fact'[Date] ) )   // ❌
```

A Power Query partition **does not refresh on open** (see *Refresh* above), so when the calculated
table evaluates, `'Fact'` has **zero rows**, `MIN`/`MAX` return `BLANK()`, and `CALENDAR` throws
*"The start and end date in calendar function cannot be Blank value."* The calculated table takes
**the whole model** down with it, and Desktop opens **`Untitled`, empty canvas, no dialog** — the
second of the causes of a silent `Untitled` open. Nothing on screen ever names the reason.

Guard both bounds:

```dax
VAR MinD = MIN ( 'Fact'[Date] )
VAR MaxD = MAX ( 'Fact'[Date] )
VAR StartD = IF ( ISBLANK ( MinD ), DATE ( <first year>, 1, 1 ), DATE ( YEAR ( MinD ), 1, 1 ) )
VAR EndD   = IF ( ISBLANK ( MaxD ), DATE ( <last y>, <m>, <d> ), MaxD )
RETURN ADDCOLUMNS ( CALENDAR ( StartD, EndD ), … )
```

Cold open builds the fallback; the post-refresh recompute picks up the live values. For a given
extract both branches should agree — the guard exists to stop the crash, not to change the answer.

**`CALENDARAUTO()` does not have this problem** (it reads model metadata, not rows) — but it extends
to whole calendar **years**, which walks straight into the PY trap in *Measure conventions*: a page
framed on the current year then puts 365 days in filter context and PY returns the **entire** prior
year against a part-year of actuals. On one export that was PY 830,260 vs AC 239,850, a
**−71% headline that is pure artifact**.

**So: end the calendar at the last date you actually have**, and the honest frame becomes the
default. This is the one case where pinning beats deriving.

## Never hardcode a period — derive it

Text properties take **measure tokens** resolved at render time (gate: the measure must be projected
into the **`Filters`** role). A date range typed into a `textbox` goes stale and silently lies.

```dax
Last data date  = CALCULATE(MAX(financials[Date]), ALL('Calendar'), ALL(financials))   // hidden
First data date = CALCULATE(MIN(financials[Date]), ALL('Calendar'), ALL(financials))   // hidden
Period label    = FORMAT([First data date],"mmm yyyy") & " - " & FORMAT([Last data date],"mmm yyyy")
```
then `titleSettings.text = 'Net sales by month, in USD · [Period label]'`. **Verified resolving.**

The same trick fixes partial-coverage windows without hardcoding a year:

```dax
Sales AC LFL =
    VAR CurYear = YEAR([Last data date])
    VAR StartMonth = MONTH([First data date])
    RETURN CALCULATE([Sales AC], ALL('Calendar'),
                     'Calendar'[Year] = CurYear, 'Calendar'[MonthNo] >= StartMonth)
```



## What is still NOT proven

- One machine, two Desktop builds (2.156 and 2.157). **RLS roles, calculation groups, field
  parameters, hierarchies, translations, KPIs and dynamic format strings now load** — each was
  reloaded and the engine's DMVs read back a ready state; `references/tmdl.md` carries the exact
  TMDL for every one. **Power Query partitions with incremental refresh are still untested.**
- Nothing here changes **"close Desktop while you write."** That rule stands.
- A model written this way and then *saved by Desktop* was not tested for round-trip fidelity.

The language itself — the file set, every object and property, what Desktop writes, the exact text
of every load error and which "mistakes" load anyway — is `references/tmdl.md`. Read it before
writing a construct you have not written before.
