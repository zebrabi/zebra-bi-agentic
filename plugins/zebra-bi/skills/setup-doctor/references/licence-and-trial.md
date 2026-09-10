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

When the user pastes their key into the chat, write it into **every** Zebra visual on the report and
render once:

```json
"objects": {
  "licenseSettings": [ { "properties": { "licenseKey": { "expr": { "Literal": { "Value": "'<key>'" } } } } } ],
```

- The value is the key in single quotes, like every other string literal.
- It is an **array** of property blocks, like every other `objects` entry. A bare object makes
  Desktop refuse the whole report: *"Property /visual/objects/licenseSettings … was not provided as
  the correct type."*
- Cards also carry the key under `license`; write `licenseSettings` on Cards too, and `license` as
  well if a Cards visual stays Free.

On that render the visual reads the key, drops the Free footer, and stores the entitlement on the
machine, so later reports on that machine need no key in their files.

Then **strip the key out of the project** with the authoring skill's stripper. A key left in a
`.pbip` travels with it and decodes, with no credential, to the customer's name, tier, seat count
and renewal date. The machine stays entitled after the strip.

Never author a key the user did not give you, and never copy one from another report.
