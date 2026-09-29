# Security policy

Please do not disclose security vulnerabilities in public issues. Report them
privately through the repository's security advisory feature.

Security fixes are provided for the latest released minor version.

The repository runs a high-severity production dependency audit in CI and
uses automated dependency update proposals. The renderer treats graph labels,
metrics, and errors as text, and SVG export XML-escapes element content and
style attributes. Consumers must still avoid sending secrets or sensitive
model data to the browser.

Use `validateWorkflowSnapshot()` at API and persistence boundaries. Its strict JSON-data
check rejects executable values, class instances, non-finite numbers, sparse
arrays, and recursive references throughout known fields and extensions, and
does not invoke getters while inspecting unknown properties.

The browser suite also runs automated WCAG A/AA checks against every supported
host wrapper. Automated checks complement rather than replace manual keyboard
and screen-reader review.

The release gate scans public source files for common private-key and service
credential signatures. This is defense in depth, not a substitute for manual
review or secret scanning on the eventual hosting platform.

It also rejects binary, visual, font, archive, document, database, and
executable assets unless their source, license, reviewer, review date, and
content hash are declared in `PUBLIC_ASSETS.json`. Text fixtures and inline
example data remain subject to manual release review.
