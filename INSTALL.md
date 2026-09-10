# Installing

[`README.md`](README.md) gives the two commands for Claude Code. This file is for everything else:
other agents, machines without git, private-preview access, and what to do when the install does
not take.

**Before anything here works you still need Windows with Power BI Desktop and a Zebra BI licence
on the machine.** Those are in the README under *Before you start* and no install route changes
them.

## Which route is yours

| You use | Route | State |
|---|---|---|
| Claude Code — terminal, desktop app, VS Code or JetBrains | **[1. Marketplace](#1-claude-code-marketplace)** | Works. This is the supported route |
| GitHub Copilot CLI | **[1b. Copilot CLI](#1b-github-copilot-cli)** | The same marketplace, two commands. Install verified; **no report authored on it yet** |
| Codex, Cursor, Gemini CLI, OpenCode, Kiro, or anything else that reads agent skills | **[2. Skills folder](#2-the-skills-folder-any-other-agent)** | The skills are plain Markdown and the checker is a plain stdio MCP server, so they load. **We have not run a report end to end on any of these hosts** |
| A machine with no git, or a locked-down build | **[3. Release zip](#3-release-zip-no-git)** | Same bytes, downloaded instead of cloned |

There is one bundle. Every route installs the same files; none of them is a cut-down version.

## 1. Claude Code (marketplace)

```
/plugin marketplace add zebrabi/zebra-bi-agentic
/plugin install zebra-bi@zebra-bi-collection
```

Restart Claude Code. Then run `/zebra-bi:setup-doctor`.

This is the only route where the checker configures itself — installing the plugin registers the
MCP server, so there is no config file to edit.

**If the first command fails**, it is nearly always the network rather than the plugin. Run
`git clone https://github.com/zebrabi/zebra-bi-agentic` by hand; the error you get there is the real
one. A corporate proxy that rewrites certificates is the usual culprit.

## 1b. GitHub Copilot CLI

Copilot CLI reads the same marketplace file, so it is the same two commands with a different
prefix:

```
copilot plugin marketplace add zebrabi/zebra-bi-agentic
copilot plugin install zebra-bi@zebra-bi-collection
```

Then start Copilot and ask for the skill by name: *"use the setup-doctor skill"*. Copilot lists
the three skills under `copilot skill list`. The MCP checker is not registered by this route;
add it with `copilot mcp add` using the `node … mcp/server.js` command from route 2, or skip it.

**What is verified:** both commands complete and all three skills load (Copilot CLI 1.0.83,
2026-09-06). **What is not:** a report authored end to end on Copilot — the account we tested with
sits in an organisation whose Copilot policy blocks the CLI, so the install is as far as we got.
If your organisation allows it, you are further than we are; tell us what happened.

## 2. The skills folder (any other agent)

Two halves, and the first one is enough to be useful.

**Half one — the skills.** Copy the three skill folders into the open-standard location your agent
reads. Codex and GitHub Copilot CLI both read `~/.agents/skills`; other hosts vary, and your host's
documentation names its own path.

```powershell
.\install.ps1
```

The script is in this repository, needs nothing but in-box PowerShell — no git, no Node — and by
default copies to `~\.agents\skills`. `-Destination <path>` puts them somewhere else,
`-WhatIf` shows you what it would do and writes nothing. It refuses to run if the source folders
are missing rather than creating an empty install.

By hand, if you would rather see it:

```powershell
Copy-Item -Recurse -Force .\plugins\zebra-bi\skills\* $HOME\.agents\skills\
```

That gives you `report-authoring`, `report-publishing` and `setup-doctor`. The agent reads them the
way Claude Code does.

**Half two — the checker.** Optional, and it needs [Node.js](https://nodejs.org). The MCP server is
a single stdio process with **no dependencies and nothing to install** — there is no `package.json`
in this repository and no `npm install` step:

```
node <this repo>\plugins\zebra-bi\mcp\server.js
```

Point your host's MCP configuration at exactly that. The shape differs per host but the contents do
not:

```jsonc
// Cursor (~/.cursor/mcp.json), Gemini CLI (~/.gemini/settings.json), and most JSON-configured hosts
{
  "mcpServers": {
    "zebra-bi": {
      "command": "node",
      "args": ["C:\\path\\to\\zebra-bi-agentic\\plugins\\zebra-bi\\mcp\\server.js"]
    }
  }
}
```

```toml
# Codex (~/.codex/config.toml)
[mcp_servers.zebra-bi]
command = "node"
args = ["C:\\path\\to\\zebra-bi-agentic\\plugins\\zebra-bi\\mcp\\server.js"]
```

`install.ps1` prints both blocks with the absolute path already filled in, so you can paste rather
than retype. **Use the absolute path** — a relative one resolves against whatever directory the
host happened to start in.

Check your host's own MCP documentation for the file location; those change more often than the
server does.

### What we have and have not run

**Verified:** the server starts under Node 24 with no dependencies, answers MCP protocol
`2025-06-18`, and lists its 18 tools. That is the interface every host in this row talks to, and it
is host-independent.

**Not verified:** a full report authored end to end on Codex, Cursor, Gemini CLI, Copilot CLI or
any other host. The skills are Markdown with no Claude-specific syntax in the bodies, so we expect
them to work, and *expect* is the right word until somebody runs one. If you do, please
[open an issue](https://github.com/zebrabi/zebra-bi-agentic/issues/new/choose) telling us which host
and what broke — that is a more useful report than almost anything else you could send.

Two Claude Code conveniences do **not** travel: the `/zebra-bi:` slash commands (ask for the skill
by name instead — *"use the setup-doctor skill"*) and automatic MCP registration.

## 3. Release zip (no git)

Every tagged release attaches the bundle as a zip with its checksum in the notes.

```powershell
# Download the zip from the Releases page, then:
Expand-Archive .\zebra-bi-<version>.zip -DestinationPath $HOME\zebra-bi
cd $HOME\zebra-bi
.\install.ps1
```

Verify it is the file we published before you trust it:

```powershell
Get-FileHash .\zebra-bi-<version>.zip -Algorithm SHA256
```

Compare against the checksum in the release notes. In-box cmdlet, no download needed.

For Claude Code specifically, a local clone works as a marketplace too:

```
/plugin marketplace add C:\path\to\zebra-bi-agentic
/plugin install zebra-bi@zebra-bi-collection
```

## 4. When the marketplace command cannot see the repository

If `/plugin marketplace add zebrabi/zebra-bi-agentic` reports that the repository does not exist,
work through these in order. The error is the same for all three causes, which is what makes it
confusing.

**Try the HTTPS URL instead of the shorthand.** The `owner/repo` short form can resolve over SSH,
which needs a key you may not have:

```
/plugin marketplace add https://github.com/zebrabi/zebra-bi-agentic.git
```

**Check you can reach it at all.** Run `git clone https://github.com/zebrabi/zebra-bi-agentic` by
hand. That gives you the real error rather than the plugin system's summary of it — usually a
proxy, a certificate, or credentials.

**If you were given access as a named account**, make sure you accepted the GitHub invitation
first, and that the account you accepted with is the one your machine's git is signed in as.
Until both are true the repository is invisible to you, and the command says so in the least
helpful way available.

Git Credential Manager handles the browser sign-in on first use. If you are never prompted, a
manual `git clone` once will cache the credentials.

## Check it worked

```
/zebra-bi:setup-doctor
```

or, on any other host, *"run the setup-doctor skill"*.

The doctor is the install test. It reports Power BI Desktop, your project, the visuals, your
licence, your model and what it can verify — and it tells you **which product you are running**,
with the checker or without. If it names the checker as absent and you configured it, the MCP
registration did not take; that is the thing to fix, and everything else still works meanwhile.

If the doctor itself will not start, the skills did not land. Check the files are where you put
them and that you restarted the agent.

## Updating

| Route | How |
|---|---|
| Marketplace | `/plugin update zebra-bi@zebra-bi-collection` |
| Skills folder | Pull or download the new version and run `install.ps1` again — it overwrites |
| Release zip | Download the new zip, re-extract, re-run `install.ps1` |

The skills folder route has **no auto-update**. Nothing tells you a version shipped, so check the
[releases page](https://github.com/zebrabi/zebra-bi-agentic/releases) occasionally.

## Uninstalling

```
/plugin uninstall zebra-bi@zebra-bi-collection
```

For the skills folder, delete the three folders you copied:

```powershell
Remove-Item -Recurse $HOME\.agents\skills\report-authoring, `
                     $HOME\.agents\skills\report-publishing, `
                     $HOME\.agents\skills\setup-doctor
```

Then remove the `zebra-bi` entry from your host's MCP configuration.

Nothing is installed outside these locations: no service, no registry keys, no PATH changes, and
no files in your Power BI installation. Removing the folders removes the product.

## When the install is the problem

[Open an issue](https://github.com/zebrabi/zebra-bi-agentic/issues/new/choose) — there is a template
for install and setup problems. Tell us the host, the route you took, and the exact error. If the
doctor ran at all, its output is the single most useful thing to paste.

For anything about your licence or your account, email **support@zebrabi.com** instead.

---

Zebra BI · https://zebrabi.com · support@zebrabi.com
