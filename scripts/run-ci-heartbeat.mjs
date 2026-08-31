#!/usr/bin/env node

import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HEARTBEAT_INTERVAL_MS = 45_000;
export const HEARTBEAT_LINE = "PUBLIC_CI_HEARTBEAT=alive\n";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const DEFAULT_KILL_GRACE_MS = 5_000;
const PROCESS_GROUP_POLL_MS = 10;

function writeHeartbeat() {
  try {
    writeSync(2, HEARTBEAT_LINE);
  } catch {
    // A closed logging stream must not change the command result.
  }
}

function signalChild(child, signal, detached) {
  try {
    if (detached && child.pid !== undefined) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // The child may have exited between the signal and this call.
  }
}

function processGroupExists(child, detached) {
  if (!detached || child.pid === undefined) {
    return false;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

export function runCommand(command, args, options = {}) {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const heartbeatWriter = options.heartbeatWriter ?? writeHeartbeat;
  const manageSignals = options.manageSignals ?? false;
  const detached = options.detached ?? process.platform !== "win32";
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const stdio = options.stdio ?? "inherit";
  const env = options.env ?? process.env;

  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
    throw new TypeError("heartbeat_interval_invalid");
  }
  if (!Number.isSafeInteger(killGraceMs) || killGraceMs <= 0) {
    throw new TypeError("kill_grace_invalid");
  }

  return new Promise((resolve) => {
    let child;
    let finished = false;
    let heartbeatTimer;
    let killTimer;
    let processGroupPollTimer;
    let forwardedSignal = null;
    const signalHandlers = new Map();

    function cleanup() {
      if (heartbeatTimer !== undefined) {
        clearInterval(heartbeatTimer);
      }
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      if (processGroupPollTimer !== undefined) {
        clearTimeout(processGroupPollTimer);
      }
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
    }

    function finish(outcome) {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve(outcome);
    }

    function scheduleForcedTermination() {
      if (killTimer !== undefined || child === undefined) {
        return;
      }
      killTimer = setTimeout(() => {
        signalChild(child, "SIGKILL", detached);
      }, killGraceMs);
      killTimer.unref();
    }

    function finishCancellation() {
      const outcome = { code: null, signal: forwardedSignal, spawnError: false };
      if (child === undefined || !detached) {
        finish(outcome);
        return;
      }

      const deadline = Date.now() + killGraceMs;
      const sweep = () => {
        signalChild(child, "SIGKILL", detached);
        if (!processGroupExists(child, detached) || Date.now() >= deadline) {
          finish(outcome);
          return;
        }
        processGroupPollTimer = setTimeout(sweep, PROCESS_GROUP_POLL_MS);
      };
      sweep();
    }

    if (manageSignals) {
      for (const signal of FORWARDED_SIGNALS) {
        const handler = () => {
          if (forwardedSignal === null) {
            forwardedSignal = signal;
          }
          if (child !== undefined) {
            signalChild(child, signal, detached);
            scheduleForcedTermination();
          }
        };
        signalHandlers.set(signal, handler);
        process.on(signal, handler);
      }
    }

    try {
      child = spawn(command, args, {
        detached,
        env,
        stdio,
        windowsHide: true,
      });
    } catch {
      finish({ code: null, signal: null, spawnError: true });
      return;
    }

    heartbeatTimer = setInterval(() => {
      try {
        heartbeatWriter(HEARTBEAT_LINE);
      } catch {
        // Heartbeat observation is never command authority.
      }
    }, heartbeatIntervalMs);
    heartbeatTimer.unref();

    if (forwardedSignal !== null) {
      signalChild(child, forwardedSignal, detached);
      scheduleForcedTermination();
    }

    child.once("error", () => {
      if (forwardedSignal !== null) {
        finishCancellation();
      } else {
        finish({ code: null, signal: null, spawnError: true });
      }
    });
    child.once("close", (code, signal) => {
      if (forwardedSignal !== null) {
        finishCancellation();
      } else {
        finish({ code, signal, spawnError: false });
      }
    });
  });
}

async function main() {
  if (process.argv[2] !== "--" || process.argv.length < 4) {
    process.stderr.write("PUBLIC_CI_HEARTBEAT=FAIL reason=usage\n");
    process.exitCode = 2;
    return;
  }

  const outcome = await runCommand(process.argv[3], process.argv.slice(4), {
    manageSignals: true,
  });
  if (outcome.spawnError) {
    process.stderr.write("PUBLIC_CI_HEARTBEAT=FAIL reason=spawn_failed\n");
    process.exitCode = 2;
    return;
  }
  if (outcome.signal !== null) {
    try {
      process.kill(process.pid, outcome.signal);
    } catch {
      process.exitCode = 1;
    }
    return;
  }
  process.exitCode = outcome.code ?? 1;
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
