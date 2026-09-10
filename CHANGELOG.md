# Changelog

What changed, and what is known to be wrong. Dates are the day the work landed, not the day it was
written up.

This file starts at the first public release. Versions before it exist in the git history and were
never published — the repository was private, with no tags and no releases — so listing them as
though they shipped would misrepresent what anyone could have installed.

## 0.3.0 — 2026-09-10, the first public release

Preview. It works, it is used daily inside Zebra BI, and it is new enough that the most useful
thing you can do is tell us when it does not.

### What you get

| | |
|---|---|
| **`setup-doctor`** | Ten checks on the machine, each with a fix. Two are about your model — scenario measures and a marked date table — and they are the ones that decide whether the report comes out right |
| **`report-authoring`** | Planning, data binding, IBCS variance semantics, formatting, small multiples, comments, and page layouts proven against real Zebra BI templates |
| **`report-publishing`** | The Zebra-specific parts of publishing. Microsoft's own skill does the upload; this covers the visual-track choice and the refresh without which the report arrives empty |
| **The checker** | 59 rules over an unopened `.pbip`. Optional — needs Node.js, no dependencies to install |
| **18 MCP tools** | Profiling, page proposal, the encoders for the property blobs that cannot be written by hand, and the report writers |

Ten on-demand reference layers sit behind the authoring skill and load only when they are needed:
the analyst layer (what to ask before writing anything), DAX, design, formatting, the model layer,
pre-flight, recipes, TMDL, the verify loop, and the visual property reference.

### Recent work, most consequential first

- **Licences activate from the report file.** Paste your key into the chat; the agent writes it
  into the visuals for one render and strips it again. Nothing to type in Power BI Desktop, and
  the entitlement persists on the machine afterwards.
- **AppSource visuals resolve by GUID with no prior install.** A report that names the Zebra BI
  visuals renders on a machine that has never added them.
- **The analyst layer.** The skill now frames the brief before it writes — reader, decision,
  period, comparison, fiscal-year convention — instead of building first and asking later. With
  `profile_source` it does the same for a flat file.
- **The DAX layer and a batch oracle**, after a broken measure was found to take the whole visual
  down with it and the doctor's model check was found to test the wrong thing.
- **The design layer** — which visual form carries which message, sizing, zero baselines, one
  scale per unit, sorting, titles and colour.
- **TMDL as a measured grammar.** ~130 variants against Power BI Desktop 2.157, and fourteen
  validator rules built on a real parser.
- **Calculation groups, drill and drillthrough**; view-mode comments; per-category scenarios;
  chart-in-column tables.
- **Installs on GitHub Copilot CLI** with the same two commands (`copilot plugin marketplace add`,
  `copilot plugin install`). Two things were in the way and are fixed: the marketplace file carried
  a `pluginRoot` that Copilot applied twice, and the authoring skill's description exceeded the open
  standard's 1024-character cap, so spec-strict hosts loaded two skills of three. Install verified;
  authoring on Copilot is not, see *Not verified*.

### Known issues

**An agent-written Cards visual has crashed Power BI Desktop's serializer, once.** Editing that
visual's formatting by hand in Desktop threw
`TypeError: Cannot read properties of null (reading 'gradient')` in `serializeVisualContainerConfig`
and the report would not render. Observed once, on Desktop 2.156.951.0, on 2026-08-12.

It matters more than one observation usually would, because of *where* it surfaces: the file is
written by the agent and the crash appears only when a person later edits that visual — after
handover, on the reviewer's machine.

**It is not diagnosed, and we are not going to guess in public.** One thing is certain from the
error text: the value the serializer read was literally `null`. Beyond that the cause is open — an
earlier hypothesis of ours was checked against the saved files and did not survive them.

It is also **not established that this is specific to agent-written reports.** The layout structure
involved is written into the file by Power BI Desktop itself on save, so if you hit this on a Cards
visual you built by hand, we want to hear that just as much.

*If you hit it:* the report is not lost — the `.pbip` on disk is intact and reopening the project
recovers it. Please [open an issue](https://github.com/zebrabi/zebra-bi-agentic/issues/new/choose) and
attach the visual's `visual.json`; that file is the one thing we cannot reconstruct, and it is what
would turn one observation into something the checker can enforce.

### Not verified

Stated so you know which claims we have earned and which we are extending on reasonable grounds.

- **Hosts other than Claude Code.** The skills are plain Markdown and the checker is a plain stdio
  MCP server — verified to start, speak MCP `2025-06-18` and list its tools with no dependencies —
  but **no report has been authored end to end on Codex, Cursor, Gemini CLI or Copilot CLI.** See
  [`INSTALL.md`](INSTALL.md).
- **View-mode commenting by a report viewer.** The agent can configure it; nobody has tested a
  viewer using it.
- **Unlicensed tenants replace comment bodies** with an upgrade prompt in the Power BI service.
  Seen once, on one tenant, and *the licensed control has not been run* — so it is recorded here
  rather than stated as behaviour.

### What it cannot do

Unchanged from [`README.md`](README.md) and worth repeating: it reads your report files, not your
data, so it cannot tell you a number is wrong. It cannot see the rendered page. It is Windows-only
in practice, because Power BI Desktop is. And it cannot tell whether two periods are comparable —
if your actuals stop in April and last year runs to December, every variance on the page is wrong
and nothing in the files says so.

## Before 0.3.0

Internal only, 2026-08-03 to 2026-09-06, `0.1.0` through `0.2.16`. Never tagged, never released,
never installable outside Zebra BI. The arc, for anyone reading the history:

| | |
|---|---|
| `0.1.0`–`0.1.4` | The plugin generated from an internal source; the model reader; the encoders; the first run against a real project, which cut 19 false positives |
| `0.2.0`–`0.2.5` | The setup doctor, the README, and five passes of a full read-through gate |
| `0.2.6`–`0.2.13` | Seven rules retired or gated after they fired on shipped reference templates — including a retraction, on the principle that a census cannot overrule a render |
| `0.2.14` | CI on every push, which immediately found a contradiction in our own prose |
| `0.2.15` | The doctor's model check tests evaluation rather than presence; rule messages carry the symptom |
| `0.2.16` | Licence activation from the file; registration settled; the trial link tagged |

---

Zebra BI · https://zebrabi.com · support@zebrabi.com
