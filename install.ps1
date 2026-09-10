<#
.SYNOPSIS
    Install the Zebra BI agent skills for any agent that reads an open-standard skills folder.

.DESCRIPTION
    Copies the three skill folders (report-authoring, report-publishing, setup-doctor) into your
    agent's skills directory, then prints the MCP configuration for the optional checker with the
    absolute path already filled in.

    This is route 2 in INSTALL.md. Claude Code users do not need it -- use the two marketplace
    commands in README.md instead, which also register the checker automatically.

    Needs nothing but the PowerShell that ships with Windows. No git, no Node, no admin rights.
    Node is needed only to RUN the checker, not to install anything.

.PARAMETER Destination
    Where to put the skills. Defaults to ~\.agents\skills, which is what Codex and GitHub Copilot
    CLI read. Other hosts use other paths -- see your host's documentation.

.PARAMETER SkipMcpInstructions
    Copy the skills and say nothing about the checker.

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -Destination "$HOME\.cursor\skills"

.EXAMPLE
    .\install.ps1 -WhatIf
    Shows what would be copied and writes nothing.

.LINK
    https://github.com/zebrabi/zebra-bi-agentic
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $Destination = (Join-Path $HOME ".agents\skills"),
    [switch] $SkipMcpInstructions
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$SkillNames = @("report-authoring", "report-publishing", "setup-doctor")

function Write-Step {
    param([string] $Message)
    Write-Host ""
    Write-Host $Message -ForegroundColor Cyan
}

# A refusal has to READ like one. Write-Error under $ErrorActionPreference = "Stop" throws, so the
# message the user needs arrives wrapped in a stack trace pointing at the caller's line -- which is
# how an actionable "you are in the wrong folder" becomes "PowerShell broke". Say it plainly and
# exit with a code instead.
function Stop-WithMessage {
    param([string] $Message)
    Write-Host ""
    foreach ($line in ($Message -split "`n")) {
        Write-Host $line -ForegroundColor Red
    }
    Write-Host ""
    exit 1
}

# --- Locate the bundle ------------------------------------------------------------------------
# A git clone keeps the repository layout; an extracted release zip may hold the plugin directly.
# Try both rather than assuming, so the same script serves route 2 and route 3.

$candidates = @(
    (Join-Path $PSScriptRoot "plugins\zebra-bi"),
    $PSScriptRoot
)

$pluginRoot = $null
foreach ($candidate in $candidates) {
    if (Test-Path (Join-Path $candidate "skills")) {
        $pluginRoot = $candidate
        break
    }
}

if ($null -eq $pluginRoot) {
    Stop-WithMessage @"
Could not find the Zebra BI bundle next to this script.

Looked for a 'skills' folder in:
  $($candidates -join "`n  ")

Run install.ps1 from the folder you cloned or extracted, not from somewhere else. If you copied
the script out on its own, copy it back -- it installs the files that sit beside it.
"@
}

$sourceSkills = Join-Path $pluginRoot "skills"

# Refuse a partial bundle rather than laying down an install that is missing a skill. A doctor
# that is not there reads to the user as "the product does not work", with nothing to point at.
$missing = @()
foreach ($name in $SkillNames) {
    if (-not (Test-Path (Join-Path $sourceSkills $name))) { $missing += $name }
}
if ($missing.Count -gt 0) {
    Stop-WithMessage @"
The bundle at
  $sourceSkills
is incomplete -- missing: $($missing -join ", ")

Nothing was installed. Re-clone or re-download rather than installing part of it.
"@
}

# --- Report what we found ---------------------------------------------------------------------

$version = "unknown"
$manifest = Join-Path $pluginRoot ".claude-plugin\plugin.json"
if (Test-Path $manifest) {
    try {
        $version = (Get-Content $manifest -Raw | ConvertFrom-Json).version
    } catch {
        # A manifest we cannot parse is worth saying nothing about, not worth failing over --
        # the skills are the product and they copy fine either way.
        $version = "unreadable"
    }
}

Write-Host ""
Write-Host "Zebra BI agent skills" -ForegroundColor White
Write-Host "  version:     $version"
Write-Host "  source:      $sourceSkills"
Write-Host "  destination: $Destination"

# --- Copy -----------------------------------------------------------------------------------

Write-Step "Installing skills"

if (-not (Test-Path $Destination)) {
    if ($PSCmdlet.ShouldProcess($Destination, "Create directory")) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }
}

foreach ($name in $SkillNames) {
    $from = Join-Path $sourceSkills $name
    $to = Join-Path $Destination $name

    if ($PSCmdlet.ShouldProcess($to, "Install $name")) {
        # Remove first so a skill that dropped a reference file in a new version does not keep
        # the stale one. Copy-Item -Force merges; it does not replace.
        if (Test-Path $to) { Remove-Item -Recurse -Force $to }
        Copy-Item -Recurse -Force $from $to

        $fileCount = (Get-ChildItem -Recurse -File $to | Measure-Object).Count
        Write-Host ("  {0,-20} {1} files" -f $name, $fileCount) -ForegroundColor Green
    } else {
        Write-Host ("  {0,-20} would install" -f $name)
    }
}

if ($WhatIfPreference) {
    Write-Host ""
    Write-Host "-WhatIf: nothing was written." -ForegroundColor Yellow
    exit 0
}

# --- The checker ------------------------------------------------------------------------------

if (-not $SkipMcpInstructions) {
    $serverPath = Join-Path $pluginRoot "mcp\server.js"
    $jsonPath = $serverPath -replace '\\', '\\'

    Write-Step "The checker (optional)"

    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $node) {
        Write-Host "  Node.js is not on PATH, so the checker will not run." -ForegroundColor Yellow
        Write-Host "  Everything else works without it -- you get a smaller product, not a broken one."
        Write-Host "  To add it later: https://nodejs.org, then re-read this section."
    } else {
        Write-Host "  Node found: $($node.Source)" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "  Add this to your host's MCP configuration. There is nothing to install first --"
    Write-Host "  the server has no dependencies."
    Write-Host ""
    Write-Host "  JSON hosts (Cursor ~\.cursor\mcp.json, Gemini CLI ~\.gemini\settings.json):" -ForegroundColor White
    Write-Host @"

  {
    "mcpServers": {
      "zebra-bi": {
        "command": "node",
        "args": ["$jsonPath"]
      }
    }
  }
"@
    Write-Host "  TOML hosts (Codex ~\.codex\config.toml):" -ForegroundColor White
    Write-Host @"

  [mcp_servers.zebra-bi]
  command = "node"
  args = ["$jsonPath"]
"@
    Write-Host "  Your host's own documentation names the file; those paths change more often"
    Write-Host "  than the server does."
}

# --- Done -------------------------------------------------------------------------------------

Write-Step "Done"
Write-Host "  Restart your agent, then ask it to run the setup-doctor skill."
Write-Host "  It reports what this machine can do and what is missing."
Write-Host ""
Write-Host "  Full instructions: INSTALL.md"
Write-Host "  Problems:          https://github.com/zebrabi/zebra-bi-agentic/issues/new/choose"
Write-Host ""
