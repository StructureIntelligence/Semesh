#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EXPECTED = Object.freeze({
  repository: "StructureIntelligence/Semesh",
  repositoryId: "1271244662",
  repositoryOwner: "StructureIntelligence",
  repositoryOwnerId: "292772730",
  workflow: "content-policy",
  workflowPath: ".github/workflows/content-policy.yml",
  node: "v22.23.1",
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function requireValue(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing_${name.toLowerCase()}`);
  }
  return value;
}

function requireEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label}_mismatch`);
  }
}

function requireSHA(label, value) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function requireRepository(label, repository) {
  if (
    repository === null ||
    typeof repository !== "object" ||
    repository.full_name !== EXPECTED.repository ||
    String(repository.id) !== EXPECTED.repositoryId
  ) {
    throw new Error(`${label}_mismatch`);
  }
}

function loadEvent() {
  let event;
  try {
    event = JSON.parse(readFileSync(requireValue("GITHUB_EVENT_PATH"), "utf8"));
  } catch {
    throw new Error("event_payload_invalid");
  }
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("event_payload_invalid");
  }
  return event;
}

function readCheckoutSHA() {
  let value;
  try {
    value = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error("checkout_unreadable");
  }
  return requireSHA("checkout_sha", value);
}

function validateCommon(event, expectedCheckoutSHA) {
  requireEqual("node_version", process.version, EXPECTED.node);
  requireEqual("github_actions", requireValue("GITHUB_ACTIONS"), "true");
  requireEqual("runner_environment", requireValue("RUNNER_ENVIRONMENT"), "github-hosted");
  requireEqual("runner_os", requireValue("RUNNER_OS"), "Linux");
  requireEqual("runner_arch", requireValue("RUNNER_ARCH"), "X64");
  requireEqual("server_url", requireValue("GITHUB_SERVER_URL"), "https://github.com");
  requireEqual("api_url", requireValue("GITHUB_API_URL"), "https://api.github.com");
  requireEqual("repository", requireValue("GITHUB_REPOSITORY"), EXPECTED.repository);
  requireEqual("repository_id", requireValue("GITHUB_REPOSITORY_ID"), EXPECTED.repositoryId);
  requireEqual(
    "repository_owner",
    requireValue("GITHUB_REPOSITORY_OWNER"),
    EXPECTED.repositoryOwner,
  );
  requireEqual(
    "repository_owner_id",
    requireValue("GITHUB_REPOSITORY_OWNER_ID"),
    EXPECTED.repositoryOwnerId,
  );
  requireEqual("workflow", requireValue("GITHUB_WORKFLOW"), EXPECTED.workflow);
  requireRepository("event_repository", event.repository);
  requireEqual("checkout_sha", readCheckoutSHA(), expectedCheckoutSHA);
}

function validatePush(event, expectedCheckoutSHA, workflowRef, workflowSHA) {
  requireEqual("github_ref", requireValue("GITHUB_REF"), "refs/heads/main");
  requireEqual("github_ref_name", requireValue("GITHUB_REF_NAME"), "main");
  requireEqual("github_ref_type", requireValue("GITHUB_REF_TYPE"), "branch");
  requireEqual("event_ref", event.ref, "refs/heads/main");
  if (event.forced !== false) {
    throw new Error("forced_push_rejected");
  }

  const githubSHA = requireSHA("github_sha", requireValue("GITHUB_SHA"));
  requireEqual("event_after", requireSHA("event_after", event.after), githubSHA);
  requireEqual("checkout_sha", expectedCheckoutSHA, githubSHA);
  requireEqual("workflow_sha", workflowSHA, githubSHA);
  requireEqual(
    "workflow_ref",
    workflowRef,
    `${EXPECTED.repository}/${EXPECTED.workflowPath}@refs/heads/main`,
  );
  if (event.head_commit !== null && event.head_commit !== undefined) {
    requireEqual(
      "event_head_commit",
      requireSHA("event_head_commit", event.head_commit.id),
      githubSHA,
    );
  }
}

function validatePullRequest(event, expectedCheckoutSHA, workflowRef, workflowSHA) {
  if (!["opened", "reopened", "synchronize"].includes(event.action)) {
    throw new Error("pull_request_action_rejected");
  }
  if (!Number.isInteger(event.number) || event.number <= 0) {
    throw new Error("pull_request_number_invalid");
  }

  const pullRequest = event.pull_request;
  if (pullRequest === null || typeof pullRequest !== "object") {
    throw new Error("pull_request_payload_invalid");
  }
  requireRepository("pull_request_base_repository", pullRequest.base?.repo);
  requireEqual("pull_request_base_ref", pullRequest.base?.ref, "main");
  const baseSHA = requireSHA("pull_request_base_sha", pullRequest.base?.sha);
  const headSHA = requireSHA("pull_request_head_sha", pullRequest.head?.sha);
  requireEqual("checkout_sha", expectedCheckoutSHA, headSHA);
  if (
    pullRequest.head?.repo === null ||
    typeof pullRequest.head?.repo?.full_name !== "string" ||
    pullRequest.head.repo.full_name.length === 0
  ) {
    throw new Error("pull_request_head_repository_invalid");
  }

  const githubSHA = requireSHA("github_sha", requireValue("GITHUB_SHA"));
  let mergeSHA = null;
  if (pullRequest.merge_commit_sha !== null && pullRequest.merge_commit_sha !== undefined) {
    mergeSHA = requireSHA("pull_request_merge_sha", pullRequest.merge_commit_sha);
  }

  const mergeRef = `refs/pull/${event.number}/merge`;
  requireEqual("github_ref", requireValue("GITHUB_REF"), mergeRef);
  requireEqual("github_ref_name", requireValue("GITHUB_REF_NAME"), `${event.number}/merge`);
  requireEqual("github_ref_type", requireValue("GITHUB_REF_TYPE"), "branch");
  requireEqual("github_base_ref", requireValue("GITHUB_BASE_REF"), "main");
  requireEqual("github_head_ref", requireValue("GITHUB_HEAD_REF"), pullRequest.head.ref);

  const workflowPrefix = `${EXPECTED.repository}/${EXPECTED.workflowPath}@`;
  if (!workflowRef.startsWith(workflowPrefix)) {
    throw new Error("workflow_ref_mismatch");
  }
  const workflowSourceRef = workflowRef.slice(workflowPrefix.length);
  const trustedWorkflowSources = [
    [mergeRef, githubSHA],
    ["refs/heads/main", baseSHA],
  ];
  if (mergeSHA !== null) {
    trustedWorkflowSources.push([mergeRef, mergeSHA]);
  }
  if (pullRequest.head.repo.full_name === EXPECTED.repository) {
    trustedWorkflowSources.push([`refs/heads/${pullRequest.head.ref}`, headSHA]);
  }
  const matchingSources = trustedWorkflowSources.filter(
    ([sourceRef]) => sourceRef === workflowSourceRef,
  );
  if (matchingSources.length === 0) {
    throw new Error("workflow_ref_mismatch");
  }
  if (!matchingSources.some(([, sourceSHA]) => sourceSHA === workflowSHA)) {
    throw new Error("workflow_sha_mismatch");
  }
}

function main() {
  const event = loadEvent();
  const eventName = requireValue("GITHUB_EVENT_NAME");
  const expectedCheckoutSHA = requireSHA(
    "expected_checkout_sha",
    requireValue("SEMESH_EXPECTED_CHECKOUT_SHA"),
  );
  const workflowRef = requireValue("GITHUB_WORKFLOW_REF");
  const workflowSHA = requireSHA("workflow_sha", requireValue("GITHUB_WORKFLOW_SHA"));

  validateCommon(event, expectedCheckoutSHA);
  if (eventName === "push") {
    validatePush(event, expectedCheckoutSHA, workflowRef, workflowSHA);
  } else if (eventName === "pull_request") {
    validatePullRequest(event, expectedCheckoutSHA, workflowRef, workflowSHA);
  } else {
    throw new Error("event_name_rejected");
  }

  process.stdout.write(
    `PUBLIC_CI_IDENTITY=PASS event=${eventName} checkout_sha=${expectedCheckoutSHA} workflow_sha=${workflowSHA}\n`,
  );
}

try {
  main();
} catch (error) {
  const reason =
    error instanceof Error
      ? error.message.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 160)
      : "unknown_error";
  process.stderr.write(`PUBLIC_CI_IDENTITY=FAIL reason=${reason}\n`);
  process.exitCode = 2;
}
