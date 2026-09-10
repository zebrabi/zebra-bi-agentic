---
name: report-publishing
description: >-
  The Zebra-specific things to do around publishing a report to a Power BI or Fabric workspace.
  Microsoft's powerbi-report-management skill does the upload; this covers the visual-track
  decision that has to be made before you publish, the Zebra licence in the service, and the
  post-publish refresh without which a report built from a portable .pbip is silently empty.
  Use when the user says "publish", "upload", "push to Fabric", "deploy the report", "share it
  with the team", or asks why a published report shows no data. For authoring, use
  report-authoring.
---

# Publishing

**Microsoft publishes Power BI reports. Use their skill.** `powerbi-report-management` owns the
upload, download, update and delete, and it is good. It ships in the `powerbi-authoring` plugin of
`/plugin marketplace add microsoft/skills-for-fabric`. Do not reimplement any of it.

**If that plugin cannot be installed** (an organisation that allows only the official marketplace),
the `.pbix` Imports call in `references/unreachable-source.md` needs no plugin and has been run end
to end with data.

Three things Microsoft's skill cannot know about. That is the whole of this skill.

## 1. Before: pick the visual track, because publishing is when it stops being free

The authoring default is **Tables+ and Charts+**. They are Beta and **not Microsoft-certified**.
Tables, Charts and Cards on the certified track are.

**Both tracks publish and render in the service** — checked as a pair, same report and data, only
the two GUIDs different. Do not talk anyone off the default on a worry that Plus will not survive
the upload.

What Plus costs is everything *downstream*: **`exportToFile`, PDF export, PowerPoint export and
e-mail subscriptions** all refuse uncertified visuals and draw an error symbol. So if any of those
matter, swap `ZebraBITablesPlus…` → `ZebraBITables…` and `ZebraBIChartsPlus…` → `waterfall…` before
you publish. One-line change, query untouched, Cards unchanged.

Ask if you cannot tell: a report that publishes fine and then cannot be e-mailed to the board is
re-done late.

## 2. Before: do not promise a render you have not seen

Say what you actually checked; the claim table at the end is the vocabulary. A clean render on your
machine is not evidence about anyone else's.

## 3. After: refresh, or ship an empty report

**A model with a calculated-table partition can arrive unprocessed, and the report then renders
empty.** The shape to watch, and where this was seen, is a portable `.pbip` with its rows in
`DATATABLE(...)`. Every step reports success and the first query says:

```
"The query referenced calculated table 'Spend' which does not hold any data
 because it needs to be recalculated or refreshed."
```

**Do not go down the entity-name-mismatch trail**, which is where the generic advice points. The
bindings are already correct, so a TMDL diff comes back clean and costs an hour.

**And no refresh helps when the service cannot reach the source** — a personal workbook, a local
path, a gateway-less database. Publish the `.pbix`: `references/unreachable-source.md`.

One call, about five seconds:

```
POST https://api.powerbi.com/v1.0/myorg/groups/{ws}/datasets/{semanticModelId}/refreshes
     {"type":"Full","commitMode":"Transactional"}
```

Then check `value[0].status == "Completed"` on `GET .../refreshes`, and prove the data with one
query against the **published** model, compared to the source file rather than to another visual:

```
POST .../datasets/{id}/executeQueries
     {"queries":[{"query":"EVALUATE ROW(\"Rows\", COUNTROWS(T), \"Total\", SUM(T[Col]))"}]}
```

## What you may claim afterwards

| You ran | You may say |
|---|---|
| Upload returned 202 → Succeeded | The items were created. Nothing more |
| `getDefinition` round-trip matches | The service kept the files, Zebra GUIDs included |
| DAX against the published model matches source | The data is right |
| A human opened the report | It renders |
| `exportToFile` came back clean | It renders — **only on the certified track**; on Plus this check reports a failure that is not real |

Hand over the URL and say which line you reached:
`https://app.powerbi.com/groups/{workspaceId}/reports/{reportId}`

## If the Azure CLI is missing

`az rest` needs an admin install. The **Fabric CLI** is the no-admin substitute —
`pip install ms-fabric-cli` — and `fab api` maps one-for-one: `-X` method, `-i` body, `-q` JMESPath,
`--show_headers` for the LRO id, `-A powerbi` for a Power BI endpoint. Give it a path, not a full
URL, or every call 404s.
