import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { browserValidationSteps, recoverBrowserLock } from "./run-browser-tests.js";

const runnerURL = new URL("./run-browser-tests.js", import.meta.url).href;
const directory = realpathSync(mkdtempSync(join(tmpdir(), "eino-browser-guard-")));
const tasks = new Set(), groups = new Set(), detachedServerFiles = new Set();
const lock = (root) => join(root, ".artifacts", "browser-validation.lock");
const record = (root) => join(lock(root), "owner.json");
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const live = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
const step = (code) => ({ command: process.execPath, args: ["-e", code] });
function root(name) { const path = join(directory, name); mkdirSync(path); return path; }
function launch(path, steps) {
  const code = `import {runBrowserValidation} from ${JSON.stringify(runnerURL)};
    try { process.exitCode = await runBrowserValidation(${JSON.stringify({ root: path, steps })}); }
    catch(error) { console.error(error.message); process.exitCode=1; }`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  tasks.add(child);
  child.output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { child.output += data; });
  child.finished = new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => { tasks.delete(child); done({ code, signal }); });
  });
  return child;
}
async function until(check, description) {
  const end = Date.now() + 8000;
  while (!check()) { if (Date.now() > end) throw new Error(`Timed out: ${description}`); await pause(15); }
}
const hold = (ignore = false) => step(`process.on('SIGINT',()=>${ignore ? "{}" : "process.exit(0)"});process.on('SIGTERM',()=>${ignore ? "{}" : "process.exit(0)"});console.log('READY');setInterval(()=>{},1000);`);
function detachedManager(path, behavior) {
  const file = join(path, "detached-server.json");
  detachedServerFiles.add(file);
  // A real detached long-lived process models the server's ownership/lifetime;
  // no TCP listener is needed to verify groups, teardown or orphan retention.
  const server = `process.on('SIGTERM',()=>process.exit(0));process.send({pid:process.pid});setInterval(()=>{},1000);`;
  const manager = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
    const server=spawn(process.execPath,['-e',${JSON.stringify(server)}],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
    let closing=false; const close=(code)=>{if(closing)return;closing=true;server.once('exit',()=>process.exit(code));process.kill(-server.pid,'SIGTERM');};
    server.on('error',error=>{console.error(error);process.exit(1);});
    server.on('exit',(code,signal)=>{if(!closing){console.error('detached server exited',code,signal);process.exit(1);}});
    process.on('SIGINT',()=>${behavior === "ignore" ? "{}" : "close(0)"});
    process.on('SIGTERM',()=>${behavior === "ignore" ? "{}" : "close(0)"});
    server.on('message',info=>{fs.writeFileSync(${JSON.stringify(file)},JSON.stringify(info));console.log('SERVER_READY');
      ${behavior === "success" ? "close(0);" : behavior === "failure" ? "close(7);" : ""}});
    setInterval(()=>{},1000);`;
  return { ...step(manager), mayDetachDescendants: true };
}
function seed(path, overrides = {}) {
  mkdirSync(lock(path), { recursive: true });
  const owner = { kind: "eino-viewer-browser-validation", version: 2, root: path, host: hostname(), token: randomUUID(),
    pid: process.pid, startedAt: new Date().toISOString(), phase: "idle", childMode: "posix-group", childPid: null,
    detachedDescendants: "none", ...overrides };
  writeFileSync(record(path), JSON.stringify(owner));
  return owner;
}

try {
  {
    const args = ["--grep", "@P0|name with spaces", "--workers=4"], copy = [...args];
    const commands = browserValidationSteps(directory, args, "npm-cli.js", "test-run");
    assert.deepEqual(commands.slice(0, 2).map(({ args }) => args), [["npm-cli.js", "run", "build:site"], ["npm-cli.js", "run", "build:portable"]]);
    assert.deepEqual(commands[2].args.slice(1), ["test", "tests/browser", ...args]);
    assert.equal(commands[2].mayDetachDescendants, true, "Playwright owns separately detached webServer/browser processes");
    assert.ok(commands.slice(0, 2).every((entry) => !entry.mayDetachDescendants));
    assert.deepEqual(commands[2].env, { EINO_VIEWER_BROWSER_GUARDED: "1",
      EINO_VIEWER_BROWSER_OUTPUT_DIR: join(directory, ".artifacts", "playwright", "browser-test-run") });
    assert.deepEqual(args, copy, "Playwright arguments are passed verbatim, not shell-interpolated");
    const { default: config } = await import("../playwright.config.js");
    const previous = process.env.EINO_VIEWER_BROWSER_GUARDED;
    const previousOutput = process.env.EINO_VIEWER_BROWSER_OUTPUT_DIR;
    process.env.EINO_VIEWER_BROWSER_GUARDED = "1";
    process.env.EINO_VIEWER_BROWSER_OUTPUT_DIR = commands[2].env.EINO_VIEWER_BROWSER_OUTPUT_DIR;
    const guarded = (await import("../playwright.config.js?guarded-check")).default;
    if (previous === undefined) delete process.env.EINO_VIEWER_BROWSER_GUARDED; else process.env.EINO_VIEWER_BROWSER_GUARDED = previous;
    if (previousOutput === undefined) delete process.env.EINO_VIEWER_BROWSER_OUTPUT_DIR; else process.env.EINO_VIEWER_BROWSER_OUTPUT_DIR = previousOutput;
    assert.equal(guarded.webServer.reuseExistingServer, false, "guarded runs never borrow an unrelated existing server");
    assert.equal(guarded.outputDir, commands[2].env.EINO_VIEWER_BROWSER_OUTPUT_DIR, "each guarded run has its own default trace/output directory");
    assert.equal(config.webServer.reuseExistingServer, !process.env.CI && previous !== "1");
  }
  {
    const path = root("success"), trace = join(path, "trace");
    const children = ["build-site", "build-portable", "playwright"].map((name) => step(`require('node:fs').appendFileSync(${JSON.stringify(trace)},${JSON.stringify(name + "\n")});`));
    assert.equal((await launch(path, children).finished).code, 0);
    assert.equal(readFileSync(trace, "utf8"), "build-site\nbuild-portable\nplaywright\n");
    assert.equal(existsSync(lock(path)), false);
    assert.equal((await launch(path, []).finished).code, 0, "normal completion allows the next run");
  }
  {
    const path = root("busy"), marker = join(path, "must-not-build");
    const first = launch(path, [hold()]);
    await until(() => first.output.includes("READY"), "first fake step started");
    const saved = readFileSync(record(path), "utf8");
    const second = launch(path, [step(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'built');`)]);
    assert.equal((await second.finished).code, 1);
    assert.match(second.output, /Nothing was built/);
    assert.equal(existsSync(marker), false, "contending task exits before its first build");
    assert.equal(readFileSync(record(path), "utf8"), saved, "contending task cannot replace the first owner's lock");
    await assert.rejects(recoverBrowserLock(path), /still active/);
    first.kill("SIGTERM");
    assert.equal((await first.finished).code, 143);
    assert.equal(existsSync(lock(path)), false);
  }
  {
    const path = root("failure"), marker = join(path, "must-not-run");
    const child = launch(path, [step("process.exit(7)"), step(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`)]);
    assert.equal((await child.finished).code, 7);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(lock(path)), false);
    assert.equal((await launch(path, [{ command: join(path, "missing-command") }]).finished).code, 1);
    assert.equal(existsSync(lock(path)), false, "spawn failure also releases its own lock");
  }
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const path = root(signal), child = launch(path, [hold(signal === "SIGTERM")]);
    await until(() => child.output.includes("READY"), "signal fixture started");
    const owner = JSON.parse(readFileSync(record(path), "utf8"));
    groups.add(owner.childPid);
    child.kill(signal);
    assert.equal((await child.finished).code, signal === "SIGINT" ? 130 : 143, child.output);
    assert.equal(existsSync(lock(path)), false, "signal completion releases after child termination");
    assert.equal(live(process.platform === "win32" ? owner.childPid : -owner.childPid), false);
    groups.delete(owner.childPid);
    assert.equal((await launch(path, []).finished).code, 0);
  }
  {
    const path = root("changed-owner"), child = launch(path, [hold()]);
    await until(() => child.output.includes("READY"), "ownership fixture started");
    const foreign = { ...JSON.parse(readFileSync(record(path), "utf8")), token: randomUUID(), pid: process.pid };
    writeFileSync(record(path), JSON.stringify(foreign));
    child.kill("SIGTERM");
    assert.equal((await child.finished).code, 1);
    assert.match(child.output, /ownership changed/);
    assert.deepEqual(JSON.parse(readFileSync(record(path), "utf8")), foreign, "exit cannot release a different owner's lock");
  }
  if (process.platform !== "win32") {
    const path = root("killed-owner"), child = launch(path, [hold()]);
    await until(() => child.output.includes("READY"), "force-exit fixture started");
    const owner = JSON.parse(readFileSync(record(path), "utf8"));
    groups.add(owner.childPid);
    child.kill("SIGKILL");
    assert.equal((await child.finished).signal, "SIGKILL");
    const before = readFileSync(record(path), "utf8");
    await assert.rejects(recoverBrowserLock(path), /child .* still active/);
    assert.equal(readFileSync(record(path), "utf8"), before);
    process.kill(-owner.childPid, "SIGTERM");
    await until(() => !live(-owner.childPid), "orphan fake step exited");
    groups.delete(owner.childPid);
    const reports = join(path, ".artifacts", "report.json");
    writeFileSync(reports, "keep old report");
    assert.equal(await recoverBrowserLock(path), true);
    assert.equal(readFileSync(reports, "utf8"), "keep old report");
    assert.equal((await launch(path, []).finished).code, 0);
  }
  if (process.platform !== "win32") {
    for (const behavior of ["success", "failure", "SIGINT", "SIGTERM"]) {
      const path = root(`detached-graceful-${behavior}`), child = launch(path, [detachedManager(path, behavior)]);
      await until(() => child.output.includes("SERVER_READY"), "detached server ready");
      const server = JSON.parse(readFileSync(join(path, "detached-server.json"), "utf8"));
      if (behavior.startsWith("SIG")) child.kill(behavior);
      const expected = { success: 0, failure: 7, SIGINT: 130, SIGTERM: 143 }[behavior];
      assert.equal((await child.finished).code, expected, child.output);
      assert.equal(live(-server.pid), false, "manager's graceful teardown actually stops its separately detached server");
      assert.equal(existsSync(lock(path)), false, "verified graceful completion releases the lock");
    }
    for (const behavior of ["escalation", "manager-killed", "owner-killed"]) {
      const path = root(`detached-abnormal-${behavior}`);
      const child = launch(path, [detachedManager(path, behavior === "escalation" ? "ignore" : "hold")]);
      await until(() => child.output.includes("SERVER_READY"), "abnormal detached server ready");
      const owner = JSON.parse(readFileSync(record(path), "utf8"));
      const server = JSON.parse(readFileSync(join(path, "detached-server.json"), "utf8"));
      groups.add(owner.childPid);
      assert.notEqual(server.pid, owner.childPid);
      assert.equal(owner.detachedDescendants, "pending", "uncertainty is recorded before the manager can spawn detached children");
      if (behavior === "owner-killed") {
        child.kill("SIGKILL");
        assert.equal((await child.finished).signal, "SIGKILL");
        process.kill(-owner.childPid, "SIGKILL");
      } else {
        if (behavior === "escalation") child.kill("SIGTERM");
        else process.kill(-owner.childPid, "SIGKILL");
        assert.equal((await child.finished).code, 1, child.output);
        assert.match(child.output, /Detached Playwright descendant cleanup is unverified/);
      }
      await until(() => !live(-owner.childPid), "manager's own group exited");
      groups.delete(owner.childPid);
      assert.equal(live(-server.pid), true, "runner never kills a separate unregistered server group");
      const retained = readFileSync(record(path), "utf8");
      assert.equal(JSON.parse(retained).detachedDescendants, behavior === "owner-killed" ? "pending" : "uncertain");
      await assert.rejects(recoverBrowserLock(path), /Detached Playwright descendants/);
      assert.equal(readFileSync(record(path), "utf8"), retained);
      const marker = join(path, "must-not-build"), next = launch(path, [step(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`)]);
      assert.equal((await next.finished).code, 1);
      assert.equal(existsSync(marker), false);
      process.kill(-server.pid, "SIGTERM"); // Test owns this exact fake server; recovery never stops it.
      await until(() => !live(-server.pid), "test-owned detached server exited");
      await assert.rejects(recoverBrowserLock(path), /Detached Playwright descendants/,
        "no automated cleanup claim is made even after a human/test has stopped the unknown descendant");
    }
  }
  {
    const retired = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise((done) => retired.once("exit", done));
    const path = root("unverified"), owner = seed(path, { pid: retired.pid, phase: "starting" });
    await assert.rejects(recoverBrowserLock(path), /did not finish registering/);
    for (const patch of [{ host: "another-host" }, { root: directory }, { token: "foreign" }]) {
      writeFileSync(record(path), JSON.stringify({ ...owner, phase: "idle", ...patch }));
      await assert.rejects(recoverBrowserLock(path), /foreign ownership/);
    }
    writeFileSync(record(path), JSON.stringify({ ...owner, version: 1, phase: "idle" }));
    await assert.rejects(recoverBrowserLock(path), /incomplete or foreign ownership/, "older locks without detached-stage evidence require manual review");
    writeFileSync(record(path), "{broken");
    await assert.rejects(recoverBrowserLock(path));
    assert.equal(readFileSync(record(path), "utf8"), "{broken");
    writeFileSync(record(path), JSON.stringify({ ...owner, phase: "idle" }));
    writeFileSync(join(lock(path), "unrelated"), "do not remove");
    await assert.rejects(recoverBrowserLock(path), /Unexpected browser lock entry/);
    assert.equal(readFileSync(join(lock(path), "unrelated"), "utf8"), "do not remove");
    assert.equal(existsSync(record(path)), true);
    const redirected = root("symlink");
    mkdirSync(join(redirected, ".artifacts"));
    symlinkSync(lock(path), lock(redirected), "dir");
    await assert.rejects(recoverBrowserLock(redirected), /regular owned directory/);
  }
  console.log("OK: browser entry guard preserves ownership and managed teardown, refuses unverified detached-descendant recovery, and leaves foreign locks/servers/reports untouched");
} finally {
  for (const child of tasks) child.kill("SIGKILL");
  for (const pid of groups) { try { process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
  for (const file of detachedServerFiles) if (existsSync(file)) {
    const { pid } = JSON.parse(readFileSync(file, "utf8"));
    try { process.kill(-pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  rmSync(directory, { recursive: true, force: true });
}
