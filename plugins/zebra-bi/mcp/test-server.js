#!/usr/bin/env node
// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";
/**
 * Tests for the report-authoring MCP server.
 *
 * Two kinds. Unit tests build a throwaway PBIP on disk and assert the checker fires or stays
 * quiet. Protocol tests drive the real binary over stdio, because a checker that works when
 * called directly and a server Claude Code can actually talk to are different claims.
 *
 *   node test-server.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const srv = require("./server.js");

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(["PASS", name, ""]); }
  catch (e) { results.push(["FAIL", name, String(e.message).split("\n")[0].slice(0, 90)]); }
};

/** Build a minimal PBIP on disk. `theme` false omits the base theme. */
function makeProject(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zbi-"));
  if (opts.empty) return root;
  fs.writeFileSync(path.join(root, "Demo.pbip"), "{}");
  const def = path.join(root, "Demo.Report", "definition");
  fs.mkdirSync(def, { recursive: true });
  const report = { $schema: "https://x", publicCustomVisuals: [] };
  if (opts.theme !== false) report.themeCollection = { baseTheme: { name: "CY24SU10" } };
  const body = opts.badJson ? "{ not json" : JSON.stringify(report);
  fs.writeFileSync(path.join(def, "report.json"), (opts.bom ? "﻿" : "") + body);
  return root;
}

// --- the checker ---------------------------------------------------------------------------

check("a report with a base theme produces no finding", () => {
  const out = srv.validateReport({ projectPath: makeProject() });
  assert.ok(out.ok, out.error);
  assert.strictEqual(
    out.findings.filter((f) => f.code === "report-has-no-base-theme").length, 0);
});

check("a report with NO base theme is caught", () => {
  const out = srv.validateReport({ projectPath: makeProject({ theme: false }) });
  const hit = out.findings.find((f) => f.code === "report-has-no-base-theme");
  assert.ok(hit, "the missing base theme was not reported");
  assert.strictEqual(hit.severity, "blank");
  assert.ok(hit.location.includes("report.json"), "no location");
  // The message must be the one from rules.json, not a second wording invented here.
  assert.ok(/renders nothing at all/.test(hit.message), `message was: ${hit.message}`);
});

// The failure the PowerShell had: every layer optional, so nothing to inspect reads as a pass.
// This test used to assert `ok: true` and prove the honesty in `checked` instead. That was not
// enough -- the corpus harness read `ok`, got a pass on 20 projects it had never opened, and the
// `0 .Report` in `checked` sat there unread. The honesty has to be in the field callers branch on.
check("an empty directory does NOT read as a pass", () => {
  const out = srv.validateReport({ projectPath: makeProject({ empty: true }) });
  assert.strictEqual(out.ok, false, "an empty directory must not report ok");
  assert.ok(/nothing was checked/.test(out.error), `error was: ${out.error}`);
});

// The exact shape of that harness bug: the .pbip is a real file, the .Report is a junction, so
// the resolver sees a project with no report and every rule finds nothing for that reason.
check("a project whose .Report is invisible cannot report a pass", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zbi-"));
  fs.writeFileSync(path.join(root, "Demo.pbip"), "{}");
  const out = srv.validateReport({ projectPath: root });
  assert.strictEqual(out.ok, false, "no .Report must not report ok");
  assert.ok(/junction|symlink/.test(out.error), "the error must name the cause that bit us");
});

// Not a fault and not fatal -- but a green result on a report with no visuals means far less
// than a green result on a populated one, and the caller must not have to infer that from a count.
check("no visuals is stated in notChecked, not left to the counts", () => {
  const out = srv.validateReport({ projectPath: makeProject() });
  assert.ok(out.ok, out.error);
  assert.ok(/0 visual\(s\)/.test(out.checked.join("|")), "the count must still be reported");
  assert.ok(out.notChecked.some((s) => /this report has none/.test(s)),
    "a report with no visuals must say so in notChecked");
});

check("a BOM does not also produce a bogus parse error", () => {
  const out = srv.validateReport({ projectPath: makeProject({ bom: true }) });
  assert.strictEqual(out.findings.filter((f) => f.code === "unparseable-json").length, 0,
    "the BOM was not stripped before parsing, so one fault reported twice");
});

check("unparseable JSON is caught and named", () => {
  const out = srv.validateReport({ projectPath: makeProject({ badJson: true }) });
  const hit = out.findings.find((f) => f.code === "unparseable-json");
  assert.ok(hit && hit.severity === "wont-open");
});

// The $schema URL of definition.pbir is checked by Desktop against a pattern; a plausible URL with
// one extra segment refused a whole project on 2026-09-06 while the validator said ok.
function withPbir(schemaUrl) {
  const root = makeProject();
  fs.writeFileSync(path.join(root, "Demo.Report", "definition.pbir"), JSON.stringify({
    $schema: schemaUrl, version: "4.0", datasetReference: { byPath: { path: "../Demo.SemanticModel" } },
  }));
  return root;
}
check("definition.pbir with the right $schema pattern stays silent", () => {
  const out = srv.validateReport({ projectPath: withPbir(
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json") });
  assert.strictEqual(out.findings.filter((f) => f.code === "pbir-schema-url-invalid").length, 0);
  const out1 = srv.validateReport({ projectPath: withPbir(
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/1.0.0/schema.json") });
  assert.strictEqual(out1.findings.filter((f) => f.code === "pbir-schema-url-invalid").length, 0);
});
check("definition.pbir with an extra path segment in $schema is a wont-open finding", () => {
  const out = srv.validateReport({ projectPath: withPbir(
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/definitionProperties/1.0.0/schema.json") });
  const hit = out.findings.find((f) => f.code === "pbir-schema-url-invalid");
  assert.ok(hit, "the bad $schema was not caught");
  assert.strictEqual(hit.severity, "wont-open");
  assert.ok(/follow patterns/.test(hit.message), hit.message);
  // An ABSENT $schema is not claimed: it has not been put through a cold open.
  const missing = srv.validateReport({ projectPath: withPbir(undefined) });
  assert.strictEqual(missing.findings.filter((f) => f.code === "pbir-schema-url-invalid").length, 0);
});

check("a missing directory is an error, never a clean report", () => {
  const out = srv.validateReport({ projectPath: "/nope/does/not/exist" });
  assert.strictEqual(out.ok, false);
  assert.ok(/No such directory/.test(out.error));
});

check("notChecked is never empty", () => {
  const out = srv.validateReport({ projectPath: makeProject() });
  assert.ok(out.notChecked.length >= 3);
  assert.ok(out.notChecked.some((s) => /window/i.test(s)),
    "the partial-actuals class must be named explicitly");
});

check("findings sort worst-first", () => {
  const out = srv.validateReport({ projectPath: makeProject({ theme: false, badJson: true }) });
  const sev = out.findings.map((f) => f.severity);
  assert.ok(sev.indexOf("wont-open") <= sev.indexOf("blank") || !sev.includes("blank"));
});

check("every rule in the catalogue is either run or declared unrun", () => {
  const out = srv.validateReport({ projectPath: makeProject() });
  const rules = srv.loadRules();
  const unrun = rules.length - out.rulesRun;
  const declared = out.notChecked.some((s) => s.includes(`${unrun} rule(s)`));
  assert.ok(unrun === 0 || declared,
    `${unrun} rules did not run and the response did not say so`);
});

// --- the protocol ----------------------------------------------------------------------------

function rpc(messages) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, "server.js")]);
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", reject);
    p.on("close", () => resolve(out.trim().split("\n").filter(Boolean).map(JSON.parse)));
    for (const m of messages) p.stdin.write(JSON.stringify(m) + "\n");
    p.stdin.end();
    setTimeout(() => p.kill(), 5000);
  });
}

(async () => {
  const replies = await rpc([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "validate_report",
                arguments: { projectPath: makeProject({ theme: false }) } } },
  ]);

  check("initialize answers with a protocol version", () => {
    const r = replies.find((x) => x.id === 1);
    assert.ok(r && r.result.protocolVersion, "no protocolVersion");
    assert.strictEqual(r.result.serverInfo.name, "zebra-bi-report-authoring");
  });

  check("a notification gets no reply", () => {
    assert.strictEqual(replies.filter((r) => r.id === undefined || r.id === null).length, 0);
  });

  check("tools/list advertises validate_report", () => {
    const r = replies.find((x) => x.id === 2);
    assert.strictEqual(r.result.tools[0].name, "validate_report");
    assert.ok(r.result.tools[0].inputSchema.required.includes("projectPath"));
  });

  check("tools/list advertises the encoders too", () => {
    const names = replies.find((x) => x.id === 2).result.tools.map((t) => t.name);
    assert.ok(names.length >= 8, `only ${names.length} tools advertised`);
    for (const n of ["encode_annotations", "encode_added_formulas", "plan_card_invert"]) {
      assert.ok(names.includes(n), `${n} not advertised`);
    }
  });

  check("every advertised tool has a usable input schema", () => {
    for (const t of replies.find((x) => x.id === 2).result.tools) {
      assert.strictEqual(t.inputSchema.type, "object", `${t.name} has no object schema`);
      assert.ok(Array.isArray(t.inputSchema.required) && t.inputSchema.required.length,
        `${t.name} declares nothing required, so a landmine is reachable`);
      assert.ok(t.description && t.description.length > 40, `${t.name} has a thin description`);
    }
  });

  check("tools/call returns the finding over the wire", () => {
    const r = replies.find((x) => x.id === 3);
    const payload = JSON.parse(r.result.content[0].text);
    assert.ok(payload.findings.some((f) => f.code === "report-has-no-base-theme"));
  });

  // An encoder over the wire, and a refused encode: both must come back as answers rather than
  // as a dead connection.
  const enc = await rpc([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "encode_data_value_list",
      arguments: { target: "groupsInverted", values: ["COGS"] } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "encode_added_formulas",
      arguments: { categoryField: "A.B", formulas: [{ name: "X", expression: "[y]" }] } } },
  ]);

  check("an encoder answers over stdio", () => {
    const p = JSON.parse(enc.find((x) => x.id === 1).result.content[0].text);
    assert.strictEqual(p.property, "groupsMetadata.inverted");
    assert.ok(p.literal.expr.Literal.Value.includes("COGS"));
  });

  check("a refused encode returns a message, not a crash", () => {
    const r = enc.find((x) => x.id === 2);
    assert.strictEqual(r.result.isError, true);
    const p = JSON.parse(r.result.content[0].text);
    assert.ok(/aggregatesOtherRows/.test(p.error), `unhelpful refusal: ${p.error}`);
  });

  for (const [s, n, d] of results) console.log(`  ${s}  ${n}${d ? "  <- " + d : ""}`);
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
