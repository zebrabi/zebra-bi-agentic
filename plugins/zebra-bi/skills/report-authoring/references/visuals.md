<!-- Summary: The Zebra products — GUIDs for both the Plus and certified tracks, which to author by default, roles, per-product differences, and the split between the GUIDs in shipped templates and the installed ones that makes a naive lookup return nothing. -->
# The visuals

Five to author with: **Tables+ and Charts+**, their **certified** twins, and **Cards**, which has no
Plus variant.

| product | `visualType` — AUTHOR WITH THESE | installed |
|---|---|---|
| Zebra BI **Tables+** — **default** | `ZebraBITablesPlus3E6085701D7B426980C3859B16327993` | 8.3.0.16 (Beta) |
| Zebra BI **Charts+** — **default** | `ZebraBIChartsPlusC3F2FD9F79054F76BD1B722E7666AC33` | 8.2.1 (Beta) |
| Zebra BI **Cards** | `zebraBiCards2C860CFAA9944091B75F0DBD117F20FA` | 7.4.2.115 |
| Zebra BI **Tables** (certified) | `ZebraBITablesBAE31B370F254F808553548EFB35BFA5` | 8.3.0.37 |
| Zebra BI **Charts** (certified) | `waterfall6C9ED82ABD1F44C4A0D590CE01EB5EE7` | 8.1.0.36 |

**All five register the same way** — as a bare GUID in `publicCustomVisuals` (mechanism 1 below).
The Plus visuals are *not* organizational-store visuals: Desktop writes their plain GUID with no
`_OrgStore` suffix and adds no `resourcePackages` entry, so nothing about registering them differs
from the certified three. **Charts+ 8.2.1 is ahead of certified Charts 8.1.0.36**, so do not assume
the Plus build trails its twin.

**Every version here is what the visual reports about itself on this machine**, read off its own
landing page or its package. Yours may differ; the GUIDs are the stable part, and nothing in this
skill keys off a version number.

## Author the Plus visuals by default

**Use Tables+ and Charts+ unless the person tells you otherwise.** They are the same visuals — same
data roles, same properties, same rendering — plus a collaboration layer, so nothing else in this
skill changes when you swap the GUID. Cards has **no** Plus variant, so a Cards visual is always the
certified GUID; a page mixing Cards with Tables+/Charts+ is normal and correct.

**Say once, in the plan, that you are using them** — one line, not a lecture: *"Tables+ and Charts+,
so viewers can comment on the report in view mode. They are not Microsoft-certified and are in Beta;
say the word and I'll use the certified visuals instead."*

**Switch to the certified track** — `ZebraBITables…`, `waterfall…` — whenever any of these is true,
and you should ask if you cannot tell:

- Microsoft **certification** is required in their tenant, or the report goes somewhere governed that
  demands certified-only visuals.
- **Native PDF export**, print or subscription workflows matter for this report.
- Viewer commenting is not wanted, or their IT has not enabled the **SharePoint** setup it needs.
- They ask for certified visuals, or they are **editing an existing report** that already uses them —
  match what is there; do not migrate a report's visuals as a side effect of another change.

Both tracks are supported and neither is going away, so this is a default, not a migration.

### What is actually different about them

**Nothing you author.** Verified by re-extracting both installed packages, and by a three-arm render —
certified, Plus, and a deliberately-unresolvable GUID as the control:

- **Schema: identical.** Tables+ 8.3.0.16 vs Tables 8.3.0.37 — 26 object groups, **432 properties**
  with identical names *and* identical types (0 type differences), 10 data roles, matrix mapping,
  every top-level capability the same.
- **The only delta is `privileges`**: Tables+ adds `AADAuthentication` to `https://api.zebrabi.com`
  and a non-essential `WebAccess ["*"]`. Viewer commenting is a **runtime** feature — the annotation
  properties already exist on the certified visuals. The one property that only *does* something on
  a Plus visual is `annotationLayerSettings.annotationsStorageConfig`, the link to the SharePoint
  workbook the comments live in; `encode_storage_config` writes it, and SKILL.md's *View-mode
  comments* says when to.
- **Render: identical.** Same PBIR, GUID swapped, **0 differing pixels** of 538,488 sampled canvas
  pixels for both pairs. No sign-in prompt, no licence gate, no placeholder.


### View-mode comments workbook

The Plus visuals keep view-mode comments in an Excel workbook on SharePoint and reach it through
Graph as the signed-in user, so **whoever can open the workbook can read the comments, and whoever can
edit it can add, change and delete their own**. Report access alone shows a viewer nothing. Editors
see the same comments in Desktop, which is why a Desktop render is a valid check of the storage layer.

**The link** is `annotationLayerSettings.annotationsStorageConfig`, one JSON text property:

```jsonc
{ "storageBackend": "sharePointExcel",
  "storageOptions": { "siteId": "<site collection GUID>",
                      "folderPath": "/drive/root:/Folder/Sub",   // "/drive/root:" for the library root
                      "fullFileName": "comments.xlsx" } }
```

`encode_storage_config` writes it and derives `siteId` from a Graph `driveId` when you have one (it
is the first of the three GUIDs packed into the id). The visual resolves it as
`/sites/{siteId}{folderPath}/{fullFileName}:/workbook`, and ☠️ **nothing validates the path before
the visual loads** — a wrong part shows the loading skeleton, then an empty panel, no error. Create
the workbook before the report is first opened. **Put it in a team-site document library**: that is
what the visual's own file picker offers and what the permission model is built on. A personal
OneDrive path resolves at runtime but is not offered by the picker, so author one only when asked.

**The workbook.** Sheet `Annotation` holding **one** Excel table (the visual takes the first), headed
exactly `UUID, Type, Tenant ID, User ID, User Name, Content, CreatedAt, UpdatedAt, Status`. The
visual adds a missing column itself and refuses a foreign column inserted among these nine.

| column | value |
|---|---|
| `UUID` | the comment's id, the same as `uuid` inside `Content` |
| `Type` | `comment` (also `highlight`, `cagrArrow`) |
| `Tenant ID`, `User ID` | Entra tenant and object id of the person the comment belongs to — they can edit or delete it in view mode; editors can manage every row |
| `User Name` | display name shown with the comment |
| `Content` | **the same JSON an authored `annotationComments` entry carries** — `encode_annotations` produces it; one object per row, stringified |
| `CreatedAt`, `UpdatedAt` | ISO-8601 UTC |
| `Status` | `active`; a delete sets `deleted` and keeps the row |

**Append rows; never regenerate a workbook viewers also write to** — a whole-file replacement drops
what they added. Through Graph the safe call is the Excel table `rows/add`, which is exactly what the
visual itself does. **Getting write access is the part a tenant decides, not you**: a delegated Graph
token needs an app the tenant allows, and Conditional Access can refuse every public client an agent
could use. Two routes work without one, in this order: **the person opens the workbook from
SharePoint in desktop Excel and you attach to that running Excel over COM** (signed in, holding the
co-authoring session, so a plain `Save` writes back — a fresh Excel instance opening the URL itself may
be refused); or a folder the OneDrive client syncs, where a plain file write uploads. Either way the
render is the check: the visual shows the rows or it shows *"No comments match this view"*.


Two things the checker reads off the link once it is written:

A view-mode comments link (`annotationLayerSettings.annotationsStorageConfig`) belongs on Tables+ or
Charts+, the visuals that carry the viewer comment panel. On the certified Tables and Charts the
property has no effect, so a link written there looks configured while viewers get no comment panel
and can add nothing. Switch the visual to its Plus twin, or drop the link and carry the commentary in
the authored comment layer. `validate_report` catches this.


A view-mode comments link needs the comment panel on: `commentBoxSettings.show` must not be `false` on
the same visual. With the panel off, existing comments still mark their data points and show on hover,
but the panel is where a viewer writes a new one, so the link is set up for a conversation nobody can
start. Leave `show` unset or set it to `true`. `validate_report` catches this.



**Not established:** view-mode viewer commenting itself — the reason the Plus visuals exist — has not
been exercised from an authoring session, because it needs the Service and a SharePoint file. Treat
them as drop-in equivalents *for authoring* and claim nothing about the feature.

> ☠️ **Charts+ does NOT carry the `waterfall` prefix.** Certified Charts is `waterfall6C9ED82…`;
> Charts+ is `ZebraBIChartsPlus…`. Anything that finds Zebra chart visuals by matching `waterfall` —
> a grep, a filter, a validator's prefix table — **silently misses every Charts+ visual** and reports
> a clean result on a page it never read.

**Charts' GUID and filename both say `waterfall`.** Historical artifact. It is the entire Charts
product — waterfall is one `chartType` value among many. This is the single most likely thing to
send you down a wrong path.

## Two GUID universes

Twenty Zebra BI templates embed **different GUIDs for the same products** (file-imported at 6.0–7.8):

| product | GUID inside shipped templates (READ ONLY) |
|---|---|
| Charts | `waterfall0221D8FBE40445C1A4E598AA8EF8B506` |
| Tables | `ZebraBITables98F88148E5424E949E69864664EE1860` |
| Cards | `zebraBiCards8085D508EB994C8081CA47C85ABD7C26` |

A join on `visualType` between the two sets returns **~zero overlap by design** — enough to produce
a confident, completely inverted conclusion ("templates use none of our catalog"). **Join on the
product NAME.** Author with the installed GUIDs; read templates with the ones above.

Property lookup: the declared enum values for a property live in the visual's own capabilities, and `formatting.md` records the ones that matter.

## Roles

**Uniform across all of them, Plus included.** One binding shape drives everything; chart↔table is a
one-line `visualType` swap with the query untouched, and so is certified↔Plus.

| role | kind | notes |
|---|---|---|
| `Category` | Grouping | a LIST → a hierarchy, but **it is not the same object on each product** — see *Hierarchy depth* below |
| `Group` | Grouping | small multiples; a LIST of 2 → 2D grid |
| `Values` | GroupingOrMeasure | "actual" |
| `PreviousYear` | GroupingOrMeasure (Cards: Measure) | needs time context |
| `Plan` | GroupingOrMeasure (Cards: Measure) | |
| `Forecast` | GroupingOrMeasure (Cards: Measure) | |
| `Tooltips` | Measure | |
| `Comments` | Measure | narrative from the model |
| `Filters` | Measure | reaches a data island |
| `CategoryClass` | Measure | **Tables only** — IBCS row semantics |
| `KPI Descriptions` | Measure | **Cards only** |

```js
visual: { visualType: TABLES, query: { queryState: {
  Category:     { projections: [ … ] },   // role name IS the key
  Values:       { projections: [ … ] },
  PreviousYear: { projections: [ … ] },
} } }
```

### What a projection's four keys do

`field`, `queryRef`, `nativeQueryRef`, **`displayName`**. **Only `displayName` changes the label on
screen.** `queryRef` is qualified (`Financials.Value AC`) and `nativeQueryRef` is the bare column
name the query returns — the two differing is the ordinary shape, not a rename, and Desktop writes
a divergent one itself when two tables carry a field of the same name (`AC` from a second table
becomes `AC2`).

So relabelling through `nativeQueryRef` does nothing and reports nothing. Bind a Card to a measure
named `AC_` and it renders "AC_", with deltas "ΔPY_" and "ΔPL_", whatever `nativeQueryRef` says. On
Cards the field name **is** the card title, so this is the difference between a KPI row and a debug
dump. Set `displayName`.

### `CategoryClass` (Tables)

Carries the IBCS row semantics — which rows are results (`=`), which are subtractive (`-`), which
invert. Bound as `Max(Accounts[Category Class])`. Bind it and the `+ / − / =` prefixes, subtotal
rules and sign handling come out right with no further configuration.

**The value domain is the three plain text characters, `+`, `-` and `=`**, held in a text column on
the scheme dimension and projected with the `Max` aggregation (function code 4). Render-verified on
two independent income statements: a `-` row draws with a `−` prefix and **inverts its polarity** —
Operating Expenses up 5M renders red with nothing else set — and an `=` row draws bold as a result
row (Operating Profit, Net Income). Store the amounts positive, as the ledger holds them; the class
carries the sign. The `=` rows' values are the model's job: compute them with the signed roll-up in
`references/model-layer.md`, the visual only styles them.

### `Filters`

Takes **measures**. Its purpose is reaching data the relationships cannot: a separate data island
(e.g. a `CashFlow` table with no path to the page's `Calendar`) is filtered by binding support
measures that carry the slicer selections across. Not to be confused with `filterConfig`.

Verified on two unrelated templates, so it generalises. In the second, *every* value measure
resolves through a disconnected parameter table, so **every** Zebra visual on the page reads its
slicers this way — `Selected Year`, `Selected Month Name`, `Selected Market`, each a
`SELECTEDVALUE`/`MIN` support measure.

**Its second use is making text tokens resolve.** A `[Measure]` token in a title, or in a
`legendHeaderSettings` header, resolves only if that measure is projected somewhere on the visual —
otherwise the token renders as literal text. Projecting it into `Filters` is how you get a dynamic
title or a dynamic column header without adding a column to the chart. Render-proven for both titles
and headers on a report whose every period label came from the data.

### Two projections in ONE role

`Values` with two projections renders **a value chart AND a dot-chart overlay** — e.g. AC columns
with a margin-% line over them, from one binding. `dotChartDataLabelSettings` styles the second.
The same list-taking behaviour as `Category` (→ hierarchy) and `Group` (→ 2D multiples), but the
result is a different *chart*, not a different grouping.

**A comparison pairs with `Values[0]`, and the rest are plain columns.** On a Table with three
`Values` projections and one `Plan`, the variance (`ΔPL`, `ΔPL%`) is computed against the **first**
projection only; projections 2..n render as ordinary measure columns with no comparison. Render-
proven on five tables.

So the ordering of `Values` is a *semantic* choice, not cosmetic: **put the measure you want the
variance on first.** This is what lets one table carry a benchmarked rate and its supporting volume
and count columns at the same time — and it composes with `sortSettings.columnName`, which takes a
display name, so you can benchmark column 1 while sorting on column 2.

## Per-product differences

The differences are small in number and every one of them is a trap:

| | Cards | Charts | Tables |
|---|---|---|---|
| colour/design object | **`design`** | **`designSettings`** | **`designSettings`** |
| data labels object | **`dataLabels`** | **`dataLabelSettings`** | **`dataLabelSettings`** |
| number format | `dataLabels.numberFormat: 'P'` | via model `formatString` | via model `formatString` |
| axis break | `card.cardDefaultAxisBreak` | `axisBreakSettings.show` | — |
| axis label density | **none** | `categorySettings.axisLabelDensity` | — |
| per-column API | — | — | `chartSettings.columnSettings` |
| whole-visual invert | `card.cardDefaultInvert` | `chartSettings.invert` | `chartSettings.invert` |
| **per-item invert** | `customData.uniformData` → `cards[<id>].kpiInvert` **(blob)** | `groupsMetadata.inverted` (per **group**) | `groupsMetadata.inverted` (per **group**) |
| **per-ROW invert** | — | untested | `categoriesMetadata.invertCalculationCategoriesValues` **(blob)** + a `previewSettings.migrationsLog` gate |
| layout | `grid.cardsInRow` + container height | `multipleLayout.*` | `multipleLayout.*` |
| comment bubble (authored) | **❌ not declared at all** | `annotationLayerSettings` + `commentBoxSettings` | `annotationLayerSettings` + `commentBoxSettings` |
| **☠️ a comment's `categoryFields`** | — | **the category field NAME**, one per axis level | **always `[]`** |
| `Comments` data role | ✅ (max 2) | ✅ | ✅ |
| per-card chart scale | **per card** (`chartMax`/`chartMin` in the layout blob) — **not shared** | one scale across all small multiples | — |
| declared objects | 8 | 25 | 26 |

**On a narrow visual, keep the comments and switch the PANEL off.** `commentBoxSettings.show: false`
still draws the numbered marker on the data point and still serves the text on hover, so the comment
survives while the chart keeps its full width. Under roughly 1,000px of visual width the panel takes
so much of the box that the chart stops being readable, which is the point at which the trade is
worth making. Keep the panel on the wide visuals, where the text can be read without hovering.

❌ **The comment row means a comment cannot be authored onto a Cards visual at all.** There is no
object to write to and nothing appears. A Cards comment has to come through the `Comments` **data
role**, which means the text must exist in the model.

**Per-ROW invert on a Table takes two objects, and one of them is a preview gate.** Use it for the
exception — a single cost row in an otherwise higher-is-better table — where making the polarity
split a `Group` would list every category under both headers:

```jsonc
"categoriesMetadata": [{ "properties": {
  "invertCalculationCategoriesValues":
    "'[{\"hierarchyIdentity\":\"Spend.Dept\",\"category\":\"Operations\",\"level\":0}]'"
}}],
"previewSettings": [{ "properties": {
  "migrationsLog": "'{\"calculationCorrectionFeature\":{\"isMigrationCompleted\":true}}'"
}}]
```

`hierarchyIdentity` is the field's `queryRef`, `category` is the row's plain data value, `level` is
`0` on a flat category axis — so nothing has to be created in Desktop first. ☠️ **Without the
`migrationsLog` gate the invert is accepted and silently ignored**, with no warning and no validator
finding: the row simply keeps default polarity. Only `isMigrationCompleted: true` matters inside the
gate — **do not add a `visualVersion`**, since a matched version string would stop working on a
visual release. Tables and Tables+ take the identical shape; on Charts it is untested.

⚠️ `calculationCorrectionFeature` is a Zebra **preview** feature, and writing that flag switches it
on for the visual. Say so when you use it rather than slipping it into a report silently.

☠️ **The `categoryFields` row is a silent dropper.** Tables wants `[]`; Charts wants the category
field's display name (`["Segment"]`, and one entry per level on a hierarchy: `["Year","Quarter Name"]`).
Author a Charts comment with `[]` and the visual renders perfectly while the comment panel reads
*"No comments match this view"* — no error, no bubble, nothing naming the cause. The corpus is
unanimous, 200 Tables comments all `[]` and 56 Charts comments all named, and it is render-confirmed in
both directions.

**Cards renames things.** `design` (not `designSettings`), `dataLabels` (not
`dataLabelSettings`). Two independent instances of the same trap: same concept, different object
name, no error when you guess by analogy — the property is simply ignored. Assume any Cards object
name is different until you have checked the catalog.

`dataLabels.numberFormat: 'P'` is what turns a raw fraction into `32.6%` on a Card. Charts and
Tables take their format from the model's `formatString` instead; Cards does not.

**Cards: `Category` bound but `Group` unbound → exactly ONE card**, stretched full width.
`grid.cardsInRow` + a `Group` binding is what makes Cards a KPI row.

**A card's headline number is its `Values` projection, and nothing else changes that.** Bind
`Forecast` as well and you do not get a forecast headline — you get the actual, with the forecast
added as a small delta underneath. So a tile meant to read "forecast 46.3M" prints the actual and
looks simply wrong, with every property correctly set. **One scenario plus one reference per tile**
is the shape that says what you meant; if the headline has to be the forecast, make the forecast the
`Values` measure.

**Two Cards facts that a declared-property list gets wrong.** Both were established by render, and
both are traps if you reason from the catalog alone:

- **Cards declares no `groupsMetadata`, but it CAN invert a single card.** The lever is a
  JSON-string blob — `customData.uniformData` → `cards[<id>].kpiInvert` — so no census of declared
  objects will ever show it.
- **Cards layout is NOT set by that blob's `globalCardSize`.** An authored blob with an empty
  `cards{}` is accepted and silently ignored. Cards-per-row comes from `grid.cardsInRow`; card
  height comes from the **container**, because the card auto-sizes to its content (≈264px with
  `Values` + `PreviousYear`).

## What Zebra does for free

Scenario notation, variance calculation, delta labels, IBCS good/bad colouring (on by default),
hatched forecast fills, result-bar treatment — **all derived deterministically from the role
binding**. No DAX, no properties. This is why bindings are the product: get them right and most of
the report is already correct.

**Axis label format comes from the model's `formatString`**, not the report layer. The report cannot
override it.

---

# Registration — the other two mechanisms

**Read this when a Zebra visual comes back as a grey box or "can't display this visual", or when the
report you were handed registers its visuals some way other than `publicCustomVisuals`.**

### `publicCustomVisuals` is only ONE of three registration mechanisms

A GUID that renders on one machine and shows a grey box on another is almost always a registration
mismatch, not a binding fault. Three mechanisms exist; they use **different GUIDs for the same
product**, so you cannot mix them. Established by reading resaved Zebra BI templates that
use each.

| # | Mechanism | Where it registers | `visualType` | Payload |
|---|---|---|---|---|
| 1 | **AppSource / public** | `publicCustomVisuals: ["<GUID>"]` | `<GUID>` | none — must be installed on the rendering machine |
| 2 | **Embedded / file-import** | `resourcePackages` entry `type: "CustomVisual"`, item `path: "<GUID>.pbiviz.json"` | `<GUID>` | **inside the report**: `<Name>.Report/CustomVisuals/<GUID>/resources/<GUID>.pbiviz.json`, 2.4–4.4 MB each |
| 3 | **Organizational store** | `resourcePackages` entry `type: "OrganizationalStoreCustomVisual"`, name `<GUID>_OrgStore` | `<GUID>_OrgStore` | a **tenant-minted blob**: `path: "2/<tenant-guid>/ResourcePackage/BlobIdV2-<opaque>.json"` |

Worked evidence: `Marketing Attribution Dashboard` is pure mechanism 2 — `publicCustomVisuals` is
`[]`, three `CustomVisual` resource packages, three payload files on disk, and every Zebra visual's
`visualType` is the unsuffixed GUID. `Dashboard Tips&Tricks v3` mixes 1 and 3 in one file.

**What this means for authoring:**

- **Mechanism 2 is the one you can author.** It is plain text plus a file copy: add the
  `resourcePackages` entry and copy the `CustomVisuals/<GUID>/` folder in beside `definition/`. It
  is self-contained and portable between machines and tenants, and the licence rides inside the
  payload — which is why a report built this way is not at the mercy of what the opener has
  installed.
- **Mechanism 3's `path` is not derivable.** It is opaque, tenant-scoped and nothing in the file
  tells you what it should be. **Do not try to author it** — it is a long, plausible-looking dead
  end.
- **Either way, seed rather than guess.** Have the human open the blank `.pbip` in Desktop, drop
  one Charts, one Tables and one Cards, and save. That save writes whichever registration *their*
  tenant actually uses, with a working licence. The agent then copies the existing
  `resourcePackages` / `visualType` / `CustomVisuals/` shape verbatim and never authors a
  registration at all; the seeded visuals are deleted or overwritten like any others. Sixty seconds
  of human time removes a whole class of failure you cannot diagnose from text.

**Read the registration before you author a single visual.** `publicCustomVisuals` being empty is
not a bug to fix — on a mechanism-2 report it is correct, and "helpfully" adding the AppSource GUID
gives you two registrations for one product and a visual that resolves to the wrong build.

**Rendered results: two experiments, both with `licenseSettings` omitted entirely.**

*Two arms on one page, one model, identical bindings.* A Zebra Table authored against the
mechanism-2 GUID and one against the mechanism-1 GUID, side by side: **both rendered live and
unlocked**, no "Feature Limit Reached", no grey box, same five values and ten deltas — all confirmed
against the model by `EVALUATE`.

*Clean room, to remove the obvious confound* — that first test ran in a report that still carried
embedded payloads. So: `CustomVisuals/` deleted, every `CustomVisual` resource package stripped,
`publicCustomVisuals` set to the three AppSource GUIDs, one Table authored with no licence key.
**It rendered a complete IBCS variance table** — PY column, AC bars, ΔPY, ΔPY% — with the same
DAX-verified numbers.

Two things follow, and they remove a manual step people would otherwise be told to do:

- **Registration needs no `licenseSettings.licenseKey`, so never hunt for one or copy one from
  another report.** A report authored without one renders on a machine that holds the visuals —
  proven in both arms below. Vendor templates and saved reports carry one because a *human* saving
  the report writes it, and because it is how the entitlement travels with the file.
- **A key the user hands you is how you activate the visuals — from the file, with no Desktop
  step.** When a Zebra visual renders in **Free** mode (a footer reading *"Zebra BI Charts · Free ·
  Enter license key"*), and the user pastes a key from their trial or purchase email into the chat,
  write it into **every** Zebra visual on the report and render once:

  ```json
  "objects": {
    "licenseSettings": [ { "properties": { "licenseKey": { "expr": { "Literal": { "Value": "'<key>'" } } } } } ],
  ```

  The value is the key in single quotes, like every other string literal. **It is an array of
  property blocks**, like every other `objects` entry; a bare object makes Desktop refuse the whole
  definition (*"Property /visual/objects/licenseSettings … was not provided as the correct type"*).
  Cards also carry the same key under `license`, with `licensedTo` and `validUntil` beside it; write
  `licenseSettings` on Cards too, and `license` as well if it stays Free. On the next render the
  visual reads the key, drops the Free footer, and **stores the entitlement in Desktop's own
  storage** — a later report on that machine renders licensed with no key in its files. Then run
  the licence stripper over the project so the key does not travel with the report; the machine
  stays entitled. Never author a key the user did not give you, and never leave one in a project
  you hand over.
- **You do not need anything pre-placed in the report.** Three GUIDs in `publicCustomVisuals` is the
  whole registration — no payload, no resource package, no seeded visual. Desktop fetches an
  AppSource visual by GUID for a report it has never opened and a visual the machine has never
  added — the pane even gains its icon.

**When a visual still comes back unresolved** — *"To see this custom visual, add it to this report
first: <GUID>"*, a grey box, *"can't display this visual"* — do these in order, and stop at the first
that works. **Restart Desktop**: it loads its visual registry at startup, so a fetch that failed at
launch stays failed for the session, and a visual added mid-session does not appear on
`file.reload/v1` either. If it persists, **Get more visuals → search "Zebra BI" → Add** the missing
visual, once per machine; the same files then render. Only a tenant whose Desktop carries the
**organizational-store builds alone** needs the 60-second seed in the cold-start section — as
recovery, never as a prerequisite.

☠️ **"Installed" is per visual, and Charts+ resolving tells you nothing about Tables+.** They are
separate AppSource items, so a page where every chart renders and every table is a white box is not a
PBIR fault — it is one missing install, and the identical file renders once the visual is added. Read
the blank as a machine question before you touch the file.

⚠️ **A newly installed visual needs a Desktop RESTART, not a reload.** Desktop reads its
custom-visual registry at startup, so `file.reload/v1` on a running instance keeps reporting the
visual unresolved however correct the definition is. This is the one cold open in the loop that is
actually justified; every other symptom deserves a reload first.

---

# Tooltips

**Read this when you want a tooltip** — either extra measures in the default bubble, or a whole
report page on hover.

## Hierarchy depth — expand, drill, and where the state lives

A `Category` list makes a hierarchy, but **the three products do different things with it**, and
choosing the wrong one produces a page that renders perfectly and answers a different question.
Which one to reach for is a design decision — `references/design.md` §12 — this section is the
binding.

| | Tables / Tables+ | Charts | Cards |
|---|---|---|---|
| a `Category` **list** gives you | an expandable tree: parent **and** child rows together | a **stacked multi-level axis of the LEAF members** — every leaf, ancestry printed beneath | one tile per leaf |
| expand / collapse in place | ✅ | ❌ | ❌ |
| `expansionStates` honoured | ✅ | **inert** | **inert** |
| `drillSettings.loadStrategy` | ✅ | — | — |
| cross-visual highlight | none — selection **filters**, it never dims | none | none |

Two consequences that catch people:

- ☠️ **A hierarchy on a Chart is not collapsible and cannot be pre-positioned.** Bind three
  `Category` levels to a Chart and you get every leaf on one axis with a two- or three-line label
  under each. Fine for 6–12 leaves, unreadable at 200. If the message is *which parent* is the
  problem, that is a Table.
- ☠️ **No Zebra visual highlights.** Selecting a point in another visual **filters** a Zebra visual
  rather than dimming part of its bars. Plan `visualInteractions` on that basis — there is no
  partial-highlight behaviour to fall back on.

### Ship the visual at the right depth — `expansionStates`

`expansionStates` is a member of **`visual`** (a sibling of `visualType` / `query` / `objects`), and
it is what lets a page open already expanded where the point is, instead of making the reader click
to it.

```jsonc
"expansionStates": [{
  "roles": ["Category"],
  "levels": [                                    // one entry per Category projection, in order
    { "queryRefs": ["Sales.Region"],
      "identityKeys": [ { "Column": { "Expression": { "SourceRef": { "Entity": "Sales" } },
                                      "Property": "Region" } } ],
      "isPinned": true },
    { "queryRefs": ["Sales.Country"], "isPinned": true }
  ],
  "root": { "children": [
    { "identityValues": [ { "Literal": { "Value": "'Europe'" } } ], "isToggled": true }
  ]}
}]
```

☠️ **`isToggled` means "differs from this level's default", NOT "expanded".** Zebra Tables opens a
multi-level `Category` **expanded**, so a member marked `isToggled` comes back **collapsed**. Read it
as *"this member is the odd one out"* and check the render — the property name points the opposite
way to its effect, and both readings produce a plausible-looking page.

**Use `root.children[].isToggled` for this.** `levels[].isCollapsed` also exists and appears in
Desktop-written files, but authoring it by hand did not change which rows rendered here — and that
attempt did not carry `identityKeys` on the collapsed levels, so it is equally possible the block was
rejected as malformed. Treat `levels[].isCollapsed` as **unproven for hand-authoring** and verify by
render if you use it.


### `drillSettings.loadStrategy` — one setting, two questions

**Tables and Tables+ only.** This is the most misread property on the visual, because a single
dropdown answers **two independent questions** and its three values are named after the customer
situations that produced them rather than after either question.

**Question 1 — where do the rows come from?** Level by level as the reader expands, or all of them up
front. **Question 2 — where do the subtotals come from?** The visual recomputes them from the
individual rows, or it trusts what the model returned.

| value | rows | subtotals |
|---|---|---|
| `'drill'` — *Importing, live connections and drill down* (default) | level by level | recomputed from the lowest level |
| `'no_drill'` — *DirectQuery and ragged hierarchies* | **all at once** | recomputed from the lowest level |
| `'shallow_drill'` — *Shallow calculations (trust Power BI subtotals)* | level by level | **taken from the model** |

☠️ **The `'no_drill'` label points the wrong way and the value name points the wrong way too.**
Power BI's DirectQuery means *fetch on demand*; this value means *fetch everything up front*. An
author who matches the label to their storage mode is right by luck, not by understanding. And
`no_drill` does not mean "no drilling": rows still expand and collapse, and every number is
unchanged. What it does is fetch the whole hierarchy at once so that **a repeated-parent branch is
recognised and merged into a single row**, and Power BI's own drill *buttons* give way to right-click
expand and collapse.

**Set `'no_drill'` whenever the category hierarchy is an account or P&L structure** — anywhere a
branch is shallower than its siblings, so a parent repeats itself as its own child. The default
prints that member once per level it repeats at.

```js
objects: { drillSettings: [ { properties: {
  loadStrategy: { expr: { Literal: { Value: "'no_drill'" } } } } } ] }
```

⚠️ **`'shallow_drill'` trades accuracy for speed, and the trade is visible to the reader.** It
calculates only where the mark sits and takes collapsed subtotals from the model, so **numbers can
change as the reader expands a row**. Reach for it when a hierarchical-calculation visual is too
slow, not as a default — and never on a page where someone reconciles a subtotal by eye.

⚠️ **`'shallow_drill'` does not exist on older builds** — it arrived with 8.3.1. Check the enum in
the package you are targeting; a value the installed build does not declare is not a safe default.

`drillSettings` carries one more property worth knowing: **`exploreResultRaggedness`** (bool), the
ragged-level check on result rows whose own children include members with no children. It **defaults off**, and
with `'shallow_drill'` that combination has a known wrong-numbers case on exactly those result rows.
If you author `'shallow_drill'` on a structure that uses result rows, set it.

### Zebra Tables *calculates*, it does not only format

This is what the loading and calculation settings ultimately govern, and it surprises people: the marks an author puts on
rows are **calculation instructions**, not decoration.

| the mark | what it does |
|---|---|
| invert on a row | flips the sign, **and the flip propagates into every parent subtotal** |
| mark as result | the row is **recalculated from its own child rows**, replacing the model's number |
| skip | the row is excluded from its parent total |
| a formula row | computed by the visual |
| a hierarchy subtotal | computed by the visual at every level |

So a report whose model already holds correct subtotals can render *different* numbers once rows are
marked. The grand total is the exception on Tables — it comes from the model — whereas **Charts sums
the grand total on the client**.

The master switch for this behaviour is `previewSettings.calculationCorrectionFeature`
(*Hierarchical calculations*), on by default since 7.6.


## Drillthrough — a hidden page bound to one field

**What actually makes a page a drillthrough target is the `pageBinding`** — a `type: "Drillthrough"`
whose every `parameters[].boundFilter` names a filter in that same page's `filterConfig`. That is the
one part that holds without exception; the rest of what a Desktop-authored target usually contains is
convention, and reading it as a requirement will make you "fix" pages that were already correct.

```jsonc
{
  "visibility": "HiddenInViewMode",                   // conventional, NOT required
  "filterConfig": { "filters": [
    { "name": "fRegion",
      "field": { "Column": { "Expression": { "SourceRef": { "Entity": "Sales" } },
                             "Property": "Region" } },
      "type": "Categorical",
      "howCreated": "Drillthrough" }                  // conventional, NOT required
  ]},
  "pageBinding": {                                    // ← REQUIRED, and the binding is what counts
    "name": "Pod1",
    "type": "Drillthrough",
    "parameters": [
      { "name": "Param_fRegion",
        "boundFilter": "fRegion",                     // MUST match a filter `name` on this page
        "fieldExpr": { "Column": { "Expression": { "SourceRef": { "Entity": "Sales" } },
                                   "Property": "Region" } } }
    ]
  }
}
```

Three things it is easy to over-specify, each contradicted by shipped templates:

- **`visibility` is not required.** Most targets are `HiddenInViewMode`, but a drillthrough target
  can legitimately be a visible page — some shipped templates deliberately leave it in the tab strip.
- **`howCreated: "Drillthrough"` is not what binds the filter.** The `pageBinding` parameter is.
  Targets exist whose bound filters are `howCreated: "User"`, and `"Drillthrough"` also appears on
  filters of *tooltip* pages with no drillthrough binding at all — so it is neither necessary nor
  sufficient, and never use it alone to detect a drillthrough target.
- **A `filter` body is allowed.** Leaving it out means "accept whatever arrives"; including one
  pre-seeds a default selection, which is a legitimate design and common in practice.

`pageBinding.acceptsFilterContext` is a generic binding property — `"Default"` (filter context flows,
and it is the documented default) or `"None"` (additional filter context does not flow). It applies
to `Default`, `Tooltip` and `Drillthrough` bindings alike.

**Give the reader a visible way in.** Right-click is undiscoverable, so put a button on the source
page. ⚠️ `visualLink` goes in **`visualContainerObjects`**, not `objects`:

```jsonc
"visualContainerObjects": { "visualLink": [ { "properties": {
  "show":                { "expr": { "Literal": { "Value": "true" } } },
  "type":                { "expr": { "Literal": { "Value": "'Drillthrough'" } } },
  "drillthroughSection": { "expr": { "Literal": { "Value": "'<target page id>'" } } },
  "disabledTooltip":     { "expr": { "Literal": { "Value": "'Select a region first'" } } }
} } ] }
```

`drillthroughSection` takes the target page's **`name`** (its id), not its `displayName`. The button
is **greyed until a data point is selected** — that is correct behaviour, and `disabledTooltip` is
what stops it reading as broken. Put a back button on the target: the same object with
`"type": "'Back'"` and nothing else. Other `visualLink.type` values: `PageNavigation` (with
`navigationSection`), `Bookmark` (with `bookmark`), `WebUrl` (with `webUrl`).

An `actionButton`'s `text` object is an **array of state-scoped entries**, and the label value must
sit in an entry carrying a `selector` — normally `{"id": "default"}`. A selector-less entry carries
only state-independent properties such as `show`, so a label placed there renders nothing: the button
comes out as a bare coloured rectangle, with no text and no error. The state ids are `default`,
`hover`, `selected` and `disabled`. `validate_report` catches this.


`{"id": "hover"}` is a legitimate second home — a handful of shipped buttons carry their label *only*
under `hover`, so a label absent from `default` is not by itself a fault. What is a fault is a label
in an entry with no `selector` at all.

```jsonc
"text": [
  { "properties": { "show": { "expr": { "Literal": { "Value": "true" } } } } },
  { "properties": { "text": { "expr": { "Literal": { "Value": "'Drill through to detail'" } } },
                    "fontSize": { "expr": { "Literal": { "Value": "11D" } } } },
    "selector": { "id": "default" } }
]
```

**The target page is a page, so it obeys every rule a page obeys** — a comparison, not a bare actual;
a title naming the member; and the scenario checked at the target's grain, because a drillthrough
goes one dimension deeper and a plan that was never allocated to that dimension puts almost all of it
on one member and produces variance percentages in the thousands.

## Tooltips — two different mechanisms

All five visuals (Cards, Charts, Tables, Tables+, Charts+) declare **both** kinds, and they are not
alternatives — a visual can carry one, the other, or both. Every one caps the `Tooltips` data role at
**5** and declares `tooltips.supportedTypes.canvas: true`.

**Zebra already writes a good default tooltip.** Hover any data point and you get the full scenario
block — AC, PY, PL, ΔPY, ΔPY%, ΔPL, ΔPL% — filtered to that point, with no authoring at all. Reach
for a field tooltip or a report-page tooltip only to add what that default cannot show.

### 1. Field tooltips — extra measures in the default bubble

Bind measures to the `Tooltips` role, same projection shape as any other role. They render as extra
rows **appended after** Zebra's scenario block, and are filtered to the hovered data point.

```json
"Tooltips":{"projections":[{"field":{"Measure":{"Expression":{"SourceRef":{"Entity":".Measures"}},
"Property":"Channels"}},"queryRef":".Measures.Channels","nativeQueryRef":"Channels"}]}
```

Use this for context that is a **number per row** — a count, a rate, a data-quality flag. Max 5.

### 2. Report-page tooltips — a whole visual on hover

A hidden 400-ish×300-ish page holding one visual, shown on hover and filtered to the hovered point.
This is the house pattern for *drilling into a second dimension*: hover a segment, see its channels.

**The page needs TWO properties, and missing either leaves it silently inert.**

```json
{ "$schema": "…/definition/page/2.0.0/schema.json",
  "name": "pTip", "displayName": "Segment channels (tooltip)",
  "displayOption": "ActualSize", "height": 320, "width": 420,
  "pageBinding": { "name": "<20-hex or GUID, unique report-wide>", "type": "Tooltip" },
  "visibility": "HiddenInViewMode",
  "type": "Tooltip" }
```

`pageBinding` registers the page as a binding target; the **top-level `type`** is what makes it a
tooltip page. Add the page to `pages.json` `pageOrder` as normal. `visibility` only hides the tab from
a reader — it is **not** required for the tooltip to fire, and was never tested without; set it
because a tooltip page in the tab strip is clutter, not because the mechanism needs it.

A tooltip page needs a top-level `"type": "Tooltip"` in its `page.json`, and that property **does not
exist before page schema `2.0.0`**. Older schemas also declare `additionalProperties: false`, so on
`1.0.0` the property cannot be written at all — and a page carrying only `pageBinding` is accepted
without any error and then never opens on hover. Bump the `$schema` to `2.0.0` or later **and** set
`type`. `validate_report` catches this.


The consuming visual points at it by page **`name`** — not by `pageBinding.name`. Note where this
block lives:

```json
"visual": { "visualType": "…", "query": { … },
  "visualContainerObjects": { "visualTooltip": [ { "properties": {
      "show":    { "expr": { "Literal": { "Value": "true" } } },
      "type":    { "expr": { "Literal": { "Value": "'Canvas'" } } },
      "section": { "expr": { "Literal": { "Value": "'pTip'" } } } } } ] } }
```

⚠️ **`visualContainerObjects` goes INSIDE `visual`**, as a sibling of `visualType` / `query` /
`objects` — never at the `visual.json` root. The root holds only the container's own keys (`$schema`,
`name`, `position`, `filterConfig`, `visual`, …). Put a `visual` member at the root and **Desktop
refuses to open the report at all**, naming the property and the file. The same applies to
`visualType`, `query`, `objects` and `drillFilterOtherVisuals`: at the root each is a will-not-open
fault, and it is worth catching from the text on disk rather than from a 75-second launch. `validate_report` catches this.


Hover context flows on its own. You do **not** need `pageBinding.parameters` or page-level filters
for a plain tooltip — those exist for drillthrough-style explicit field binding.

### The tooltip is a visual, so it obeys every rule a visual obeys

A tooltip page carrying a single actual with no comparison ships a Zebra visual without the thing
Zebra is for. Project a comparison: `Category` + `Values` + `PreviousYear` (or `Plan`), and let Zebra
emit the variance columns.

⚠️ **And check the scenario is attributed at the tooltip's grain.** A tooltip page drills into a
**second dimension**, so a scenario that is valid on the main visual can be meaningless one dimension
down. A plan loaded at company level, or against a dimension it was never allocated to, puts ~all of
it on one member and ~zero on the rest — so the variance percentages come out in the thousands. They
are arithmetically correct and analytically worthless, and **no oracle catches it, because the
arithmetic is right**. Query the scenario grouped by the tooltip's dimension before you project it; if
it concentrates on one member, drop that scenario and say so in the title.

Size the page to the content: 320×240 fits a bare value list, but variance columns need about
420×320. Use `displayOption: "ActualSize"`.


