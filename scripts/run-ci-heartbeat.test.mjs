import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_LINE,
  runCommand,
} from "./run-ci-heartbeat.mjs";

const runner = path.resolve(import.meta.dirname, "run-ci-heartbeat.mjs");
const secret = "TOP_SECRET_ARG_AND_ENV_VALUE";

test("freezes a fixed ASCII heartbeat below sixty seconds", () => {
  assert.equal(HEARTBEAT_INTERVAL_MS, 45_000);
  assert.equal(HEARTBEAT_LINE, "PUBLIC_CI_HEARTBEAT=alive\n");
  assert.match(HEARTBEAT_LINE, /^[\x20-\x7e]+\n$/u);
  assert.doesNotMatch(
    HEARTBEAT_LINE,
    /time|date|pid|argv|command|elapsed|github|runner|secret/iu,
  );
});

test("does not emit a heartbeat for a fast command", async () => {
  const observed = [];
  const outcome = await runCommand(process.execPath, ["-e", "process.exit(0)"], {
    heartbeatIntervalMs: 500,
    heartbeatWriter: (line) => observed.push(line),
    stdio: "ignore",
  });
  assert.deepEqual(outcome, { code: 0, signal: null, spawnError: false });
  assert.deepEqual(observed, []);
});

test("emits only fixed heartbeat bytes without reflecting argv or env", async () => {
  const observed = [];
  const outcome = await runCommand(
    process.execPath,
    ["-e", "setTimeout(() => {}, 90)", secret],
    {
      env: { ...process.env, SECRET_SENTINEL: secret },
      heartbeatIntervalMs: 15,
      heartbeatWriter: (line) => observed.push(line),
      stdio: "ignore",
    },
  );
  assert.equal(outcome.code, 0);
  assert.ok(observed.length >= 2);
  assert.ok(observed.every((line) => line === HEARTBEAT_LINE));
  assert.doesNotMatch(observed.join(""), new RegExp(secret, "u"));
});

test("a heartbeat write failure cannot change the command result", async () => {
  const outcome = await runCommand(
    process.execPath,
    ["-e", "setTimeout(() => {}, 50)"],
    {
      heartbeatIntervalMs: 10,
      heartbeatWriter: () => {
        throw new Error(secret);
      },
      stdio: "ignore",
    },
  );
  assert.deepEqual(outcome, { code: 0, signal: null, spawnError: false });
});

test("preserves a nonzero command exit code", async () => {
  const outcome = await runCommand(process.execPath, ["-e", "process.exit(17)"], {
    heartbeatIntervalMs: 500,
    stdio: "ignore",
  });
  assert.deepEqual(outcome, { code: 17, signal: null, spawnError: false });
});

for (const expectedSignal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  test(`the CLI exits with the child ${expectedSignal} signal`, async () => {
    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          runner,
          "--",
          process.execPath,
          "-e",
          `process.kill(process.pid, ${JSON.stringify(expectedSignal)})`,
        ],
        { stdio: "ignore" },
      );
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: null, signal: expectedSignal });
  });
}

test("preserves binary child stdout and stderr byte for byte", async () => {
  const stdoutBytes = Buffer.from([0x00, 0xff, 0x0a, 0x41]);
  const stderrBytes = Buffer.from([0xfe, 0x00, 0x42, 0x0a]);
  const result = await new Promise((resolve) => {
    const source = [
      `process.stdout.write(Buffer.from(${JSON.stringify([...stdoutBytes])}));`,
      `process.stderr.write(Buffer.from(${JSON.stringify([...stderrBytes])}));`,
    ].join("\n");
    const child = spawn(process.execPath, [runner, "--", process.execPath, "-e", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
  assert.deepEqual(result, { code: 0, signal: null, stdout: stdoutBytes, stderr: stderrBytes });
});

test("cancellation forwards the signal and leaves no child process", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "semesh-public-heartbeat-"));
  const pidPath = path.join(directory, "child.pid");
  const source = [
    "const { writeFileSync } = require('node:fs');",
    `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    "process.on('SIGTERM', () => process.exit(0));",
    "setInterval(() => {}, 1000);",
  ].join("\n");

  try {
    const wrapper = spawn(process.execPath, [runner, "--", process.execPath, "-e", source], {
      stdio: "ignore",
    });
    let childPID;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        childPID = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.ok(Number.isSafeInteger(childPID));

    wrapper.kill("SIGTERM");
    const result = await new Promise((resolve) => {
      wrapper.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: null, signal: "SIGTERM" });
    assert.throws(() => process.kill(childPID, 0), { code: "ESRCH" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cancellation kills a stubborn descendant after its group leader exits", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "semesh-public-heartbeat-group-"));
  const pidPath = path.join(directory, "grandchild.pid");
  let grandchildPID;
  const grandchildSource = [
    "const { writeFileSync } = require('node:fs');",
    "process.on('SIGTERM', () => {});",
    `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const leaderSource = [
    "const { spawn } = require('node:child_process');",
    "process.on('SIGTERM', () => process.exit(0));",
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: 'ignore' });`,
    "setInterval(() => {}, 1000);",
  ].join("\n");

  try {
    const wrapper = spawn(
      process.execPath,
      [runner, "--", process.execPath, "-e", leaderSource],
      { stdio: "ignore" },
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        grandchildPID = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.ok(Number.isSafeInteger(grandchildPID));

    wrapper.kill("SIGTERM");
    const result = await new Promise((resolve) => {
      wrapper.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: null, signal: "SIGTERM" });

    let descendantAlive = true;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        process.kill(grandchildPID, 0);
        await new Promise((resolve) => setTimeout(resolve, 10));
      } catch (error) {
        if (error?.code === "ESRCH") {
          descendantAlive = false;
          break;
        }
        throw error;
      }
    }
    assert.equal(descendantAlive, false);
  } finally {
    if (Number.isSafeInteger(grandchildPID)) {
      try {
        process.kill(grandchildPID, "SIGKILL");
      } catch {
        // The expected path already removed the descendant.
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("spawn failures and usage errors are fixed and secret-free", async () => {
  const missing = await runCommand(`missing-${secret}`, [], {
    heartbeatIntervalMs: 500,
    stdio: "ignore",
  });
  assert.deepEqual(missing, { code: null, signal: null, spawnError: true });

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [runner, secret], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  assert.deepEqual(result, {
    code: 2,
    signal: null,
    stdout: "",
    stderr: "PUBLIC_CI_HEARTBEAT=FAIL reason=usage\n",
  });
  assert.doesNotMatch(result.stderr, new RegExp(secret, "u"));
});
