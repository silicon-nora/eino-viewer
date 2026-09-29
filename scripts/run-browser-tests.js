import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const ownerName = "owner.json";
const kind = "eino-viewer-browser-validation";
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const exists = (path) => { try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } };

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; if (error.code === "EPERM") return true; throw error; }
}

function paths(root) {
  const canonical = realpathSync(root);
  return { root: canonical, lock: join(canonical, ".artifacts", "browser-validation.lock") };
}

function readOwner(location) {
  const directory = lstatSync(location.lock), path = join(location.lock, ownerName), file = lstatSync(path);
  if (!directory.isDirectory() || directory.isSymbolicLink() || !file.isFile() || file.isSymbolicLink()) throw new Error("Browser validation lock is not a regular owned lock.");
  const owner = JSON.parse(readFileSync(path, "utf8"));
  if (owner.kind !== kind || owner.version !== 2 || owner.root !== location.root || owner.host !== hostname()
    || !/^[a-f0-9-]{36}$/.test(owner.token) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
    || !["idle", "starting", "running"].includes(owner.phase)
    || !["none", "pending", "uncertain"].includes(owner.detachedDescendants)
    || !["posix-group", "process"].includes(owner.childMode)
    || owner.phase === "running" && (!Number.isSafeInteger(owner.childPid) || owner.childPid <= 0)
    || owner.phase !== "running" && owner.childPid !== null) throw new Error("Browser validation lock has incomplete or foreign ownership; it was left untouched.");
  return owner;
}

function childAlive(owner) {
  return owner.childPid !== null && alive(owner.childMode === "posix-group" ? -owner.childPid : owner.childPid);
}

function storeOwner(location, owner) {
  if (readOwner(location).token !== owner.token) throw new Error("Browser lock ownership changed; no lock was overwritten.");
  const temporary = join(location.lock, `owner-${owner.token}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(owner)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, join(location.lock, ownerName));
}

async function mutateLock(location, action, wait = false) {
  const directory = lstatSync(location.lock);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Browser validation lock is not a regular owned directory.");
  const gate = join(location.lock, "mutation.lock");
  for (let attempt = 0; ; attempt++) {
    try { mkdirSync(gate); break; }
    catch (error) {
      if (error.code !== "EEXIST" || !wait || attempt >= 40) throw new Error("Browser lock recovery/release is already in progress; no lock was removed.");
      await pause(25);
    }
  }
  let heldDirectory = location.lock;
  try {
    const retired = action();
    if (retired) heldDirectory = retired;
    return retired;
  } finally { rmdirSync(join(heldDirectory, "mutation.lock")); }
}

function retireOwner(location, owner) {
  if (readOwner(location).token !== owner.token) throw new Error("Browser lock ownership changed; no lock was removed.");
  const allowed = new Set([ownerName, "mutation.lock", `owner-${owner.token}.tmp`]);
  if (readdirSync(location.lock).some((name) => !allowed.has(name))) throw new Error("Unexpected browser lock entry; no lock was removed.");
  const temporary = join(location.lock, `owner-${owner.token}.tmp`);
  if (exists(temporary)) {
    const file = lstatSync(temporary);
    if (!file.isFile() || file.isSymbolicLink()) throw new Error("Unexpected browser lock entry; no lock was removed.");
  }
  // Move the verified lock out of the acquisition path atomically. Cleanup can
  // never remove a new task's lock, even if that task starts immediately.
  const retired = join(dirname(location.lock), `browser-validation-released-${owner.token}-${randomUUID()}`);
  renameSync(location.lock, retired);
  return retired;
}

function cleanRetired(retired, owner) {
  const temporary = join(retired, `owner-${owner.token}.tmp`);
  if (exists(temporary)) unlinkSync(temporary);
  unlinkSync(join(retired, ownerName));
  rmdirSync(retired);
}

// Recovery never signals a process, applies an age timeout, or touches reports.
export async function recoverBrowserLock(root = projectRoot) {
  const location = paths(root);
  if (!exists(location.lock)) return false;
  let owner;
  const retired = await mutateLock(location, () => {
    owner = readOwner(location);
    if (alive(owner.pid)) throw new Error(`Browser validation PID ${owner.pid} is still active (or inaccessible); recovery refused.`);
    if (owner.phase === "starting") throw new Error("The interrupted task did not finish registering its child; safe automatic recovery is unavailable. Inspect the recorded task manually; the lock was left untouched.");
    if (childAlive(owner)) throw new Error(`Browser validation child ${owner.childPid} is still active; recovery refused.`);
    if (owner.detachedDescendants !== "none") throw new Error("Detached Playwright descendants have no verified cleanup; automatic recovery refused. Inspect this task's own server/browser processes manually; the lock was left untouched.");
    if (owner.phase === "running" && owner.childMode === "process") throw new Error("This platform cannot verify all orphan descendants; recovery requires manual inspection. The lock was left untouched.");
    return retireOwner(location, owner);
  });
  cleanRetired(retired, owner);
  return true;
}

function acquire(root) {
  const location = paths(root);
  mkdirSync(dirname(location.lock), { recursive: true });
  try { mkdirSync(location.lock); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let identity = "an existing or incomplete lock";
    try { const owner = readOwner(location); identity = `PID ${owner.pid}, started ${owner.startedAt}`; } catch {}
    throw new Error(`Browser validation is already reserved by ${identity}. Nothing was built. After the task and its children exit, run npm run test:browser:recover; do not delete another task's lock or reports.`);
  }
  const owner = { kind, version: 2, root: location.root, host: hostname(), token: randomUUID(), pid: process.pid,
    startedAt: new Date().toISOString(), phase: "idle", childMode: process.platform === "win32" ? "process" : "posix-group", childPid: null,
    detachedDescendants: "none" };
  writeFileSync(join(location.lock, ownerName), `${JSON.stringify(owner)}\n`, { flag: "wx", mode: 0o600 });
  return { location, owner };
}

async function finishChild(child, mode, signal, beforeForce) {
  const target = mode === "posix-group" ? -child.pid : child.pid;
  const send = (value) => { try { process.kill(target, value); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  if (!alive(target)) return;
  send(signal || "SIGTERM");
  for (let attempt = 0; attempt < 100 && alive(target); attempt++) await pause(25);
  if (alive(target)) {
    // Persist uncertainty before killing a manager which can own independently
    // detached groups. Killing its group cannot prove those groups are gone.
    try { beforeForce?.(); } finally { send("SIGKILL"); }
  }
  for (let attempt = 0; attempt < 100 && alive(target); attempt++) await pause(25);
  if (alive(target)) throw new Error("A validation child has not exited; its lock is retained for verified recovery.");
}

export function browserValidationSteps(root, args, npm = process.env.npm_execpath, runToken = randomUUID()) {
  const npmCommand = (script) => npm
    ? { command: process.execPath, args: [npm, "run", script] }
    : { command: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run", script] };
  return [npmCommand("build:site"), npmCommand("build:portable"),
    { command: process.execPath, args: [join(root, "node_modules", "@playwright", "test", "cli.js"), "test", "tests/browser", ...args],
      mayDetachDescendants: true,
      env: { EINO_VIEWER_BROWSER_GUARDED: "1", EINO_VIEWER_BROWSER_OUTPUT_DIR: join(root, ".artifacts", "playwright", `browser-${runToken}`) } }];
}

// Internal injection permits deterministic Node-only tests; the CLI always uses
// the fixed project build/test pipeline and forwards arguments only to Playwright.
export async function runBrowserValidation({ root = projectRoot, steps, args = [] } = {}) {
  const { location, owner } = acquire(root);
  let child, interrupted, termination, uncertain = false;
  const beforeForce = () => {
    if (owner.detachedDescendants !== "none") {
      uncertain = true;
      owner.detachedDescendants = "uncertain";
      storeOwner(location, owner);
    }
  };
  const interrupt = (signal) => {
    interrupted ||= signal;
    if (child?.pid) {
      termination ||= finishChild(child, owner.childMode, signal, beforeForce).catch(() => { uncertain = true; });
    }
  };
  const onINT = () => interrupt("SIGINT"), onTERM = () => interrupt("SIGTERM");
  process.on("SIGINT", onINT); process.on("SIGTERM", onTERM);
  const pipeline = steps || browserValidationSteps(location.root, args, process.env.npm_execpath, owner.token);
  try {
    for (const step of pipeline) {
      if (interrupted) break;
      owner.phase = "starting";
      owner.detachedDescendants = step.mayDetachDescendants ? "pending" : "none";
      storeOwner(location, owner);
      child = spawn(step.command, step.args || [], { cwd: location.root, stdio: "inherit", detached: owner.childMode === "posix-group",
        env: { ...process.env, ...step.env } });
      const ended = new Promise((done) => {
        child.once("error", (error) => done({ error }));
        child.once("exit", (code, signal) => done({ code, signal }));
      });
      if (child.pid) {
        owner.childPid = child.pid; owner.phase = "running";
        storeOwner(location, owner);
      }
      const result = await ended;
      await termination;
      if (child.pid) await finishChild(child, owner.childMode, interrupted, beforeForce);
      if (owner.detachedDescendants !== "none" && (result.signal || uncertain)) {
        owner.detachedDescendants = "uncertain";
        storeOwner(location, owner);
        throw new Error("Playwright terminated abnormally; detached descendant cleanup is unverified and the browser lock was retained.");
      }
      // A normal CLI exit (success or test failure), including a handled INT/
      // TERM, follows Playwright's managed teardown. A dead PID alone does not.
      owner.detachedDescendants = "none";
      child = undefined;
      owner.childPid = null; owner.phase = "idle";
      storeOwner(location, owner);
      if (result.error) throw result.error;
      if (interrupted) break;
      if (result.code !== 0) return result.code || (result.signal === "SIGINT" ? 130 : 1);
    }
    return interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : 0;
  } finally {
    try {
      if (child?.pid) await finishChild(child, owner.childMode, interrupted, beforeForce);
      if (owner.detachedDescendants !== "none") throw new Error("Detached Playwright descendant cleanup is unverified; the browser lock was retained for manual inspection.");
      if (uncertain) throw new Error("Child termination could not be verified; the browser lock was retained.");
      const retired = await mutateLock(location, () => {
        if (childAlive(owner)) throw new Error("Child still active; the browser lock was retained.");
        return retireOwner(location, owner);
      }, true);
      cleanRetired(retired, owner);
    } finally { process.off("SIGINT", onINT); process.off("SIGTERM", onTERM); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--recover-lock") {
      if (args.length !== 1) throw new Error("--recover-lock takes no additional arguments.");
      console.log(await recoverBrowserLock() ? "Verified inactive browser validation lock released." : "No browser validation lock exists.");
    } else process.exitCode = await runBrowserValidation({ args });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
