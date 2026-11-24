# vendor/ — product files this suite needs from outside its own folder

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

- **If the product changes the original:** copy the new version over the file here, by hand, from the product repo,
  and update the commit above.
- **To change the behaviour:** fix it in the product repo, because these are the product's own source files, then copy it here.
  If one deployment really needs a different version, change the importing spec on that deployment's branch
  to import its own helper instead of editing this copy.
- **When a new spec imports another file from outside the suite:** copy that file here at the same path under
  `vendor/product/`, point the import at the copy with the comment above, and add a row to the table.
