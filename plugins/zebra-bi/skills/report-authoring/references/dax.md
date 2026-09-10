# DAX — read the engine's answer, not your own guess

You do not have to be right about DAX first time. **You have to be able to ask.** Power BI Desktop
serves the open model on a loopback port, an `EVALUATE` costs a few milliseconds, mutates nothing and
needs nothing installed — so a measure you are unsure of is a question, not a gamble.

The connection recipe is in **`references/verify-loop.md`** under *"DAX against the live model"*. It
is not repeated here. This file is the other half: **what the engine says back, and what each answer
means.** Read it when a measure errors, when a number looks wrong, or once before writing a model's
measures.

Everything below was measured on Desktop 2.157 against a 20,000-row model — 452 variants, 108
controlled pairs. Where a claim is not measured, it says so.

---

## 1. `The syntax for 'X' is incorrect` — the message that tells you nothing

This one string covers at least **twelve unrelated faults**, so never read it as "I mistyped
something near X". Work the list in order; `X` is the token the parser gave up on.

| If `X` is… | The fault | Fix |
|---|---|---|
| a **table name with a space** | missing single quotes | `'Opportunity Calendar'[Date]` |
| **`Calculations`** | a reserved word | quote it, or rename the table |
| your **`VAR` name** | it collides with a DAX function name — see §2 | rename the variable |
| a **table name after `DEFINE MEASURE`** | same two causes as above | quote it |
| the token after a **`;`** | `;` is not an argument separator | use `,` |
| the token after `Table.Column` | dot notation | `Table[Column]` |
| the token after a `VAR` block | no `RETURN` | add exactly one `RETURN` |
| **`)`** or end of input | unbalanced parentheses | count them |
| a second expression with no comma | missing argument separator | add `,` |
| the whole `DEFINE …` | `DEFINE` with no `EVALUATE` | every `DEFINE` needs one |
| a **measure written `Table[Measure]`** | measures take no table prefix | `[Measure]` |
| a trailing `+`, `-`, `&` | dangling operator | complete or delete it |

Two neighbours that are *not* this message, and are more helpful because they name the real problem:

- **`The end of the input was reached.`** — unbalanced parentheses, unambiguously.
- **`The following syntax error occurred during parsing: Invalid token, Line 1, Offset 80, "Won))`** —
  an unterminated string. The offset is exact; the quoted fragment starts at the runaway quote.

## 2. A `VAR` may not be named after a DAX function

Some DAX names are reserved and cannot be used as a variable name. The failure is the generic
*"The syntax for 'X' is incorrect"* — it never says "reserved". The collision is exact-match and
case-insensitive, so adding a noun to the name clears it. The model still **opens**; the damage is
on the page, where every visual touching the measure shows *"Something's wrong with one or more
fields"* and loses its other fields with it. `validate_report` catches this.


```dax
VAR LastDate      = MAX ( Sales[Date] ) RETURN …    // ERROR — LASTDATE is reserved
VAR LastDateValue = MAX ( Sales[Date] ) RETURN …    // fine
```

**It is not "every function name", and the difference is not guessable.** Of 234 names put through
the engine, **105 are refused and 129 are fine**. Reserved are the table functions, filter
modifiers, time intelligence, aggregators and language keywords — `Filter`, `Sum`, `Value`, `Date`,
`Rank`, `Union`, `Order`, `Min`, `Max`, `Count`, `All`, `Row`, `If`, `Not`, `True`, `False`. Legal,
and common in real models, are the scalar text and maths functions — `Mid`, `Round`, `Format`,
`Search`, `Left`, `Right`, `Len`, `Trim`, `Now`, `Today`, `Year`, `Month`, `Day`, `Abs`, `Int`,
`Offset`, `Index`, `Window`.

When in doubt add a noun: `…Value`, `…Table`, `…Dates`.



## 3. Name-resolution messages, keyed on what you see

| Message | What it actually means |
|---|---|
| `Column 'X' in table 'Y' cannot be found or may not be used in this expression` | the name is wrong, **or** you wrote a measure as `Table[Measure]` |
| `Cannot identify the table that contains [X] column` | a bare `[Column]` in an aggregator. Qualify it: `Table[Column]` |
| `The value for 'X' cannot be determined. Either the column doesn't exist, or there is no current row` | you referenced a **measure that does not exist** (a missing `PL`/`FC` scenario is the usual cause), or a column with no row context |
| `A single value for column 'X' cannot be determined…` | a column used where a scalar is needed — wrap it in an aggregator, or you meant `RELATED` |
| `Failed to resolve name 'X'. It is not a valid table, variable, or function name` | the table does not exist at all (this is what `Measures` gives) |
| `The column 'X' does not have a relationship to any table in the current context` | `RELATED` pointing the wrong way — use `RELATEDTABLE` from the one-side |

☠️ **A bare `[Column]` is legal inside a row context and illegal outside one.**
`FILTER(Sales, [Status]="Won")` works; `SUM([Value])` does not. So the same shorthand is fine in an
iterator and fails in an aggregator — which is why this fault survives a quick read. **Qualify every
column reference anyway**; it is the industry convention (and `[Measure]` unqualified, which is the
mirror image, is also the convention).

## 4. Type and arity messages

| Message | Fix |
|---|---|
| `The function SUM cannot work with values of type String` | aggregate a numeric column, or `SUMX(… VALUE(col))` |
| `The function AVERAGE cannot work with values of type Boolean` | `AVERAGEX(T, IF(col, 1, 0))` |
| `Cannot convert value 'X' of type Text to type Number` | a text column in arithmetic — the value is data, not code |
| `DAX comparison operations do not support comparing values of type Date with values of type Text` | compare like with like; `FORMAT`/`VALUE` one side |
| `Function 'LOOKUPVALUE' does not support comparing values of type Text with values of type Integer` | **a model defect surfacing** — two key columns typed differently |
| `Too few / Too many arguments were passed to the X function` | check arity; `DIVIDE` needs 2 |
| `USERELATIONSHIP function can only be used in the CALCULATE function` | it is a CALCULATE modifier |
| `USERELATIONSHIP / CROSSFILTER can only use the two columns participating in a relationship` | the relationship does not exist, or you named the wrong endpoints |
| `A function 'X' has been used in a True/False expression used as a table filter` | a measure in a CALCULATE predicate — wrap the predicate in `FILTER(T, …)` |
| `The expression specified in the query is not a valid table expression` | `EVALUATE` needs a table; wrap a scalar in `ROW("v", …)` |

The `LOOKUPVALUE`/`TREATAS` type messages are worth a second look: in the measured model
`Territories[TerritorySeq]` is text while `Accounts[TerritorySeq]` is a whole number. DAX refused to
join them. **A type error across a key pair is usually the model telling you something true.**

## 5. Semantics people get wrong

All measured. None of it is intuitive, and every one changes a rendered number.

| Expression | Result | So |
|---|---|---|
| `1/0` | `Infinity` (a **value** — `ISERROR` true, `IFERROR` catches it) | it can reach a visual |
| `0/0` | `NaN` | likewise |
| `DIVIDE(1,0)` | `BLANK` | **always use `DIVIDE`** |
| `DIVIDE(1,0,0)` | `0` | third argument when a zero reads better than an empty cell |
| `BLANK() = 0` · `< 1` · `= ""` · `> -1` | all **true** | `= 0` does NOT distinguish blank from zero — use `ISBLANK` |
| `BLANK() + 1` | `1` | blank is zero under `+` |
| `BLANK() * 2` | **`BLANK`** | but not under `*` — the asymmetry is real |
| `BLANK() & "x"` | `"x"` | blank is an empty string under `&` |
| `MAX('Calendar'[MONTH])` on month **names** | `"September"` | alphabetical, not latest — aggregate the month **number** |
| keyword and identifier **casing** | case-insensitive | `evaluate row(… OPPORTUNITIES[value])` runs. Casing is style, not syntax |

☠️ **Return `BLANK()`, not `0`, for a scenario with no data.** A zero draws a bar and a 0% variance;
a blank is omitted. `CALCULATE(SUM(…), Status="NoSuch")` is already blank — adding `+ 0` or
`COALESCE(…, 0)` is what breaks it.

## 6. The four measured wrong-number traps

Each proved with a control — a naive and a correct form computing the *same* quantity, so a
difference is the trap and agreement refutes it.

1. **A ranking restarts inside every partition.** `RANKX(ALL(T[Col]), …)` with a parent level also in
   the grouping ranked three different products as #1. Mechanism, fix and the `ALL(Table)`/
   `REMOVEFILTERS` positional rule are in `references/model-layer.md`.
2. **A CALCULATE predicate OVERRIDES the outer filter on the same column**, so every row of that
   column shows the same number — the "same total repeated on every row" symptom. `KEEPFILTERS`
   intersects instead: measured, `Warm 9,001 / Hot 1,986` rather than `10,987` three times.
3. **A `VAR` is evaluated where it is declared.** `VAR t = [Sales] RETURN CALCULATE(t, …)` returns the
   *unfiltered* value — 77,252,216 where the filtered answer is 26,435,925. `CALCULATE` cannot reach
   back into a variable. Compute inside, or capture what you actually want.
4. **A ratio is not additive.** Averaging per-row ratios gave a 158% win rate where the correct
   recomputed total was 49.6%. **A total ratio must be recomputed from the totals**, never summed or
   averaged. The same applies to a ratio's variance: `AC − PY` on a ratio is in *percentage points*
   and is a different number from the variance %.

   ☠️ **Tables' Top N Others row is this same fault, wearing the clothes of a correct one.** The
   Others row aggregates the tail rather than dropping it, so on an additive measure the grand
   total survives Top N — which is the check the authoring skill tells you to make, and it passes.
   **On a rate the aggregate is arithmetic nonsense and nothing flags it:** ten clubs' home
   advantage summed to **2.16 against a real maximum of 1.05**, and the benchmark row counted the
   same value ten times to **4.11**. Top N on a rate needs the measure recomputed over the Others
   set, not aggregated across it. If you cannot do that, **do not put a rate behind Top N.**

☠️ **A variance % against a NEGATIVE base flips sign.** Measured twice independently:

```dax
DIVIDE ( AC - PY, PY )        // PY = -100, AC = +50  →  -1.5   "down 150%" — but it improved
DIVIDE ( AC - PY, ABS ( PY ) ) //                      →  +1.5   correct
```

**Always `ABS()` the denominator of a variance percentage.** Guard blank and zero separately:
`DIVIDE` returns blank for both, and "no prior year" is not "0% change".

**Zebra BI's own ΔPY% already does this, so a naive measure disagrees with the visual beside it.**
Render-verified on a Zebra Table with `PreviousYear` bound: a division at AC −86k against PY −29k
drew **−193.5%** in red — worse, and shown as worse — while a `DIVIDE(AC − PY, PY)` measure on the
same page printed **+193.5%**; a division at AC +474k against PY −54k drew **+973.3%** in green
where the naive measure said −973.3%. The visual divides by `|PY|`. Any variance % you write
yourself — for a card, a title token, a comment trigger — must too, or the page contradicts itself
on exactly the rows a reader will ask about.

## 7. House style — write DAX a reviewer will trust

Casing and whitespace are not syntax, so this is convention, and the convention is the one the DAX
community settled on (daxformatter.com). It matters because a human opens this model next.

- **One expression per line, arguments indented**, `VAR`/`RETURN` at the same depth. A measure that
  fits on one line may stay on one line.
- **`UPPERCASE` functions, `'Table'[Column]` fully qualified, `[Measure]` never qualified.**
- **`VAR` over repetition.** A sub-expression written twice is evaluated twice and drifts when edited
  once. Name it.
- **`DIVIDE` over `/`** — always, per §5.
- **Comment the *why*, not the what.** `// PY window clipped to elapsed days` earns its place;
  `// divide sales by count` does not.
- Per-scenario measures follow the house `AC`/`PY`/`PL`/`FC` suffix convention and ratios take no
  suffix — see `references/model-layer.md`, which is where the naming rules live.
- ⚠️ In TMDL, a multi-line expression must start on the line **after** `=`, indented. Starting it on
  the `=` line swallows the next property. That is a TMDL rule, not a DAX one — `references/tmdl.md`.

## 8. Performance — what is worth optimising, and what is not

Measured on a **20,000-row** model where the measurement floor is about **10 ms** per query.

| | measured |
|---|---|
| **Context transition in an iterator** — `SUMX(T, [Measure])` or `SUMX(T, CALCULATE(…))` | **3–6× slower** than a flat iterator (38–69 ms vs 11–14 ms) |
| `CROSSJOIN` of a fact and a calendar | 3.2 s — real, and almost always a mistake |
| `CALCULATE(…, FILTER(Table, …))` vs a bare predicate | **below the floor. Not measurable at this size** |
| `SUM` vs `SUMX`, `/` vs `DIVIDE` | below the floor |

**So there is exactly one performance rule worth applying while authoring: do not call a measure
inside an iterator over a large table unless you mean the per-row context transition.** Iterate the
dimension you actually mean to aggregate over — `AVERAGEX(VALUES(Accounts[Name]), [Revenue])`, not
`AVERAGEX(Sales, [Revenue])`; measured, those differ by 28×, and the second one silently answers a
different question.

Everything else on this list is a **readability** decision at report scale. Prefer the clearer form.

