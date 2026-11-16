# vendor/ — product files this suite needs from outside its own folder

This folder is written by `ci/import-product-suite.mjs` (part of CMS-Automation's
"Sync product suite" workflow and `ci/prepare-suite.sh --source product`). **Do not edit it by hand.**

## Why it exists

In the product repo (`egovernments/Citizen-Complaint-Resolution-System`) this suite lives at `tests/integration-tests`,
and some specs import product source code by a relative path that climbs out of the suite folder.
Here, that path would lead nowhere, and a single import Playwright can't resolve aborts the **whole run**.
So every such file is copied here, keeping its product-repo path, and the import is pointed at the copy.
Each rewritten import line carries the comment `// vendored from the product repo: see vendor/README.md`.

| Copy in this suite | Original path in the product repo | Imported by |
|---|---|---|
| `vendor/product/digit-ui-esbuild/products/pgr/src/utils/geoLocation.js` | `digit-ui-esbuild/products/pgr/src/utils/geoLocation.js` | `tests/specs/pgr-geo-location-contract.spec.ts` |

Copied from `egovernments/Citizen-Complaint-Resolution-System` at `develop`, commit `a11596cc3e0a1f397042e6f2eb85bc1cf666bcec`.

## Working on it

- **To refresh it:** run the "Sync product suite" workflow. Every sync re-copies these files from the product repo
  and re-applies the same import rewrite, so they never drift from the product.
- **To change the behaviour:** fix it in the product repo, because these are the product's own source files, then sync.
  If an implementation really needs a different version, change the importing spec on that implementation's
  `impl/<name>` branch to import its own helper instead of editing this copy. The next sync would overwrite an edited copy.
- **When a new spec imports another file from outside the suite:** nothing to do. The next sync finds it, vendors it,
  and adds a row above. If the file can't be found, the sync stops and names it.
