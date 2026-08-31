import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const guard = path.join(root, "scripts", "check-ci-identity.mjs");
const headSHA = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const baseSHA = "1".repeat(40);
const mergeSHA = "2".repeat(40);
const runnerMergeSHA = "3".repeat(40);

function baseEnvironment() {
  return {
    PATH: process.env.PATH,
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    RUNNER_ARCH: "X64",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_REPOSITORY: "StructureIntelligence/Semesh",
    GITHUB_REPOSITORY_ID: "1271244662",
    GITHUB_REPOSITORY_OWNER: "StructureIntelligence",
    GITHUB_REPOSITORY_OWNER_ID: "292772730",
    GITHUB_WORKFLOW: "content-policy",
    SEMESH_EXPECTED_CHECKOUT_SHA: headSHA,
  };
}

function repository() {
  return { full_name: "StructureIntelligence/Semesh", id: 1271244662 };
}

function pushScenario() {
  return {
    env: {
      ...baseEnvironment(),
      GITHUB_EVENT_NAME: "push",
      GITHUB_SHA: headSHA,
      GITHUB_REF: "refs/heads/main",
      GITHUB_REF_NAME: "main",
      GITHUB_REF_TYPE: "branch",
      GITHUB_WORKFLOW_REF:
        "StructureIntelligence/Semesh/.github/workflows/content-policy.yml@refs/heads/main",
      GITHUB_WORKFLOW_SHA: headSHA,
    },
    event: {
      ref: "refs/heads/main",
      after: headSHA,
      forced: false,
      head_commit: { id: headSHA },
      repository: repository(),
    },
  };
}

function pullRequestScenario() {
  return {
    env: {
      ...baseEnvironment(),
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_SHA: mergeSHA,
      GITHUB_REF: "refs/pull/71/merge",
      GITHUB_REF_NAME: "71/merge",
      GITHUB_REF_TYPE: "branch",
      GITHUB_BASE_REF: "main",
      GITHUB_HEAD_REF: "ci-hardening",
      GITHUB_WORKFLOW_REF:
        "StructureIntelligence/Semesh/.github/workflows/content-policy.yml@refs/pull/71/merge",
      GITHUB_WORKFLOW_SHA: mergeSHA,
    },
    event: {
      action: "synchronize",
      number: 71,
      repository: repository(),
      pull_request: {
        merge_commit_sha: mergeSHA,
        base: { ref: "main", sha: baseSHA, repo: repository() },
        head: {
          ref: "ci-hardening",
          sha: headSHA,
          repo: { full_name: "contributor/Semesh", id: 999 },
        },
      },
    },
  };
}

function runScenario(scenario) {
  const directory = mkdtempSync(path.join(tmpdir(), "semesh-public-ci-identity-"));
  const eventPath = path.join(directory, "event.json");
  writeFileSync(eventPath, JSON.stringify(scenario.event));
  try {
    return spawnSync(process.execPath, [guard], {
      cwd: root,
      encoding: "utf8",
      env: { ...scenario.env, GITHUB_EVENT_PATH: eventPath },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertPass(scenario) {
  const result = runScenario(scenario);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^PUBLIC_CI_IDENTITY=PASS /m);
  assert.equal(result.stderr, "");
}

function assertReject(scenario, reason) {
  const result = runScenario(scenario);
  assert.equal(result.status, 2, result.stdout);
  assert.equal(
    result.stderr.match(/^PUBLIC_CI_IDENTITY=FAIL /gm)?.length ?? 0,
    1,
  );
  assert.match(result.stderr, new RegExp(`reason=${reason}`));
  assert.doesNotMatch(result.stderr, /\n\s+at\s/u);
}

test("admits an exact non-forced main push", () => {
  assertPass(pushScenario());
});

test("admits an exact pull request head with a merge-ref workflow", () => {
  assertPass(pullRequestScenario());
});

test("admits an exact pull request head with the base workflow", () => {
  const scenario = pullRequestScenario();
  scenario.env.GITHUB_WORKFLOW_REF =
    "StructureIntelligence/Semesh/.github/workflows/content-policy.yml@refs/heads/main";
  scenario.env.GITHUB_WORKFLOW_SHA = baseSHA;
  assertPass(scenario);
});

test("admits a fork whose head branch is also named main with the base workflow", () => {
  const scenario = pullRequestScenario();
  scenario.env.GITHUB_HEAD_REF = "main";
  scenario.env.GITHUB_WORKFLOW_REF =
    "StructureIntelligence/Semesh/.github/workflows/content-policy.yml@refs/heads/main";
  scenario.env.GITHUB_WORKFLOW_SHA = baseSHA;
  scenario.event.pull_request.head.ref = "main";
  assertPass(scenario);
});

test("admits a same-repository head run without equating it to the merge commit", () => {
  const scenario = pullRequestScenario();
  scenario.env.GITHUB_SHA = headSHA;
  scenario.env.GITHUB_WORKFLOW_REF =
    "StructureIntelligence/Semesh/.github/workflows/content-policy.yml@refs/heads/ci-hardening";
  scenario.env.GITHUB_WORKFLOW_SHA = headSHA;
  scenario.event.pull_request.head.repo = repository();
  assertPass(scenario);
});

test("admits a merge-ref workflow at the runner SHA when event merge identity differs", () => {
  const scenario = pullRequestScenario();
  scenario.env.GITHUB_SHA = runnerMergeSHA;
  scenario.env.GITHUB_WORKFLOW_SHA = runnerMergeSHA;
  assertPass(scenario);
});

test("admits a merge-ref workflow at the event merge SHA when runner identity differs", () => {
  const scenario = pullRequestScenario();
  scenario.env.GITHUB_SHA = runnerMergeSHA;
  assertPass(scenario);
});

const hostileScenarios = [
  [
    "foreign repository",
    () => {
      const scenario = pushScenario();
      scenario.env.GITHUB_REPOSITORY = "attacker/Semesh";
      return scenario;
    },
    "repository_mismatch",
  ],
  [
    "wrong repository id",
    () => {
      const scenario = pushScenario();
      scenario.env.GITHUB_REPOSITORY_ID = "1";
      return scenario;
    },
    "repository_id_mismatch",
  ],
  [
    "forced main push",
    () => {
      const scenario = pushScenario();
      scenario.event.forced = true;
      return scenario;
    },
    "forced_push_rejected",
  ],
  [
    "event after drift",
    () => {
      const scenario = pushScenario();
      scenario.event.after = "3".repeat(40);
      return scenario;
    },
    "event_after_mismatch",
  ],
  [
    "foreign workflow source",
    () => {
      const scenario = pushScenario();
      scenario.env.GITHUB_WORKFLOW_REF =
        "attacker/Semesh/.github/workflows/content-policy.yml@refs/heads/main";
      return scenario;
    },
    "workflow_ref_mismatch",
  ],
  [
    "workflow sha drift",
    () => {
      const scenario = pushScenario();
      scenario.env.GITHUB_WORKFLOW_SHA = "4".repeat(40);
      return scenario;
    },
    "workflow_sha_mismatch",
  ],
  [
    "unsupported event",
    () => {
      const scenario = pushScenario();
      scenario.env.GITHUB_EVENT_NAME = "schedule";
      return scenario;
    },
    "event_name_rejected",
  ],
  [
    "pull request targets another base",
    () => {
      const scenario = pullRequestScenario();
      scenario.event.pull_request.base.ref = "release";
      return scenario;
    },
    "pull_request_base_ref_mismatch",
  ],
  [
    "pull request targets a foreign repository",
    () => {
      const scenario = pullRequestScenario();
      scenario.event.pull_request.base.repo = { full_name: "attacker/Semesh", id: 7 };
      return scenario;
    },
    "pull_request_base_repository_mismatch",
  ],
  [
    "pull request head sha drifts from checkout",
    () => {
      const scenario = pullRequestScenario();
      scenario.event.pull_request.head.sha = "5".repeat(40);
      return scenario;
    },
    "checkout_sha_mismatch",
  ],
  [
    "pull request merge sha is null",
    () => {
      const scenario = pullRequestScenario();
      scenario.event.pull_request.merge_commit_sha = null;
      return scenario;
    },
    "pull_request_merge_sha_invalid",
  ],
  [
    "pull request merge sha is omitted",
    () => {
      const scenario = pullRequestScenario();
      delete scenario.event.pull_request.merge_commit_sha;
      return scenario;
    },
    "pull_request_merge_sha_invalid",
  ],
  [
    "pull request merge ref is labelled as a tag",
    () => {
      const scenario = pullRequestScenario();
      scenario.env.GITHUB_REF_TYPE = "tag";
      return scenario;
    },
    "github_ref_type_mismatch",
  ],
  [
    "pull request workflow sha does not match its ref",
    () => {
      const scenario = pullRequestScenario();
      scenario.env.GITHUB_WORKFLOW_SHA = baseSHA;
      return scenario;
    },
    "workflow_sha_mismatch",
  ],
  [
    "divergent merge identities cannot admit a third workflow sha",
    () => {
      const scenario = pullRequestScenario();
      scenario.env.GITHUB_SHA = runnerMergeSHA;
      scenario.env.GITHUB_WORKFLOW_SHA = "4".repeat(40);
      return scenario;
    },
    "workflow_sha_mismatch",
  ],
  [
    "fork head main cannot replace the base workflow sha",
    () => {
      const scenario = pullRequestScenario();
      scenario.env.GITHUB_HEAD_REF = "main";
      scenario.env.GITHUB_WORKFLOW_REF =
        "StructureIntelligence/Semesh/.github/workflows/content-policy.yml@refs/heads/main";
      scenario.env.GITHUB_WORKFLOW_SHA = headSHA;
      scenario.event.pull_request.head.ref = "main";
      return scenario;
    },
    "workflow_sha_mismatch",
  ],
];

for (const [name, makeScenario, reason] of hostileScenarios) {
  test(`rejects ${name}`, () => {
    assertReject(makeScenario(), reason);
  });
}

test("workflow freezes the reviewed supply chain and keeps one required job", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/content-policy.yml"), "utf8");
  assert.equal(
    createHash("sha256").update(workflow).digest("hex"),
    "ee1d4e0920585f44df5f47e186a36d4e5e2156dfad222235e9e473d81e84e95d",
  );
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /timeout-minutes: 5/u);
  assert.match(workflow, /actions\/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/u);
  assert.match(workflow, /actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/u);
  assert.match(workflow, /node-version: 22\.23\.1/u);
  assert.match(workflow, /RG_VERSION: 15\.2\.0/u);
  assert.match(workflow, /RG_REVISION: e89fff89ac/u);
  assert.match(
    workflow,
    /RG_SHA256: 33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c/u,
  );
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /SEMESH_EXPECTED_CHECKOUT_SHA:/u);
  assert.match(workflow, /--connect-timeout 10 --max-time 50 --retry 2 --retry-max-time 50/u);
  assert.equal(
    workflow.match(/node scripts\/run-ci-heartbeat\.mjs --/gu)?.length ?? 0,
    6,
  );
  assert.ok(
    workflow.indexOf("name: Verify exact CI identity") <
      workflow.indexOf("name: Install exact ripgrep"),
  );
  assert.doesNotMatch(workflow, /uses:\s+[^\n]+@(v\d+|main|master)\b/u);
  assert.doesNotMatch(workflow, /ubuntu-latest|apt-get|actions\/cache|cache:/u);
  assert.equal(workflow.match(/^  confirmation-language:$/gm)?.length ?? 0, 1);
});
