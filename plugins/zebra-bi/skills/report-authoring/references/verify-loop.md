# The verify loop — launching Desktop, reloading, and capturing evidence

**Read this before you launch Power BI Desktop, reload it, or take the first screenshot.**
Nothing here is needed before your first *write*, which is why it is not in `SKILL.md`.

Everything in this file works with **nothing installed but Power BI Desktop**. The node CLIs are an
optional accelerator, never a prerequisite.

### The dependency-free loop — the default path, in full

**Everything in this section works with nothing installed.** The node CLIs are an optional accelerator, never a prerequisite: where one is absent, the in-box PowerShell path does the same job.

`powerbi-desktop` and `powerbi-report-author` are node, and on a clean machine neither exists. The loop closes anyway, entirely on in-box Windows — proven end-to-end on a
multi-page
board pack:

- **Author** — write PBIR JSON directly. `references/formatting.md` is the authority on the
  *encodings* even when you cannot execute them; read them and hand-write the same shapes.
- **Pre-flight** — run `references/preflight.md` first. It is the cheapest step in the loop and the
  only one that catches a mangled title, a BOM or a dead title token before Desktop ever opens.
- **Validate** — no headless validator exists. Substitute a structural pass in PowerShell:
  `ConvertFrom-Json` every file (catches syntax), then assert every `pageOrder` entry has a
  `page.json`, every `visuals/*` dir has a `visual.json`, `activePageName` is in `pageOrder`, no
  stray page dirs, and **every filter has a non-empty unique `name`** — that last one is the check
  that stops the modal which wedges the Bridge. It will not catch anything Zebra-specific, which
  validate never did either.
- **Launch** — `Start-Process -FilePath "$env:LOCALAPPDATA\Microsoft\WindowsApps\PBIDesktopStore.exe"
  -ArgumentList <pbip>`.

  ☠️ **Ready means "a query against MY table returns a number". Nothing weaker works.** Three
  readiness checks look right and all three pass while the project is still loading:

  | check | why it lies |
  |---|---|
  | `MainWindowTitle` matches the project | it sits on `Untitled` for the first seconds — and stays there if the load *failed*, so it cannot tell those apart |
  | `msmdsrv` is running | it starts before the model is attached |
  | `$conn.Database` is non-empty | **an empty document has a database GUID too** — the connection opens, a query runs, and `COUNTROWS` of every table comes back BLANK |

  That third one is the trap, because it is the fix usually recommended for the first. Poll until
  `COUNTROWS ( '<a table you authored>' )` returns an **integer**, and treat blank as not-ready
  rather than as empty. On a model that genuinely failed to load, the same query errors with *"DAX
  Evaluate queries work only on databases which have at least one table"* — which is the signal you
  want, and which no title, process or connection check ever produces.

  ☠️ **A ready model does NOT mean a loaded report, and this is the one that wastes a human's time.**
  A bad *report definition* pops *"Your report has issues that could not be resolved"* while the
  **model loads perfectly** — so the title is correct, the connection is open, and `COUNTROWS`
  returns an integer. **Every check above passes with the modal on screen.**

  Power BI reports a report-definition load failure in a **separate top-level window whose title is
  an empty string**, so no window-title check of any kind can see it — and the model behind it loads
  normally, so a readiness query passes too. Confirm a load by **enumerating the process's visible
  top-level windows**: one window means clean, more than one means read the extra window before
  believing anything. A load error that is not detected is not merely missed, it is waited on.

  In-box: `EnumWindows`, filter to the PID, count `IsWindowVisible`. On >1, capture the extra window
  with `PrintWindow` and read it — the dialog **names the offending property and file**, which is a
  better diagnosis than any check here produces.

  ⚠️ **But a bare count of >1 is NOT the signal — it fires on every launch.** Power BI shows a
  **splash window during startup that is also large and also has an empty title**, so "more than one
  window" is true for the first several seconds of a perfectly healthy open. A harness that aborts on
  the raw count aborts everything, which is worse than no check at all because the check then gets
  removed. Two properties separate the splash from a modal, and you want both:

  - **Persistence.** The splash is transient; a modal stays until someone dismisses it. Re-check
    after ~4 s and only believe the second answer.
  - **The owner is disabled.** A modal disables its owner window, so `IsWindowEnabled(mainHwnd)`
    returns **false**. The splash never does this. This is the cheaper and sharper of the two.

  Check **after** the title has settled to the project name, not during the load — the title matches
  *with* the dialog up, so you lose nothing, and you skip the whole splash window.

  **Read the dialog through UI Automation first; photograph it only when that returns nothing.**
  The report-definition load error is a WebView (`desktopDialogHost.html`), and a `FindAll`
  over the **dialog's own handle** returns the full message as text in about a second — read from
  the dialog handle, not from the main window, which only ever yields the host URL. The packaging
  *"Issues were found"* modal is the exception: it exposes no text, not even to its clipboard
  button, so `PrintWindow` that one and read the image.

  **And match `msmdsrv` to the right PID:** `Get-CimInstance Win32_Process -Filter "Name='msmdsrv.exe'
  AND ParentProcessId=$pid"`. A bare `Get-Process msmdsrv` returns every instance, so with two
  Desktop windows open you connect to the wrong model and read someone else's numbers.
- **Screenshot** — `PrintWindow(hwnd, hdc, 2)` (`PW_RENDERFULLCONTENT`) into a `System.Drawing`
  bitmap sized from `GetWindowRect`. **This reads the window's own surface, so Desktop does not need
  to be in front** — the user keeps their focus and you never photograph your own terminal.
  **Call `SetProcessDPIAware()` first**: without it PowerShell is DPI-unaware, the rect comes back in
  *logical* pixels (1933×1045) while the capture is *physical* (3866×2090), so you silently get the
  top-left quadrant, magnified — which reads as "Desktop opened zoomed in".
- **Per-page capture — select the page tab through UI Automation. Do not restart.** The page tabs
  are real `TabItem` elements exposing `SelectionItemPattern`, and UIA does not need the window
  focused, so it has none of the `SendKeys("^{PGDN}")` foreground-lock problem (that keystroke lands
  in whatever the user last touched, and you capture page 1 four times believing you swept the
  report). Switching costs **~70 ms** against 23–210 s for a restart:

  ```powershell
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  # RETRY: after a reload the UIA tree is rebuilt and is not ready at once.
  # Re-resolve the root each attempt - do not cache it across a reload.
  $tab = $null; $tries = 0
  while (-not $tab -and $tries -lt 40) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $cond = New-Object System.Windows.Automation.PropertyCondition(
              [System.Windows.Automation.AutomationElement]::NameProperty, $pageDisplayName)
    $tab  = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $tab) { Start-Sleep -Milliseconds 250; $tries++ }
  }
  $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
  ```

  **The retry is not defensive padding — the first lookup after a reload returns `null`.** A run
  without it threw `You cannot call a method on a null-valued expression` on the first page and
  succeeded on the next two, which is the worst version of the fault: it looks intermittent, and the
  page you fail to switch to still gets captured, so you silently photograph the wrong page and read
  it as a rendering bug. One 250 ms retry was enough.

  **Match on the page's `displayName`** — the UIA `Name` is the tab caption, not the page id — **and
  require `ControlType.TabItem` as well.** Neither condition is sufficient on its own, and each fails
  differently. Filtering by TabItem alone returns the ribbon tabs, the view switchers and the
  DAX-query tabs, and on one sweep **the page tabs were not in that list at all**. But matching the
  caption alone is **ambiguous**: the page-navigator element carries the same `Name` as the tab, it
  comes back first, and selecting it does nothing — which produced three byte-identical captures of
  whichever page was already open, read as a rendering bug rather than a navigation failure. Search
  the descendants for the caption, keep only `ControlType.TabItem`, and fall back to the caption-only
  match if that leaves you nothing. Budget ~550 ms for the
  first full sweep of the tree.

  **Rewriting `pages.json` → `activePageName` and reloading does NOT move the viewport** — settled,
  three pages, three `{"success":true}` replies, and the tab bar never moved off the page it was on.
  Reload applies *file* edits; it does not drive the *UI*. Set `activePageName` for what a cold open
  should land on, and use UIA for everything after that.
- **Wait for the ink to plateau before the shutter — a still frame is NOT a rendered frame.**
  ☠️ Power BI paints the page skeleton (slicers, titles, empty visual frames) and **holds it stable
  for about a second** before the Zebra visuals draw. A detector that stops at "the last two frames
  match" photographs that skeleton, and the result is indistinguishable from a report whose visuals
  genuinely failed. Measured after one page switch: an ink count of 619 then 620 — stable, and
  **empty** — then 6,842 at 1.7 s, then 15,671 at 2.2 s, then flat. So: sample every ~500 ms and
  require the frame unchanged **and** ≥ 2.5 s elapsed **and** ink above the skeleton baseline.
  2.5 s covered every page of that project; a heavier or DirectQuery page has no measured floor, so
  keep the plateau test and treat the number as a starting point.
  ☠️ **Count that ink inside the CANVAS rectangle, never across the whole window.** The ribbon,
  the Visualizations pane and the Data pane contribute several thousand saturated pixels on their
  own, so a whole-window count clears any sane threshold while the canvas is still empty — the
  plateau test then passes on chrome and the shutter fires on a blank report. On a three-visual
  page a window-wide count sat at 5,385 and held "stable" across three probes with **all three
  visuals unpainted**, and the capture was read as a genuine blank until a human looked at the
  screen. Take the floor from a known-empty capture of that same rectangle, not from a guess.
- Park the cursor (`SetCursorPos(3,3)`) before the shutter, or hover highlight fakes a stuck filter.
- **Compare two frames on a pixel THRESHOLD, not on a hash.** Taking a second capture a few seconds
  later is the right way to prove a page has settled, but file hashes make it useless: two captures
  of a fully settled page differed by **8 pixels out of 51,000 sampled** — anti-aliasing, not a state
  change — and a hash comparison calls that unstable. Sample a grid, count differing pixels, and
  compare **per band** (the KPI row, the table, the chart) so a real change in one visual is not
  averaged away by three that are identical.

### The Desktop bridge is reachable in-box too — reload without node

The bridge the `powerbi-desktop` CLI drives is a **local JSON-RPC endpoint you can call directly**.
Established; the transport is solved, one caveat below.

**This is now an official Microsoft preview feature**, "Enable external tool access to Power BI
Desktop through secure local APIs", **on by default** since the June 2026 release. Docs:
`learn.microsoft.com/power-bi/developer/agentic/power-bi-desktop-bridge-overview`.

- **Endpoint:** named pipe `\\.\pipe\pbi-desktop-bridge-<PBIDesktop pid>` (enumerate with
  `[System.IO.Directory]::GetFiles("\\.\pipe\")`). Each Desktop window has its own pipe, and **only
  one operation runs at a time** — a concurrent request errors.
- **Protocol:** JSON-RPC 2.0 with `Content-Length: N\r\n\r\n<utf8 json>` framing. Use
  `System.IO.Pipes.NamedPipeClientStream`. (Note `ReadTimeout` is unsupported on this stream.)
- **Method names — call `bridge.manifest`.** It returns every supported method with its params and
  result schema. `bridge.manifest` is the supported discovery path and was confirmed on
  Desktop 2.156.951.0 returning exactly the three methods below.

  | method | params | result |
  |---|---|---|
  | `bridge.manifest` | `{}` | every method + schemas. **Call this first.** |
  | `application.state.get/v1` | `{}` | `{currentFilePath, hasUnsavedChanges}` — ~0.1–0.7s |
  | `file.reload/v1` | `{reloadModelDefinition: bool}` | **see below** |
  | `report.snapshot.capture/v1` | `{pageId, scale}` — **both required**, whatever older notes say | PNG as base64 — **broken on 2.156.951.0**. Use `PrintWindow` instead. |

  **Do not spend time trying to call the snapshot method correctly.** It throws
  `System.NullReferenceException` in `ReportSnapshotHandler.ExecuteAsync`, and the control that
  settles it is this: **a deliberately bogus `pageId` throws the identical exception.** A handler
  that fails the same way for a page that exists and one that does not has not resolved the page at
  all, so no parameter spelling recovers it — supplying `scale` (which the manifest does mark
  required) changes nothing. Recorded so nobody re-derives it. If a later Desktop build fixes it,
  this becomes the fastest capture path there is.

**`file.reload/v1` takes `reloadModelDefinition`** (defaults `true`), which the old notes missed:

- `false` → reloads the **report only**, ~1.5–3.2s, and **preserves the in-memory refresh**. Right
  for editing an existing visual.
- `true` → report **and** model definition, ~1.8–4.0s. Needed after any TMDL change — **and on its
  own it is not enough.** Two things it does not do, each reproduced:

  ☠️ **It does not make already-rendered visuals re-query.** The engine gets the new model — an
  ADOMD query returns the new values immediately — but a page that was already on screen keeps
  showing the old numbers, and a UIA page switch does **not** refresh it either. A measure changed
  to `* 1.4` read `212.3M` over ADOMD and `106.1M` on the page at the same moment. So a DAX oracle
  is trustworthy straight after a reload; the *screen* is not.

  ☠️ **It does not materialise a calculated (DATATABLE) partition. Run a TMSL refresh.** Until you
  do, new tables are not in the model the visuals can see: the Data pane still lists the *old*
  tables and every visual reads *"Something's wrong with one or more fields"*. Desktop says so
  itself, in a red banner across the top of the canvas — *"One or more calculated tables need to be
  manually refreshed"* — with a grey *"Some of the tables have incomplete or no data"* beneath it.
  **Those two banners are the tell, and they are easy to read past.** They sat on top of every
  screenshot in a whole session of render work before anyone noticed them.

  **So the sequence after a model change is: write → `reload {reloadModelDefinition: true}` →
  TMSL refresh → then look.** The refresh is ~0.3–1.6 s over ADOMD with nothing installed
  (`references/model-layer.md` has the recipe). Do it as part of the LOAD, not at the end of the
  loop: bolting it on afterwards is what makes a working path look like a dead end.

  With the refresh in place, a warm instance takes a **wholly new model plus a new report layer**
  and renders correctly — write, reload, refresh and two verified pages in **19.2 s** against ~40 s
  for a cold open of the same content.
- **Reload DOES pick up a new `visuals/<name>/` directory. Try it first.** A brand-new visual
  directory (a textbox the running instance had never seen) was written to disk and rendered after
  `file.reload/v1` with **no restart at all** — `reloadModelDefinition: false` (1288 ms) then
  `true` (1136 ms).
  **Limit of the evidence, stated plainly:** the two arms were run back-to-back and the screenshot
  was taken after both, so **which arm picked it up was never isolated**. The safe instruction is
  therefore: **call reload (either arm) and look.** Fall back to a restart only if the new visual
  does not appear.
- **Round trip is ~0.3–1.2s** against a cold restart measured between 23 s and 210 s depending
  on the model. That is the whole prize, and it
  now applies to *adding* visuals as well as editing them — **do not batch new visuals into a
  restart** you probably do not need.

☠️ **Reload re-reads from DISK, so it silently destroys whatever a human has done in Desktop and not
saved.** Annotations drawn, comments typed, a property set in the formatting pane — all of it is
in-memory until someone presses Ctrl+S, and a reload discards the lot with no warning and no prompt.
The report simply reverts, which reads like the feature failed rather than like you deleted the work.
**Before any write-then-reload, know whether a person is working in that report**, and if they are,
ask them to save first and wait. `application.state.get/v1` returns `hasUnsavedChanges` — check it,
and treat `true` as a stop.

> **Why the instruction is "call reload and look" and not a rule per case.** One reload that appears
> not to pick up a change is not evidence that reload does not pick up changes. Run the other arm,
> and re-run, before you conclude anything: **one failure is not proof that its neighbours fail.**

**What still needs a cold restart: `definition/report.json`, and a model reload that Desktop
refused.** A registration change is only read at open. A model change is **not** a restart case:
`file.reload/v1` with `reloadModelDefinition: true` followed by the TMSL refresh swaps the whole
model into the warm instance (19 s against a 40 s cold open, measured). The restart is for the
refusal — a modal on reload, or a refresh that never returns after a table was removed — and then
it is a restart, never a retry.
**A new `pages/<name>/` directory IS picked up by `file.reload/v1` with no restart** — report-only reload, `reloadModelDefinition: false`, 675 ms,
confirmed twice, with the new page appearing in the tab bar and rendering.

### The warm scaffold — a from-scratch project need not pay a cold open either

Everything to this point takes the cold restart out of the **edit** loop. A from-scratch build still
looks like it has to pay one, because there is no instance running yet to reload against. It does
not, and this is the single largest saving in the loop.

**Keep one throwaway scaffold project open and reload the real payload into it.** The cold open is
paid once, in the background, while you are still writing files — so it is off the critical path —
and every project after it lands in a warm instance for the price of a reload plus a refresh.

Measured with a cold-open control on each arm: **44.4 s → 15.8 s** on one project, **50.2 s → 20.7 s**
on a second. Both arms produced the same verified pages, so this buys wall-clock and gives up no
evidence.

The scaffold is a minimal valid project — one page, a small model, a base theme. Launch it once;
from then on, per real project:

1. write the real payload, model **and** report, into the scaffold's folder,
2. `file.reload/v1 {reloadModelDefinition: true}`,
3. **TMSL refresh** — a calculated partition is not materialised by the reload, and the two banners
   are the tell,
4. select each page and capture.

☠️ **The scaffold's active page id MUST exist in the payload, or Desktop refuses the whole
definition.** `pages.json` names an `activePageName`; if the payload has no page directory with that
id, the reload fails everything — and it fails in the worst way available, with the RPC returning
**`success: true`** while a modal sits on the canvas. The instinct is to suspect the payload. The
payload is usually fine: it is the *scaffold's* active page that is stale. Either carry the
scaffold's page id into every payload, or rewrite `activePageName` to a page the payload does have,
in the same write. Undiagnosed, this costs about as long as the cold open you were avoiding.

**Limit of the evidence:** two projects, both with calculated (DATATABLE) partitions, on one
machine. The saving is the cold open, so it scales with how slow yours is — measure your own cold
open once and the arithmetic is done.

⚠️ **But reload does not move the VIEWPORT — settled.** Rewriting `pages.json` → `activePageName`
changes which page is *active in the file* and nothing on screen: three pages were written and
reloaded, all three returned `{"success":true}`, and the tab bar stayed on the page it started on.
So:

- **Editing a visual on the page already displayed is the fast loop** — under a second, always works.
- **Navigation is UI Automation's job, not a restart's** — `SelectionItemPattern.Select()` on the
  page tab, ~70 ms, no focus needed. See *Per-page capture* above. This is the single biggest
  saving in the loop: a 4-page verify sweep goes from four cold restarts to one reload and four tab
  switches.
- **A cold restart is for `definition/report.json`, and for a model reload Desktop refused. That
  is all.** A model edit is reload plus refresh. Never restart to apply an edit and never restart
  to reach a page — either habit makes this loop an order of magnitude slower than it is.

**Reload can be blocked by model-side state**, and
there are two distinct causes. Both were reproduced on an unrelated model, so this is not specific to a model carried over by file-copy. Errors arrive one per ~0.65–1.0s, so
just fix and re-call:

1. **`CompatibilityLevel downgrade … Current '1606', Requested '1600'`.** Desktop runs the model
   at **1606 or higher** — it keeps a level of 1606 to 1702 as written and runs at 1700 when
   `database.tmdl` is absent — so a file that says 1600 asks for a downgrade on every reload and is
   refused. Fix: write `compatibilityLevel: 1606` (or any level Desktop accepts) in `database.tmdl`;
   `references/tmdl.md` has the measured list.
2. **`The LinguisticMetadata object with ID <n> does not exist`.** Emptying the culture file's
   `Entities` does **not** fix it — the error is about the object ID in the running instance. Fix:
   delete `definition/cultures/` **and** the `ref cultureInfo` line from `model.tmdl`. Cost is Q&A
   linguistic metadata, which Desktop regenerates.

**Unexpected bonus: `file.reload/v1` is the validator you don't otherwise have.** With no node there is
no headless `validate`, but reload's `-32505` payload names the **exact file and the exact reason** —
it identified a UTF-8 BOM down to `pages/ExecutiveSummary/visuals/P1Table/visual.json`. It costs one
~1s RPC and catches precisely the class of error that otherwise pops the modal and wedges the Bridge.
Call it after every write, even on a project where the reload itself cannot complete.

Every edit needs a restart when reload is unavailable, so batch fixes rather than iterating one
property at a time.

### DAX against the live model — NO INSTALL REQUIRED

**You do not need node, the plugin, or anything installed to run `EVALUATE`.** Power BI Desktop ships
its own ADOMD client *inside its package*, and the model is served by a local `msmdsrv` on a loopback
port. Proven; this is the oracle, use it. **The same connection is how you refresh a Power
Query-backed model after a cold open** — the recipe and the rules are in `references/model-layer.md`,
and that step is yours, never the user's.

```powershell
# 1. msmdsrv only exists while Desktop has the model open. Its own path gives you the bin dir,
#    so never hard-code the version number (it changes on every Desktop update).
$srv  = Get-Process msmdsrv                      # if this is empty, Desktop isn't open
$dll  = Join-Path (Split-Path $srv.Path) 'Microsoft.PowerBI.AdomdClient.dll'
$port = (Get-NetTCPConnection -OwningProcess $srv.Id -State Listen |
         Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -First 1).LocalPort

# 2. Connect. The assembly is PowerBI-branded but the TYPES are still Microsoft.AnalysisServices.*
$asm  = [Reflection.Assembly]::LoadFrom($dll)
$t    = $asm.GetExportedTypes() | Where-Object { $_.Name -eq 'AdomdConnection' }
$conn = [Activator]::CreateInstance($t, @("Data Source=localhost:$port")); $conn.Open()

# 3. OPEN ONCE, QUERY MANY. Connecting is the expensive part; the queries are not.
foreach ($q in $queries) {                       # the whole enumeration set in one connection
  $cmd = $conn.CreateCommand(); $cmd.CommandText = $q
  $r = $cmd.ExecuteReader(); while ($r.Read()) { $r.GetValue(0) }; $r.Close()
}
$conn.Close()                                    # once, at the end
```

**Do not open and close a connection per query.** Enumerating what the data can answer is half a
dozen `SUMMARIZECOLUMNS`, and profiling it is several more; paying the connect cost for each is the
easiest avoidable waste in the whole session. Build the list of queries first, then run them through
one open connection.

Notes that cost time to establish:

- `C:\Program Files\WindowsApps\...` **is readable and listable** on a known subpath, even though it is
  ACL-locked against *execution* and enumerating the package root returns nothing. `LoadFrom` works.
- **The MSOLAP OLE DB provider is NOT installed**, so `ADODB.Connection` + `Provider=MSOLAP` is a dead
  end (10 providers present, none OLAP). Don't spend time there — go straight to the ADOMD DLL.
- Formatting trap when printing results: variance measures come back as **fractions**
  (−0.1106, not −11.06), so rounding to 1 dp destroys them. Round to 4+, or multiply first.
- **On an unprocessed table, `COUNTROWS` returns blank (DBNull), not 0.** That is the signature of a
  PQ-backed model before its refresh — see `references/model-layer.md` for the refresh that fixes it.

☠️ **Query the shape ZEBRA sends, not the shape you find convenient.** A measure that ranks its
own dimension — a comment anchor, a conditional highlight, a "top N" label — tested **clean** in
`EVALUATE SUMMARIZECOLUMNS('Calendar'[MONTH], "c", [Comment month])`, returning exactly the two rows
it should, and was wrong on screen: the comment fired on **all twelve** months. Zebra's real query
also carries the **sort column** behind `sortByColumn` and, on a hierarchy, the **parent level**, and
those are what break the ranking (the mechanism and the fix are in `model-layer.md`). So put them in
the grouping:

```dax
EVALUATE FILTER(SUMMARIZECOLUMNS('Calendar'[MONTH], 'Calendar'[MONTH NUMBER], "c", [Comment month]),
                NOT ISBLANK([c]))
-- on a hierarchy, add the parent level: Products[Product Category], Products[Product]
```

An oracle that omits those columns is the wrong instrument, and it fails in the direction that costs
most: it agrees with you.

With this in hand, verification is **DAX-vs-render** as normal, and the checks below become the
cross-checks they should be rather than the whole case. Keep using them — they are free and they
catch binding faults fast — but **know what each does and does not prove**:

1. **Probe coverage BEFORE you frame anything — once per account/measure group.** This is the only
   check that catches a wrong *window*, and it is the one that matters most. Consistency checks
   structurally cannot catch it.

   ⚑ **And the window gates RATIOS too — margin, rate, share, price per unit.** This is the one that
   got missed. One pass caught the coverage artefact on the *totals*, wrote it up as
   the strongest available argument for probing coverage first, put the caveat in the page
   subtitle — **and then computed the margin comparison on the uncut window anyway**, concluding
   *"margin fell 14.7% → 14.1%"*. It had compared four months of one year against twelve of the next.
   The true like-for-like counterpart was **15.03%: margin ROSE** — the headline had the direction
   backwards.

   **Why a ratio feels safe and is not:** normalising removes the *volume* difference — the one you
   can see — and leaves the **composition** difference, which you cannot. **If a measure has a PY
   counterpart, it needs the LFL window** — no exceptions for percentages. One `<metric> AC LFL` /
   `<metric> PY LFL` pair per metric, derived from `First data date` / `Last data date` so nothing is
   hardcoded; `references/model-layer.md` has the pattern.

   **Do not name a cause for the difference.** The rule is justified by the *possibility* of any
   period-specific composition difference; naming one adds nothing and is where this gets wrong twice
   over. That gap was first explained as *"H2 is structurally richer"* — refuted on
   review: on 2014's actual halves it is 13.90% vs 14.27% (0.36pp, not the 1.53pp the framing
   implied), Q2 beats Q3 so it is not even monotone, and **discount-band mix drift accounts for ~86%
   of it** (re-weight 2014 Sep–Dec to Jan–Aug band weights and 15.03% becomes 13.72% against an
   actual 13.50%). It was a causal story from n=1 — the same failure the rule exists to prevent.

   ⚑ **And matching month LABELS is not matching month MASS — check inside the window too.** In
   `Financial Sample.xlsx` every month carries 35 rows *except four that carry 70*. So Sep–Dec 2013
   holds **one** double month and Sep–Dec 2014 holds **two**, one of them the richest month in the
   file. Consequence: the same comparison reads **+0.06pp** equal-weighted per month, **+0.35pp** raw,
   and **+0.96pp** at constant prior-year segment weights — and **2 of the 4 paired months actually
   fell**. **Report the direction, and check it under two weightings before you quote a magnitude.**
2. **Read member names off a render**, not from a guess: bind the dimension to a throwaway
   `showAsTable` Zebra Table and look. Cheaper than four wrong filters.
3. **Cross-visual reconciliation** — put the same measures in a Cards row and a Table and check every
   value and delta agrees. Different aggregation paths, same answer.
4. **Cross-page reconciliation** — a monthly page's ΔPL summed across months must equal the YTD page's
   ΔPL (it did: −145M on three independently-computed visuals across three pages).
5. **Arithmetic reconciliation** — `AC − PL = ΔPL` and `ΔPL / PL = ΔPL%` on every row, allowing for
   displayed rounding.
6. **Predict, then confirm.** Before rendering a fix, write down the number you expect. Predicting
   "plan Jan–Apr = 39+35+39+38 = 151K" and then seeing exactly 151K is far stronger evidence than
   inspecting the result and finding it plausible.

**The limit, stated honestly:** 3–5 prove *internal consistency*, not correctness. Every one of them
passed on a page that was wrong by 5x, because every visual was reading the same wrong window. They
catch binding and formatting faults; only step 1 catches framing faults. Never report a
consistency pass as "the numbers are verified" without saying which kind of check ran.

**So run 3–5 only when you cannot reach the oracle.** They are a *cheaper proxy* for
DAX-vs-render, not an addition to it: if you are already comparing each rendered headline figure to
an `EVALUATE` result, agreeing with a second visual that reads the same binding tells you nothing
further. Running the full six every time is the redundancy worth cutting. **Steps 1 and 6 are never
redundant** — 1 is the only framing check there is, and 6 costs one written-down number.

**And now you don't have to settle for that** — the ADOMD path above gives a real oracle with nothing
installed, so run step 1 as a DAX query (it is one `SUMMARIZECOLUMNS` over `Calendar[MonthNo]` per
account group) and DAX-verify the headline figures before shipping. On one board pack the
oracle confirmed the coverage cut-off *and* all six KPIs with all twelve deltas to displayed
precision — after the same numbers had already survived every consistency check while page 4 was
wrong by 5x. Consistency checks are the fast filter; DAX is the verdict.

---

# The three render states, and what may overlap

**Read this before you trust a screenshot.** Two of these look exactly like a binding failure and
are not, and the third is about which parts of the loop can run at the same time.

### ☠️ The Zebra landing page is a THIRD render state, and it reads like a binding failure

A Zebra visual that has loaded but has **not yet received its query** paints its own landing page:
the product name and version, *"Licensed to …"*, *"Drop your data and get started"*, and three
buttons — Zebra BI Academy, Knowledge Base, Download Templates. It is neither the data nor a blank.

**It is the most misleading of the three**, because a blank canvas reads as *something is broken*
while the landing page reads as ***my bindings are wrong***, and it sends you to rewrite a
`queryState` that was correct all along. Seen at an 8 s settle on the first page captured after a
cold open; the 4 s recheck showed the full render, nothing else having changed.

- **≥12 s before the first capture after a cold open.** The later pages in the same sweep are fine at
  the normal settle — it is the first one that pays the model's first-query cost.
- **Take a second capture a few seconds after the first** whenever a visual looks wrong. It costs
  0.2 s and it separates *still painting* from *actually wrong*. Every settle threshold here is one
  machine's number, so treat the recheck as the check and the threshold as the optimisation.
- If the landing page is still there after a genuine wait, **then** read the bindings — that is a
  real empty dataview, not a race.

### ☠️ A blank Report view after a force-kill is a PAINT failure, not a load failure

A screenshot showing an empty white canvas with **no page tab strip and no side panes**, taken after
Desktop has been force-killed and relaunched at least once in the session, does not mean the report
failed to load. Reproduced three times in a row across three separate processes, and the report had
loaded every time.

Confirm it before concluding anything, and **confirm on the page's own `displayName`** — find a tab
whose `Name` equals it. ☠️ **A count of `ControlType.TabItem` is NOT a confirmation.** That query
returns the ribbon tabs, the view switchers and the DAX-query and TMDL tabs: on a window whose page
collection was genuinely broken it returned **58 TabItems and not one page tab**, so `count > 0` — the
natural reading — reports a confident false "loaded". Search by name and accept only an exact match.
A plain name *substring* search has the opposite failure, dropping the real tab when its name collides
with window-title text in a dedup step, so match the whole name.

The recovery to try is `WindowPattern.SetWindowVisualState`: minimize, restore to maximized, wait
~3 s, then re-screenshot. ⚠️ **It can refuse.** Called against a window in this state the pattern is
exposed and both calls threw `InvalidOperationException: Operation cannot be performed`. So treat the
symptom as reproduced, the recovery as worth one attempt, and **a cold restart as the fallback that
actually works** — it has fixed every instance of this seen so far.

**And an identical-looking blank has a second cause with no recovery but a restart:** if a page
directory was deleted while Desktop was displaying that page, the running instance loses its page
collection. Same blank canvas, same missing tab strip and panes, and the status bar keeps a stale page
count for a report that no longer has that many pages. Nothing short of reopening fixes it.

**This is a different failure from the skeleton trap.** That one is a screenshot taken too early, and
waiting fixes it. This is a screenshot taken well after the settle wait, on a surface that never
received its first paint — so waiting longer does nothing, and the blank frame is stable enough to
look like a real result.

### Where overlapping work actually helps — and where it corrupts

**The cold open is 23 s of dead time. Start it early and work through it.** Launch Desktop as soon
as the project is structurally writable, and spend the wait reading the references you need, writing
the page plan, and drafting the JSON for pages you have not written yet. This is the one big
overlap available and it is free.

**Run every DAX probe through one open connection** (see the ADOMD section) — connecting is the
expensive part, the queries are not.

**Write all the files for an increment before you check any of them.** Pre-flight, `validate_report`
and reload each read the whole project, so their cost is per-run, not per-file.

Two things that must stay strictly serial:

- **The bridge runs one operation at a time — a concurrent request errors.** Never fire a reload
  while another call is in flight.
- **Never write to the project while a reload or a screenshot is in progress.** You will capture a
  half-applied state and read it as a rendering fault.

**Do not run several Desktop instances to parallelise the page sweep.** It looks available now that
capture works on a background window, but Store-app instancing and per-instance model memory have
not been tested, and the failure mode — two instances sharing or clobbering one model — is the kind
that produces a plausible wrong render rather than an error.

**And if the model has Power Query partitions, "open" is not the end of the load.** A PQ-backed
model cold-opens structurally perfect and **EMPTY** — every table blank, a banner reading *"Some of
the tables have incomplete or no data."* That is by design, and **the refresh is your job**: run the
TMSL refresh in `references/model-layer.md` (~5s, in-box, works on any Desktop version), verify a
row count through the engine, and only then read the screenshot. **Never end a turn telling the
user to click "Refresh now", and never send an F5/keystroke to Desktop** — both have failed in the
field.

**If the `validate_report` tool is available, call it once per batch of writes.** It checks the same
mechanical layer plus the Zebra-specific faults that Power BI's own validator knows nothing
about: a sort naming a field the visual does not show, a comment missing its filter-context key,
colours set without the style gate, a computed row that lands in the grand total. One call, no
Desktop, and the failure message carries the fix. It reads the whole project, so one call after
twenty writes covers all twenty.

Two rules about how to read its answer, and the second matters more:

1. **The tool is not always there.** It needs Node. If it is missing, say so once and run
   `references/preflight.md` instead. Do not install anything and do not retry.
2. **A clean result is not a correct report.** Every response carries a `notChecked` list, and it
   is never empty, because the tool reads files and the expensive faults live in the data:
   whether a number is right, whether the actuals cover the same window as the comparison,
   whether the report renders at all. **Read that list back before you call anything verified**,
   and never write "validated" in a summary when what you mean is "the file checks passed".

### The node accelerator, which you almost certainly do not have

The `powerbi-desktop` / `powerbi-report-author` CLIs are node, and they are not part of this plugin. Most machines running this skill have no node at all. A `command not found` here is the
expected result, not a setup problem — drop to the dependency-free loop rather than installing or
retrying. Everything a user is expected to run must work with nothing installed.

```bash
node <your-builder>.js                        # write PBIR (validate inside — see below)
powerbi-desktop reload --pid <pid>            # page/visual edits only
powerbi-desktop screenshot-all --pid <pid> --output-dir out --settle 6000
# READ the screenshot. Then iterate.
```

The encodings they implement are documented in `references/formatting.md`, which does ship.

**Reload vs restart.** `reload` covers page and visual edits — and, **new
visual directories too** (see the bridge section in `references/verify-loop.md`). It does **not** re-read
`definition/report.json` or the model, and it will serve a **pixel-identical false green** from
cache — a registration you deleted still renders perfectly until you restart. A registration
change needs a cold restart (23 s on a small project, 159–210 s measured on real ones — the model
size and the cache drive it, so budget from your own first open); close Desktop and reopen the project.
**This paragraph is about the *node* `reload`.** The bridge's `file.reload/v1` is a different
instrument and **does** re-read the model when you pass `reloadModelDefinition: true` — see the
bridge section in `references/verify-loop.md`. Do not carry "reload never sees the model" across from here.

**Never skip validate.** It cannot check anything Zebra-specific, which makes skipping it feel
free. It is not: the errors it *does* catch are the ones that pop Desktop's *"Your report has
issues that could not be resolved"* modal, which wedges the Bridge for **every page in the report**
(`BRIDGE_ERROR -32505 "Print metadata is not available"`) and cannot be dismissed from the CLI.
So validate BEFORE you hand the project to Desktop, never after — a broken report that has already been opened costs you the modal as well as the fix.

**Gate on the DELTA, never `errorCount == 0`.** Two diagnostics fire on *correct* reports:
`PBIR_VISUAL_TYPE_UNKNOWN` (every Zebra visual, forever — the validator bundles only the ~60
built-in types) and `PBIR_SLICER_HEIGHT_BELOW_FLOOR` (fires on Zebra BI's own 92×46 slicers).
Filter both of those codes out before you read the count, or every clean report looks like it has two errors.
