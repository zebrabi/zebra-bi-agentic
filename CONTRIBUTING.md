# Contributing

Thank you for looking. Please read the next section before you open a pull request — this
repository has an unusual shape and it decides what can be merged.

## Half of this repository is generated

`plugins/zebra-bi/skills/report-authoring/` — the authoring skill and its five references — is
**build output**. It is emitted from a marked source that lives in a private Zebra BI repository,
because roughly a third of that source is material we do not publish: measurement history, incident
write-ups, and the derivations behind the visual encodings. The build strips the held spans and
turns the knowledge in them into validator rules instead, so it reaches you as a check rather than
as prose.

The practical consequence:

| Path | Can you send a PR? |
|---|---|
| `plugins/zebra-bi/skills/report-authoring/**` | **No.** The next build reverts it. Open an issue instead and we will change the source |
| `plugins/zebra-bi/skills/setup-doctor/`, `report-publishing/` | Yes |
| `plugins/zebra-bi/mcp/**` — the server, the checkers, the encoders | Yes, and this is where most useful contributions land |
| `README.md`, `AGENTS.md`, `.github/**`, `perf/**` | Yes |

`.bundle-sha256` and the `bundle` job in CI enforce the first row: an edit to generated output
fails the build rather than shipping. That is deliberate. An edit that never went through the
generator never went through its disclosure checks either.

**If a shipped instruction is wrong, an issue is worth more than a patch.** It reaches the source,
so the fix survives the next build — and it usually becomes a rule as well as a sentence.

## What is most useful

In rough order:

1. **A report that came out wrong while the checker said it was fine.** The checker reads files, not
   data. Every one of these we hear about is a candidate rule.
2. **A rule that fired on a correct report.** Retiring a rule is a normal outcome. A check that
   cries wolf is worse than no check, because people learn to skip the output and then it misses
   the real one. We have already retired two this way.
3. **A fault in `mcp/`.** Self-contained, testable, and yours to fix directly.
4. **An instruction you had to work out for yourself.** The skill is meant to be executable from
   what it ships.

## If you are changing a rule

Rules live in two places and both have to move together: the sentence a person reads
(`rules.json`, generated) and the function that fires it (`plugins/zebra-bi/mcp/checkers.js`,
authored here). `.github/scripts/check-rule-implementations.js` fails the build if they disagree.

Every rule needs **two** fixtures, and the second is the one that matters:

- one project where it **fires**, and
- an otherwise identical project where it stays **silent**.

A rule with only the first is untested in the direction that costs money. A checker that reads
nothing scores zero false positives, and so does a correct one — the numbers are identical, so the
silent arm is the only thing that tells them apart. `plugins/zebra-bi/mcp/test-checkers.js` and
`test-tmdl.js` are full of worked examples.

Before proposing a rule, run it over as many real `.tmdl`/PBIR projects as you can reach. A rule
that fires on reports that open and render is not a rule. One draft here reported 207 findings
across Zebra BI's own shipped templates, all false; another reported 11, all correct TMDL.

## Testing a change: use the built bundle, from somewhere else

The skill under `plugins/zebra-bi/skills/report-authoring/` is generated from a larger source, and
roughly a third of that source never ships as prose — it reaches you as validator rule messages
instead. So a test run against the source is a test of an artefact no user has, and it will make
the skill look better than it is in exactly the places where the missing third would have helped.

Two rules follow, and the second is the one people miss:

1. **Test the built bundle**, the files in this repository, not whatever produced them.
2. **Test from a directory that is not a checkout of anything containing a Zebra BI skill.** A skill
   on the path auto-activates, so a run inside such a checkout cannot tell you which copy answered.
   A bare directory with the plugin's `skills/` and `mcp/` copied in is enough.

Verify the bundle before you trust a result from it: `sha256sum -c .bundle-sha256` inside
`plugins/zebra-bi/skills/report-authoring/`. A stale or hand-edited bundle produces findings that
are properties of your working tree rather than of the product.

**When the run needs a fact the bundle does not contain, that is the finding** — it is the whole
reason to test this way, and it is lost the moment you supply the fact from somewhere else without
recording that you had to.

## Running the checks

No dependencies, deliberately — the MCP server has to run on a locked-down machine. Node 20 or 22.

```
cd plugins/zebra-bi/mcp
for t in test-*.js; do node "$t"; done

node ../../../.github/scripts/check-public-surface.js --self-test
node ../../../.github/scripts/check-public-surface.js
node ../../../.github/scripts/check-rule-implementations.js
node ../../../.github/scripts/check-rule-count.js
node ../../../.github/scripts/check-context-budget.js
```

`AGENTS.md` is the full contributor contract, including the context budget — the authoring skill
loads in full on every session, so tokens added there are paid by every user on every run, and the
ceiling is a ratchet.

## Licence

Contributions are accepted under the terms in [`LICENSE`](LICENSE), Section 5: by submitting a
contribution you confirm it is your own work or that you have the right to submit it, and you grant
Zebra BI a perpetual, worldwide, royalty-free, irrevocable licence to use, modify, sublicense and
distribute it as part of the Materials. You keep the copyright in your contribution.

It is not an open-source licence. It permits use, including commercial use, but not redistribution
or derivative works — a fork made to propose a contribution is the one exception (Section 1). If
that is a problem for you, please say so in the issue rather than sending code.
