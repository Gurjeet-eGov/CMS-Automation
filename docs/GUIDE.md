# CMS-Automation — the step-by-step guide

This repo holds the CMS/PGR Playwright integration suite and runs it on GitHub Actions.

- Results go to a dashboard on GitHub Pages.
- A run turns red (and GitHub emails you) only when something unusual happens.
- Nothing here assumes you have used GitHub Actions before.

**Contents**

1. [GitHub Actions in five minutes](#1-github-actions-in-five-minutes)
2. [One-time setup](#2-one-time-setup)
3. [Running the tests](#3-running-the-tests)
4. [Branches](#4-branches)
5. [Environments](#5-environments)
6. [Running on a schedule](#6-running-on-a-schedule)
7. [Reading the results](#7-reading-the-results)
8. [Recording, traces and alerts](#8-recording-traces-and-alerts)
9. [Running on your own machine](#9-running-on-your-own-machine)
10. [Troubleshooting](#10-troubleshooting)
11. [What each file does](#11-what-each-file-does)

---

## 1. GitHub Actions in five minutes

| Word | What it means | Where it is here |
|---|---|---|
| **Workflow** | An automated procedure, written in YAML, that GitHub runs for you. | `.github/workflows/*.yml` — two of them (§11) |
| **Trigger** (`on:`) | What starts a workflow: a button press (`workflow_dispatch`), a push, a pull request, or a timer (`schedule`). | the `on:` block at the top of each workflow |
| **Inputs** | The form you fill in when you start a workflow by hand. | `integration-tests.yml` → `inputs:` (environment, scope, grep) |
| **Job** | A group of steps that runs on one fresh machine. Jobs can depend on each other. | `run-tests`, then `report` |
| **Runner** | The machine GitHub lends you for a job: a clean Ubuntu VM, thrown away afterwards. | `runs-on: ubuntu-24.04` |
| **Step** | One command (`run:`) or one ready-made action (`uses:`). | `ci/*.sh` scripts called from steps |
| **Secret** | An encrypted value you store once in the repo settings. Workflows can read it; nobody can read it back, and logs show `***` instead. | `CONFIG_ENV` and `SECRETS_ENV` in each environment (§2) |
| **Environment** | A named set of secrets in the repo settings (Settings → Environments). Here: one per deployment, holding its two files. | `naipepea`, `net_two`, … (§2, §5) |
| **Variable** | A plain, non-secret setting stored in the repo settings: a switch. | `RECORD_VIDEO`, `REPORTS_KEPT`, … (§8) |
| **Artifact** | Files a run keeps for download. Here: the HTML report and `report.json` (`results-<environment>`), and the results as JUnit XML (`test-results`), kept 90 days. | "Artifacts" box at the bottom of a run page |
| **GitHub Pages** | A free static website served from a branch of this repo. | the `gh-pages` branch → your dashboard |

What happens when you press **Run workflow** on *Integration tests*:

```
run-tests job                                   report job
─────────────                                   ──────────
1. check out the branch you picked              1. download those results
2. prepare the suite (this branch's)            2. full runs: add the run to the dashboard
3. install Node packages + Chromium                on the gh-pages branch (GitHub Pages)
4. load the environment's settings + secrets    3. compare with the previous full run, write the run summary
5. check the deployment answers                 4. turn the run red if something is unusual
6. run Playwright                                  → GitHub also emails you
7. upload the results as artifacts
```

---

## 2. One-time setup

Everything here is done once, in the browser, on
`https://github.com/Gurjeet-eGov/CMS-Automation`.

### Step 1 — push this repo

Push `master`, the suite plus everything in this repo:

```bash
git push origin master
```

### Step 2 — one environment per deployment, holding its two files

Each deployment you test (naipepea, net_two, bomet…) is a **GitHub Environment** with **two secrets**, each a whole file pasted in one go:

| Secret | What you paste | Example |
|---|---|---|
| `CONFIG_ENV` | the whole **config.env**: address, tenant, workspace slug, logins (emails) | `environments/naipepea/config.env` |
| `SECRETS_ENV` | the whole **secrets.env**: passwords and codes | fill in `environments/naipepea/secrets.example` |

1. On GitHub, open **Settings** → **Environments** → **New environment**. Name it after the deployment, e.g. `net_two`, then **Configure environment**.
2. Under **Environment secrets** → **Add environment secret**:
   - **Name:** `CONFIG_ENV`. **Value:** paste your whole config.env.
3. **Add environment secret** again:
   - **Name:** `SECRETS_ENV`. **Value:** paste your whole secrets.env, one `KEY=value` per line, for example:

   ```
   ADMIN_PASSWORD=…
   EMPLOYEE_PASSWORD=…
   GRO_PASSWORD=…
   WARD_CSR_PASSWORD=…
   IDENTITY_TEST_OTP_CODE=123456
   ```
4. Repeat for each deployment. The **environment** dropdown on the run form lists them by itself: nothing to edit in the workflow.

**From a terminal instead** (needs admin on the repo):

```bash
gh secret set CONFIG_ENV --env net_two < environments/net_two/config.env
```

```bash
gh secret set SECRETS_ENV --env net_two < environments/net_two/secrets.env
```

How the files are read:

- Both are read **line by line and never run**. You don't need quotes, and `$`, `"`, `'`, backticks and `=` are all fine inside a value.
- Lines starting with `#` and blank lines are ignored.
- Spaces around a value are dropped. If a value really starts or ends with a space, wrap it in quotes.
- In the run log, each **SECRETS_ENV** value is shown as `***`. CONFIG_ENV values (the address, tenant…) stay readable, so the log says where the run went. The summary lists only which *secret keys* were set, never their values.
- If an environment is missing one of the two, the run stops at once: *"SECRETS_ENV is missing in the net_two environment's secrets"*.

**Changing a file later:** open the environment → the secret → **Update** → paste the whole file again. You can't view the old value, only replace it.

**The old setup still works** while you move over: an environment without `CONFIG_ENV` uses `environments/<name>/config.env` from the repo, and one without `SECRETS_ENV` uses the old repository secret `SECRETS_<NAME>`. The run says so in a notice.

**Why not another way?**

- Committing passwords to this public repo would publish them.
- Typing them into the Run workflow form would show them in plain text on the run page.
- GitHub's Run workflow form can't take a file, so the files live in the environment.

### Step 3 — switch on GitHub Pages (after the first full run)

The first `full` run creates the `gh-pages` branch. Then:

**Settings** → **Pages** → **Build and deployment** → **Source:** *Deploy from a branch* → **Branch:** `gh-pages`, folder `/ (root)` → **Save**.

A minute later the site is live at:

**<https://gurjeet-egov.github.io/CMS-Automation/>**

Two things to know about this site:

- **It is public.** Anyone with the link can open it, because on GitHub's free plan Pages only works for public repos.
- **It is text only.** Screenshots, video and traces are all off by default, so no images or recordings are published. Switch one on only while debugging (§8).

### Step 4 — email when a run goes red

GitHub emails you about failed runs of workflows you started. Check that it's switched on:

1. Click your profile picture → **Settings** → **Notifications**.
2. Under **System** → **Actions**, choose **Email**.
3. Tick **Only notify for failed workflows**.

A run here only goes red when something *unusual* happened (§8), so these mails are worth reading.

### Step 5 (optional) — switches

Set these under **Settings** → **Secrets and variables** → **Actions** → **Variables** tab. Every one has a sensible default, so you only add the ones you want to change.

| Variable | Default | What it does |
|---|---|---|
| `RECORD_SCREENSHOTS` | off | `true` → keep a screenshot of each **failing** test |
| `RECORD_VIDEO` | off | `true` → keep a video of each **failing** test |
| `RECORD_TRACES` | off | `true` → keep a Playwright trace of each failing test. **Read §8 first.** |
| `REPORTS_KEPT` | `5` | How many runs per dashboard keep their full report. Older runs keep their results only. |
| `PW_GLOBAL_TIMEOUT_MS` | `5400000` | Stop a run after 90 minutes, and still publish what finished |
| `SCHEDULED_ENVIRONMENT` | `naipepea` | Which environment scheduled runs test (§6) |
| `SCHEDULED_BRANCH` | `master` | Which branch's suite scheduled runs use (§6) |
| `PAGES_URL` | `https://gurjeet-egov.github.io/CMS-Automation/` | Only if the site moves, e.g. to a custom domain |

---

## 3. Running the tests

### From the browser

1. Open the **Actions** tab → **Integration tests** (left) → **Run workflow** (right).
2. Fill in the form:

| Field | What to choose |
|---|---|
| **Use workflow from** | The **branch whose suite runs**: `master` for the shared suite, or a deployment's own branch such as `digit-3.0-naipepea` (§4). |
| **environment** | The deployment: one of your GitHub Environments (§2, step 2). Its two files give the address, tenant and passwords. |
| **scope** | `full` (default): everything, about an hour. **Only full runs go on the dashboard**, and only they are compared with the previous run. |
| | `profile-only`: read-only. It only discovers what the deployment has. Do this first on a new environment. |
| | `smoke`: a few minutes, the basics. |
| | `api`, `smoke+api`, `citizen`, `employee`, `admin`, `lifecycle`: one slice of the suite. |
| **grep** | Optional. Only tests whose title or tags match, e.g. `@area:pgr`, `@persona:citizen`, `@kind:smoke`. |

3. Click the green **Run workflow** button.

The run appears in the list a few seconds later, titled **branch · environment · scope**, e.g. `master · Nai Pepea · smoke`. Click it to watch each step's log live.

**Order for a new environment:** `profile-only` → `smoke` → `full`.

**Careful:** these runs act on a **live deployment**. They sign in, register citizens and file complaints, and that data stays.

- Only one run per environment goes at a time. A second one waits, and a third replaces the second while it waits.
- Don't run against a deployment someone else is testing at the same moment.

### From a terminal (GitHub CLI)

```bash
gh workflow run integration-tests.yml --ref master -f environment=net_two -f scope=smoke
```

```bash
gh run watch
```

```bash
gh run view --web
```

---

## 4. Branches

- **`master`**: the shared suite, what holds for every deployment, plus the workflow, `ci/` scripts, docs and example environments.
- **A deployment's own branch**, e.g. `digit-3.0-naipepea`: that deployment's version of the suite, with its own tweaks and tests. It carries the same workflow and `ci/` scripts as master.

### Where does a test go?

| The test… | Put it on |
|---|---|
| holds for every deployment (the product behaviour) | `master`, in `tests/integration-tests/` |
| holds only for one deployment (a customisation) | that deployment's branch |

### Start a deployment's branch

```bash
git checkout master && git pull
```

```bash
git checkout -b digit-3.0-<name>
```

```bash
git push -u origin digit-3.0-<name>
```

To run its suite, pick the branch in **Use workflow from**. Its dashboard is `<branch>/<environment>/` on the site. Folder names are lowercase, with `-` for spaces: environment *Nai Pepea* on `digit-3.0-naipepea` is `digit-3.0-naipepea/nai-pepea/`. The site still shows the name as *Nai Pepea*.

### When master's workflow or scripts change

Bring the change to each deployment's branch with a pull request from `master` into that branch, or locally:

```bash
git checkout digit-3.0-<name> && git pull
```

```bash
git merge origin/master
```

If Git reports conflicts, fix the files it lists, keeping what the deployment needs, then `git add -A && git commit && git push`.

### Protect the branches (for managers)

**Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**:

1. **Target branches:** add `master` and each deployment's branch.
2. Tick **Require a pull request before merging**. Set **Required approvals** to 1 or more.

The **Checks** workflow runs on pull requests (see `.github/workflows/checks.yml` for which branches). It loads every spec without touching a deployment, so a broken import fails in the PR rather than in a real run.

### The one product file this suite carries (`vendor/`)

One product spec imports product UI code from outside the suite folder (`digit-ui-esbuild/…/geoLocation.js`). That file was copied from the product repo into `tests/integration-tests/vendor/product/`, and the import points there.

`tests/integration-tests/vendor/README.md` says where it came from, and what to do if the product changes it.

---

## 5. Environments

Each deployment is a **GitHub Environment** holding two secrets, `CONFIG_ENV` and `SECRETS_ENV` (§2, step 2). The run form's **environment** dropdown lists them.

The folders under `environments/` are for **your own machine** (§9) and as examples:

| File | What goes in it |
|---|---|
| `config.env` | **Public** settings: URL, tenant, workspace slug, logins (emails). Committed. Paste it into the environment's `CONFIG_ENV`. |
| `secrets.example` | The **names** of the keys `SECRETS_ENV` must hold. Never values. |
| `expectations.json` | Optional: what this deployment **should** have (see below). Used from the repo, on GitHub too. |
| `secrets.env` | Optional, **local only**, git-ignored: the same block as `SECRETS_ENV`, for §9. |

**How a run builds its settings** (`ci/load-env.sh`), with later steps winning:

1. **`UPSTREAM_ENV`**, if the config names one: a profile the suite already ships, e.g. `deploy/naipepea.env`.
2. The rest of the config: `CONFIG_ENV` on GitHub, `environments/<name>/config.env` on your machine.
3. **`environments/<name>/expectations.json`**, if present.
4. The secrets: `SECRETS_ENV` on GitHub, `environments/<name>/secrets.env` on your machine.

If something essential is missing (URL, tenant, workspace slug), the run stops at once and says what to set.

### The shipped example environments

| Environment | State |
|---|---|
| **naipepea** | Ready: the suite's own `deploy/naipepea.env` is current. Create the `naipepea` environment with its two secrets. |
| **bomet** | **Not ready.** The suite now signs in through Keycloak and the Identity BFF, which needs bomet's workspace slug, and nobody has recorded it yet. Until `IDENTITY_TEST_TENANT_SLUG` is in bomet's config, a run stops with that message. If bomet doesn't run the new sign-in at all, it needs its own branch carrying a suite version from before that change (§4). Try `profile-only` first. |
| **custom** | A template for any other deployment: copy its config, fill in the address and tenant, and make it a new environment. |

### Add a new environment

1. Write its config: copy `environments/naipepea/config.env` and either point `UPSTREAM_ENV` at a suite profile, or remove it and set:

   ```
   BASE_URL=https://…
   IDENTITY_TEST_TENANT_SLUG=…
   DIGIT_TENANT=…
   ADMIN_USER=…
   …
   ```
2. Write its secrets, one `KEY=value` per line (see `secrets.example`).
3. On GitHub, create the environment and paste the two files (§2, step 2). That's all: it appears in the run form's dropdown.
4. Optional, for runs on your own machine: keep the two files as `environments/<name>/config.env` (commit it) and `environments/<name>/secrets.env` (git-ignored). Names there are lowercase letters, digits and `_`.

### Expectations: skip vs fail

The suite discovers what a deployment has: complaint types, personas, locales, escalation. The **expectations file** says what it **should** have.

| Declared | Missing on the deployment → |
|---|---|
| `required` | **fail**: a real gap to fix on the deployment |
| `optional` | **skip**, with the evidence |
| `absent` | **skip**: not applicable here, by design |

For a new environment:

1. Copy the suite's `tests/integration-tests/deploy/expectations/default.json` to `environments/<name>/expectations.json`.
2. Set its `"name"`.
3. Run `profile-only` and then `full` once.
4. Turn each surprise into a deliberate `required` or `absent`, with a reason in `_rationale`.

---

## 6. Running on a schedule

Scheduled runs are written but switched off. To switch them on:

1. Edit `.github/workflows/integration-tests.yml` **on master** and uncomment the two lines:

   ```yaml
   schedule:
     - cron: '30 20 * * *'
   ```

2. Optionally set the variables `SCHEDULED_ENVIRONMENT` (default `naipepea`: an environment with its two secrets, §2) and `SCHEDULED_BRANCH` (default `master`). Scheduled runs are always `full`.

Things to know about schedules:

- **Cron times are UTC.** `30 20 * * *` is 02:00 IST every day. Use `30 20 * * 1-5` for weekdays only. <https://crontab.guru> explains the format.
- **Schedules only run from the default branch** (master), whatever is on other branches.
- **GitHub pauses schedules in public repos after 60 days without activity.** A commit re-enables them.
- **Pick a quiet time.** A full run takes about an hour and changes data on the deployment. Avoid times when the deployment itself redeploys, or when someone else tests it.

---

## 7. Reading the results

### The run summary

This is on the run page; scroll down below the jobs. It shows:

- which suite, environment and scope ran, and the counts;
- any **unusual events**, with the failing tests and their first error line;
- tests **fixed** since the last run;
- the full list of failing tests;
- links to the dashboard, this run's Playwright report, and the downloadable results.

### The dashboard (GitHub Pages)

`https://gurjeet-egov.github.io/CMS-Automation/` lists one card per *suite × environment*.

Each card opens the suite's own dashboard:

- filters by status and by tag (`@persona`, `@area`, `@layer`, `@kind`);
- the run history of each test (the dots);
- run chips that open each run's full Playwright report.

It keeps 30 full runs. The newest `REPORTS_KEPT` (5) of them keep their full report; older ones show "report pruned" but keep their results.

### The downloadable results (artifact)

At the bottom of the run page, **Artifacts** → `results-<environment>`. This is a zip of the HTML report and `report.json` (plus screenshots, video or traces of failing tests if you switched them on), kept 90 days. To open it:

1. Unzip it.
2. Run:

   ```bash
   npx playwright show-report playwright-report
   ```

This is the way to see the report of a **partial** run (smoke, a folder, a grep), since only full runs go to the dashboard.

From a terminal:

```bash
gh run download <run-id> -n results-naipepea
```

Next to it, **`test-results`** holds the same results as JUnit XML (`results.xml`), under one name for every environment. It's what Test Run reads to bring a run's results in (see [Connect your test suite to Test Run](https://github.com/Gurjeet-eGov/Claude-Extensions/blob/master/test-run-console/docs/connect-a-suite.md)).

### What pass, fail and skip mean in this suite

| Result | Meaning |
|---|---|
| **pass** | The behaviour holds on this deployment. |
| **fail** | A regression, or a real defect the test correctly catches. Some are **red by design**: open-bug regression catchers that go green when the product is fixed. Don't "fix" them, and don't make them skip. The suite's `deploy/README.md` and `deploy/expectations/*.json` name them, e.g. `boundary-jurisdiction-496` and the attachment-detail half of `complaint-attachment` on bomet, and `mdms.rejectionReasons`. |
| **skip** | The deployment legitimately doesn't have the capability, as declared in its expectations file. A skip is a statement about the environment, not the code. |

Known reds raise **no alert** run after run. Only a *change* does (§8).

---

## 8. Recording, traces and alerts

### Recording (off by default)

| Variable | Off | On (`true`) |
|---|---|---|
| `RECORD_SCREENSHOTS` | no screenshot | a **screenshot** of each failing test |
| `RECORD_VIDEO` | no video | a **video** of each failing test |
| `RECORD_TRACES` | no trace | a **Playwright trace** of each failing test: every network call, the DOM at each step, a timeline. The best debugging tool. |

With all three off, a failing test still shows its error, the code line and a short text snapshot of the page (`error-context.md`). The report stays small and has no images.

**Before switching traces on**, know what you are publishing:

- A trace contains the session tokens the test used.
- The dashboard is public, so anyone could read those tokens from it until they expire, and act on the deployment as that user.

Switch traces on only for a deployment where that's acceptable, or only briefly while debugging. Then switch them off again and let the old reports age out (`REPORTS_KEPT`).

Recording every test (as the deployment box does) isn't offered here: a full run would then be several GB, past GitHub Pages' 1 GB limit. The publish step warns when the site passes 800 MB.

### What counts as "unusual"

These make the run red, and make GitHub email you:

| Event | Meaning |
|---|---|
| **config missing** | A required setting is missing (URL, tenant, workspace slug, a malformed secret line). |
| **unreachable** | The deployment didn't answer, so no test ran. |
| **setup failed** | A setup step (sign-in, discovery, fixtures) failed, so the tests depending on it never ran. |
| **cut short** | The run hit its time limit (`PW_GLOBAL_TIMEOUT_MS`). What finished is still published. |
| **no report / suite error** | Playwright crashed, or couldn't load a spec. |
| **runner error** | The test job broke before it could record anything. |
| **not published** | A full run couldn't be added to the dashboard, so it couldn't be compared with the previous one. |
| **regressed** (full runs) | It passed the last time it ran, and fails now. |
| **now skipped** (full runs) | It passed before, and skips now. |
| **stopped running** (full runs) | It passed in the previous run, and has no result now. |
| **failing** (partial runs) | Any failing test. |

What does **not** count:

- A test that was already failing in the previous full run.
- The **first** full run on a dashboard. That one becomes the baseline; its failures are listed but don't alert.

### Turning the emails off

Your GitHub notification settings (§2, step 4).

---

## 9. Running on your own machine

The same scripts CI uses, so a local run behaves like a CI run. It needs Node 20+ and git.

1. Copy the example and fill in the values:

   ```bash
   cp environments/naipepea/secrets.example environments/naipepea/secrets.env
   ```

   `secrets.env` is git-ignored.

2. Run what you need:

   ```bash
   ci/run-local.sh naipepea profile-only
   ```

   ```bash
   ci/run-local.sh naipepea smoke
   ```

   ```bash
   ci/run-local.sh naipepea citizen --grep @area:pgr
   ```

   ```bash
   ci/run-local.sh naipepea smoke -- --headed
   ```

   `-- --headed` shows the browser while it runs.

The script prepares the suite in `.work/suite`, installs what's missing, runs the tests, and prints the same summary as CI. To open the report afterwards:

```bash
(cd .work/suite && npx playwright show-report ../out/playwright-report)
```

To work on specs, edit them in `tests/integration-tests/`, never in `.work/`. Each run copies the suite afresh.

---

## 10. Troubleshooting

| What you see | Why, and what to do |
|---|---|
| **CONFIG_ENV is missing in the X environment's secrets** (or **SECRETS_ENV**) | That environment lacks one of its two files. Paste it (§2, step 2). Picking an environment that isn't a deployment (such as `github-pages`) shows the same message. |
| **IDENTITY_TEST_TENANT_SLUG (the workspace slug) is not set** | Add it to the environment's `CONFIG_ENV` (and to `environments/<env>/config.env` for local runs). It's the `<slug>` in `https://<host>/<slug>/digit-ui/…`. |
| **line N of the SECRETS_ENV (or CONFIG_ENV) secret … is not KEY=value** | That line of the file is malformed. Update the secret (§2, step 2). The line's content is never shown, in case it's a password. |
| **setup failed** at sign-in, or "account is temporarily disabled" | A wrong password. Keycloak locks an account after a few failed sign-ins, so fix the secret, then wait for the lock to expire (or ask an admin to unlock it) before running again. |
| Citizen setup fails on the OTP | `IDENTITY_TEST_OTP_CODE` must be the deployment's fixed 6-digit code, and the deployment must have the fixed OTP switched on. |
| **unreachable** | The URL is wrong or the deployment is down. Open it in a browser. GitHub's runners are on the public internet, so a deployment reachable only on a VPN or office network needs a self-hosted runner. |
| The dashboard link shows **404** | Pages isn't switched on yet (§2, step 3), or the first publish is still deploying (about 1 minute). Partial runs don't create a dashboard. |
| "Playwright does not support chromium on ubuntu26.04" | Someone changed `runs-on` to `ubuntu-latest`. Keep `ubuntu-24.04` until the suite's Playwright version supports 26.04. |
| A run waits a long time before starting | Another run on the same environment is in progress. Only one at a time per environment. |
| The **Checks** workflow fails on "Every spec loads" | A spec in the PR doesn't import or compile. The log names the file. |

---

## 11. What each file does

| File | Role |
|---|---|
| `.github/workflows/integration-tests.yml` | The test run: form, the two jobs, Pages, verdict. |
| `.github/workflows/checks.yml` | Offline checks on pull requests. |
| `ci/prepare-suite.sh` | Puts this branch's suite at `.work/suite`. |
| `ci/load-env.sh` | Builds one environment's settings; reads secrets safely; names anything missing. |
| `ci/run-suite.sh` | Preflight, Playwright, and collecting results into `.work/out`. |
| `ci/playwright.ci.config.ts` | The suite's own config, with recording behind `RECORD_SCREENSHOTS` / `RECORD_VIDEO` / `RECORD_TRACES`. |
| `ci/summarize.mjs` | The verdict and the run summary. Uses the suite's own `scripts/regression-alert.mjs` for the comparison. |
| `ci/dashboard-key.mjs` | The dashboard's folder, `<branch>/<environment>`, in plain lowercase (`Nai Pepea` → `nai-pepea`). |
| `ci/publish-pages.sh`, `ci/push-pages.sh` | Add a run to the dashboard (the suite's `scripts/build-catalog.ts` + `dashboard/`) and push `gh-pages`. |
| `ci/site-index.html`, `ci/build-site-index.mjs` | The landing page that lists every dashboard. |
| `ci/run-local.sh` | All of the above, on your machine. |
| `ci/tests/` | Tests for the CI scripts. Run them with `node --test ci/tests/*.test.mjs`. |
| `environments/<name>/` | One deployment's public config and the list of its secret keys (§5). |
| `tests/integration-tests/` | The suite itself: the shared suite on master, customised on each deployment's branch. Its own `README.md` and `WRITING-TESTS.md` explain how to write specs. |
