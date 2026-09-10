<!-- Summary: TMDL as a language — the file set, the grammar, every object and property an author can legally write, what Power BI Desktop itself writes, the exact error text each fault produces, and the constructs proven to load on Desktop 2.157 (hierarchies, calculation groups, field parameters, RLS, translations, KPIs, dynamic format strings, calculated columns, inline Power Query). -->
# TMDL — the language, and what Desktop accepts

`references/model-layer.md` is about **what to model** and how to refresh and verify it. This file is
about **the text itself**: how a TMDL file is put together, which properties exist on which object,
how Desktop's own files look, and — measured on Desktop 2.157.879.0 — which mistakes are rejected,
with the exact message, and which "mistakes" are quietly accepted. Read it when you are about to
write a model from scratch, when you meet a construct you have not written before (a hierarchy, a
calculation group, a field parameter, a role), or when Desktop rejects a model and the message
names a line whose indentation looks fine.

Every claim marked **measured** was run through `file.reload/v1` against a live Desktop on a
hand-written base model that itself opened first time; the constructs in section 6 and the killers
in section 7 were also cold-opened, and the reload verdict matched the cold open in every pair.
Claims marked **docs** come from Microsoft's TMDL specification and Tabular Object Model reference
and were not independently re-tested.

## 1. The file set

A semantic model is a folder named `<Name>.SemanticModel` containing `definition.pbism` and a
`definition/` folder of `.tmdl` files. Everything under `definition/` is TMDL; nothing outside it
is the model (`TMDLScripts/` holds saved TMDL-view script tabs, `.pbi/` holds settings).

```
<Name>.SemanticModel/
├── definition.pbism              # 3 lines, copy it from a working project
└── definition/
    ├── database.tmdl             # REQUIRED: the compatibility level
    ├── model.tmdl                # REQUIRED: culture, options, model annotations, ref lines
    ├── relationships.tmdl        # all relationships, one file
    ├── expressions.tmdl          # shared M expressions and parameters, one file
    ├── functions.tmdl            # DAX user-defined functions, one file (compat 1702+)
    ├── dataSources.tmdl          # legacy structured data sources; Desktop models have none
    ├── tables/<Table>.tmdl       # one file per table: columns, measures, hierarchies, partitions
    ├── roles/<Role>.tmdl         # one file per RLS role
    ├── perspectives/<P>.tmdl     # one file per perspective
    └── cultures/<lang>.tmdl      # one file per culture: translations, linguistic metadata
```

What the layout actually enforces, **measured**:

- **The file name is free.** A table declared as `table Product` loads from `tables/Zzz.tmdl`, and
  from `definition/Product.tmdl` outside `tables/`. The convention is the object name in the
  object's folder, and following it is what keeps a repository readable.
- **One file may declare several tables, and one table may be spread over several files.** A second
  `table Sales` block in another file adds its measures to the same table (partial declaration). The
  only limit is that a property or a child may be declared **once**: the same measure name in two
  files is an error, and so is the same property twice on one object.
- **`ref table` lines in `model.tmdl` are ordering, not registration.** A table file with no `ref`
  line still loads, appended after the referenced ones; a `ref` with no file is ignored; permuting
  them changes nothing. Write them anyway — Desktop does, and a diff of `model.tmdl` is how a
  reviewer sees a table appear.
- **A zero-byte `.tmdl` file and a stray non-`.tmdl` file in `tables/` are both ignored.**
- **`database.tmdl` needs the `database` line**, with or without a name. Desktop writes the keyword
  bare; `database TmdlLab` also loads. A file holding only the property fails — section 7.
- **A missing `database.tmdl` loads**, on reload and on a cold open, and the model then runs at
  Desktop's default level (1700 on this build) — so the next reload of a file that *does* say 1606
  is refused as a downgrade. Always write the file.
- **A missing `model.tmdl`, or one without `defaultPowerBIDataSourceVersion: powerBI_V3`, cold-opens
  but refuses every reload** with *"Power BI Data Source Version is only allowed to change from V1 to
  a higher version"*. Write the model block in section 4 every time.

Root-level objects — `database`, `model`, `table`, `relationship`, `expression`, `function`, `role`,
`perspective`, `cultureInfo`, `queryGroup`, `dataSource`, model-level `annotation` — start at
column 0. Everything they own is indented beneath them.

## 2. The grammar, on one page

There are only three kinds of line: an object declaration, a property, and an expression body.

```tmdl
/// A description: one or more /// lines directly above the object, no blank line between.
table Sales

	measure 'AC PY' =
			CALCULATE(
			    [AC],
			    SAMEPERIODLASTYEAR('Calendar'[Date])
			)
		formatString: #,##0
		displayFolder: Scenarios\Actuals

	column Region
		dataType: string
		isHidden
		summarizeBy: none
		isNameInferred
		sourceColumn: [Region]

		annotation SummarizationSetBy = Automatic

	partition Sales = calculated
		mode: import
		source = DATATABLE("Region", STRING, {{"EMEA"}})
```

**Object declaration** — `<type> <name>` and, for objects with a default property, `= <value>`.
The default property is the expression for `measure`, calculated `column`, `calculationItem`,
`tablePermission`, `function` and `expression`; the source kind for `partition` (`m`, `calculated`,
`entity`, `calculationGroup`); the value for `annotation`, `extendedProperty`, `changedProperty` and
`member`.

**Names.** Quote a name in single quotes when it contains a space, a dot, an equals sign, a colon
or a quote; escape a quote inside by doubling it: `table 'Rock ''n'' Roll'`. Non-ASCII is fine
(`'Umsätze ∑ Kennzahlen'` loads); a tab inside a name is refused (*"InvalidName"*). **Measured:** an
unquoted name with a **space** fails with an *indentation* error pointing at a correctly indented
line, because the parser reads the second word as the start of a body.

An unquoted name containing a dot loads under the **wrong name**: `measure AC.v2 = [AC]` creates a
measure called `v2`, read back from the engine, and every report binding to `AC.v2` then fails to
resolve while the model reports no error. Quote it: `measure 'AC.v2'`. `validate_report` catches this.


**Properties** — `name: value`, one line, value to end of line. Rules that matter:

- Names and enum values are **case-insensitive on read** (`DataType: Int64`, `SummarizeBy: None`
  and `IsHidden` all load — **measured**). Desktop writes camelCase; write camelCase.
- The space after the colon is optional (`dataType:string` loads — **measured**).
- **Booleans**: the bare name means true (`isHidden`); `isHidden: true`, `isHidden: True` and
  `isHidden: false` all load — **measured**.
- **Text values**: leading and trailing double quotes are stripped, so `formatString: "0.0%"`
  stores `0.0%`. Quote a value only when it needs a leading or trailing space
  (`displayFolder: " Leading space"`), and double any quote inside a quoted value. A value with a
  quote at one end only is kept verbatim, which is how `"€"#,##0` and `#,##0 "units"` survive
  (**measured**, read back from the engine; section 8 has the table).
- A property must sit **deeper than its object**. A property at the same indent as the object fails
  with an indentation error — **measured**.

A property name TMDL does not know on that object stops the model loading: *"The keyword 'isHiden'
is neither a property nor an object in the current context!"* A typo and an invented property look
the same to the parser. `discourageReportMeasures` is a real Tabular Object Model property that
Desktop's TMDL reader still refuses; the other model flags load. `validate_report` catches this.


An enum property must use a legal member: `summarizeBy: total` and `dataType: integer` fail with
*"Failed to convert the value 'total' to the expected type AggregateFunction!"*. Write `sum`,
`int64`, `dateTime`, `double`, `decimal`, `boolean`, `string`. Casing is free; spelling is not. `validate_report` catches this.


A property may appear once per object. A second `dataType:` on the same column fails with
*"Duplicated property - dataType appears more then once in the current context!"*. Only
`associatedColumn`, `column` (in a calendar group) and `groupByColumn` repeat. `validate_report` catches this.


**Expressions** — assigned with `=`, never `:`. Two forms, both **measured**:

1. Inline: `measure AC = SUM(Sales[Amount])`. The whole expression must fit on the line.
2. Multi-line: nothing after the `=`, then the body on the following lines, indented **one level
   deeper than the object's properties** (object at one tab, properties at two, body at three).
   Blank lines inside the body are part of it. The body runs while lines stay at or deeper than
   its first line and ends at the first line shallower than that.

Starting DAX on the `=` line and continuing on the next lines is the most common way to lose a
cold open: the parser takes the fragment on the `=` line as the complete expression and reads the
next line as an unexpected line type. `measure X = CALCULATE(` … and `measure X = VAR a = 1` … both fail this
way — **measured**, and both are caught by the pre-flight.

A multi-line body written at **property depth** swallows the property after it: `[AC] * 2` on one
line and `formatString: #,##0` on the next, both two tabs in, load as one expression and the engine
holds the measure in error state 5, *"The syntax for 'formatString' is incorrect"*. `measure X =`
with nothing under it does the same to whatever line follows. Indent the body one level deeper than
the properties. Every visual bound to such a measure renders an error. `validate_report` catches this.


The **fenced** form keeps the body verbatim, comments and odd indentation included:

```tmdl
	measure Fenced = ```
			VAR x = [AC]   -- a trailing comment is fine here
			RETURN x * 2
			```
		formatString: #,##0
```

The opening fence sits at the end of the `=` line; the closing fence is a line holding only the
three backticks. **Measured:** the closing fence loads whether it is indented with the body or sits
at column 0. `//` and `--` comments inside any expression body, fenced or not, are ordinary DAX and
load.

**Indentation.** Desktop writes one **tab** per level, and the specification calls the tab the
default. **Measured on reload and on a cold open:** four spaces, two spaces, and one object indented
with spaces among tab-indented siblings all load on Desktop 2.157. Write tabs anyway — every file
Desktop hands back uses them, and a mixed file diffs badly — but do not spend a cold open
re-indenting a file that loaded.

**Line endings and trailing whitespace** — CRLF and trailing spaces on every line load
(**measured**). **Encoding** — UTF-8 with **no BOM**, on every file. A BOM on a table file or on
`database.tmdl` fails with *"Only text with UTF8 encoding without BOM (byte order marks) is
supported"* — **measured** on both, reload and cold. PowerShell 5.1's `-Encoding utf8` writes a BOM;
use `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`.

**Comments.** There are none. `//` outside an expression body fails with *"Unexpected line type:
Other!"* — **measured**, reload and cold. A `///` line is a **description** bound to the object on
the very next line: it loads on a table, column, measure or partition (**measured**) and fails on a
relationship (*"Property 'description' is unknown"*).

A `///` description must sit directly above its object. A blank line between them fails the model
with *"Unexpected line type: Empty!"* at the blank line; a description with nothing after it fails
too. The same reader refuses a ``` fence that is never closed — it swallows the rest of the file. `validate_report` catches this.


**Ordering.** Children may appear in any order and may be interleaved (measures before columns,
partition first, a measure between two columns) — **docs**, and Desktop's own files put measures
first, then columns, then the partition. Follow that.

**`ref`.** `ref <type> <name>` declares collection order in `model.tmdl` and names a parent in a
TMDL *script* (`createOrReplace` / `ref table Sales` / new measures beneath). In a project folder
you only ever write the `model.tmdl` form.

## 3. Objects and their properties

Every TMDL object mirrors a Tabular Object Model class; the property name is the TOM property in
camelCase. Each table in this section lists what an author writes by hand. Properties Desktop
manages (`lineageTag`, `sourceLineageTag`, `modifiedTime`, `state`, `errorMessage`) are omitted:
never author `state` or `errorMessage`, and `lineageTag` is optional everywhere — Desktop mints one
on the next save.

### `database`

| property | values | note |
|---|---|---|
| `compatibilityLevel` | `1606` | **Measured on 2.157:** a running instance accepts `1606`, `1607`, `1608`, `1700`, `1701`, `1702` and refuses `1601`, `1605` (*"downgrade"*) and `1650` (*"Unsupported db compat level"*); a cold open accepts `1600` and raises it in memory, so a `1600` file refuses `file.reload/v1` afterwards. Raise it only if you will reload; a higher level refuses to open on an older Desktop. Feature minimums: calculation groups 1470, query groups 1480, dynamic format strings 1601, calendar objects 1701, DAX functions 1702. |
| `compatibilityMode` | `powerBI` | optional; Desktop omits it |

`database.tmdl` must start with the `database` line, with or without a name. A file holding only
`compatibilityLevel: 1606` fails with *"Unexpected line type: Property!"*. `validate_report` catches this.


An object above the model's compatibility level fails the load: a `function` on a 1606 model gives
*"The database compatibility level of 1606 is below the minimal compatability level of 1702 needed
for [model Model].[function AddTax]"*. A `calendar` object additionally needs the *Enhanced DAX Time
Intelligence* preview switched on in Desktop; without it the model is refused outright: *"The model
contains a custom calendar. This feature is not supported."* `validate_report` catches this.


### `model`

| property | values / form | note |
|---|---|---|
| `culture` | `en-US` | formatting culture |
| `sourceQueryCulture` | `en-US` | culture used during Power Query refresh |
| `defaultPowerBIDataSourceVersion` | `powerBI_V3` | Desktop writes it on every model; without it a cold open works and every reload is refused — **measured** |
| `dataAccessOptions` | child block with bare booleans `legacyRedirects`, `returnErrorValuesAsNull`, `fastCombine` | Desktop writes the first two |
| `discourageImplicitMeasures` | bare boolean | recommended, and **required for any calculation group** — **measured** |
| `discourageCompositeModels`, `forceUniqueNames` | bare booleans | both load — **measured** |
| `discourageReportMeasures` | | a TOM property this Desktop **refuses** as an unknown keyword — **measured**; leave it out |
| `defaultMode` | `import`, `directQuery` | loads — **measured**; partitions carry their own `mode` |
| `collation`, `description` (as `///`) | | |
| `annotation <Name> = <value>` | root level, after the model block | section 4 |
| `ref table`, `ref cultureInfo`, `ref role`, `ref perspective` | root level | ordering |

### `table`

| property | values | note |
|---|---|---|
| `dataCategory` | `Time` | with an `isKey` date column this **is** "Mark as date table" |
| `isHidden`, `isPrivate`, `showAsVariationsOnly`, `excludeFromModelRefresh`, `systemManaged` | bare booleans | `showAsVariationsOnly` + `isPrivate` mark Desktop's auto date tables; never author them |
| `description` | `///` above | |
| `calculationGroup` | child block, below | turns the table into a calculation group |
| `refreshPolicy` | child block (incremental refresh) | `policyType: basic`, `rollingWindowGranularity`, `rollingWindowPeriods`, `incrementalGranularity`, `incrementalPeriods`, `sourceExpression =` M — **docs** |
| children | `column`, `measure`, `hierarchy`, `partition`, `calendar`, `annotation`, `extendedProperty` | |

A measure, column, hierarchy or partition may be declared once per table, whether in one file or
across files: a second `measure AC` fails with *"TMDL objects cannot be merged because both declare
the same property: expression"*, and the message names both files. Splitting a table over files is
legal; repeating a child is not. `validate_report` catches this.


### `column`

Three kinds share one keyword. A **data** column has `sourceColumn: <query column>`. A
**calculated-table** column, on a table whose partition is `= calculated`, binds by
`isNameInferred` plus `sourceColumn: [<DAX column>]`. A **calculated** column carries an
expression: `column Doubled = [Amount] * 2` — **measured** on a calculated table.

| property | values | note |
|---|---|---|
| `dataType` | `string`, `int64`, `double`, `decimal`, `dateTime`, `boolean`, `binary`, `variant` | `decimal` is the fixed-decimal currency type. **Measured:** all of `string int64 double decimal boolean dateTime` load against `DATATABLE` types `STRING INTEGER DOUBLE CURRENCY BOOLEAN DATETIME`. A calculated column loads without `dataType` (**measured**, the engine infers); write it anyway |
| `sourceColumn` | query column name, or `[Name]` on a calculated table | quote it only for leading or trailing spaces |
| `isNameInferred`, `isDataTypeInferred` | bare booleans | calculated-table columns; `isDataTypeInferred: false` is what Desktop writes when the type was set by hand |
| `summarizeBy` | `none`, `sum`, `count`, `min`, `max`, `average`, `distinctCount`, `default` | `none` on every key, text, date and ID column |
| `formatString` | section 8 | |
| `isHidden`, `isKey`, `isUnique`, `isNullable`, `isDefaultLabel`, `isDefaultImage`, `isAvailableInMdx`, `keepUniqueRows` | booleans | `isKey` exactly one per table, on a column with unique values; `isAvailableInMdx: false` trims Excel exposure; each **measured** alone |
| `sortByColumn` | another column of the same table | `Month` by `MonthNo` |
| `dataCategory` | `Country`, `StateOrProvince`, `City`, `PostalCode`, `Continent`, `Latitude`, `Longitude`, `WebUrl`, `ImageUrl`, `Barcode`, `Address`, `Place`, `County` | plus the auto-date values Desktop writes (`Years`, `Months`, …) which you never author |
| `displayFolder` | `Folder\Sub` | backslash nests |
| `displayOrdinal`, `alignment`, `encodingHint`, `sourceProviderType` | | rare |
| `relatedColumnDetails` → `groupByColumn: <column>` | child block | field parameters, section 6 |
| `extendedProperty ParameterMetadata = { json }` | child | field / what-if parameters |
| `variation` | child block | auto date/time; never author |
| `changedProperty = <PropertyName>` | child | Desktop bookkeeping ("the user set this by hand"); harmless to omit |
| `annotation <Name> = <value>` | child | |

### `measure`

| property | values | note |
|---|---|---|
| `= <DAX>` | default property | inline or multi-line, section 2 |
| `formatString` | section 8 | Charts and Tables read axis and label formats from the model, so set it on every measure |
| `displayFolder` | `Folder\Sub` | |
| `isHidden` | boolean | |
| `dataCategory` | e.g. `WebUrl`, `ImageUrl` | for measures returning URLs — **measured** |
| `dataType` | `variant` and the column types | rarely needed; the engine infers |
| `formatStringDefinition = <DAX>` | child | **dynamic format string**; returns a format string per cell — **measured** |
| `detailRowsDefinition = <DAX>` | child | table expression for drill-through — **measured** |
| `kpi` | child block: `targetExpression =`, `statusExpression =`, `trendExpression =` (DAX), `statusGraphic:`, `trendGraphic:` (text), `targetFormatString:`, `*Description:` | **measured**; graphic names include `Traffic Light`, `Traffic Light - Single`, `Three Symbols Uncircled Colored`, `Five Bars Colored`, `Five Boxes Colored`, `Gauge`, `Gauge - Ascending`, `Gauge - Descending`, `Status Arrow - Ascending`, `Status Arrow - Descending`, `Variance Arrow`, `Standard Arrow`, `Cylinder`, `Faces` |
| `description` | `///` above | |

A measure takes `formatString` **or** `formatStringDefinition`, never both: *"The Measure
'Sales'['AC auto'] has both FormatString property and FormatStringDefinition property defined which
is not supported scenario."* `validate_report` catches this.


A measure declared with no `=` at all (`measure Measure` on its own) loads in a ready state and
returns blank; Desktop itself writes exactly that for a measure created and left empty, and one lives
in a shipped template. Harmless, and not a fault the validator raises.

### `partition`

`partition <Name> = <kind>` where the kind is the source type:

| kind | `mode` | body | note |
|---|---|---|---|
| `m` | `import` or `directQuery` | `source =` an M `let … in …` block | Power Query. **Measured:** an inline `#table(...)` source with no external connection loads, and stays in state 3 (no data) until a refresh |
| `calculated` | `import` | `source =` a DAX table expression | `DATATABLE`, `CALENDAR`, `GENERATESERIES`, `{ (…), (…) }` row constructors |
| `calculationGroup` | (none) | no body | the partition a calculation-group table carries; **measured:** the table also loads without it |
| `entity` | `directLake` | `source` block with `entityName`, `schemaName`, `expressionSource` | Direct Lake, Fabric only — **docs** |
| `query` | | `source =` a native query against a `dataSource` | legacy — **docs** |

Also on a partition: `queryGroup: <group>` (folder in the Power Query editor — **measured**),
`dataView`, `description`, `annotation`.

### `relationship`

```tmdl
relationship SalesToProductByRegion
	isActive: false
	crossFilteringBehavior: bothDirections
	fromCardinality: many
	toCardinality: many
	fromColumn: Sales.Region
	toColumn: Product.Category
```

| property | values | note |
|---|---|---|
| name | any identifier, quoted if it has spaces | Desktop writes a GUID; `SalesToCalendar` and `'Sales To Calendar'` both load — **measured**. Unquoted with spaces fails |
| `fromColumn`, `toColumn` | `Table.Column`, quoting each part that needs it: `'Sales Data'.'Order Date'` | **Measured:** `'Sales'.'Date'` loads. `fromColumn` is the **many** side |
| `isActive` | `false` to make it inactive | default true; activate per measure with `USERELATIONSHIP` — **measured** |
| `crossFilteringBehavior` | `oneDirection` (default), `bothDirections`, `automatic` | |
| `fromCardinality`, `toCardinality` | `one`, `many` | default many-to-one; both `many` is a many-to-many relationship — **measured** |
| `securityFilteringBehavior` | `oneDirection`, `bothDirections` | RLS propagation; `bothDirections` needs `crossFilteringBehavior: bothDirections` too — **measured** |
| `joinOnDateBehavior` | `datePartOnly`, `dateAndTime` | Desktop writes `datePartOnly` on auto-date relationships |
| `relyOnReferentialIntegrity` | boolean | DirectQuery inner joins |

No `///` description on a relationship, ever.

Both ends of a relationship must name a table and a column the model declares, as `Table.Column`.
A stale name fails the whole project: *"Cannot resolve all the paths while de-serializing Database.
Property ToColumn of object "relationship X" refers to an object which cannot be found"*. The DAX
bracket form `Calendar[Date]` fails the same way. Renaming a table or column and forgetting the
relationship is the single most common way to hit this. `validate_report` catches this.


`securityFilteringBehavior: bothDirections` is only legal on a relationship whose
`crossFilteringBehavior` is also `bothDirections`: *"cannot have SecurityFilterBehavior set to
BothDirections when the CrossFilterBehavior is set to OneDirection."* `validate_report` catches this.


Two relationship faults load and break later, **measured**: a relationship whose one side holds
duplicate values loads and then fails at the calculated table's evaluation — the partition drops to
state 6, *"contains a duplicate value 'EMEA' and this is not allowed for columns on the one side of
a many-to-one relationship"* — and a relationship between a `double` and a `string` column loads in a
ready state and only misbehaves at refresh. Check the engine state after a reload, section 9.

### `hierarchy` and `level`

```tmdl
	hierarchy 'Product Hierarchy'
		isHidden
		displayFolder: Drill

		level Category
			column: Category

		level Product
			column: Product
```

Levels are ordered by position in the file; `ordinal:` is optional (**measured** with and
without). Each level names a column of the **same table**. `hideMembers: hideBlankMembers` makes a
ragged hierarchy (**measured** to load). Desktop writes a `lineageTag` on the hierarchy and each
level; omit them.

### `calculationGroup` and `calculationItem`

```tmdl
table 'Time Intelligence'

	calculationGroup
		precedence: 10

		calculationItem Current = SELECTEDMEASURE()

		calculationItem PY =
				CALCULATE(
				    SELECTEDMEASURE(),
				    SAMEPERIODLASTYEAR('Calendar'[Date])
				)

		calculationItem YTD = CALCULATE(SELECTEDMEASURE(), DATESYTD('Calendar'[Date]))
			formatStringDefinition = SELECTEDMEASUREFORMATSTRING()

	column Period
		dataType: string
		summarizeBy: none
		sourceColumn: Name
		sortByColumn: Ordinal

	column Ordinal
		dataType: int64
		isHidden
		summarizeBy: none
		sourceColumn: Ordinal

	partition 'Time Intelligence' = calculationGroup
```

The two columns bind to the engine-provided `Name` and `Ordinal` source columns and are **required**:
with none, Desktop says *"The total number of data columns inside the calculation group table 'Time
Intelligence' is 0, while calculation group table only supports 1 or 2 data columns."* `precedence`
orders several groups; `calculationItem` takes `ordinal:`, `formatStringDefinition =`, a `///`
description. **Measured** to load, with the base `AC` measure resolving through `SELECTEDMEASURE()`,
once `model.tmdl` carries `discourageImplicitMeasures`.

A calculation group needs `discourageImplicitMeasures` on the model, as a bare line in
`model.tmdl`: *"The Model 'Model' property DiscourageImplicitMeasures must be set to true in order
to create any calculation groups."* Desktop sets it for you in the UI; a hand-written model must. `validate_report` catches this.


### `role`, `tablePermission`, `member`

```tmdl
role EMEA
	modelPermission: read

	tablePermission Sales = 'Sales'[Region] = "EMEA"

	member 'someone@example.com'
```

`modelPermission`: `none`, `read`, `readRefresh`, `refresh`, `administrator`. A `tablePermission`
carries a DAX filter as its default property, or `metadataPermission: none` to hide a table
entirely. `member <name>` defaults to an Entra user; `= group`, `= auto`, `= activeDirectory` set
the other member types. Add `ref role EMEA` to `model.tmdl`. **Measured** with and without members,
reload and cold.

### `perspective`

```tmdl
perspective Exec

	perspectiveTable Sales

		perspectiveMeasure AC

		perspectiveColumn Region
```

Children: `perspectiveTable`, then `perspectiveColumn`, `perspectiveMeasure`,
`perspectiveHierarchy`. Add `ref perspective Exec` to `model.tmdl`. Desktop has no UI for
perspectives; they drive *personalize visuals*. **Measured** to load.

### `cultureInfo` — translations and linguistic metadata

```tmdl
cultureInfo de-DE
	translations
		model Model
			table Sales
				caption: Verkäufe
				measure AC
					caption: Ist
					displayFolder: Szenarien
				column Region
					caption: Region (DE)
```

Translatable properties: `caption`, `description`, `displayFolder`. The tree under `translations`
mirrors the model. Add `ref cultureInfo de-DE` to `model.tmdl`. Desktop writes the object type as
**`cultureInfo`**; Microsoft's specification page shows `culture`, and **both load** on 2.157
(**measured**) — write `cultureInfo`, which is what Desktop emits. Desktop's own `en-US.tmdl` carries
a `linguisticMetadata = { json }` block with `contentType: json`; it loads, but when you copy a
model between projects delete `cultures/` and the `ref cultureInfo` line rather than carry it — a
stale one fails reload with *"The LinguisticMetadata object with ID … does not exist"*.

### `expression` — shared M and parameters

```tmdl
expression Threshold = 100 meta [IsParameterQuery=true, Type="Number", IsParameterQueryRequired=true]
	lineageTag: 6e1a2b3c-0000-4000-8000-000000000001
	queryGroup: Parameters
```

The default property is M. A parameter is an M value with the `meta [IsParameterQuery=true, …]`
record; a shared query is a `let … in` block. Partitions refer to one as `#"Threshold"`. Desktop
adds `annotation PBI_ResultType` and `annotation PBI_NavigationStepName` beneath; omit them.
**Measured** to load.

### `function` — DAX user-defined functions (compat 1702)

```tmdl
/// Adds tax
function AddTax = (amount : NUMERIC) => amount * 1.1
```

One `functions.tmdl` holds all of them. Names allow letters, digits, underscores and dots for
namespacing, no spaces. **Measured:** loads on a `1702` model and a measure calling it resolves;
refused on `1606` with the message quoted under `database`.

### `queryGroup`

```tmdl
queryGroup Facts

	annotation PBI_QueryGroupOrder = 0
```

Root level in `model.tmdl`; partitions and expressions point at it with `queryGroup: Facts`. It is
a Power Query editor folder and nothing more — **measured** to load.

### `calendar` (compat 1701, preview feature)

```tmdl
	calendar Gregorian

		calendarColumnGroup = year
			primaryColumn: Year

		calendarColumnGroup = month
			primaryColumn: MonthNo
			associatedColumn: Month

		calendarColumnGroup = date
			primaryColumn: Date
```

Inside a table, after its hierarchies. Categories: `year`, `quarter`, `quarterOfYear`, `month`,
`monthOfYear`, `monthOfQuarter`, `week`, `weekOfYear`, `weekOfQuarter`, `weekOfMonth`, `date`,
`dayOfYear`, `dayOfQuarter`, `dayOfMonth`, `dayOfWeek`; a group with no category tags time-related
columns. Time-intelligence functions then take the calendar name in place of the date column:
`TOTALYTD([AC], Gregorian)`. **Measured:** on this Desktop, with the preview off, a model carrying
one is refused outright, so this is not yet a construct to ship.

### `annotation`, `extendedProperty`, `changedProperty`

- `annotation <Name> = <text>` — any object; free text, JSON included. Desktop's own are listed in
  section 4. Custom names are yours to invent and are safe — **measured**.
- `extendedProperty <Name> = <json>` — typed JSON (multi-line, indented) or a string. Field and
  what-if parameters live here as `ParameterMetadata`.
- `changedProperty = <Property>` — Desktop's record that a user set the property by hand
  (`IsHidden`, `FormatString`, `SortByColumn`). Omit it when authoring.

Two objects in one collection may not share a `lineageTag`: *"An object with lineage-tag
'11111111-…' already exists in the collection."* Tags are optional — leave them out rather than copy
one — and a tag that is not a GUID loads. `validate_report` catches this.


## 4. What Desktop writes — read it as a style guide

From a census of 860 real `.tmdl` files (the 20 shipped Zebra BI templates plus every model built
in this project). Numbers are how often each form appears, so you know what "normal" looks like.

- **`database`** is written **bare**, followed by `compatibilityLevel` (every Desktop file).
- **`model.tmdl`** carries `culture`, `defaultPowerBIDataSourceVersion: powerBI_V3`,
  `sourceQueryCulture`, a `dataAccessOptions` block with `legacyRedirects` and
  `returnErrorValuesAsNull`, then root annotations: `__PBI_TimeIntelligenceEnabled = 0` when auto
  date/time is off, `PBI_QueryOrder = [ … ]` (Power Query editor order), `PBI_ProTooling =
  ["DevMode"]`. Then `ref` lines.
- **Set `annotation __PBI_TimeIntelligenceEnabled = 0` on every model you author.** With it on,
  Desktop generates a hidden `LocalDateTable_<guid>` per date column, a `DateTableTemplate_<guid>`,
  a `variation` block under each date column and a `joinOnDateBehavior: datePartOnly` relationship
  — 39 such tables in the corpus, none of them hand-written. Microsoft's guidance is that a date
  column added outside Desktop does **not** get its local date table generated, so a model authored
  with the feature on is inconsistent from the start. Your own `Calendar` replaces all of it.
- **Columns** carry `dataType`, `summarizeBy` (always), `sourceColumn`, `formatString` on numbers
  and dates, `isHidden` on keys and on any column exposed only through a measure, `sortByColumn`
  on month and weekday names, and an `annotation SummarizationSetBy = Automatic` (or `User`) which
  you may omit. `annotation PBI_FormatHint = {"isGeneralNumber":true}` and
  `annotation UnderlyingDateTimeDataType = Date` are Desktop's, omit them.
- **`summarizeBy: none`** is written on 2,477 of 3,046 columns. Sum only on genuine additive
  measures-in-waiting, and hide those.
- **Calculated tables** (`= calculated`, 199 partitions) carry `isNameInferred` and
  `sourceColumn: [Name]` on every column, and `isDataTypeInferred: false` when the type was
  overridden. `references/model-layer.md` explains why the bracket form is required on any column a
  relationship touches.
- **Measures** carry `formatString` (654 of 1,189), `displayFolder` (151), `lineageTag` (863) and
  occasionally `isHidden`. Multi-line DAX is written indented, not fenced; Desktop reaches for the
  fence only when the body has trailing whitespace or blank lines with spaces that indentation would
  lose.
- **`lineageTag`** is on almost everything Desktop writes and on nothing that needs it: measures,
  tables, columns, relationships and hierarchies all load without one — **measured**.
- **Templates use `cultureInfo en-US`** with a `linguisticMetadata` JSON block (Q&A). Agent-built
  models omit `cultures/` entirely.
- **Format strings Desktop writes**: `0` on integers, `#,0` on amounts, `Short Date` / `General
  Date` / `Long Date` on dates, `0.0%` on ratios, `\$#,0;(\$#,0);\$#,0` for currency (the backslash
  escapes the `$`), `"€"#,##0` when the user typed a euro prefix.

## 5. Writing a model from nothing — the order that avoids the traps

1. `database.tmdl`: `database` + `compatibilityLevel: 1606`.
2. `model.tmdl`: the block from section 4 with `__PBI_TimeIntelligenceEnabled = 0` and
   `discourageImplicitMeasures`, and a `ref table` per table.
3. One `tables/<Name>.tmdl` per table: measures, then columns, then the partition. Every column has
   `dataType` and `summarizeBy`; every measure has `formatString`; every multi-line body is one
   level deeper than the properties.
4. `relationships.tmdl`: `fromColumn` is the fact (many) side; both columns must be declared in
   their tables with the same data type, and the one side must hold unique values.
5. Run the pre-flight (`references/preflight.md`) or `validate_report` — the grammar faults in this
   file are all caught there, in about a second.
6. Reload or cold-open, then **TMSL refresh** (`references/model-layer.md`) and read the numbers
   through the engine.

Nothing about a PBIR report changes when you add a hierarchy, a calculation group, a role or a
translation: the report binds to measure and column names, and those objects are model-side only.

## 6. Constructs proven on Desktop 2.157 — copy these

Each block loaded through `file.reload/v1` on the base model, the engine's DMVs showed the new
objects in a ready state, and the calculation group, field parameter and role also cold-opened.
Section 3 has the loading form of the hierarchy, calculation group, role, perspective,
translations, expression, query group, KPI, detail rows, dynamic format string and inactive
many-to-many relationship.

**A field parameter — exactly as Desktop writes it, no `dataType`, no `isNameInferred`:**

```tmdl
table Dimension

	column Dimension
		summarizeBy: none
		sourceColumn: [Value1]
		sortByColumn: 'Dimension Order'

		relatedColumnDetails
			groupByColumn: 'Dimension Fields'

	column 'Dimension Fields'
		isHidden
		summarizeBy: none
		sourceColumn: [Value2]
		sortByColumn: 'Dimension Order'

		extendedProperty ParameterMetadata =
				{
				  "version": 3,
				  "kind": 2
				}

	column 'Dimension Order'
		isHidden
		formatString: 0
		summarizeBy: sum
		sourceColumn: [Value3]

	partition Dimension = calculated
		mode: import
		source =
				{
				    ("Region", NAMEOF('Sales'[Region]), 0),
				    ("Product", NAMEOF('Product'[Product]), 1),
				    ("Category", NAMEOF('Product'[Category]), 2)
				}
```

Zebra Tables and Charts accept a field parameter in a role, which is how one visual offers the
reader a choice of dimension or of measure; `references/visuals.md` covers the report side. The
three columns bind to the row constructor's positional `[Value1]`…`[Value3]`; `kind: 2` is a
column parameter, and a measure parameter uses `NAMEOF([AC])` rows with the same metadata. Adding
`dataType` and `isNameInferred` to the three columns also loads — **measured**.

**A what-if parameter.** `GENERATESERIES` names its one column **`Value`**, so the column binds
with `sourceColumn: [Value]` and takes its display name from the `column` line. Bound to `[Growth]`
instead, the column comes back nameless and the measure reading it fails with *"Column 'Growth' in
table 'Growth' cannot be found"* — read back from the engine.

```tmdl
table Growth

	measure 'Growth Value' = SELECTEDVALUE('Growth'[Growth], 0)
		formatString: 0%

	column Growth
		dataType: double
		formatString: 0%
		summarizeBy: none
		isNameInferred
		sourceColumn: [Value]

		extendedProperty ParameterMetadata =
				{
				  "version": 0
				}

	partition Growth = calculated
		mode: import
		source = GENERATESERIES(0, 0.2, 0.01)
```

**A calculated column on a calculated table**, **an inline Power Query table** and **an inactive
many-to-many relationship used through `USERELATIONSHIP`** are in section 3 in their loading form.
The inline Power Query partition matters for one reason: it proves the `m` partition grammar
without any external source, so a Power Query fault can be separated from a connection fault.

## 7. The error catalogue — what Desktop says, what it means, what to change

Every row was produced on purpose on Desktop 2.157.879.0 through `file.reload/v1`, which runs the
same deserializer a cold open does and returns the text in about half a second instead of a modal
after a fifteen-second restart; the rows marked † were also cold-opened and produced the *"Issues
were found"* modal. The message always names the **file and line**; the *line* is where the parser
gave up, which for two of these faults is one line **after** the real one.

| You wrote | Desktop says | Fix |
|---|---|---|
| any `.tmdl` with a UTF-8 BOM † | *Only text with UTF8 encoding without BOM (byte order marks) is supported. Detected BOM: 'UTF-8'* | write UTF-8 without BOM |
| `// note` at property level † | *Parsing error type - InvalidLineType — Unexpected line type: Other!* | delete it, or make it a `///` description on the next object |
| `column Sales Region` (space, unquoted) | *Parsing error type - Indentation — Invalid indentation was detected!* | `column 'Sales Region'` |
| `relationship Sales To Calendar` (space, unquoted) | *InvalidLineType — Unexpected line type: Other!* | quote the name |
| a property at the same indent as its object | *Indentation — Invalid indentation was detected!* | indent it one level |
| `description: text` under an object | *UnknownKeyword — Unsupported property - description is not a supported property in the current context!* | a `///` line above the object |
| `isHiden` (typo), `discourageReportMeasures` | *UnknownKeyword — The keyword 'isHiden' is neither a property nor an object in the current context!* | fix the name; the tables in section 3 list the legal ones |
| `summarizeBy: total`, `dataType: integer` | *InvalidValueFormat — Failed to convert the value 'total' to the expected type AggregateFunction!* | a legal enum member: `sum`, `int64` |
| the same property twice on one object | *DuplicatedProperty — Duplicated property - dataType appears more then once in the current context!* | declare it once |
| DAX on the `=` line, continued on the next lines | *InvalidLineType — Unexpected line type* on the **next** line | start the expression on the line after the `=`, one level deeper than the properties |
| `/// text`, blank line, then the object † | *InvalidLineType — Unexpected line type: Empty!* | remove the blank line |
| `/// text` above a `relationship` | *Property 'description' is unknown and is not expected in the situation it appears* | relationships take no description |
| a tab character inside a quoted name | *Parsing error type - InvalidName* | remove it |
| a fence opened and never closed | *Cannot resolve all the paths while de-serializing Database* (the fence ate the rest of the file) | close the fence |
| the same measure in two files, or twice in one | *TMDL objects cannot be merged because both declare the same property: expression — 1st object: type=Measure, name='AC', path='./tables/Sales measures' — 2nd object: … path='./tables/Sales'* | one declaration per name per table |
| a measure named like a column of its table | *The 'Region' measure cannot be created because a column with the same name already exists* | rename the column, hide it, keep the clean name for the measure |
| `table Measures` | *The name of the object 'Table' cannot be the reserved string 'Measures'* | `.Measures` |
| two columns with one `lineageTag` | *Failed to add a deserialized Column object into the model - name: 'Region', detailed error: An object with lineage-tag '…' already exists in the collection* | drop or change one tag |
| `database.tmdl` with only the property line | *InvalidLineType — Unexpected line type: Property!* | add the `database` line |
| `compatibilityLevel` below the running instance | *Tabular databases do not support CompatibilityLevel downgrade. Current CompatibilityLevel: '1606'. Requested CompatibilityLevel: '1601'* (reload only; a cold open upgrades silently) | match or exceed the instance |
| `compatibilityLevel: 1650` | *Unsupported db compat level detected* | a real level: 1606, 1607, 1608, 1700, 1701, 1702 |
| `model.tmdl` without `defaultPowerBIDataSourceVersion` | *Power BI Data Source Version is only allowed to change from V1 to a higher version, Current version is '2'* (reload only; cold-opens) | write `defaultPowerBIDataSourceVersion: powerBI_V3` |
| `toColumn: Calendar[Date]` | *The expected target-type Column of property 'toColumn' does not match the actual path 'Calendar[Date]'!* | `Calendar.Date` |
| a relationship endpoint that does not exist | *Cannot resolve all the paths while de-serializing Database. Property ToColumn of object "relationship SalesToCalendar" refers to an object which cannot be found* | fix the name; run the pre-flight after every rename |
| a related calculated-table column written `sourceColumn: K` | *Relationship 'SalesToProduct' uses an invalid column ID 1230* | `isNameInferred` + `sourceColumn: [K]` |
| a calculation group on a model without the flag | *The Model 'Model' property DiscourageImplicitMeasures must be set to true in order to create any calculation groups* | add `discourageImplicitMeasures` to `model.tmdl` |
| a calculation group with no `Name`/`Ordinal` columns | *The total number of data columns inside the calculation group table 'X' is 0, while calculation group table only supports 1 or 2 data columns* | add the two columns from section 3 |
| `formatString` and `formatStringDefinition` on one measure | *has both FormatString property and FormatStringDefinition property defined which is not supported scenario* | keep one |
| `securityFilteringBehavior: bothDirections` on a one-way relationship | *cannot have SecurityFilterBehavior set to BothDirections when the CrossFilterBehavior is set to OneDirection* | set `crossFilteringBehavior: bothDirections` too |
| `function` on a 1606 model † | *The database compatibility level of 1606 is below the minimal compatability level of 1702 needed for [model Model].[function AddTax]* | `compatibilityLevel: 1702` |
| a `calendar` object | *The model contains a custom calendar. This feature is not supported* | remove it until the preview is on |

**Faults that load, and are therefore worse.** A reload that returns success means the grammar
parsed and the objects were created. It does **not** mean they work, **measured** through the
engine's DMVs (section 9):

- A measure whose body sits at property depth, or `measure X =` with nothing under it, loads with
  the next property line inside its DAX — state 5, *"The syntax for 'formatString' is incorrect"*.
- A measure whose DAX **does not resolve** (`SUM(Sales[NoSuchColumn])`, state 5, *"Column
  'NoSuchColumn' in table 'Sales' cannot be found"*) or has a **syntax error** (state 5, *"The end
  of the input was reached"*) loads; the visual bound to it shows an error.
- An unquoted name with a dot loads under its last segment (`AC.v2` → `v2`).
- A relationship onto a one-side column with **duplicate values** loads and the calculated table
  drops to state 6 at evaluation; a relationship between **mismatched types** loads clean and fails
  at refresh.
- A **calculated calendar that reads a Power Query fact** loads and then kills the cold open when
  the fact is empty — `references/model-layer.md` has the guard.
- `table Goal` loads and blanks every visual bound to it — the pre-flight's rule 8.

**A refused reload is not always a no-op.** After a refused `compatibilityLevel` change or a refused
`calendar`, the instance kept the new level or the calendar in memory, and the next reload of a
correct file was refused *because of them* (**measured**, three times). If a reload of a file you
know to be good fails with a message about something that is no longer on disk, restart Desktop.

## 8. Format strings — quoting rules, read back from the engine

After each reload the measure's `FormatString` was read from `$SYSTEM.TMSCHEMA_MEASURES`, so the
right-hand column is what the engine holds, not what the file says.

| written in TMDL | stored |
|---|---|
| `formatString: "0.0%"` | `0.0%` — the enclosing quotes are stripped |
| `formatString: \$#,0;(\$#,0);\$#,0` | `\$#,0;(\$#,0);\$#,0` — Desktop's own currency form, kept verbatim |
| `formatString: #,##0 "units"` | `#,##0 "units"` — an inner literal survives |
| `formatString: "€"#,##0` | `"€"#,##0` — a leading quoted literal survives because the value does not *end* in a quote |
| `formatString: +#,##0;-#,##0;0` | `+#,##0;-#,##0;0` |

So: never wrap a whole format string in quotes to "protect" it — the quotes vanish, harmlessly
here, but a value that must **start and end** with a literal quote would lose both. Percent formats
(`0.0%`, `Percent`) are what the plugin's percent-double-scaling rule reads, so a ratio measure
must carry one of them.

## 9. Validating TMDL without a cold open

`file.reload/v1 {reloadModelDefinition: true}` on a running Desktop **is** the TMDL validator: it
deserializes the whole `definition/` folder and returns either success or the message in section 7,
in 0.4–1.5 s, and a failing reload normally leaves the running instance on the last good model so the
next attempt costs nothing. `references/verify-loop.md` has the bridge client; the warm-scaffold
pattern there means a from-scratch model never needs a cold open just to be checked.

What reload does **not** tell you — check through the engine after a success:

```
SELECT [Name],[State],[ErrorMessage],[FormatString] FROM $SYSTEM.TMSCHEMA_MEASURES
SELECT [ExplicitName],[InferredName],[State],[ErrorMessage] FROM $SYSTEM.TMSCHEMA_COLUMNS
SELECT [Name],[State],[ErrorMessage] FROM $SYSTEM.TMSCHEMA_PARTITIONS
SELECT [Name],[State],[IsActive] FROM $SYSTEM.TMSCHEMA_RELATIONSHIPS
```

`State` 1 is Ready; 3 is no data yet (a Power Query partition before refresh); 5 is a semantic or
syntax error; 6 an evaluation error; 7 a dependency error; 4 needs a refresh. Run them over the
same ADOMD connection `references/model-layer.md` opens for the TMSL refresh; a DMV `WHERE` clause
supports only `=`, so filter client-side. On a calculated-table column `ExplicitName` is empty and
`InferredName` carries the name — that is what `isNameInferred` means, not a fault.

Two things reload still cannot see, so keep one cold open at the end of a model build: the
`compatibilityLevel` and `defaultPowerBIDataSourceVersion` faults that a cold open forgives and a
reload refuses, and the calculated-table binding fault that only a cold open reports. Then refresh,
then read a number you predicted.
