<!-- The rules this template is short for are in AGENTS.md, "Pull requests". -->

## What changed, and why

<!-- One paragraph. What a reviewer needs to decide whether to approve, not a file list. -->

## Before you approve

<!-- Whatever the reviewer has to DO to check this: a command to run, a file to open, a
     claim to disbelieve. If there is nothing, say "nothing — read the diff". -->

## Checks

- [ ] `cd plugins/zebra-bi/mcp && for t in test-*.js; do node "$t"; done` — all suites pass
- [ ] `node .github/scripts/check-public-surface.js --self-test` and
      `node .github/scripts/check-no-tenant-identifiers.js --self-test` pass, then every gate
      in `.github/scripts/` passes
- [ ] If the bundle moved: `shasum -a 256 -c .bundle-sha256` inside
      `plugins/zebra-bi/skills/report-authoring/`, and the bundle and its checksum are in the
      **same** commit
- [ ] Windows / Power BI Desktop verification, if this touches authoring or publishing behaviour

## Release

- [ ] **This is not a version bump.**
- [ ] **This is a version bump**, so merging it publishes: `marketplace.json` serves
      `./plugins/zebra-bi` from this repository. Version, `CHANGELOG.md` and every stated count
      agree.

## Public surface

- [ ] `node .github/scripts/check-no-tenant-identifiers.js` passes — it decodes driveIds rather
      than reading them, so a tenant id hidden in base64 is caught. Review any listed skips:
      binary files and unsupported encodings are not privacy-verified
- [ ] No internal path, customer name or held-file reference reaches the public tree. That half is
      still judgement: the gates check citations and identifier shapes, not whether a sentence
      should have been published.
