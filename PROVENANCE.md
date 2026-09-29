# Provenance

The package implementation, protocol, declarations, tests, fixtures, Go
Recorder integration, and documentation are first-party files maintained in
this repository. They are released under the Apache-2.0 license.

The protocol build is runtime-self-contained. The `/workflow` entry re-exports
the declared `eino-workflow-dag` dependency and does not bundle it. Release
automation verifies the exact tarball and installed consumers before publish.

Package ownership, organization authorization, and registry state must be
confirmed by the maintainer immediately before the first npm publish.
