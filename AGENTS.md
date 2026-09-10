# Contributor instructions

This file is for anyone editing this repository — Zebra BI engineers, outside contributors, and
coding agents alike. It is not end-user documentation. Keep customer onboarding in `README.md`;
keep contributor workflow and repository guardrails here.

**Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first if you do not work at Zebra BI.** Half of this
repository is generated from a source you cannot see, and which half decides whether your change
can be merged at all.

## Working agreement

- Ask when an ambiguity would change product behaviour, the public contract, or the evidence needed
  to support a claim. Do not guess.
- Explain load-bearing assumptions and verification gaps. A structural pass, a successful render,
  and a numerically correct report are different claims.
- Make the smallest end-to-end change that solves the problem. Avoid broad rewrites and unrelated
  cleanup.
- Preserve the repository's evidence-first standard. New guidance must come from a reproduced
  result, an authoritative source, or both.
- Treat false positives as product defects. A validator warning on a correct report is worse than
  omitting a low-confidence rule.
- Do not commit, push, publish, or bump the plugin version unless the task calls for it.

## Repository map

- `.claude-plugin/marketplace.json` — marketplace metadata and the plugin entry.
- `plugins/zebra-bi/.claude-plugin/plugin.json` — installed plugin metadata, version, and MCP server.
- `plugins/zebra-bi/skills/setup-doctor/SKILL.md` — setup diagnosis and capability reporting.
  **Authored directly here**, not generated.
- `plugins/zebra-bi/skills/report-publishing/SKILL.md` — the Zebra-specific checks around
  Microsoft's `powerbi-report-management`, which owns the upload itself. **Authored directly
  here**, not generated.
- `plugins/zebra-bi/skills/report-authoring/SKILL.md` — the agent's main authoring workflow and
  non-negotiable rules. **Generated** — see the last section of this file.
- `plugins/zebra-bi/skills/report-authoring/references/` — detailed, task-specific authoring
  knowledge loaded from the main skill.
- `plugins/zebra-bi/skills/report-authoring/rules.json` — validator rule catalogue and user-facing
  messages.
- `plugins/zebra-bi/mcp/` — dependency-free CommonJS implementation of the validator, encoders,
  TMDL reader, MCP server, and tests.

The installed skills are the operational source of truth. The README should explain the product,
installation, prerequisites, first run, limitations, and support path without duplicating the full
skill content.

## How to make a change

1. Read the complete end-to-end path affected by the request: skill instruction, relevant reference,
   implementation, rule catalogue, and tests as applicable.
2. Identify the observable failure or user outcome before editing.
3. Change the narrowest source of truth. Do not repeat the same instruction in several files unless
   each audience genuinely needs it.
4. Add or update tests that would fail before the change and pass after it.
5. Run the relevant focused test, then the complete local suite.
6. Report what was verified and what still requires Windows, Power BI Desktop, a real project, or a
   rendered screenshot.

### Skill and reference changes

- Keep `SKILL.md` focused on routing, sequencing, decision points, and safety-critical rules. Put
  detailed visual, formatting, model, recipe, and preflight material in the matching reference.
- Make skill descriptions specific enough for automatic discovery. Include the user intents and
  artefact names that should trigger the skill.
- Do not promote a single authoring-session observation into shared guidance. Reproduce it first.
- A negative claim such as "unsupported" or "silently ignored" needs an independent reproduction.
- A number claim needs a model/data oracle. Cross-visual agreement proves consistency, not truth.

### Validator changes

- Keep the canonical user-facing wording in `rules.json`; do not create a second message in code.
- Add a fixture where the rule fires and an otherwise equivalent clean fixture where it stays
  silent.
- Keep findings actionable: name the fault, its consequence, its location, and the smallest fix.
- If the rule count changes, update assertions that deliberately pin the complete catalogue, and
  every prose site that states it. Two are here — `README.md` ("About the checker") and the example
  doctor output in `plugins/zebra-bi/skills/setup-doctor/SKILL.md` — and both are pinned by
  `.github/scripts/check-rule-count.js`, so CI will tell you. A third lives in the generator's own
  repository and no check here can reach it; whoever holds that repository owns keeping it true.
  This used to be a purely manual instruction and it was not followed for over a week: three sites
  read 24 while `rules.json` carried 31. That is why two of them are now a gate.
- Retiring a rule is a normal outcome, not a failure — a check that fires on a correct report is
  worse than no check. But the rule message may be the only place a true fact reaches the customer,
  because held files never ship as prose. Before removing one, find where the knowledge lands
  afterwards, and if the answer is nowhere, write it into a shipping file first.
- Run the real-project test. Its fixture is vendored, so it always runs. A new finding requires
  human judgement: pin it with a reason only when it is a real defect; otherwise fix the false
  positive.

#### Before you add a rule: measure it against the 20 shipped templates, both directions

Not "write a fixture" — the fixtures are yours, so they only prove the rule does what you meant. The
question that decides whether a rule may ship is **does it stay silent on the 20 shipped templates**, and
the only way to answer it is to run the rule over all 20. Both directions, in the *same* invocation as
a positive control, because a sweep that reads nothing reports a beautiful zero.

The three most recent rules, and what the measurement did to them:

| | outcome |
|---|---|
| `numeric-enum-written-as-word` | **0** findings across the 20 templates, **4** real catches in a field report → shipped |
| `page-filter-hardcodes-the-period` | **1** firing page out of 197 → shipped |
| *a Cards minimum-height rule* | **fired on 4 shipped templates** → **rejected**, not narrowed |

That third one is the point of this section. The reasoning was sound (a render-verified 264px floor for
one Cards shape, so a taller shape must need at least that), the checker was written, and the corpus
said the premise was false — the vendor ships those at 118px. **It is recorded as a comment in
`checkers.js` with its four counter-examples, deliberately, so nobody re-derives it.** If you find
yourself about to write a height threshold for Cards, read that comment first.

Two mechanical traps when adding a rule, both of which cost a cycle:

- **`check=` on a `ZBI:RULE` marker is the checker function's key, not a description.** Put prose there
  and `test-tmdl.js` fails with "checker with no rule".
- **The suites disagree on whether a rule may lack a checker.** `test-checkers.js` allows it as long as
  the server declares the unimplemented count; `test-tmdl.js` asserts every rule has a checker and
  every checker has a rule. So a rule added without a checker **passes one suite and fails the other**.
  Worth reconciling; until then, expect the `test-tmdl.js` failure and know it is the real constraint.

#### One defect already shipped, and is now fixed at source

`render_pointer` in the generator substituted on the rule block's *opening* comment only, so it emitted
the customer sentence plus the validator pointer and then left the original sentence sitting where it
already was. **Every rule authored in a file that ships printed its sentence twice.** It survived
because 21 of the then-22 rules live in the held trap catalogue, which never ships as prose — the one
exception is `colour-gate` in `formatting.md`, and its duplicate is in the released **v0.2.5** bundle.

Fixed in the generator (substitute over the whole open..close span, keeping a trailing newline, because
this corpus puts `END-RULE` on its own line and lets that line be the paragraph break). **Nothing needs
doing here** — it is stated so that a regenerated bundle showing a removed duplicate paragraph reads as
the fix rather than as lost content. Nothing checks for the class; it is what gate A9 is for.

#### The build will reject two things you would not expect, in shipped prose

Both live in `check_readthrough_classes` and both fire on the *generated* text, not on this file:
an **ISO date** anywhere in public prose ("state the sample, not the day"), and a **new
self-reference** — "see the X above/below" — until a person registers it. Write provenance and
cross-references inside `ZBI:INTERNAL`, or phrase them so they resolve from shipped text alone.

## A shipped instruction must be executable from shipped text alone

This is the one rule here that **no check enforces**, and it is written down because it cost a real
tester a real morning. The public text said to refresh the model "over the ADOMD connection" and
pointed at "the ADOMD path above" — and the passage that built the connection had been held back as
internal. Nothing was wrong with either half on its own. Together they were an instruction with its
referent deleted, and the agent following it improvised: a keystroke that landed in the wrong
window, then a manual click.

So: **if shipped prose tells the reader to do something, everything needed to do it must also
ship** — or the instruction must not ship either. A tool that stands in for the missing passage
counts, as long as the tool is reachable without the held text. "Read about it here, get the
mechanism somewhere else" does not count.

Why this is a human rule and not a build check, having tried: four versions of a mechanical check
all passed against a faithful reproduction of that exact bug. Prose mention is not definition — in
the broken state ADOMD appeared throughout the public prose and only the mechanism was gone — and
narrowing to "the referent survives inside a shipped code fence" fails too, because a surviving
comment inside the fence carries the word without the mechanism. Each version looked like a guard
and caught nothing, **which is worse than no guard, because it reads as coverage.**

What the build does instead is narrower and honest: `check_no_new_deixis` refuses a *new*
self-reference in shipped prose until a person registers it. That catches "see the X above" where X
was never public. It does not catch a referent that was public and later got held, which is the
class above. That one is caught by reading the bundle, which is gate A9.

### Gate A9 — reading the bundle. A first pass ran 2026-08-15

**A9 is still open and still needs a human.** What ran on 2026-08-15 was a full agent read-through
of all 2,979 lines of shipped prose plus this file, the README and the LICENCE — a first pass that
narrows what a person has to find, not a substitute for the person. Recorded here so the next reader
starts from the residue rather than from zero, and so the pass is repeatable.

**Read with two lenses, and they are different passes over the same text.** The leak read asks
*"should a customer be reading this?"* The executability read asks *"can a customer actually do
what this says, using only what shipped?"* The second is the one that keeps finding things, because
nothing mechanical can check it.

What the first pass found, both now fixed:

| Class | What it was |
|---|---|
| **Executability** | Four sites gave operating instructions for the node engine, which explicitly does not ship: `Use report.buildAndValidate()`, `verify.validate() filters both into .real`, `scripts/zebra/*` named as a path, and `buildReport handles the ordering`. The section correctly said *"assume it is absent"* and then told the reader to call it anyway |
| **Accuracy** | The rule count was **24** in all three prose sites while `rules.json` carried **31** — against the explicit instruction eighty lines above in this file to update those three sites when the count moves. A written rule, not followed |

Neither was a disclosure leak. That is worth knowing: the disclosure checks in the generator are
carrying their weight, and the classes that survive them are *staleness* and *instructions with no
referent*.

**A repeatable pass, in the order that finds things fastest:**

1. **Grep for the shipped-tool boundary first — it is the cheapest and it found the real defect.**
   Any mention of `scripts/`, `build.js`, `powerbi-desktop`, `powerbi-report-author`, or a bare
   `<something>.<method>()` in shipped prose. For each: does the thing ship? If not, is the sentence
   still an *instruction*? A named tool inside a clearly-labelled "you do not have this" section is
   fine; an imperative inside one is the ADOMD bug again.
2. **Check every stated count against its source.** `rules.json` versus the three prose sites; the
   property and template counts in the references. Numbers in prose have no owner and no check.
3. **Then read it front to back, in order, for the leak lens.** Statements that our own products are
   defective, colleagues' names, the vendor speaking in the first person about its own catalogue
   (the gate below now catches the common form of this), internal process identifiers (delivery-gate
   ids, harness names), internal file names, and anything a customer would read as a note we left
   ourselves.
4. **Read the README and this file too.** They are in the public repository and they are not
   generated, so no build check has ever looked at them.

**What a keyword sweep does not do.** A grep for a pattern you already suspect is not this gate — it
finds what you thought of, which is the same limitation that makes every automated version of A9
useless. Both findings above came from reading in order, not from a pattern. If the next pass is a
grep, A9 has not run.

### Encoder and TMDL changes

- Prefer refusing unsafe or incomplete input over emitting a plausible no-op or corrupt property.
- Return companion settings when encoded output needs another property to render correctly.
- Round-trip encoder output through `validate_report`.
- Test TMDL using real syntax, including tabs, quoted names, and multiline DAX. Regex-only fixtures
  are not sufficient evidence for parser behaviour.

### Rules that read INSIDE a DAX expression — the bar is higher

Everything after the first `=` is DAX, and the validator treats it as opaque on purpose: judging an
expression needs the model's names and types, which no file check has. Three rules are the exception
(`dax-removefilters-as-table-expression`, `dax-var-named-after-a-function`,
`dax-unquoted-calculations-table`). Before adding a fourth:

- **It must be a hard parse or evaluation error**, not a style or plausibility judgement. An
  expression that trips it cannot work, so the rule cannot fire on a correct report. That property is
  what makes these three safe; a "this DAX looks wrong" rule has no such guarantee.
- **Read through `daxOnly()`.** It blanks `///` descriptions, `//` and `--` comments and string
  contents. Matching DAX-shaped text anywhere in a `.tmdl` file is how the `//` rule once produced
  **207 false positives across 7 of the 20 shipped templates**.
- **Measure the set, do not reason about it.** `dax-var-named-after-a-function` first shipped with the
  obvious generalisation — any DAX function name — and the corpus sweep caught it firing on
  `VAR mid = ISINSCOPE(…)` in a shipped, working template. 234 names were then put through the engine:
  105 refused, 129 legal, and the split is scalar-vs-table, not guessable. Do not extend that list
  from memory.
- **Sweep before you commit**, staged as real copies to a short path (`MAX_PATH` truncates
  `CustomVisuals`) with **bytes-read printed** — a sweep that reads nothing and a clean corpus return
  the same number. And note when a rule's silence is *vacuous*: no template declares a `Calculations`
  table, so the sweep is not evidence for that rule at all.

## Performance is a contract, not an aspiration

An authoring session's wall-clock is dominated by three things, measured 2026-08-15: **output tokens
emitted**, **context loaded per activation**, and **how late a failure is detected**. Execution speed
is not on that list. Changes here are cheap to make and expensive to reverse, so they are gated.

**The gates.** `.github/scripts/check-context-budget.js`, `check-rule-count.js` and
`check-rule-implementations.js`, run by the `budgets` job. `perf/README.md` explains each one, what
failure it prevents, and how to change a budget deliberately. Run them before you push.

- **The per-session context floor may only go down.** `skills/report-authoring/SKILL.md` loads *in
  full* on every activation, so a token added there is paid by every user in every session — the most
  expensive place in the repository to put a sentence. Its ceiling lives in `perf/context-budget.json`.
  References are loaded on demand and are tracked but not gated; they may grow.
  **Raising the ceiling is permitted and must be argued in the `why` field**, naming what the tokens
  buy and what you deleted to pay for them. That is not a loophole — it is the point. The gate exists
  to make the cost visible at the moment of the edit, not to forbid the edit; a rule that could only
  ever be obeyed by saying no would be routed around within a month.
- **Before optimising a phase, measure it. Before calling one irreducible, try.** This document's
  own first draft called planning irreducible and moved on. Half of it turned out to be mechanical
  and became `profile_project`, ~2 min to under 10 s. An unmeasured "that cannot be faster" is an
  assertion wearing a conclusion's clothes.
- **Put knowledge in the cheapest carrier that can hold it.** In order: a **tool schema** (loads as
  schema, and cannot drift from the implementation the way prose can) → a **validator rule** (fires on
  the actual file) → a **reference behind a named trigger** (loads only when needed) → **`SKILL.md`
  prose** (loads always). Prefer the earliest option the fact fits in.
  **The exception is not optional:** for a `held: true` rule the prose never ships, and the default
  machine has no Node, so a migration must leave a one-line prose floor. Deleting it deletes the
  knowledge — see *A shipped instruction must be executable from shipped text alone*.
- **Optimise detection latency before execution speed.** The same fault costs ~0.2 s at pre-flight,
  ~1 s at `file.reload/v1` (which names the file and the reason), **23–210 s** at a cold open, and a
  whole session if a human finds it. A rule that moves a fault from the third column to the first is
  worth more than any speedup, which is why the `wont-open` severity class exists and why it is the
  first place to add a check.
- **Sequence a build so model faults happen once.** Every model fault costs a cold open; every
  report-layer fault costs about a second. `file.reload/v1` applies the report layer — verified,
  including wholesale page replacement — and **does not apply model changes**: it returns
  `{"success":true}` and the change is not live. Settled with a cold-open control.
- **A `success` code is not evidence.** The Desktop bridge has now been caught returning
  `{"success":true}` over a refused definition, over unresolved `[Measure]` title tokens, and over a
  model change it ignored. Treat it as "the RPC was received", never as "the change is live".
- **Do not add a benchmark without a dirty-environment guard.** A leftover Desktop instance once made
  a cold open appear to take 376 ms. Any timing harness must refuse to run, not silently mismeasure.
- **Quote the phase with the number.** "2.8×" is a verify sweep, "4.5×" is emission, "~3×" is a
  typical session. A bare multiplier with no phase attached has already been mistaken for a
  session-level claim once in this project's history.

## Verification

Node.js 18 or later is the only requirement for the local suite. There is no install step.

Run from the repository root:

```sh
node plugins/zebra-bi/mcp/test-checkers.js
node plugins/zebra-bi/mcp/test-encoders.js
node plugins/zebra-bi/mcp/test-server.js
node plugins/zebra-bi/mcp/test-tmdl.js
node plugins/zebra-bi/mcp/test-real-project.js
```

The real-project test runs unattended. Its fixture lives at
`plugins/zebra-bi/mcp/fixtures/sales-variance-dashboard.json` as a **manifest** — a path-to-content
map that the test materialises into a temp directory per run and deletes afterwards. Point
`ZBI_REAL_PROJECT` at another PBIP project to run the generic assertions against it instead; the
pinned checks then **skip rather than pass**, because the pins were measured on this fixture and
mean nothing anywhere else:

```sh
ZBI_REAL_PROJECT=/path/to/project node plugins/zebra-bi/mcp/test-real-project.js
```

**A manifest rather than a project tree, deliberately.** The repository `.gitignore` blocks
`*.pbip`, `*.Report/` and `*.SemanticModel/`, and that is a credential guard: saving a report in
Desktop writes a Zebra licence key into each `visual.json` that has rendered — and `enableAutoRecovery`
means Desktop can save unprompted — so a project directory in a published repository is one Desktop
session away from leaking one. Committing the tree would
have meant disabling that guard for precisely the file shape it protects. A manifest cannot be
opened in Desktop, so no key can ever be written into it.

**The test skipped silently until 14 August, which is why an absent fixture now fails.** It took
its project only from `ZBI_REAL_PROJECT`, CI never set it, and for eight days the suite printed a
skip line and exited 0 inside a green run — while the fixture carried an unpinned `wont-open`
defect (a table named `Measures`) that the rule shipped on 6 August would have caught on any of
those runs. **Listing a suite in CI is not the same as running it**: five were listed and four
executed, and the tick looked identical. When you add one, read the log and confirm it says what
you think it says.

Also parse every touched JSON file and inspect the final diff. Node tests establish structural and
protocol behaviour; they do not replace a cold open, render, screenshot review, or DAX verification
when a change makes claims about Power BI Desktop or Zebra BI visual behaviour.

## Disclosure: what is held back, and how to write a sentence that ships

Roughly a third of the source this bundle is generated from never ships as prose: the measurements,
the derivations, the corpus censuses and the incident history behind every encoding and every rule.
What ships is the **conclusion** — the property, the value, the binding, the check. That split is
deliberate and it is the whole disclosure model: a reader learns *what* to write, and the months of
*how it was established* stay with Zebra BI. Nothing in the shipped tree is secured by obscurity,
and nothing here should be written as if it were — the licence, not the wording, is what protects
the reusable parts.

Four questions for any sentence that will ship, in this repository or through the generator:

1. **Mechanism or derivation?** Ship the mechanism ("write every key in the settings object"). Hold
   how you found it, what you measured, how many files said so.
2. **Requirement or defect?** Write the requirement ("every comment needs a `filterContexts` key"),
   not a diagnosis of the product ("the visual blanks when the key is missing"). The fix reaches the
   reader either way; only the second reads as a defect catalogue.
3. **Does a design rule end in a binding?** Guidance on which visual, what scale or what sort is
   general knowledge until it terminates in the Zebra property or role that implements it. End it
   there, so the sentence is about authoring Zebra BI and not a consulting note that works anywhere.
4. **Does it ship with its referent, and without our names?** Nothing cited that the reader cannot
   open; no colleague by name, no sales framing in the first person, no internal path or corpus
   file. The gate below and the generator's seed list enforce the mechanical part; the rest is the
   A9 read.

When you find a new class of leak, turn it into a check — a seed in the generator if naming it would
itself disclose something, an entry in `.github/scripts/check-public-surface.js` if it is about
audience rather than secrecy — rather than into something a person remembers.

## Data and security boundaries

- Never commit customer data, proprietary report content, licence keys, credentials, personal data,
  or machine-specific absolute paths.
- **A Desktop save writes a Zebra BI licence key into each `visual.json` that has rendered**, under
  `licenseSettings` on Tables and Charts and `license` on Cards. That is normal Power BI behaviour —
  a `.pbix` carries the key the same way, and this plugin does not cause it. It is **not** something
  the skill warns customers about, and there is no validator rule for it: that guidance was removed
  on 2026-09-05 by the product owner's decision, on the grounds that flagging normal behaviour is
  noise. The `.gitignore` rules on `*.pbip` / `*.Report/` remain the guard that matters here, since
  this repository is public and the first bullet above still applies to what **we** commit.
- Keep **customer or otherwise non-redistributable** project fixtures outside this repository and
  provide their location through `ZBI_REAL_PROJECT`.
- Tests and examples must use synthetic names and values unless an approved, redistributable fixture
  is intentionally being added. **One such fixture exists**, added 2026-08-14 with the product owner's
  approval: `plugins/zebra-bi/mcp/fixtures/sales-variance-dashboard.json`, hand-built, wholly
  synthetic, and checked for licence keys, credentials and absolute paths before it was committed.
  It ships in-repo because an out-of-repo fixture is one nobody configures, and an unconfigured
  fixture made the suite that depends on it a no-op — but as a **manifest**, so the `*.pbip` /
  `*.Report/` ignore rules keep protecting the repository from a licence key. Adding a second one
  is a disclosure decision, not a convenience: ask, and keep it in the same form.
- Do not silently edit a contributor's global or project instruction files.

## Pull requests

Every change to `main` goes through a pull request, including from maintainers. Direct pushes are
refused by a branch ruleset rather than by convention, because a convention is what the first
hundred commits of this repository ran on and it did not hold.

- **One approval, from someone other than the author.** Self-merging your own change is not
  available even where you have the permission to do it. A named reviewer goes on the PR when it is
  opened, not when it is ready.
- **All checks green.** The four jobs in `checks.yml` are required, and the PR has to be current
  with `main` before it merges.
- **Squash merge, one commit per `main`.** Merge commits and rebase merges are disabled.
- **Nothing hand-edits the generated bundle.** `plugins/zebra-bi/skills/report-authoring/**` is
  build output; see the last section of this file. The `bundle` job fails on it, so this rule saves
  you the effort rather than catching you.
- **A bundle change and its `.bundle-sha256` are one commit.** There is no safe half.
- **A version bump is a release.** `marketplace.json` serves `./plugins/zebra-bi` from this
  repository, so merging a bump publishes it. Say so in the PR description, explicitly, either way.
- **A changed number changes every sentence that states it.** `check-rule-count.js` enforces the
  sites it knows about; a new one has to be registered in `perf/rule-count-sites.json` or the sweep
  reports it as unregistered.

What a review is looking for, in order: whether a shipped instruction is executable from shipped
text alone, whether a new rule can fire on a correct report, whether the claim in the prose matches
what the code does, and whether anything internal has reached the public tree. All four have gates
behind them now, and the gates are still not sufficient. `check-no-tenant-identifiers.js` is the
newest and the reason it exists is worth knowing: three real tenant GUIDs sat in `mcp/` through a
disclosure pass because they were inside base64, so it decodes a driveId instead of reading it. It
checks the shape of an identifier. It cannot tell you a sentence should not have been published.

## Release hygiene

For a user-facing release:

- Update `plugins/zebra-bi/.claude-plugin/plugin.json` when a new plugin version is intentionally
  being published.
- Confirm the marketplace name, plugin name, install commands, and documented skill names still
  agree.
- Run the complete local suite and any required Windows/Power BI verification.
- Review the diff for internal paths, report content, secrets, licence material, and unsupported
  claims.
- State any capability or verification downgrade rather than allowing it to look like a product
  regression.

## The shipped skill is generated. Never edit it directly

`plugins/zebra-bi/skills/report-authoring/` is **build output**. It is emitted from a marked source
in a private repository, and that build is where every disclosure check runs — no internal path, no
held-file prose, no held rule's sentence in the public text.

Editing those files directly fails two ways at once. The next build silently reverts the edit, so
the work looks landed and is not; and an edit that never went through the build never went through
the disclosure checks either. `.bundle-sha256` and the `checks` workflow exist to turn that from a
silent leak into a failed build.

If you need to change shipped prose, change the marked source and re-run the generator.

**Commit the bundle and `.bundle-sha256` in the SAME commit.** That file hashes every file in
`report-authoring/`, so staging part of a rebuilt bundle without it — or with it but without the
rest — pins a hash that does not describe the tree, and the `bundle` job fails on a commit that is
individually broken even though the branch tip is fine. Two commits went red this way within one
hour on 2026-09-05, from two different contributors, each having reasoned that holding the hash back
was the safer half. There is no safe half: the unit is the whole directory. Before you commit,
run `sha256sum -c .bundle-sha256` inside `plugins/zebra-bi/skills/report-authoring/` and expect
every line to say `OK` — the same command `CONTRIBUTING.md` gives for trusting a test result, at the
one other moment it matters.

**The public CI cannot re-check the boundary**, and it is worth knowing why rather than assuming it
does. The checks live in the generator, in a private repository, and the list they match against
names the very things it protects — publishing it here would be the leak it prevents. So CI proves
the bundle is byte-for-byte what a boundary-checked build produced, and nothing stronger.
