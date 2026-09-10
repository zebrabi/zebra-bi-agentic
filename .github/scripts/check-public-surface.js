#!/usr/bin/env node
"use strict";

// The authored half of this repository has never been checked by anything.
//
// The generated bundle under `plugins/zebra-bi/skills/report-authoring/` goes through the
// generator's disclosure checks, and `.bundle-sha256` proves the shipped copy is what those checks
// produced. Everything else -- README.md, AGENTS.md, CONTRIBUTING.md, SECURITY.md, perf/, mcp/,
// the workflow, the issue forms -- is written by hand straight into a public repository. AGENTS.md
// has said so in its own gate-A9 procedure ("no build check has ever looked at them") and left it
// as a thing a person is supposed to remember. This is that check.
//
// WHAT IT DOES NOT DO, and why. It is NOT a denylist of internal names. The generator keeps one and
// keeps it private for a good reason: a list of the strings you are protecting names the things you
// are protecting, so publishing it here would be the leak it exists to prevent. Two checks instead,
// neither of which names a secret:
//
//   1. EVERY FILE PATH CITED IN PROSE RESOLVES IN THIS REPOSITORY. This is the general form of the
//      fault that shipped in v0.2.14: `references/model-layer.md` sent a customer to
//      `tools/render-loop/Test-RelationshipHang.ps1`, which exists only in the private hub. An
//      instruction pointing at a file the reader cannot open is broken for a customer AND is how
//      an internal path reaches a public repository -- one check catches both, and it catches the
//      next internal path without having been told its name.
//
//   2. NO PRIVATE-AUDIENCE FRAMING. A small list of phrases that are about WHO IS READING rather
//      than about anything secret: "the repository is private", "internal use only", and so on.
//      Publishing these is not a leak, it is just wrong once the repository is public, and it goes
//      stale silently because nobody re-reads a README after the thing it describes has changed.
//
// Run: node .github/scripts/check-public-surface.js
//      ZBI_SURFACE_ROOT=<dir> node .github/scripts/check-public-surface.js   (to watch it fail)

const fs = require("fs");
const path = require("path");

// Built rather than written: a backslash in a regex literal is the one character this file
// cannot carry safely through every editor and shell that touches it.
const BSLASH = String.fromCharCode(92);
const toPosix = (s) => s.split(BSLASH).join("/");

const ROOT = process.env.ZBI_SURFACE_ROOT
  ? path.resolve(process.env.ZBI_SURFACE_ROOT)
  : path.resolve(__dirname, "..", "..");

// The generated bundle is the generator's job, not this one's. Checking it here would duplicate a
// stronger check and would go red for reasons the person reading this output cannot fix.
const GENERATED = path.join("plugins", "zebra-bi", "skills", "report-authoring");

/** Phrases that describe a private audience. Not secrets -- statements that stop being true. */
const AUDIENCE = [
  { re: /\bthe repository is private\b/i, why: "the repository is public" },
  { re: /\bwhile (this|the) (repo|repository) is private\b/i, why: "the repository is public" },
  { re: /\bnothing here is announced publicly\b/i, why: "it is announced" },
  { re: /\binternal use only\b/i, why: "this repository is not internal" },
  { re: /\bnot (yet )?(for|reviewed by) (public|legal)/i, why: "a public repository cannot ship an unreviewed statement of its own status" },
  { re: /\bearly release for .*\bcolleagues\b/i, why: "the audience is no longer colleagues" },
  { re: /\bping (Luka|the team) (for|to get) access\b/i, why: "no access step exists any more" },
  { re: /\bnine org teams\b|\b56 (distinct )?people\b/i, why: "an access list is meaningless once public" },
  // Added 2026-09-05. Two classes that are not secrets and not about access, but about WHO IS
  // WRITING: the vendor speaking in the first person about its own catalogue, and a colleague's
  // decision cited by name. Both read to a customer as a note we left ourselves, and 18 sites of
  // the two were in the authored half when this was added. The name class is written as a SHAPE
  // (a capitalised possessive before a decision noun), not as a list of names -- a list of
  // colleagues in a public file would be the leak it exists to catch.
  { re: /\b(?:templates?|reports?) (?:we|Zebra BI) sells?\b|\bwe sell\b/i, why: "first-person sales framing; say 'reference template' or 'shipped template'" },
  { re: /\b[A-Z][a-z]+'s (?:instruction|approval|revert|retraction|call|decision)\b/, why: "a colleague's decision cited by name; name the role, not the person" },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}


// --- self-test ---------------------------------------------------------------------------
//
// `--self-test` plants each fault in a throwaway tree and asserts the gate refuses it, then plants
// the corrected form and asserts it passes. A gate that has only ever been seen to pass is
// indistinguishable from a gate that reads nothing, and this repository has already shipped one
// check whose regex could not match the fault it named. CI runs this before the real pass.
function selfTest() {
  const os = require("os");
  const cases = [
    ["a cited script the repo does not ship",
     { "README.md": "Run `Rank-Questions.ps1` to score the dimensions.\n" }, true],
    ["a cited script the repo DOES ship",
     { "README.md": "Run `helper.ps1` first.\n", "helper.ps1": "" }, false],
    ["private-audience framing",
     { "README.md": "While the repository is private you will need access.\n" }, true],
    ["the same sentence without it",
     { "README.md": "The plugin installs from the marketplace.\n" }, false],
    ["a customer-owned path is NOT judged",
     { "README.md": "Read `definition/report.json` in your own project.\n" }, false],
    // The rot half. AGENTS.md is PRESENT but no longer carries the citation the list exempts, so
    // the entry is dead and has to be reported. The case below, where AGENTS.md is absent
    // entirely, must stay silent -- that pair is the whole discrimination.
    ["a dead exemption is reported",
     { "AGENTS.md": "Nothing here cites anything.\n" }, true],
    ["an exemption whose file is absent is NOT reported",
     { "README.md": "Nothing here cites anything.\n" }, false],
    // A citation carrying a DIRECTORY must match a real path. Basename-only matching passed this
    // because some `server.js` exists somewhere in the tree, which is the v0.2.14 fault exactly.
    ["a cited path whose directory does not exist",
     { "README.md": "See `tools/render-loop/server.js` for the harness.\n", "server.js": "" }, true],
    ["the same path, actually present",
     { "README.md": "See `tools/render-loop/server.js`.\n", "tools/render-loop/server.js": "" }, false],
    // A cited path may be written relative to anywhere in the repo, so a real tail still resolves.
    ["a cited path written relative to its own directory",
     { "README.md": "See `references/model-layer.md`.\n", "a/b/references/model-layer.md": "" }, false],
    // The held internal reference: an `.md` citation that resolves nowhere. Invisible until today.
    ["a cited markdown file the repository does not ship",
     { "README.md": "The rule's evidence is in `held-notes.md`.\n" }, true],
    // The two 2026-09-05 framing classes. README.md and not AGENTS.md as the carrier, because a
    // planted AGENTS.md without the `build.js` citation also trips the rot check, and a case that
    // fails for the wrong reason proves nothing.
    ["first-person sales framing",
     { "README.md": "It fired on three templates we sell.\n" }, true],
    ["a colleague's decision cited by name",
     { "README.md": "Removed on Priya's instruction.\n" }, true],
    ["the same decision cited by role",
     { "README.md": "Removed on the product owner's instruction.\n" }, false],
  ];
  let failed = 0;
  for (const [name, files, shouldFail] of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zbi-surface-"));
    for (const [rel, body] of Object.entries(files)) {
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
    const r = require("child_process").spawnSync(
      process.execPath, [__filename], { env: { ...process.env, ZBI_SURFACE_ROOT: dir }, encoding: "utf8" });
    const didFail = r.status !== 0;
    const ok = didFail === shouldFail;
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name} — ${shouldFail ? "must be refused" : "must pass"}`
      + (ok ? "" : `, but exit was ${r.status}`));
  }
  console.log(`\n${cases.length - failed}/${cases.length} self-test(s) passed`);
  process.exit(failed ? 1 : 0);
}
if (process.argv.includes("--self-test")) selfTest();

const all = walk(ROOT);
// A gate that reads nothing is indistinguishable from a gate that passes, which is the sentence
// this file opens with -- and `ZBI_SURFACE_ROOT=/somewhere-empty` used to print "0 authored
// file(s) read ... ok" and exit 0. Both ZBI_RULES gates fail closed on empty input and echo the
// override in their header; this one did neither. Corrected 2026-08-31.
if (process.env.ZBI_SURFACE_ROOT) {
  console.log(`  (reading ZBI_SURFACE_ROOT=${process.env.ZBI_SURFACE_ROOT})`);
}
const shipped = new Set(all.map((p) => path.basename(p)));
// The POSIX path of every file, so a citation carrying a directory can be checked against the
// real tree instead of against a bare filename.
const shippedPaths = all.map((p) => toPosix(path.relative(ROOT, p)));
// This file is exempt from itself, and that is not a convenience. It has to quote the phrases it
// searches for in order to document what it does, so including it would make the gate permanently
// red for the one file whose text is deliberately about the fault. Exempted by exact path, so a
// second file cannot quietly inherit the exemption.
const SELF = path.join(".github", "scripts", "check-public-surface.js");
const authored = all.filter((p) => {
  const rel = path.relative(ROOT, p);
  return !rel.startsWith(GENERATED) && rel !== SELF && /\.(md|json|ya?ml|js)$/.test(rel);
});

// A backticked path with an extension we ship as a file. Deliberately narrow: prose is full of
// things that look like paths (`visual.json` inside a PBIP, `definition/report.json`) and belong to
// the CUSTOMER's project rather than to this repository, so only extensions that would be OUR
// tooling are judged. `.js` is in the list because it is the extension of the fault that started
// all of this: the bundle told a customer that `pbir.js` and `visuals.js` remained the authority
// on the encodings, and neither has ever shipped.
// A citation that is deliberately not an instruction. Keyed by file and by the exact string, with
// the reason, because an unexplained exemption is how a real leak gets waved through later.
//
// The alternative was a semantic test -- "is this sentence an imperative?" -- and it is not worth
// attempting. The generator tried four versions of that question for a neighbouring check and every
// one passed on a faithful reproduction of the bug it was written for. A short reviewed list beats a
// clever test that reads as coverage and is not.
//
// Entries are checked for rot: if the citation is gone from the file, the entry has to go too, or
// the list decays into a set of exemptions for text nobody has read in a year. Rot is only judged
// when the FILE is present, because a partial tree cannot tell "the line was removed" from "the
// file is not here" -- the exact defect that made 12 of the generator's own tests unpassable for
// three weeks.
const ALLOWED = [
  { file: "AGENTS.md", cite: "build.js",
    why: "a grep TERM in the gate-A9 procedure, not a file to open. The instruction is to search shipped prose for mentions of it." },
  { file: "perf/README.md", cite: "plugins/zebra-bi/mcp/ci-supplement.js",
    why: "a historical note, inside a <details> block, about a file that was deliberately deleted. Naming it is the point of the paragraph." },
];

// `.md` added 2026-08-31. It was the one extension missing, and it is the extension of the held
// internal reference this repository cited in prose seven times while shipping none of it -- the
// exact leak class this check exists for, invisible to it for as long as it has existed.
const CITED = /`([A-Za-z0-9_.\/-]+\.(?:ps1|sh|py|mjs|js|md))`/g;

const problems = [];
const used = new Set();
for (const file of authored) {
  const rel = toPosix(path.relative(ROOT, file));
  const text = fs.readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(CITED)) {
      const base = path.basename(toPosix(m[1]));
      const exempt = ALLOWED.find((a) => a.file === rel && a.cite === m[1]);
      if (exempt) { used.add(exempt); continue; }
      // A citation carrying a directory is checked against the real tree. Matching on the bare
      // basename let `tools/render-loop/server.js` resolve because SOME `server.js` exists, and an
      // internal path under `tools/render-loop/` is precisely the v0.2.14 fault -- caught last time
      // only because that filename happened not to collide. A cited path may be written relative to
      // anywhere in the repo, so the test is that it is the TAIL of a real file path.
      const cited = toPosix(m[1]);
      const resolves = cited.includes("/")
        ? shippedPaths.some((sp) => sp === cited || sp.endsWith("/" + cited))
        : shipped.has(base);
      if (!resolves) {
        problems.push(
          `${rel}:${i + 1}: cites \`${m[1]}\`, which this repository does not contain.\n` +
          `      A reader cannot open it. If it is ours and internal, do not name it; if it is ` +
          `theirs, say so in the sentence.`);
      }
    }
    for (const a of AUDIENCE) {
      if (a.re.test(line)) {
        problems.push(`${rel}:${i + 1}: private-audience framing — ${a.why}.\n      ${line.trim().slice(0, 100)}`);
      }
    }
  });
}

// Rot: an exemption for a line that no longer exists. Only asked of files that are present.
const present = new Set(authored.map((f) => toPosix(path.relative(ROOT, f))));
for (const a of ALLOWED) {
  if (present.has(a.file) && !used.has(a)) {
    problems.push(`${a.file}: ALLOWED still exempts \`${a.cite}\`, which is no longer cited there. ` +
      `Drop the entry so the list does not rot.`);
  }
}

if (!authored.length) {
  console.error("\npublic surface FAILED — 0 authored files read. Either the tree is wrong or this "
    + "gate is reading nothing, and a gate that reads nothing cannot be told from one that passes.");
  process.exit(1);
}
console.log(`public surface — ${authored.length} authored file(s) read, ${ALLOWED.length} reasoned exemption(s) (the generated bundle is the generator's job)`);
if (problems.length) {
  console.error(`\npublic surface FAILED — ${problems.length} problem(s)\n`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("public surface ok — every cited tool resolves, no private-audience framing");
