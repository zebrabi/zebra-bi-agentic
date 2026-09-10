#!/usr/bin/env node
"use strict";

// Scan tracked text for non-placeholder Microsoft tenant hosts, packed drive GUIDs,
// GUIDs and personal email addresses. Synthetic fixture exemptions are file-scoped.
// Binary and unsupported encodings are reported as unverified skips; read errors fail.
// Run with --self-test to exercise the scanner and its CLI in a temporary Git repository.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const NUL = String.fromCharCode(0);
const GATE_FILE = ".github/scripts/check-no-tenant-identifiers.js";

// Documentation-style tenant labels accepted in examples.
const PLACEHOLDER_HOSTS = new Set([
  "contoso", "fabrikam", "adventureworks", "northwind", "tailspin", "woodgrove",
  "litware", "wingtip", "wingtiptoys", "example", "test", "invalid", "localhost",
]);

const ROLE_EMAILS = new Set(["support@zebrabi.com", "security@zebrabi.com"]);

// GUID-shaped fixtures that are deliberately not placeholder-shaped. Each needs a reason.
const GUID_EXEMPTIONS = [
  { value: "8c8b00e4-961a-489c-9a8b-812542526d79",
    file: "plugins/zebra-bi/mcp/test-tmdl.js",
    why: "Input to the TMDL parser test that a GUID used as a relationship NAME is not mistaken for "
       + "an unquoted dotted name. It has to look like a real relationship name to test that, and a "
       + "relationship name is not a tenant identifier." },
  { value: "01234567-89ab-4cde-8f01-23456789abcd",
    file: "plugins/zebra-bi/mcp/test-encoders.js",
    why: "Synthetic asymmetric bytes preserve the driveId decoder's little-endian regression test." },
  { value: "6e1a2b3c-0000-4000-8000-000000000001",
    file: "plugins/zebra-bi/skills/report-authoring/references/tmdl.md",
    why: "A worked lineageTag in a TMDL example. Hand-built to a valid v4 shape so the sample is "
       + "copy-pasteable; the 0000-4000-8000 middle makes it obviously synthetic." },
];

const HEX = "[0-9a-fA-F]";
const GUID_SRC = [HEX + "{8}", HEX + "{4}", HEX + "{4}", HEX + "{4}", HEX + "{12}"].join("-");
const guidRe = () => new RegExp(GUID_SRC, "g");
const hostRe = () => /([A-Za-z0-9][A-Za-z0-9-]*)\.(sharepoint|onmicrosoft)\.com/gi;
const driveRe = () => /b![A-Za-z0-9_-]{40,}/g;
const emailRe = () => /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Each group may repeat a different hex digit so fixtures can use distinct fake IDs.
const isPlaceholderGuid = (g) => g.toLowerCase().split("-")
  .every((group) => new Set(group.split("")).size === 1);

// The repo's own packing: three GUIDs in 48 bytes after the `b!`, first three groups little-endian.
function guidsFromDriveId(driveId) {
  const b64 = driveId.slice(2).replace(/-/g, "+").replace(/_/g, "/");
  let raw;
  try {
    raw = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
  } catch (err) {
    return null;
  }
  if (raw.length !== 48) return null;
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const one = (off) => {
    const g = Buffer.from(raw.subarray(off, off + 16));
    return [hex(g.subarray(0, 4).reverse()), hex(g.subarray(4, 6).reverse()),
      hex(g.subarray(6, 8).reverse()), hex(g.subarray(8, 10)), hex(g.subarray(10, 16))].join("-");
  };
  return [one(0), one(16), one(32)];
}

// Registry declarations themselves may state these documented synthetic GUIDs. This
// exception applies only to the exact declaration line, not to other detector content.
function isExemptGuid(guid, file, line) {
  return GUID_EXEMPTIONS.some((e) => e.value.toLowerCase() === guid &&
    (e.file === file || (file === GATE_FILE && line.trim() === `{ value: "${e.value}",`)));
}

function decodeText(bytes) {
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  let text;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return { reason: "binary or unsupported encoding (invalid " + encoding + ")" };
  }
  if (text.includes(NUL)) return { reason: "binary or unsupported encoding (NUL in decoded text)" };
  return { text };
}

function scan(files, read) {
  const problems = [];
  const skipped = [];
  const readErrors = [];
  let scanned = 0;
  for (const f of files) {
    let bytes;
    try {
      bytes = read(f);
    } catch (err) {
      readErrors.push(f + ": cannot read (" + (err.code || "unknown error") + ")");
      continue;
    }
    const decoded = decodeText(bytes);
    if (decoded.reason) {
      skipped.push(f + ": " + decoded.reason);
      continue;
    }
    scanned += 1;
    decoded.text.split(/\r?\n/).forEach((line, i) => {
      const at = f + ":" + (i + 1);
      for (const m of line.matchAll(hostRe())) {
        if (!PLACEHOLDER_HOSTS.has(m[1].toLowerCase())) {
          problems.push(at + " names a non-placeholder Microsoft tenant host: " + m[0]);
        }
      }
      for (const m of line.matchAll(driveRe())) {
        const guids = guidsFromDriveId(m[0]);
        if (!guids) continue;
        const bad = guids.filter((g) => !isPlaceholderGuid(g) && !isExemptGuid(g, f, line));
        if (bad.length) problems.push(at + " has a driveId with non-placeholder GUIDs: " + bad.join(", "));
      }
      for (const m of line.matchAll(guidRe())) {
        const g = m[0].toLowerCase();
        if (isPlaceholderGuid(g) || isExemptGuid(g, f, line)) continue;
        problems.push(at + " states a GUID that is not placeholder-shaped: " + m[0]
          + "  (register legitimate synthetic fixtures in GUID_EXEMPTIONS with a file and reason)");
      }
      for (const m of line.matchAll(emailRe())) {
        const e = m[0].toLowerCase();
        if (ROLE_EMAILS.has(e) || e.endsWith("@example.com") || e.endsWith("@contoso.com")) continue;
        problems.push(at + " states a non-role email address: " + m[0]);
      }
    });
  }
  return { problems, skipped, readErrors, scanned };
}

function selfTest() {
  const assert = require("assert");
  const os = require("os");
  const { spawnSync } = require("child_process");
  const cases = [];
  const check = (name, run) => cases.push([name, run]);
  const scanOne = (content, file = "fixture.txt") => scan([file], () =>
    typeof content === "string" ? Buffer.from(content) : content);
  const expectFindings = (name, content, count, file) => check(name, () => {
    const result = scanOne(content, file);
    assert.strictEqual(result.problems.length, count);
    assert.strictEqual(result.scanned, 1);
    assert.deepStrictEqual(result.skipped, []);
    assert.deepStrictEqual(result.readErrors, []);
  });

  // Negative controls are assembled from synthetic components so the source itself
  // stays scannable. Never substitute a value captured from a live tenant here.
  const tenant = (suffix) => ["synthetic-review-tenant", suffix, "com"].join(".");
  for (const suffix of ["sharepoint", "SharePoint", "SHAREPOINT", "onmicrosoft", "ONMICROSOFT"]) {
    expectFindings("refuse tenant host casing: " + suffix, tenant(suffix), 1);
  }
  expectFindings("allow documentation tenant casing", "CONTOSO.SHAREPOINT.COM", 0);
  expectFindings("allow placeholder GUID", "11111111-1111-1111-1111-111111111111", 0);
  expectFindings("allow role address", "support@zebrabi.com", 0);
  expectFindings("refuse synthetic personal address", ["synthetic.person", "zebrabi.com"].join("@"), 1);

  const drive = (bytes) => "b!" + bytes.toString("base64url");
  expectFindings("allow packed placeholders", drive(Buffer.alloc(48, 0x11)), 0);
  for (let position = 0; position < 3; position++) {
    const bytes = Buffer.alloc(48, 0x11);
    Buffer.from(Array.from({ length: 16 }, (_, i) => i)).copy(bytes, position * 16);
    expectFindings("refuse non-placeholder packed GUID at position " + position, drive(bytes), 1);
  }

  for (const exemption of GUID_EXEMPTIONS) {
    expectFindings("allow fixture GUID in " + exemption.file, exemption.value, 0, exemption.file);
    expectFindings("refuse fixture GUID outside " + exemption.file, exemption.value, 1);
    expectFindings("allow exact registry declaration for " + exemption.file,
      `{ value: "${exemption.value}",`, 0, GATE_FILE);
    expectFindings("refuse non-declaration GUID in detector for " + exemption.file,
      `const id = "${exemption.value}";`, 1, GATE_FILE);
  }
  // Independent packed bytes for the asymmetric encoder fixture; no decoder builds this oracle.
  const encoderFixture = GUID_EXEMPTIONS.find((e) => e.file.endsWith("test-encoders.js"));
  const packed = Buffer.concat([Buffer.from("67452301ab89de4c8f0123456789abcd", "hex"),
    Buffer.alloc(16, 0x22), Buffer.alloc(16, 0x33)]);
  expectFindings("allow packed GUID in its registered fixture", drive(packed), 0, encoderFixture.file);
  expectFindings("refuse packed GUID outside its registered fixture", drive(packed), 1);

  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tenant("sharepoint"), "utf16le")]);
  const utf16be = Buffer.from(utf16le).swap16();
  expectFindings("scan UTF-8 with BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(tenant("sharepoint"))]), 1);
  expectFindings("scan UTF-16LE with BOM", utf16le, 1);
  expectFindings("scan UTF-16BE with BOM", utf16be, 1);
  for (const [name, bytes] of [["binary", Buffer.from([0, 1, 2])],
    ["unsupported encoding", Buffer.from([0xff, 0x80])],
    ["malformed UTF-16", Buffer.from([0xff, 0xfe, 0x41])]]) {
    check("report skipped " + name, () => {
      const result = scanOne(bytes);
      assert.strictEqual(result.scanned, 0);
      assert.strictEqual(result.skipped.length, 1);
      assert.deepStrictEqual(result.problems, []);
      assert.deepStrictEqual(result.readErrors, []);
    });
  }
  check("report a read error and continue scanning", () => {
    const result = scan(["unreadable.txt", "fixture.txt"], (file) => {
      if (file === "unreadable.txt") throw Object.assign(new Error("denied"), { code: "EACCES" });
      return Buffer.from(tenant("sharepoint"));
    });
    assert.strictEqual(result.scanned, 1);
    assert.strictEqual(result.problems.length, 1);
    assert.deepStrictEqual(result.readErrors, ["unreadable.txt: cannot read (EACCES)"]);
  });

  check("CLI scans itself and tracked files, reports skips, and fails on read errors", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tenant-gate-test-"));
    try {
      const script = path.join(temp, GATE_FILE);
      fs.mkdirSync(path.dirname(script), { recursive: true });
      fs.copyFileSync(__filename, script);
      const git = (...args) => execFileSync("git", args, { cwd: temp, stdio: "pipe" });
      const run = () => spawnSync(process.execPath, [script], { cwd: temp, encoding: "utf8" });
      git("init", "-q");
      git("add", "--", GATE_FILE);
      let result = run();
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /1 scanned, 0 skipped, 0 read failures/);
      fs.appendFileSync(script, "\n// " + tenant("SharePoint") + "\n");
      result = run();
      assert.strictEqual(result.status, 1, result.stdout + result.stderr);
      assert.ok(result.stdout.includes(GATE_FILE + ":"));
      fs.copyFileSync(__filename, script);
      fs.writeFileSync(path.join(temp, "fixture.txt"), utf16be);
      git("add", "--", "fixture.txt");
      result = run();
      assert.strictEqual(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /fixture.txt:1 names a non-placeholder/);
      fs.writeFileSync(path.join(temp, "fixture.txt"), "safe text");
      fs.writeFileSync(path.join(temp, "binary.bin"), Buffer.from([0, 1, 2]));
      fs.writeFileSync(path.join(temp, "unsupported.txt"), Buffer.from([0xff, 0x80]));
      git("add", "--", "binary.bin", "unsupported.txt");
      result = run();
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /2 scanned, 2 skipped, 0 read failures/);
      assert.match(result.stdout, /SKIP binary.bin:/);
      assert.match(result.stdout, /SKIP unsupported.txt:/);
      assert.match(result.stdout, /skipped files were not privacy-verified/);
      fs.unlinkSync(path.join(temp, "fixture.txt"));
      result = run();
      assert.strictEqual(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /1 scanned, 2 skipped, 1 read failures/);
      assert.match(result.stderr, /fixture.txt: cannot read \(ENOENT\)/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  let passed = 0;
  for (const [name, run] of cases) {
    try {
      run();
      passed += 1;
      console.log("  PASS  " + name);
    } catch (err) {
      console.error("  FAIL  " + name + "\n" + err.message);
    }
  }
  console.log("\n" + passed + "/" + cases.length + " self-test(s) passed");
  return passed === cases.length;
}

function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest() ? 0 : 1);
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" })
    .split(NUL).filter(Boolean);
  const result = scan(tracked, (f) => fs.readFileSync(path.join(REPO, f)));
  console.log("tenant-identifier surface (" + tracked.length + " tracked files; "
    + result.scanned + " scanned, " + result.skipped.length + " skipped, "
    + result.readErrors.length + " read failures)");
  for (const skip of result.skipped) console.log("  SKIP " + skip);
  if (result.skipped.length) console.log("  skipped files were not privacy-verified");
  for (const error of result.readErrors) console.error("  " + error);
  for (const problem of result.problems) console.log("  " + problem);
  if (result.problems.length || result.readErrors.length) {
    console.error("  FAILED: " + result.problems.length + " identifier finding(s), "
      + result.readErrors.length + " read failure(s)");
    process.exit(1);
  }
  console.log("  ok - no identifier findings in " + result.scanned + " scanned file(s)");
}

main();
