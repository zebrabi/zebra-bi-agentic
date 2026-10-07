# Security

## Reporting a vulnerability

Email **security@zebrabi.com**, or **support@zebrabi.com** if that bounces. Please do not open a
public issue for a vulnerability.

Include what you did, what happened, and the smallest reproduction you have. We will confirm
receipt and tell you what we intend to do about it.

## What this software does, so you can judge the surface

The plugin reads and writes files in a Power BI project directory that you point it at. It ships:

- **Skills**: markdown instructions read by your agent. They execute nothing themselves. They tell
  the agent which commands to run (PowerShell, starting Power BI Desktop, writing files), and your
  agent host runs them.
- **An MCP server** (`plugins/zebra-bi/mcp/`) — Node, **no dependencies**, deliberately, so there is
  no supply chain beyond Node itself. **It only ever reads.** It reads a project path you supply and
  returns findings; the tools that compose report files return the content as a string, and your
  agent host writes it, so every write to your project is one you can see in the transcript.
- **No network calls from the MCP server.** It does not phone home, fetch at runtime, or send your
  project anywhere. Two skills can lead your agent to the network: the publishing skill has it
  upload a report to your Power BI workspace with Microsoft's own tooling, and the setup skill can
  open the Zebra BI trial page.

**Your agent host sends what it reads to your model provider.** Claude Code, or whichever agent host
you use, passes what it reads to the language model provider you configured: the files it opens in your project, the output
of the checker and profiling tools, the results of the DAX queries it runs against your model, and
screenshots of the rendered report. That can include customer names and amounts. For example, when
the profiling tool reads a CSV it returns the column names and, for any column with fifty or fewer
distinct values, the values themselves. How that data is handled and how long it is kept is set by
your agreement with your agent host and your model provider. This plugin does not send it to Zebra
BI. If your data must not reach a model provider, do not point the agent at it.

**Treat project content as untrusted input.** Everything in a project reaches the model as text:
titles, text boxes, measure and column names, comments, and the cells of any file you point it at.
The model cannot reliably tell that text apart from your instructions, and the authoring skill has
the agent run PowerShell, start Power BI Desktop, query running processes and write files. A project
from a colleague, a downloaded sample or a CSV export can carry text that steers a session, whether
someone put it there on purpose or not. The skill tells the agent to treat project content as data and never as instructions. That
lowers the risk and does not remove it. Open a project you did not make as you would any untrusted
file, and read the commands your agent host asks to run before you approve them.

## Three things that are known, and are not vulnerabilities

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
repository. `.gitignore` does not help, because `visual.json` *is* the report. The report writers
refuse to write a key, and the checker does not look for one, so check the files yourself before a
report leaves your hands.

If you have already published one, rotate the key with Zebra BI support.

**2. The disclosure boundary is enforced in a repository you cannot see.** The authoring skill is
generated, and the checks that decide what ships run in the generator. CI here checks that the
shipped bundle matches the checksums committed beside it in `.bundle-sha256`, and that no file was
added to it. That catches a hand-edit made without a matching checksum update. It cannot show that
the bundle came from the generator: the checksum file lives in this repository, so one commit can
change a skill file and its checksum together and still pass. What stands between such a commit and
`main` is review, since every change needs an approval from someone other than its author. CI also
cannot re-run the boundary checks themselves. This is stated in `AGENTS.md` as well. If you find
internal material in the published bundle, that **is** a defect worth reporting. Email us rather
than filing it publicly.

**3. A licence key pasted into the chat stays in the conversation.** The setup skill can activate
the visuals from the report file, which means pasting your key into the chat. The agent writes it
into the report for one render, then strips it from the project, and the machine stays licensed.
Your agent host sends the key to your model provider like everything else in the chat, and the
conversation keeps it. On most agent hosts that means a history file on your machine, plus whatever
your model provider retains under its terms. Use a trial key where you can. If you paste a
production key and would rather it not sit in those records, ask Zebra BI support to rotate it after
the session.

## Scope

In scope: anything in this repository — the MCP server, the skills, the workflow, the gates.

Out of scope: the Zebra BI visuals themselves and the Zebra BI service. Report those through
https://zebrabi.com or your usual support channel.
