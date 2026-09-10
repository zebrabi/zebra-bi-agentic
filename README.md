# Zebra BI for Claude

Describe the report you want. Get a Power BI report built with Zebra BI visuals.

You point this at a Power BI project that already has your data in it, say what you want to see,
and it writes the report: the pages, the charts and tables, the variance columns, the IBCS
formatting. Then it checks its own work before you open it.

It is not a chatbot that tells you how to build a report. It builds the report.

> **This is an early release.** It works, it is used daily inside Zebra BI, and it is new enough
> that the most useful thing you can do is tell us when it does not. There is a
> [feedback section](#when-something-goes-wrong) at the end, and
> [issues](https://github.com/zebrabi/zebra-bi-agentic/issues) are open.

## What it actually produces

Give it a model with actuals, plan and prior year, and ask for a monthly P&L. You get a real
`.pbip` project you can open in Power BI Desktop: an income statement in a Zebra BI Table with
variance columns, a KPI row in Cards, a waterfall showing what moved, prior-year comparison
throughout, IBCS notation, and the numbers tied to your model rather than typed in.

It works the same way a good analyst does. It looks at your data first, decides what the data can
actually answer, picks the visuals for that, and tells you what it left out and why.

## Before you start

Four things, and the second and third catch most people out.

**1. Windows, with Power BI Desktop installed.** Zebra BI visuals render in Power BI Desktop, and
there is no way around that. On a Mac it can write the files but cannot show you the result, so in
practice this is a Windows tool.

**2. A Zebra BI licence, or a free trial.** The visuals need a licence on the machine that renders
them. If you do not have one:
**https://zebrabi.com/pro-trial/power-bi/?utm_source=agent-skills&utm_medium=plugin&utm_campaign=readme**
gives you a key in a couple of minutes. Paste the key into the chat and the agent activates the
visuals from the report itself; there is nothing to type in Power BI Desktop.

**3. A data model that can show a variance.** This is the big one. Your model needs:

- **Separate measures per scenario.** Something like `Actual`, `Plan`, `Previous Year`. Not one
  column called `Scenario` with values in it. Zebra BI puts actuals and plan in different places,
  so it needs different fields for them.
- **A date table, marked as the date table.** In Power BI that is *Table tools → Mark as date
  table*.

Without those two, you still get a report, and the variance and prior-year columns come out empty
or wrong **while the page looks completely finished**. That is the single most common
disappointment, and there is a check that catches it before you waste time.

If your model is not there yet, it can write the measures and the date table for you. Ask.

**4. Claude Code.** This is the tool that runs everything here, and it runs in a terminal window.
If that is unfamiliar territory, it is genuinely worth twenty minutes: install it once and you
type requests in plain English from then on. Instructions at
**https://claude.com/claude-code**.

## Installing

Two commands, once. Paste them into Claude Code:

```
/plugin marketplace add zebrabi/zebra-bi-agentic
/plugin install zebra-bi@zebra-bi-collection
```

The first tells Claude where to find our things. The second installs them. Restart Claude Code
afterwards.

No account, no login, no key: the repository is public and the marketplace step reads it
anonymously. If the first command fails, it is almost always network or proxy rather than
permissions — try `git clone https://github.com/zebrabi/zebra-bi-agentic` by hand and you will get the
real error.

To get updates later:

```
/plugin update zebra-bi@zebra-bi-collection
```

## Your first ten minutes

**Step one: check the machine.**

```
/zebra-bi:setup-doctor
```

Ten checks, a few seconds. It tells you what is ready, what is missing, and how to fix each thing
it finds. It is worth running before your first report and again any time something behaves oddly.

Two of its checks are about your model, and they are the ones to pay attention to: whether you
have scenario measures, and whether a date table is marked. If either fails, fix that first.
Everything else about the report will look fine and be wrong.

**Step two: ask for a report.**

```
/zebra-bi:report-authoring
```

Or simply tell Claude what you want, in your own words:

> Here's my sales model at C:\Reports\Sales.pbip. Build me a monthly P&L page with variance
> against plan and last year.

It will decide the structure, build one page, and show you. Then you steer.

If you would rather be involved in each decision, say **"work with me"** and it will propose
before it builds instead of deciding for you.

## What is included

| | What it does |
|---|---|
| **`/zebra-bi:setup-doctor`** | Checks this machine can do the job: Power BI Desktop, your project, the visuals, your licence, your model, and what it can verify. Ten checks, each with a fix. |
| **`/zebra-bi:report-authoring`** | The authoring itself. Planning a page, binding data, variance semantics, formatting, small multiples, comments, and page layouts proven against real Zebra BI templates. |
| **`/zebra-bi:report-publishing`** | The Zebra-specific parts of putting a finished report in a workspace. Microsoft's own skill does the upload; this covers the choice of visuals you have to make before you publish, and the refresh without which the report arrives empty. |
| **The checker** | Reads your project and reports faults before you open it: 59 of them, each one a real problem we have hit and fixed. Optional, see below. |

### About the checker

The checker needs **Node.js**, a free download from **https://nodejs.org**. If you have it, you
get 59 checks that catch things Power BI itself does not mention: a comment that will blank a whole
visual, colours that will be silently ignored, a computed row that will quietly inflate your grand
total, a sort that will make a table render empty.

If you do not have Node, everything else works exactly the same and you simply do not get those
checks. It is a smaller product, not a broken one, and the doctor will tell you which one you are
running.

## What it cannot do

Worth knowing before you start, so nothing here surprises you later.

**It cannot tell you whether a number is right.** It reads your report files, not your data. It
can tell you a column is bound to the wrong field or a formatting rule will be ignored. It cannot
tell you that revenue should be 4.2 million. Check the headline figures yourself.

**It cannot see the rendered page.** Its checks read files. Some faults only appear on screen, so
look at the report.

**It is Windows only in practice**, because Power BI Desktop is.

**It cannot tell whether two periods are comparable.** If your actuals stop in April and last year
runs to December, every variance on the page is wrong, and nothing in the files says so. The
checker states this in its own output rather than leaving you to assume otherwise, and the skill
will look for the problem while it works. Neither is a guarantee. **Check that your actuals and
your comparison cover the same window.** It is the most expensive mistake available here, and it
looks completely normal on screen.

## When something goes wrong

Run the doctor first. It resolves most of it.

If it does not, the most useful things to send us are:

1. **A report that came out wrong when the tool said it was fine.** This is the one we care about
   most.
2. **A warning about something that was actually correct.** A checker that cries wolf is worse
   than no checker, so please tell us.
3. Anything in the instructions you had to work out for yourself.

A screenshot of the page tells us more than any log file.

**[Open an issue](https://github.com/zebrabi/zebra-bi-agentic/issues/new/choose)** — there are templates
for a wrong report, a false warning, and a documentation gap, and each one asks for the few details
that make a report actionable. Public, so other people can see whether their problem is already
known.

For anything about your licence, your account, or data you would rather not post publicly, email
**support@zebrabi.com** instead.

## Licence

See [`LICENSE`](LICENSE). In short: use it with Zebra BI as much as you like, including
commercially, and the reports you make are yours. Do not modify or redistribute it (a fork to propose a
contribution is the one exception), and do not use
it to train machine-learning models. It does not include a licence for the Zebra BI visuals, which
need their own.

---

Zebra BI · https://zebrabi.com · support@zebrabi.com
