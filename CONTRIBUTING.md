# Contributing

Thank you for helping improve `eino-viewer`.

## Branches and pull requests

`main` is the only long-lived development branch and must remain releasable.
Create a short-lived branch for every change, using a descriptive prefix such
as `feat/`, `fix/`, `docs/`, or `chore/`. Open a pull request against `main`,
resolve review threads, and wait for every required check before merging. Delete
the source branch after it is merged.

Do not create permanent `develop`, `stable`, or `production` branches. A
temporary `release/<version>` branch is appropriate only when a candidate needs
an extended freeze. A maintenance branch such as `v1-maintenance` is justified
only when the project is actively shipping fixes for more than one stable major
line.

## Development workflow

1. Install dependencies with `npm ci`.
2. Add or update focused tests for behavior changes.
3. Run `npm run prepublishOnly` and `npm run test:browser`. The publish gate
   includes syntax, documentation, types, unit tests, benchmarks, builds, and
   packed-tarball checks, including a temporary consumer build from the exact
   package artifact. `npm run lint:package` is available for focused publint
   and ESM/CommonJS type-resolution checks.
4. When changing production dependencies, update `THIRD_PARTY_NOTICES.md` and
   run `npm run check:licenses`.
5. When adding a binary or visual asset, record its provenance, license,
   reviewer, review date, and SHA-256 in `PUBLIC_ASSETS.json`, then run
   `npm run check:assets`.
6. Keep the renderer framework agnostic. Framework-specific integrations
   belong in adapters or examples.
7. Keep port-selection policy in `src/port-planner.js`; keep route geometry,
   obstacle checks, and route commitment in `src/routing.js`.
8. Keep source, fixtures, examples, comments, and documentation self-contained.
   Use neutral workflow data and public references; do not add private workspace
   paths, internal product identifiers, or cross-repository migration records.

Public JavaScript export changes must update `API_SURFACE.json` and
`CHANGELOG.md`. The distribution gate verifies that the manifest matches every
ESM, CommonJS, and UMD entry.

Public TypeScript declaration changes must also describe their compatibility
impact in `CHANGELOG.md`. After reviewing the declaration diff, run
`npm run types:surface` to update `TYPE_SURFACE.json`; the release gate rejects
unreviewed declaration changes across all typed subpaths.

Please open an issue before making a breaking protocol or public API change.
