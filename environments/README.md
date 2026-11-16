# environments/

Each folder here describes one deployment the suite can run against. Full explanation: [docs/GUIDE.md §5](../docs/GUIDE.md#5-environments).

| File | Committed? | What goes in it |
|---|---|---|
| `config.env` | yes (public) | URL, tenant, workspace slug, logins, `UPSTREAM_ENV` (a profile the suite ships) |
| `secrets.example` | yes (public) | the **names** of the keys the `SECRETS_<NAME>` repository secret must hold |
| `expectations.json` | yes, optional | what the deployment should have: `required` / `optional` / `absent` per capability |
| `secrets.env` | **never** (git-ignored) | the same block as the secret, for local runs with `ci/run-local.sh` |

Folder names: lowercase letters, digits and `_` only, because the name becomes the secret's name (`kenya_uat` → `SECRETS_KENYA_UAT`).

A new folder also needs its name added to the `environment` options in `.github/workflows/integration-tests.yml`.
