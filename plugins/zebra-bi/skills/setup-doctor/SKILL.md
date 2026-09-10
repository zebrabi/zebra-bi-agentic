---
name: setup-doctor
description: >-
  Check whether this machine can author Zebra BI reports in Power BI, and say what it can and
  cannot verify. Run it before authoring anything, and again after installing a dependency. It
  reports Power BI Desktop, the .pbip project shape, Zebra visual registration, licence state,
  Node, the validator, the Desktop Bridge, the resulting verification tier, and any conflict with
  the user's own instruction files. Use when the user says "check my setup", "is this machine
  ready", "why is the validator not running", "which tier am I on", "zebra bi doctor", or when
  authoring has just failed for a reason that looks environmental.
---

# Setup doctor

Work out what this machine can do, say so plainly, and leave a record. Ten checks. Each returns
**pass**, **fail** or **capability**, and every failure carries one sentence on how to fix it.

**Run all ten before reporting.** Do not stop at the first failure. Ten checks cost seconds; ten
round trips through a human cost an afternoon.

**This runs with nothing installed.** That is the point, and it is why the doctor is a skill
rather than a tool: if Node were missing, a tool could not tell you so, because the tool would
not be running either.

## The three states, and why the third exists

| State | Means |
|---|---|
| **pass** | Works. Say nothing beyond the tick. |
| **fail** | Authoring will not work, or will produce a wrong report. Give the fix. |
| **capability** | The machine is missing something optional. A smaller product, not a broken one. |

A missing capability is not an error and must not be reported as one. Without Node the plugin
authors reports without the validator, which is exactly what it did before the validator existed.
**Say which of the two products is running**, because a user who does not know they are on the
smaller one reads its gaps as defects.

## The checks

Run them in this order. It puts the cheap, decisive ones first.

### 1. Power BI Desktop present — *fail*

Windows only. Look for `PBIDesktop.exe` or the Store build:

```
%LOCALAPPDATA%\Microsoft\WindowsApps\PBIDesktopStore.exe
%ProgramFiles%\Microsoft Power BI Desktop\bin\PBIDesktop.exe
```

Absent means nothing can be verified: no render, no screenshot, no bridge. Authoring the files
still works, and you should say that rather than implying the whole thing is dead. Point at
AppSource or the Microsoft Store for Desktop.

On macOS or Linux, report this as a fail with the reason: the product depends on Power BI
Desktop, and there is no headless renderer. Do not soften it into a capability.

### 2. The `.pbip` project shape — *fail*

If the user named a project, check it holds a `.pbip` file, one `*.Report` directory and one
`*.SemanticModel` directory. If `validate_report` is available, call it and let it answer this,
along with everything else it checks.

More than one `*.Report` or `*.SemanticModel` in a directory is worth saying out loud, because
tooling tends to inspect only the first and stay quiet about the rest.

### 3. Zebra visuals available, and by which mechanism — *fail*

Read `definition/report.json` and any existing visual. Three mechanisms, and they must not be
mixed:

| | Mechanism | Where it lives |
|---|---|---|
| 1 | AppSource / public | `publicCustomVisuals: ["<GUID>"]` |
| 2 | Embedded / file-import | a `resourcePackages` entry of type `CustomVisual` |
| 3 | Organizational store | a `resourcePackages` entry of type `OrganizationalStoreCustomVisual` |

**If the report already uses Zebra visuals, copy that shape exactly.** Report which mechanism is
in use. If none is present, that is fine on a fresh report and not a failure.

Nothing needs installing: Desktop fetches an AppSource visual by GUID, even one never added.
If one comes back unresolved (*"add it to this report first"*): **restart
Desktop** first (its visual registry loads at startup), then *Get more visuals → Zebra BI → Add*;
the seed only for org-store-only tenants.

### 4. Licence state — *routed, not pass/fail*

Answered by a render: an unlicensed Zebra visual shows a **Free** footer with *"Enter license key"*.

| State | What to do |
|---|---|
| Licensed | Carry on |
| Free, user has a key | Write it into every Zebra visual, render once, strip — `references/licence-and-trial.md` |
| Free, no key | Offer the trial (UTM link; EULA and privacy links first) — same reference |

Never tick a consent box or author a key the user did not give you.

### 5. Scenario measures present — *fail*

If `profile_project` is available, call it and read `scenarios`: it pairs structurally, so
`Revenue` + `Revenue PY` counts. Without the tool, look for a measure per scenario (AC, PL, PY)
**or** a base measure with a PY, PL or FC twin. Do not fail a model for naming its actual `Revenue`.

Without a pair, no variance: `Values` and `Plan` are separate wells and need separate fields, a
single `Scenario` column cannot feed both, and every variance column ends up empty **while the page
still looks finished**. That is why this is a fail rather than a warning.

The fix is three lines of DAX and the user may prefer to write them, so offer both.

⚠️ **Presence is not correctness.** With Desktop open, check they evaluate:
`EVALUATE ROW("ac", [AC], "py", [PY])`. A broken measure still opens and still lists; it fails only
on the page, as *"Something's wrong with one or more fields"*, taking the whole visual with it. An
error is a **fail** naming the measure. Desktop closed means the check could not run, not a pass.
Needs no Node and no Bridge — recipe in the authoring skill's `references/verify-loop.md`.

### 6. Calendar marked as the date table — *fail*

The model needs a date table, marked. In TMDL that is `dataCategory: Time` on the table **plus** a
column carrying `isKey`. Both halves. Either alone does not do it.

Without it, `PreviousYear` and `Forecast` are silently meaningless: prior year equals actual, the
delta reads a flat 0.0%, and nothing on screen says so.

If a table looks like the intended calendar but is not marked, say that specifically. "There is a
Calendar and it is not marked" is a different fix from "there is no calendar".

### 7. Node.js — *capability*

`node --version`. Node 20 or later, which is what the suites run on.

Absent is not an error. It gates two optional things: our validator, and Microsoft's modelling
server. Report it as a capability and say what is unavailable because of it. **Do not install
anything and do not retry.**

### 8. The Zebra validator — *capability*

Is `validate_report` in your tool list? If yes, say so: it changes what the agent can catch
before a render.

**Report the rule count the tool returns, not a number from this page.** The catalogue grows and a
figure written here goes stale silently.

Node present but the tool missing means the server is not starting, which is a different problem
from Node being absent. Say which.

### 9. The Desktop Bridge — *capability, with a second act*

Call `application.state.get/v1` over the named pipe:

```
\\.\pipe\pbi-desktop-bridge-<PBIDesktop pid>
```

A healthy call answers in well under a second. **Time out generously and report "did not answer"
rather than "not available"**, because Desktop degrades over a long session and a tired instance
can look absent when it is not.

If it is missing, do not just report it. It is an official Microsoft preview feature, *"Enable
external tool access to Power BI Desktop through secure local APIs"*, on by default since the
June 2026 release. So: show where the setting is, ask the user to restart Desktop, then **check
again**. A check that reports a fixable state and does not offer the fix is worse than no check.

### 10. Instruction-file conflicts — *fail, and the one that can do harm*

Read the user's own instruction files, global and project. Look for anything that contradicts how
this skill works, for example a rule never to write files, or a different report convention.

**Never write to those files without explicit approval.** Show the exact change and wait. This is
the only check that can modify work that is not ours, and silently editing a user's instructions is
how a tool gets uninstalled.

## The verification tier

Derive it from checks 8 and 9 only, and state it:

| Tier | Requires | What you can verify |
|---|---|---|
| 1 | Microsoft's modelling MCP server | DAX through the supported path |
| 2 | The bridge answers | Bridge verification, about a second per round trip |
| 3 | Neither | Cold restart per page, structural checks only |

**Probe tier 1, never infer it.** `fabric-skills` and `powerbi-authoring` are separate bundles, so
a user who installed the general Fabric bundle has neither.

**Our validator is reported separately from the tier.** It changes what the agent knows while
authoring, not how the result is verified. Folding them together would tell someone their
verification improved when it did not.

**Announce a downgrade.** A tier the plugin states reads as a platform difference. A tier it
quietly drops to reads as our bug.

## Reporting

One line per check. Failures carry the fix. Then the tier, then which product is running.

```
Power BI Desktop        pass
.pbip project shape     pass
Zebra visuals           pass    AppSource GUIDs
Licence                 trial   see references/licence-and-trial.md
Scenario measures       FAIL    no AC/PL/PY measures — variance will be empty. Fix: 3 lines of DAX.
Calendar date table     FAIL    Calendar exists, not marked. Add dataCategory: Time + isKey.
Node.js                 pass    v22.22.3
Zebra validator         pass    59 rules
Desktop Bridge          pass    answered in 0.2s

Tier 2. Validator running.
Two model faults will make every variance column meaningless. Fix those first.
```

Keep a short record of the outcome so support can read it later: which checks passed and failed,
the plugin version, the tier, and whether the validator was running. **No report content and no
file paths outside the project.**

## Two rules for the whole run

**Do not claim what you did not check.** If a check could not run, say it could not run. "Pass"
and "not looked at" are different answers, and conflating them is how a doctor becomes something
people skip.

**Re-run after any change.** The answer moves when the user installs Node or enables the preview
feature, which is why this is a skill you can call by name rather than only an install gate.
