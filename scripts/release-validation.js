const exactVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const officialRegistry = "https://registry.npmjs.org/";

export function validateReleaseRegistry(value) {
  let registry;
  try {
    registry = new URL(value);
  } catch {
    throw new Error(`Invalid release package registry URL: ${value || "<empty>"}`);
  }
  if (
    registry.protocol !== "https:" ||
    registry.username ||
    registry.password ||
    registry.search ||
    registry.hash
  ) {
    throw new Error("Release package registry must be an uncredentialed HTTPS URL");
  }
  return registry.href;
}

export function validateReleaseVersion(version, manifestVersion) {
  if (!exactVersionPattern.test(version || "")) {
    throw new Error(
      "Release validation requires an exact version such as 1.0.0 or 1.1.0-rc.1",
    );
  }
  if (version !== manifestVersion) {
    throw new Error(
      `Release version ${version} does not match package.json version ${manifestVersion}; ` +
        "run the validation from the matching release checkout",
    );
  }
  return version;
}

export function parseReleaseValidationArguments(argv, manifestVersion, environment = {}) {
  let version = manifestVersion;
  let reportDirectory = ".artifacts/release-validation";
  let cycles = Number(
    environment.RELEASE_SOAK_CYCLES || environment.RC_SOAK_CYCLES || 50,
  );
  let registry = officialRegistry;
  let localArtifact = null;
  let positionalVersion = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--report-dir") {
      reportDirectory = argv[index + 1];
      index += 1;
      if (!reportDirectory) throw new Error("--report-dir requires a directory");
      continue;
    }
    if (argument.startsWith("--report-dir=")) {
      reportDirectory = argument.slice("--report-dir=".length);
      if (!reportDirectory) throw new Error("--report-dir requires a directory");
      continue;
    }
    if (argument === "--cycles") {
      cycles = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argument === "--registry") {
      registry = argv[index + 1];
      index += 1;
      if (!registry) throw new Error("--registry requires a URL");
      continue;
    }
    if (argument.startsWith("--registry=")) {
      registry = argument.slice("--registry=".length);
      if (!registry) throw new Error("--registry requires a URL");
      continue;
    }
    if (argument === "--local-artifact") {
      localArtifact = argv[index + 1];
      index += 1;
      if (!localArtifact) throw new Error("--local-artifact requires a tarball path");
      continue;
    }
    if (argument.startsWith("--local-artifact=")) {
      localArtifact = argument.slice("--local-artifact=".length);
      if (!localArtifact) throw new Error("--local-artifact requires a tarball path");
      continue;
    }
    if (argument.startsWith("--cycles=")) {
      cycles = Number(argument.slice("--cycles=".length));
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unknown release validation option: ${argument}`);
    }
    if (positionalVersion) throw new Error("Only one release version may be provided");
    version = argument;
    positionalVersion = true;
  }

  validateReleaseVersion(version, manifestVersion);
  if (!Number.isSafeInteger(cycles) || cycles < 10 || cycles > 200) {
    throw new Error("Release soak cycles must be an integer from 10 through 200");
  }

  return {
    version,
    reportDirectory,
    cycles,
    registry: validateReleaseRegistry(registry),
    localArtifact,
  };
}

export function formatReleaseValidationReport(report) {
  const lines = [
    `# Release validation: ${report.package}@${report.version}`,
    "",
    `- Result: **${report.status.toUpperCase()}**`,
    `- Revision: \`${report.revision}\``,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Soak cycles per browser: ${report.cycles}`,
    `- Package registry: ${report.registry}`,
    `- Package source: ${report.packageSource}`,
    `- Runtime: ${report.environment.node} on ${report.environment.platform}/${report.environment.arch}`,
    "",
    "| Check | Result | Duration |",
    "| --- | --- | ---: |",
  ];
  for (const phase of report.phases) {
    lines.push(
      `| ${phase.name.replaceAll("|", "\\|")} | ${phase.status} | ${(phase.durationMs / 1000).toFixed(2)} s |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
