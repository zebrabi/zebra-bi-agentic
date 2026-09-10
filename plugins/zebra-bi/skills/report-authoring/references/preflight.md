<!-- Summary: Run this after every write and before every launch — the mechanical PBIR and TMDL faults that render silently wrong or block a cold open, caught in about a second instead of a 90s restart or a human spotting them in a screenshot. -->
# Pre-flight — catch it at authoring time, not in the screenshot

Every check here exists because the fault it catches **actually shipped** and was found
by a human looking at a render. That is the expensive way. All of them are mechanical.

**Run after every write. Run before every launch.** It costs ~1 second. A cold-open failure costs
~90s, and a silent corruption costs a review cycle.

This is the **whole-project** check: report layer *and* model layer. It supersedes the model-only
lint in `model-layer.md`, which is the same TMDL checks without the report half — run this one
and you do not need that one. Why each TMDL check exists in full (what the error message looks like,
how to fix it) is still documented there. The script carries the eight TMDL killers that cost a cold
open most often plus four of the cheap grammar checks (a duplicate object, a `///` separated from its
object by a blank line, a relationship endpoint naming nothing in the model, a `database.tmdl` that does
not start with its `database` line); `validate_report` carries those twelve plus the remaining grammar
rules (unknown property, illegal enum value, duplicate property, and the rest of `references/tmdl.md`
section 7), so when the tool is available it is the fuller check.

## Why a *report-layer* check is needed at all

The skill's oldest rule is *"the screenshot is the only evidence"* — true, and it stays true. But it
has been read as *"only the screenshot can find problems"*, which is wrong and expensive. A whole
class of fault is **mechanically detectable before you ever launch Desktop**: corrupted text, a BOM,
unparseable JSON, a missing page file. Leaving those to the eye wastes the render loop on things a
regex settles, and — worse — they are the faults most likely to be *missed* by eye, because a
mangled title still looks like a title.

## The script

```powershell
param([string]$Project)   # folder containing <name>.pbip

$issues = @()

# ---------- THE .pbip SHORTCUT ----------
# Desktop validates this BEFORE it looks at the model or the report, and rejects a wrong $schema by
# opening `Untitled` with an empty canvas plus a Frown dialog - a third cause of a silent `Untitled` open, and the only one a regex settles. The natural wrong guess is the shape
# every OTHER PBIR file uses (`item/report/definition/...`); the .pbip does not follow it.

foreach ($f in (Get-ChildItem $Project -Filter *.pbip -File)) {
  try {
    $s = ([System.IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8) | ConvertFrom-Json).'$schema'
  } catch { $issues += "BAD JSON: $($f.Name)"; continue }
  if ($s -notmatch '^https://developer\.microsoft\.com/json-schemas/fabric/pbip/pbipProperties/1\.\d+\.\d+/schema\.json$') {
    $issues += "PBIP SCHEMA: $($f.Name) has '$s' - Desktop opens Untitled. Expected .../fabric/pbip/pbipProperties/1.0.0/schema.json"
  }
}

# ---------- REPORT LAYER ----------
$rep = Get-ChildItem $Project -Directory -Filter *.Report | Select-Object -First 1
if ($rep) {
  foreach ($f in (Get-ChildItem $rep.FullName -Recurse -Filter *.json)) {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)

    # 1. BOM - PBIR rejects it, and reload names the file but only once you launch
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
      $issues += "BOM: $($f.FullName)"
    }

    # 2. MOJIBAKE - the one that shipped. Text decoded as ANSI and re-encoded as UTF-8,
    #    usually by a ConvertFrom/ConvertTo-Json round-trip that did not pin the encoding.
    #    A mangled title still renders and still looks like a title.
    #    MATCH ON BYTES, NOT LITERALS: 0xC3 0x83 is the double-encoding signature. Pasting the
    #    mojibake characters into a .ps1 breaks the PowerShell parser - learned the hard way.
    $hi = 0; $mojibake = $false
    for ($i = 0; $i -lt $bytes.Length; $i++) {
      if ($bytes[$i] -gt 127) { $hi++ }
      if ($i -lt $bytes.Length - 1 -and $bytes[$i] -eq 0xC3 -and $bytes[$i+1] -eq 0x83) { $mojibake = $true }
    }
    if     ($mojibake) { $issues += "MOJIBAKE (double-encoded): $($f.FullName)" }
    elseif ($hi -gt 0) { $issues += "NON-ASCII ($hi bytes) - keep PBIR titles ASCII: $($f.FullName)" }

    # 3. Parses at all
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    try { $null = $text | ConvertFrom-Json } catch { $issues += "BAD JSON: $($f.FullName)" }
  }

  # 3b. TITLE TOKEN GATE - a [Measure] token in titleSettings.text resolves ONLY if that
  #     measure is projected into the visual's Filters role. Otherwise it renders the
  #     literal "[LFL label]" on the page and looks like a typo nobody made.
  foreach ($vf in (Get-ChildItem $rep.FullName -Recurse -Filter visual.json)) {
    $v = [System.IO.File]::ReadAllText($vf.FullName, [Text.Encoding]::UTF8) | ConvertFrom-Json
    # reset per iteration and guard the null array - textboxes have no titleSettings, and a
    # leaked $title from the previous visual produces a confident false positive
    $title = $null
    $ts = $v.visual.objects.titleSettings
    if ($ts -and $ts.Count -gt 0) { $title = $ts[0].properties.text.expr.Literal.Value }
    if (-not $title) { continue }
    $inFilters = @()
    if ($v.visual.query.queryState.Filters) { $inFilters = @($v.visual.query.queryState.Filters.projections.nativeQueryRef) }
    foreach ($m in [regex]::Matches($title, '\[([^\]]+)\]')) {
      $tok = $m.Groups[1].Value
      if ($inFilters -notcontains $tok) {
        $issues += "TOKEN NOT RESOLVABLE: '[$tok]' in $($vf.Directory.Name) title; Filters role has [$($inFilters -join ', ')]"
      }
    }
  }

  # 4. Every page in pageOrder has a page.json, and activePageName is one of them
  $pagesFile = Join-Path $rep.FullName 'definition\pages\pages.json'
  if (Test-Path $pagesFile) {
    $pages = [System.IO.File]::ReadAllText($pagesFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
    foreach ($pg in $pages.pageOrder) {
      if (-not (Test-Path (Join-Path $rep.FullName "definition\pages\$pg\page.json"))) {
        $issues += "MISSING PAGE: $pg is in pageOrder with no page.json"
      }
    }
    if ($pages.activePageName -and $pages.pageOrder -notcontains $pages.activePageName) {
      $issues += "activePageName '$($pages.activePageName)' is not in pageOrder"
    }
  }

  # 5. A base theme, or the report renders NOTHING with no error
  $reportJson = Join-Path $rep.FullName 'definition\report.json'
  if (Test-Path $reportJson) {
    $rj = [System.IO.File]::ReadAllText($reportJson, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if (-not $rj.themeCollection.baseTheme) { $issues += "NO BASE THEME - the report will render blank with no page tabs" }
    foreach ($pkg in $rj.resourcePackages) {
      # SharedResources are Desktop built-ins (e.g. baseTheme CY23SU08) - no file on disk is correct.
      # Verified by render: a report declaring one with no file paints normally.
      if ($pkg.type -eq 'SharedResources') { continue }
      foreach ($item in $pkg.items) {
        if (-not (Test-Path (Join-Path $rep.FullName "StaticResources\$($pkg.name)\$($item.path)"))) {
          $issues += "MISSING RESOURCE: $($item.path) is declared but absent"
        }
      }
    }
  }
}

# ---------- MODEL LAYER ----------
$sm = Get-ChildItem $Project -Directory -Filter *.SemanticModel | Select-Object -First 1
if ($sm) {
  $measures = @{}; $columns = @{}; $objs = @{}; $ends = @(); $allCols = @{}
  foreach ($f in (Get-ChildItem "$($sm.FullName)\definition" -Recurse -Filter *.tmdl)) {
    $b = [System.IO.File]::ReadAllBytes($f.FullName)
    if ($b.Length -ge 3 -and $b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191) { $issues += "BOM: $($f.Name)" }
    $lines = [System.IO.File]::ReadAllLines($f.FullName); $tbl = ""
    $inFence = $false; $exprIndent = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $ln = $lines[$i]; $t = $ln.Trim()
      $ind = (($ln -replace "`t", '    ') -replace '\S[\s\S]*$', '').Length
      # `//` IS legal DAX, so only a `//` outside an expression body is a TMDL fault. A fenced
      # body OPENS at the END of the assignment line and closes on a line that is only the fence.
      if ($inFence) { if ($t -eq '```') { $inFence = $false; $exprIndent = -1 }; continue }
      if ($t.EndsWith('```') -and $t -ne '```') { $inFence = $true; continue }
      $inExpr = $false
      if ($exprIndent -ge 0) {
        if ($t -eq '') { $inExpr = $true } elseif ($ind -gt $exprIndent) { $inExpr = $true } else { $exprIndent = -1 }
      }
      if (-not $inExpr -and $ln -match "^\s*(?:[A-Za-z_]\w*\s+)?(?:'[^']*'|[A-Za-z_][\w .\-]*)\s*=") { $exprIndent = $ind }
      # These three are guarded by the FENCE only, not by $inExpr, and the difference matters.
      # $inExpr marks every deeper line after any assignment as expression body -- right for `//`,
      # and it would make a property-position check unable to fire under `measure X = 1`, which is
      # exactly where `description:` appears. A fence is the only place a TMDL file holds arbitrary
      # text. Screened against 1,325 real .tmdl files: zero hits with no guard at all.
      if ($t -match '^description\s*:') {
        $issues += "DESCRIPTION PROPERTY: $($f.Name):$($i+1) - TMDL has no 'description:' property; use a /// line above the object. Fails with 'Unsupported property - description is not a supported property in the current context!'" }
      if ($t -match "^(table|column|measure|partition|hierarchy|level|role|perspective|calculationGroup|calculationItem)\s+(.+)$") {
        $kw = $Matches[1]; $nm = $Matches[2]
        $eq = $nm.IndexOf('=')
        if ($eq -ge 0) { $nm = $nm.Substring(0, $eq) }
        $nm = $nm.Trim()
        # Only the NAME. Everything after `=` is DAX and its spaces are ordinary.
        if ($nm -and -not $nm.StartsWith("'") -and $nm -match '\s') {
          $issues += "UNQUOTED NAME: $($f.Name):$($i+1) - $kw $nm - a name containing a space must be quoted ('$nm'). Desktop reports this as an INDENTATION error on a correctly indented line" } }

      if ($inExpr) { continue }

      if ($t -match '^//(?!/)') { $issues += "COMMENT: $($f.Name):$($i+1) - '//' is not TMDL" }
      if ($t -match '^///') {
        $gap = $false
        for ($j = $i + 1; $j -lt $lines.Count; $j++) {
          $n = $lines[$j].Trim()
          if ($n -eq '') { $gap = $true; continue }
          if ($n -match '^///') { break }
          if ($n -match '^relationship\b') {
            $issues += "DESC ON RELATIONSHIP: $($f.Name):$($i+1) - relationships take no /// description; DataModelLoadFailed" }
          # A /// description sits DIRECTLY above its object. A blank line between them fails the load.
          elseif ($gap) { $issues += "DESCRIPTION GAP: $($f.Name):$($i+1) - a blank line separates this /// description from its object" }
          break
        }
      }
      if ($ln -match '^table\s+(.+)$') { $tbl = $Matches[1].Trim().Trim("'")
        if ($tbl -eq 'Measures') { $issues += "RESERVED NAME: $($f.Name) - 'Measures' is a reserved table name (ModelSchemaValidationFailed); use '.Measures'" }
        # Unlike 'Measures' this one OPENS. The model is fine and every visual bound to the table
        # renders "Something's wrong with one or more fields", so nothing connects the two.
        if ($tbl -eq 'Goal') { $issues += "RESERVED NAME: $($f.Name) - 'Goal' loads without complaint and then breaks every visual bound to it; rename it (Goals, Target)" } }
      # A multi-line expression must not start on the `=` line: the `=` is bare and the body is
      # indented under it. Two forms continue below -- unbalanced parens, and VAR (which needs a
      # RETURN, so it always does). Parens are counted outside string literals so a caption cannot
      # open a phantom continuation, and ``` is skipped because that IS the legal multi-line form.
      if ($t -match "^measure\s+(?:'([^']+)'|([^\s=]+))\s*=\s*(\S.*)$") {
        $mn = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
        $expr = $Matches[3].Trim()
        if (-not $expr.StartsWith('```') -and $i + 1 -lt $lines.Count) {
          $nx = $lines[$i + 1]
          if ($nx.Trim() -ne '') {
            $nxInd = (($nx -replace "`t", '    ') -replace '\S[\s\S]*$', '').Length
            if ($nxInd -gt $ind) {
              $depth = 0; $q = $false
              foreach ($c in $expr.ToCharArray()) {
                if ($c -eq '"') { $q = -not $q }
                elseif (-not $q) { if ($c -eq '(') { $depth++ } elseif ($c -eq ')') { $depth-- } } }
              if ($depth -gt 0 -or $expr -match '^VAR\s') {
                $issues += "MULTILINE MEASURE: $($f.Name):$($i+1) - measure '$mn' starts DAX on the '=' line and continues below. The '=' must be bare, body indented deeper. Fails with 'Unexpected line type: Other!'" } } } } }

      if ($t -match "^measure\s+'?([^'=]+?)'?\s*=") { $measures["$tbl|$($Matches[1].Trim())"] = 1 }
      if ($t -match "^column\s+'?([^'\r\n]+?)'?\s*$") { $columns["$tbl|$($Matches[1].Trim())"] = 1 }
      # A measure, column, hierarchy or partition is declared ONCE per table, across every file of the
      # model. The second declaration fails the load; a name typed twice in a split model is how it happens.
      if ($t -match "^(measure|column|hierarchy|partition)\s+(?:'([^']+)'|([^\s=]+))") {
        $on = if ($Matches[2]) { $Matches[2] } else { $Matches[3] }
        # Every column, calculated ones (`column X = <DAX>`) included, is a legal relationship end.
        if ($Matches[1] -eq 'column') { $allCols["$tbl|$on"] = 1 }
        $ok = "$tbl|$($Matches[1])|$on"
        if ($objs.ContainsKey($ok)) { $issues += "DUPLICATE OBJECT: $($f.Name):$($i+1) - $($Matches[1]) '$on' is declared twice in table '$tbl' (first at $($objs[$ok]))" }
        else { $objs[$ok] = "$($f.Name):$($objs.Count)" } }
      # Relationship endpoints, collected here and resolved after every file is read.
      if ($t -match "^(fromColumn|toColumn):\s*(.+)$") { $ends += ,@("$($f.Name):$($i+1)", $Matches[2].Trim()) }
    }
  }
  foreach ($k in $measures.Keys) { if ($columns.ContainsKey($k)) { $issues += "NAME COLLISION: $k" } }
  # Both ends of a relationship must name a table and a column the model declares, as Table.Column
  # (the table quoted when its name has a space). An endpoint naming nothing fails the whole load.
  foreach ($e in $ends) {
    $ref = $e[1]
    if ($ref -match "^'([^']+)'\.(.+)$") { $rt = $Matches[1]; $rc = $Matches[2].Trim().Trim("'") }
    elseif ($ref -match "^([^.]+)\.(.+)$") { $rt = $Matches[1]; $rc = $Matches[2].Trim().Trim("'") }
    else { $issues += "RELATIONSHIP ENDPOINT: $($e[0]) - '$ref' is not Table.Column"; continue }
    if (-not $allCols.ContainsKey("$rt|$rc")) { $issues += "RELATIONSHIP ENDPOINT: $($e[0]) - '$ref' names no column the model declares" }
  }
  # database.tmdl begins with its `database` line, named or bare. A file holding only properties fails.
  $dbf = Join-Path $sm.FullName 'definition\database.tmdl'
  if (Test-Path $dbf) {
    $first = (Get-Content $dbf | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1)
    if ($first -notmatch '^database(\s|$)') { $issues += "DATABASE LINE: database.tmdl must start with 'database' (found '$first')" }
  }

  # Reported, not flagged: a cultures/ file is legitimate TMDL that cold-opens perfectly and
  # silently kills `file.reload/v1`, i.e. the whole one-second loop. Knowing costs nothing; not
  # knowing cost seven cold opens.
  $cul = Join-Path $sm.FullName 'definition\cultures'
  if (Test-Path $cul) {
    "NOTE: a cultures/ file is present - file.reload/v1 will not work on this project (it cold-opens normally). Budget a cold open per iteration, or remove it if nothing needs it."
  }

  # Reported, not flagged. Every shipped template sits at 1600/1601 and every one of them opens,
  # so this is not a defect — it only means `file.reload/v1` is refused until the file says 1606.
  $db = Join-Path $sm.FullName 'definition\database.tmdl'
  if (Test-Path $db) {
    $m = [regex]::Match((Get-Content $db -Raw), 'compatibilityLevel:\s*(\d+)')
    if ($m.Success -and [int]$m.Groups[1].Value -lt 1606) {
      "NOTE: compatibilityLevel $($m.Groups[1].Value) - Desktop runs the model at 1606 or higher, so a reload of a file below 1606 is refused as a downgrade. Write 1606 (up to 1702 is accepted). Not a fault."
    }
  }
}

if ($issues.Count -eq 0) { "PRE-FLIGHT: PASS" } else { "PRE-FLIGHT: $($issues.Count) issue(s)"; $issues | % { "  - $_" } }
```

## Writing files without creating the faults in the first place

- **Do not hand-author ANY schema-versioned file.** `.pbip`, `definition.pbir`, `version.json`,
  `definition.pbism` and `.platform` are three lines each, they carry a pinned `$schema`, and there is
  no upside to writing one from memory. **Copy a working project's copy and change the path/name**
  (and re-stamp `.platform`'s `logicalId` so the copy has its own identity). Guessing a `$schema` by
  analogy with the neighbouring files is exactly how the check above came to exist.
- **Never `Set-Content -Encoding utf8`** in PowerShell 5.1 — it writes a BOM. Use
  `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`.
- **Assert the shape of GENERATED data before you write it.** Building DAX/JSON rows in a loop and
  joining them is where silent corruption enters: a multi-line PowerShell `@(...)` array literal fed
  to `-join ','` emitted 700 **space**-separated `DATATABLE` rows — valid-looking,
  completely wrong, and it would have surfaced as an unexplained cold-open failure. Use a
  `System.Collections.Generic.List[string]` + `[string]::Join`, then **assert one row** (count the
  separators) before writing. Same family as the `ConvertTo-Json` blob damage below.
- **Never round-trip a `visual.json` through `Get-Content | ConvertFrom-Json | ConvertTo-Json`
  without pinning the encoding on the way in.** `Get-Content` guesses, and each guess-and-rewrite
  compounds: a `·` became `Â·`, then `ÃƒÆ'Ã†â€™…` after several passes. Read with
  `[System.IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)`.
- **Better: keep report-layer titles ASCII.** A `-` separator survives every toolchain; `·` and `—`
  are one careless read away from mojibake and the render still *looks* fine.

## Three name-resolution checks worth more than everything else here

Each of these is a **cold-open failure or a visible error in the report**, each is decided entirely
by text you already have on disk, and each costs a full restart to find by rendering. All three fire
on the same mistake: **renaming something and not updating what points at it.** That is not an
exotic error — it is the single most common edit an author makes.

**1. Every relationship endpoint must resolve.** For each `relationship` in `relationships.tmdl`,
split `fromColumn` and `toColumn` on the dot and confirm the table has a file and the column is
declared in it. A stale endpoint gives:

> Cannot resolve all the paths while de-serializing Database. Property FromColumn of object
> "relationship X" refers to an object which cannot be found

…and the project does not open at all.

**2. Every report field reference must resolve.** Walk every `visual.json` for `Measure` and
`Column` nodes, read `Expression.SourceRef.Entity` and `Property`, and confirm that table exists and
declares that measure or column. This one does **not** stop the report opening — it renders, and the
field is silently absent, with `Missing_References` in the error detail. **A report that opens is
not a report whose fields resolved.**

**3. A multi-line measure must put NOTHING after the `=`.** TMDL takes the body on the following
lines, indented deeper than the property:

```tmdl
	measure 'AR overdue' =
			VAR AsAt = [AR as at]
			RETURN
			COUNTROWS ( FILTER ( 'AR', 'AR'[Settled] = 0 && 'AR'[DueDate] < AsAt ) )
		formatString: #,0
```

Start the DAX on the `=` line and continue it below and **the whole model fails to load**, with no
message naming the measure. Detect it as: a `measure` line with text after `=`, whose next line is
indented three tabs or more and is not `formatString` / `lineageTag` / `displayFolder` / `isHidden`.

## Mechanical, but NOT checked here yet

Known-detectable faults this script does not cover. Do them by hand until someone writes and
**renders** a check for them:

- **Textbox height vs font size.** `h >= fontSize(pt) * 1.333 * 1.3 + ~16` — a 22pt title in a 40px
  box gets Power BI's own scrollbar and clips. 
- **Visuals overlapping, or hanging off a 1280×720 canvas.** Renders without complaint.

## What this does NOT replace

The screenshot. Everything Zebra-specific — bindings, roles, whether a number is right, whether the
variance is comparable — is invisible to this script and always will be. This catches the
*mechanical* layer so the render loop is spent on the *semantic* one.
