<!-- Summary: Publishing a model whose source the service cannot reach — the .pbix Imports route, and why the published dataset is a snapshot. -->
# When the service cannot reach the model's source

Read this when section 4 of the skill sent you here: the report is correct, the data is real on your
machine, and the source behind it is a personal OneDrive or SharePoint workbook, a path on your own
disk, or a database with no gateway.

## Why the definition route fails here

A report definition is text. It describes visuals and a model; it contains no rows. The service
loads the rows by running the model's source, and it cannot run a source it cannot reach. So the
publish succeeds, the report renders its layout, every visual is empty, and a refresh call fails on
the source rather than on anything you wrote. Nothing in the definition is wrong, so a definition
diff costs an hour and finds nothing.

## Publish the `.pbix`

A `.pbix` carries the loaded model beside the report, so it needs no source at the far end:

```
POST https://api.powerbi.com/v1.0/myorg/groups/{workspaceId}/imports
     ?datasetDisplayName=<name>.pbix&nameConflict=CreateOrOverwrite
Content-Type: multipart/form-data     -- the .pbix as the single part
```

Measured at about three seconds for a 20,000-row model. A Fabric-scope token was accepted by
`api.powerbi.com`, so the Fabric CLI substitute in the skill covers this call too.

Then prove the data the same way as any other publish: one `executeQueries` against the **published**
model, compared against the source file rather than against another visual.

## The same route when Microsoft's plugin cannot be installed

An organisation that allows only the official marketplace, or a machine with no
`~/.claude/plugins/repos/` at all, refuses `/plugin marketplace add microsoft/skills-for-fabric`.
Do not stop there: the Imports call above needs no plugin and has been run end to end with data
(the published model's `COUNTROWS`, revenue and prior-year figures matched the local oracle
exactly). The token is the Fabric CLI's own — `pip install ms-fabric-cli`, `fab auth login`, then
read the cached token rather than asking for a second sign-in. **Git integration is not the
fallback**: the GitHub provider is commonly off at tenant level while Azure DevOps is on, and the
Items API rejects a `byPath` dataset reference, so a PBIP pushed through git arrives as a report
with no model it can bind to.

## Two things to say when you hand over the URL

- **It is a snapshot.** The published dataset has no reachable source, so it will not refresh on a
  schedule and a refresh call against it fails. Someone will otherwise find that out at month end.
- **Only Desktop writes a `.pbix`.** There is no API that turns a project folder into one. It is
  File > Save as with the file type set to `.pbix`.
