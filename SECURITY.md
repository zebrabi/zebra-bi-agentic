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

**1. Zebra BI licence information appears in report files.** Zebra BI visuals store licence
information in each visual's `objects` (`licenseSettings`; Cards also `license`) and in Power BI
Desktop's local storage. That is normal. Leave it in place: removing it can make a visual render
unlicensed on a machine whose local storage does not hold the entitlement.

**2. The disclosure boundary is enforced in a repository you cannot see.** The authoring skill is
generated, and the checks that decide what ships run in the generator. CI here checks that the
shipped bundle matches the checksums committed beside it in `.bundle-sha256`, and that no file was
added to it. That catches a hand-edit made without a matching checksum update. It cannot show that
the bundle came from the generator: the checksum file lives in this repository, so one commit can
change a skill file and its checksum together and still pass. Review is the intended control for
such a commit: a change to `main` needs an approval from someone other than its author, which
repository administrators can override. CI also cannot re-run the boundary checks themselves.
This is stated in `AGENTS.md` as well. If you find
internal material in the published bundle, that **is** a defect worth reporting. Email us rather
than filing it publicly.

**3. A licence key pasted into the chat stays in the conversation history, like anything else in
the chat.**

## Scope

In scope: anything in this repository — the MCP server, the skills, the workflow, the gates.

Out of scope: the Zebra BI visuals themselves and the Zebra BI service. Report those through
https://zebrabi.com or your usual support channel.
