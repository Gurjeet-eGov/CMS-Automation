# CMS-Automation

This repo runs the CMS/PGR complaint-management Playwright integration suite against DIGIT deployments on GitHub Actions. It has a public results dashboard and Slack alerts when a run goes unusually wrong.

- **New here or new to GitHub Actions?** Read **[docs/GUIDE.md](docs/GUIDE.md)**. It covers one-time setup click by click, running, branches, environments, results and troubleshooting.
- **Dashboard:** <https://gurjeet-egov.github.io/CMS-Automation/>, once GitHub Pages is switched on (guide §2, step 6).
- **Run the tests:** **Actions** → **Integration tests** → **Run workflow**.

## How it's organised

```
product repo (egovernments) ──"Sync product suite" PR──▶ master ──"Propagate" PRs──▶ impl/<implementation>
```

- **`tests/integration-tests/`** is the suite.
  - On `master` it's the shared baseline, brought in from the product repo and kept current through reviewed sync PRs.
  - On an `impl/<name>` branch it's that implementation's own version.
- **Each deployment is a GitHub Environment** (Settings → Environments) holding two secrets, each a whole file pasted once: `CONFIG_ENV` (config.env) and `SECRETS_ENV` (secrets.env). To run: Actions → Integration tests → pick the branch and the environment (scope and grep are optional).
- **`environments/<name>/`** holds example configs and the list of secret keys, used for runs on your own machine (`naipepea`, `bomet`, and `custom` as a template).
- **`ci/`** holds the scripts the workflows call. You can also run them locally with `ci/run-local.sh <environment> [scope]`.
- **`.github/workflows/`** holds four workflows: `integration-tests`, `sync-product-suite`, `propagate-to-implementations` and `checks`.

A run picks three things:

- the **suite**: the branch, or the product repo directly;
- the **environment**;
- the **scope**: from `profile-only` (read-only) to `full`.

Full runs go on the dashboard and are compared with the previous run. Only something *new* turns a run red: a regression, a setup failure, an unreachable deployment.
