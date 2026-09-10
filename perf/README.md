# perf — budgets that cannot be lost by accident

Three properties in this repository were won by measurement and can be lost without anyone
noticing: how much context a skill costs on every session, whether the rule count we print to
customers is true, and whether a rule in the catalogue can actually fire. None of them shows up in
a test, a render, or a diff read one hunk at a time.

This directory holds the data. The logic is in [`.github/scripts/`](../.github/scripts/), and the
`budgets` job in [`.github/workflows/checks.yml`](../.github/workflows/checks.yml) runs all three
on every push and pull request, with no path filter.

| Gate | Data | Script |
|---|---|---|
| Context budget | `context-budget.json` | `check-context-budget.js` |
| Rule-count sync | `rule-count-sites.json` | `check-rule-count.js` |
| Rule implementations | *(none — reads `rules.json` and `checkers.js`)* | `check-rule-implementations.js` |

Run them locally exactly as CI does:

```sh
node .github/scripts/check-context-budget.js
node .github/scripts/check-rule-count.js
node .github/scripts/check-rule-implementations.js
```

---

## 1. Context budget

**What it protects.** `plugins/zebra-bi/skills/report-authoring/SKILL.md` loads *in full* on every
activation of the skill, so every token in it is paid on every session by every user whether or not
that session goes anywhere near the material. It measured **24,934 tokens**, of which about
**10,419** are genuinely needed every time; roughly **12,349** are branch-specific and belong in a
reference loaded on demand, and about **1,974** are archival.

**The failure it prevents.** Not a bad edit — a good one. Somebody adds a hard-won paragraph to the
main skill instead of to a reference, the paragraph is correct and useful, the diff looks like an
improvement, and the always-loaded floor goes up by 300 tokens. Repeat that eight times over a
quarter and the restructuring has been undone by people who were each individually right. Nothing
in a test suite, a render or a code review reads a file's total size.

**How it works.** Each entry has a `ceiling`. The ceiling is a **ratchet**: it is pinned at the
value measured when the entry was written, so the file can only shrink. Exceeding one fails the
build with the file, both numbers, and the overshoot.

Two things it does on purpose:

- **References carry `"ceiling": null`.** They are loaded on demand and are not part of the
  per-session floor — and the restructuring works by moving material *into* them, so gating them
  would fight the fix. They are measured and printed so a reviewer can see where relocated
  material landed. A large fake ceiling was the alternative and was rejected: it would have read
  as coverage while catching nothing.
- **Any markdown under `plugins/zebra-bi/skills/` with no budget entry fails the build.** A gate
  that only checks the files it was told about has the same blind spot as `sha256sum -c`, which is
  why the `bundle` job counts files as well as verifying them.

**`target` is not a ceiling.** `report-authoring/SKILL.md` carries `"target": 10700` — where a
relocation-only restructuring should land it, with 8,300 as the eventual goal. The script prints
progress toward it on every run and **never fails on it**. A target that failed the build would
just be a ceiling, and the difference between "must not get worse" and "should get better" is the
whole point.

**The estimator is `words × 4/3`**, where a word is a whitespace-separated run of non-space
characters. It is not a tokenizer. It is stable, needs no dependency, and reproduces the
measurement the ceilings were set from — a real tokenizer would be more accurate and would also
invalidate every number in the JSON the day it changed version.

### Changing a budget deliberately

**To lower a ceiling** — which is the direction this exists to encourage — edit
`perf/context-budget.json` and set `ceiling` to the new measured size. The script prints the exact
value to use on every run, on the line beginning `ceiling can be lowered to` — illustrated here
with invented numbers, because the real ones move:

```
    tokens  ceiling  headroom  file
     22110    24934      2824  plugins/zebra-bi/skills/report-authoring/SKILL.md
                               target 10700 — 11410 still to relocate
                               ceiling can be lowered to 22110 to keep the win
```

Take the win in the same pull request that earns it. A ceiling left at the old number gives the
next well-meant paragraph 2,824 tokens of room it was not supposed to have.

**To raise a ceiling**, edit the same field and say why in the `why` string and in the pull
request. There is no override flag, no environment variable and no skip comment, and that is
deliberate: raising a budget should be a decision somebody makes, not a build that goes green
because of a flag nobody read.

**To add a file**, add an entry with `path`, `ceiling`, `target` and `why`. Give it a real ceiling
if it loads on activation, `null` if it is loaded on demand, and say which in the `why`.

---

## 2. Rule-count sync

**What it protects.** `rules.json` says how many rules the checker has. Three pieces of prose say
the same number to the customer, and nothing kept them in agreement.

**The failure it prevents, verbatim.** The count sat at **24** in every prose site while
`rules.json` carried **31**, for over a week — directly against a written instruction in
`AGENTS.md` to update those sites whenever the count moves. It was found by a human reading the
bundle front to back. This is the house defect class: *the prose shipped, the enforcement did not.*

**How it works — two mechanisms, because either alone fails.**

- **Pins.** One per known claim, matched by sentence, in `rule-count-sites.json`. Each captures the
  number and compares it to `rules.json`. **A pin that matches nothing fails the build.** That
  property is the most important line in this directory: without it, a reworded sentence turns the
  pin into a no-op, and a gate that reads nothing produces exactly the same green tick as a
  repository with nothing wrong.
- **A sweep**, as a net for a count that appears in prose without being registered: two- or
  three-digit numbers within 40 characters of *rule / check / checker / catalogue*, markdown only.
  Every hit must be pinned or exempted with a written reason.

**Why both.** The sweep alone is provably insufficient, and here is the proof. README states the
count as *"reports faults before you open it: 31 of them"* — the noun is nine words away, and no
sensible window finds it. It is pinned by hand. Before widening the sweep to catch sentences like
that, run it and look at what the wider window drags in; the calibration at 40 characters and two
digits was arrived at by measurement, from 21 hits down to 10.

**The three live sites**, all currently in agreement. The numbers are deliberately not repeated
here — a fourth copy of the count, in the documentation of the gate that exists to stop copies of
the count going stale, would be a joke at our own expense. Run the gate; it prints them.

| Site | Sentence |
|---|---|
| `README.md` — "What is included" table | *…reports faults before you open it: N of them…* |
| `README.md` — "About the checker" | *…you get N checks that catch things…* |
| `setup-doctor/SKILL.md` — example output | `Zebra validator         pass    N rules` |

**`AGENTS.md` has no live claim**, and that is a finding rather than a gap. Its mentions of 24, 31,
21, 22 and 20 are history and template counts — the sentence recording the 24-vs-31 drift must
*stay* at 24 and 31 when the count next moves, or the account is destroyed. Those lines are
exempted with that reason.

**Two known gaps, both recorded in `rule-count-sites.json`:**

- A **third** prose site lives in the generator's own repository, which is private, so nothing here
  can reach it. It is the one copy of the count still unguarded, and whoever holds that repository
  owns keeping it true.
- Two *code* sites assert a lower bound rather than a count — `checks.yml` ("at least 20") and
  `test-real-project.js` ("the catalogue is down to N"). A floor cannot go stale, so they are
  deliberately out of scope.

### Changing it deliberately

**When the rule count changes**, run the gate. It names every disagreeing site as `file:line` with
the sentence, and tells you the number to write. Fix the prose; do not touch this directory.

**When a sentence is reworded**, the pin fails with `matched 0 sites` and its pattern. Update the
`pattern` in `rule-count-sites.json` to the new wording. Delete the pin only when the claim itself
is gone.

**When the sweep flags something new**, decide which it is. A real count gets a pin. Anything else
gets an `exemptions` entry with `file`, `contains` (a literal substring of the line) and a `why`
that says what the number actually is. A stale exemption is reported as a notice, not a failure, so
the file can be tidied without a build breaking over it.

---

## 3. Rule implementations

**What it protects.** Every rule in `rules.json` must have a checker function behind it in
`plugins/zebra-bi/mcp/checkers.js`. The mapping is `rule.check` → a key of the exported `checkers`
object.

**The failure it prevents.** A rule declared with no implementation is worse than no rule at all:
it is counted in the number we print to the customer, it appears in the catalogue, and it never
once reports the fault it names. It is coverage that contributes none. `AGENTS.md` records that the
two existing suites *disagree* about whether this is allowed — `test-checkers.js` permits it if the
server declares the unimplemented count, `test-tmdl.js` forbids it — so a rule added without a
checker passes one suite and fails the other. This gate states the strict position on its own and
does not depend on which suite ran.

It **requires** `checkers.js` and asks whether the function exists at runtime, rather than
grepping the source. A regex over source would pass on a name sitting in a comment.

The reverse direction — a checker with no rule — is reported as a notice rather than a failure,
because `test-tmdl.js` already owns it and two gates asserting the same thing in different words is
how contributors learn to ignore both.

**Every rule is implemented today, so this gate passes trivially.** That is the danger: a gate
only ever seen to pass is indistinguishable from a gate that reads nothing. Both this script and
`check-rule-count.js` accept **`ZBI_RULES`**, an override pointing at another `rules.json` — the
same convention as `ZBI_REAL_PROJECT` in the test suite — so either can be watched failing without
editing generated output under `skills/`:

```sh
ZBI_RULES=/tmp/rules-with-a-bogus-entry.json node .github/scripts/check-rule-implementations.js
```

**If this gate ever fails, do not loosen it.** As of the last measurement the mapping was complete
in both directions — every rule to a checker, every checker to a rule, no orphans. A failure is
either a real gap or a mis-detected mapping. Investigate which before changing anything.

---

## The gates run in CI, from the `budgets` job

**Status: enforced, in `.github/workflows/checks.yml`.** All three gates run as their own job on
every push and pull request, and all seven suites run in the `suites` loop.

**Verified end to end by a failing arm, not by a clean run** — a gate that never fires scores zero
false positives too, so a green tick is not evidence. Three links, each tested separately:

| Link | How it was shown |
|---|---|
| the gate **detects** a violation and exits 1 | locally: 600 words appended to the built `SKILL.md` → exit 1, naming the overage and the remedy, other two gates still passing |
| the `budgets` job **runs** the gates | the CI log lists all three by name on every push |
| a failing gate **turns a PR check red** | PR #1, a throwaway: ceiling lowered 16252 → 9000, `budgets` **fail** while `suites` (node 20 and 22) and `bundle` **pass**. Closed unmerged |

The third is the one that is easy to assume and easy to get wrong, and the first two do not imply
it. **Re-run it if you ever change how a gate is invoked** — lowering a ceiling on a throwaway
branch is the cheapest version, because it leaves the bundle checksum valid and so proves the
failure is *discriminating* rather than a blanket red.

<details><summary>How this briefly ran from somewhere else, and why the patch file is still here</summary>

For three commits the gates ran from `plugins/zebra-bi/mcp/ci-supplement.js`, called at the end of
`test-checkers.js`. An agent session cannot edit `.github/workflows/` — GitHub requires the
`workflow` OAuth scope and rejects the push server-side with *"refusing to allow an OAuth App to
create or update workflow"* — and leaving the gates unrun was not an option, because that is
precisely the "prose shipped, enforcement did not" failure they were written to stop. Once the
scope was granted (`gh auth refresh -h github.com -s workflow`; the `-h` is required when it is not
run from a plain interactive shell) the patch was applied and the supplement deleted in the same
commit, so there was never a window with neither.

`perf/checks-workflow.patch` is kept because it is the readable record of what the `budgets` job is
and why it has no `paths:` filter.
</details>

### The two rules the `budgets` job encodes

**No `paths:` filter, deliberately.** A perf gate is exactly the kind of job somebody scopes to the
files it watches, and then it does not run on the pull request that renames one. This repository has
already had a suite skip silently for eight days inside a green run.

**Every suite is named in the loop, not globbed.** A glob silently drops a renamed file, and a suite
that stops running without saying so is the failure this whole section exists to prevent — it is how
`test-writers.js` and `test-profile.js`, 89 tests over the generator that writes every shipped page,
came to run on nobody's machine but the author's. If you add a suite, add it to the list.
