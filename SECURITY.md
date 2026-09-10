# Security

## Reporting a vulnerability

Email **security@zebrabi.com**, or **support@zebrabi.com** if that bounces. Please do not open a
public issue for a vulnerability.

Include what you did, what happened, and the smallest reproduction you have. We will confirm
receipt and tell you what we intend to do about it.

## What this software does, so you can judge the surface

The plugin reads and writes files in a Power BI project directory that you point it at. It ships:

- **A skill** — markdown instructions read by Claude Code. No execution of its own.
- **An MCP server** (`plugins/zebra-bi/mcp/`) — Node, **no dependencies**, deliberately, so there is
  no supply chain beyond Node itself. **It only ever reads.** It reads a project path you supply and
  returns findings; the tools that compose report files return the content as a string, and Claude
  Code writes it, so every write to your project is one you can see in the transcript.
- **No network calls.** Nothing in this repository phones home, fetches at runtime, or transmits
  your project anywhere.

## Two things that are known, and are not vulnerabilities

Reported often enough to be worth stating plainly.

**1. Saving a report in Power BI Desktop writes your Zebra BI licence key into it.** The key sits in
each Zebra visual's `visual.json` that has rendered, comes back out with no credential of any kind,
and names the licensee, the seat count, the tier and the expiry date.

It is written under **two different object names**: Charts and Tables use `licenseSettings`, Cards
uses `license`. If you scrub by hand, clear both. Clearing one and looking again is how a report
that still carries a key reads as clean.

This is how Power BI report files have always behaved — a `.pbix` does the same — and it is not
caused by this plugin, which never authors a key. It is a **sharing** consideration: strip or
exclude a generated report before it leaves your organisation, and never commit one to a public
repository. `.gitignore` does not help, because `visual.json` *is* the report. The checker flags a
key if it finds one, without printing it.

If you have already published one, rotate the key with Zebra BI support.

**2. The disclosure boundary is enforced in a repository you cannot see.** The authoring skill is
generated, and the checks that decide what ships run in the generator. CI here proves the shipped
bundle is byte-for-byte what a boundary-checked build produced; it cannot re-run the boundary
itself. This is stated in `AGENTS.md` as well. If you find internal material in the published
bundle, that **is** a defect worth reporting — email rather than filing publicly.

## Scope

In scope: anything in this repository — the MCP server, the skills, the workflow, the gates.

Out of scope: the Zebra BI visuals themselves and the Zebra BI service. Report those through
https://zebrabi.com or your usual support channel.
