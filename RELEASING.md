# Releasing eino-viewer

## Go SDK

The Go module is released separately from the npm viewer. Its module path is
`github.com/silicon-nora/eino-viewer/integrations/go`; version tags must include
the subdirectory prefix, for example `integrations/go/v0.1.0`. Run the SDK tests,
vet, race tests and `npm run test:protocol-v2:all` before tagging. The Go SDK
release workflow repeats these gates for the immutable tag. Publish the GitHub
release only after that workflow passes, then verify a fresh module download
from `proxy.golang.org` and a consumer build without a local replace directive.
The first SDK version contains the v2 public content/event/relation APIs,
immutable sealing, callback ownership filtering and separate redactors for
automatic I/O and explicitly projected content. Protocol schemaVersion 2 does
not require a Go module major version 2.

## npm viewer

`eino-viewer` is released from this standalone repository. Its published
`eino-workflow-dag` compatibility dependency must already be available on npm.
Do not publish from a developer checkout by hand; the GitHub release workflow
creates and publishes a validated immutable artifact with npm provenance.

## Release order

1. From a clean default-branch revision, run `npm run prepublishOnly`,
   `npm run test:go`, `npm run test:browser`, and the package dry-run.
2. Confirm repository authorization and npm ownership. Before the first
   release, confirm that the `eino-viewer` name is available.
3. Verify `npm view eino-workflow-dag@1.3.1 version --json` succeeds.
4. Create the `v0.1.0` GitHub release from the default-branch revision. Wait
   for the publish workflow and published-consumer smoke test to pass.
5. Verify `npm view eino-viewer@0.1.0 version --json` returns `0.1.0`.

## Local release rehearsal

```sh
npm run prepublishOnly
npm run test:go
npm run test:browser
npm run release:dry-run
```

The publish workflow also compiles, tests, and vets the Go projectors against
the supported Eino range. The package gate verifies ESM, CommonJS, TypeScript,
Vite, and the packed artifact before publishing.

The viewer-specific packed-size budget was revised from 100 to 104 KiB for
the static-result fidelity fixes (measured about 102.4 KiB). Iteration 2 adds
source-backed run summaries and strict body identity checks, measuring about 112.3
KiB; its bounded budget is 114 KiB. This is an explicit size-budget revision,
not a relaxation of API, type, evidence or consumer checks. The package still
excludes fixtures, the workbench, source maps, and bundled compatibility code.

## Failure and rollback

Stop if any workflow step fails. For a defective published version, prefer an
npm deprecation notice and a forward patch over unpublishing. Never reuse or
move a released tag.
