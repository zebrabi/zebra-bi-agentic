# Licence state, the trial, and activating from the file

Read this when a Zebra visual renders in **Free** mode — a footer reading *"Zebra BI Charts · Free ·
Enter license key"* — or when the user asks how to get a licence. Authoring works without a licence;
it is the render that shows the difference, so the check is answered by looking at the page.

## Offer the trial

The link, with its parameters kept — they are how the team sees that a trial came from an agent:

```
https://zebrabi.com/pro-trial/power-bi/?utm_source=agent-skills&utm_medium=plugin&utm_campaign=setup-doctor
```

Before opening it or filling anything, say what the page asks for — name, work email, company — and
link the three documents it binds the user to:

- End-User Licence Agreement — https://zebrabi.com/legal/?doc=eula
- Privacy Policy for the visuals — https://zebrabi.com/legal/?doc=privacy-policy-visuals
- Privacy Policy — https://zebrabi.com/legal/?doc=privacy-policy

Then either open the page for them, or, if they ask you to, complete it with them: read the live
page, ask for each field, ask for an explicit *yes* to each consent box, and submit only after that.
The key arrives instantly.

**Never** tick a consent box yourself, guess a field, reuse details from another session, or carry a
hard-coded form layout. If the page has changed, fall back to opening the link.

## Activate from the file

Before you ask for a key, tell the user that a key pasted into the chat stays in the
conversation history like anything else in the chat.

When the user pastes their key into the chat, write it into **every** Zebra visual on the report and
render once:

```json
"objects": {
  "licenseSettings": [ { "properties": { "licenseKey": { "expr": { "Literal": { "Value": "'<key>'" } } } } } ],
```

- On **Tables+ and Charts+**, write a timestamp beside the key, set to the time of the write in
  milliseconds with a `D` suffix. These visuals hold the key twice, in the file and in Desktop's
  local storage, and keep the copy with the larger `appliedTimestamp` (a missing one counts as 0).
  A key written alone loses to an older key already stored on the machine, and the visual stays
  locked ("Available with a Paid Plan"). Never reuse an earlier timestamp with a new key.

  ```json
  "licenseSettings": [ { "properties": {
    "licenseKey": { "expr": { "Literal": { "Value": "'<key>'" } } },
    "appliedTimestamp": { "expr": { "Literal": { "Value": "<Date.now()>D" } } } } } ],
  ```

- On **Charts+**, also write these two groups. Which of them matters has not been isolated, so
  write both; `<version>` is the installed Charts+ version, shown in Format > About.

  ```json
  "proFeaturesSettings": [ { "properties": { "show": { "expr": { "Literal": { "Value": "true" } } } } } ],
  "visualCreatedVersion": [ { "properties": { "version": { "expr": { "Literal": { "Value": "'<version>'" } } } } } ],
  ```

  `write_visual`, `write_page` and `write_report` do this when the spec carries
  `licenseSettings.licenseKey` on a Tables+ or Charts+ visual. For Charts+ pass `installedVersion`,
  or `existingVisualPath` of a file that already holds `visualCreatedVersion`; without either, that
  one group is left out and the writer says so. Carrying an existing licence unchanged keeps its own
  timestamp.
- To confirm a key took effect, check the **Expires** field in Format > About, not "Licensed to":
  older keys carry the same licensee.
- The value is the key in single quotes, like every other string literal.
- It is an **array** of property blocks, like every other `objects` entry. A bare object makes
  Desktop refuse the whole report: *"Property /visual/objects/licenseSettings … was not provided as
  the correct type."*
- Cards also carry the key under `license`; write `licenseSettings` on Cards too, and `license` as
  well if a Cards visual stays Free.

On that render the visual reads the key, drops the Free footer, and stores the entitlement on the
machine. Leave the key in place.

Zebra BI visuals store licence information in each visual's objects and in Power BI Desktop's local
storage. That is normal. Leave it in place: removing it can make a visual render unlicensed on a
machine whose local storage does not hold the entitlement.
