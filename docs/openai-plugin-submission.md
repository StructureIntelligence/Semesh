# OpenAI Plugin Submission Packet

This packet is the source of truth for the public Semesh plugin submission. Keep reviewer credentials out of this repository and enter them only in the OpenAI Platform submission portal.

## Submission Type

Submit Semesh as a skills-plus-local-MCP plugin for Codex. The bundled skill installs the public `semesh` CLI and the bundled MCP configuration starts `npx -y semesh mcp` on the user's machine.

Do not submit this release as an MCP-backed ChatGPT app. The current MCP server is a local stdio command, not a publicly hosted HTTPS MCP endpoint. A future app-plus-skills release needs a public production MCP URL, domain verification, and remote authentication review.

## Listing Details

| Field | Value |
| --- | --- |
| Plugin name | Semesh |
| Publisher | StructureIntelligence Inc. |
| Category | Developer Tools |
| Short description | Deploy and monetize agent-built apps: login, database, usage billing, end-user payments. |
| Website | https://semesh.io/ |
| Support | https://semesh.io/support |
| Privacy policy | https://semesh.io/privacy |
| Terms of service | https://semesh.io/terms |
| Repository | https://github.com/StructureIntelligence/Semesh |

Long description:

> Semesh turns an agent-written app into a live, paid product in one command: managed OAuth login, a managed database, usage-based billing, and end-user payments. It also gives coding agents a searchable capability catalog over the Semesh CLI and local MCP server. The plugin requires the user's Semesh login or API key. It asks for confirmation before paid, deploy, publish, or destructive actions.

## Starter Prompts

1. Deploy this app with Semesh, including login, a database, and usage billing.
2. Show me the Semesh capabilities for this task and quote any paid action first.
3. Turn this agent-built app into a paid product with end-user billing.

## Reviewer Access

Before submission, create a dedicated reviewer account with a non-expiring test API key and enough Aev credit for the test cases below. The reviewer flow must not require MFA, SMS, email confirmation, a private network, or a paid card. Enter the credential only in the OpenAI Platform portal; never commit it to Git.

## Positive Test Cases

1. **Capability discovery**
   - Prompt: `Show me which Semesh capability can search the web for a topic.`
   - Expected behavior: The plugin uses `semesh search` and `semesh tool show` to identify the relevant capability, without completing a paid action.
   - Expected result: A tool identifier, plain-language capability summary, and any price/quote information available before execution.

2. **Deploy a prepared app**
   - Prompt: `Deploy the provided sample app with Semesh and wait for the live URL.`
   - Expected behavior: The plugin checks the target folder, explains the deployment scope, requests confirmation, then runs `semesh deploy ./sample-app --name reviewer-sample --full-stack --wait --json`.
   - Expected result: A `*.run.semesh.io` URL and structured deployment result.

3. **Add a managed database**
   - Prompt: `Prepare this app for persistent user data with Semesh.`
   - Expected behavior: The plugin identifies the relevant deploy or database recipe and explains the data impact before proceeding.
   - Expected result: A production deployment plan or an executed deployment only after confirmation.

4. **Quoted capability call**
   - Prompt: `Find a Semesh tool for image generation and show the quote before using it.`
   - Expected behavior: The plugin discovers the tool, presents quote information, and waits for an explicit confirmation before the metered call.
   - Expected result: No paid request occurs before approval; after approval, the result contains the generation output or job reference.

5. **MCP availability**
   - Prompt: `Use the Semesh MCP tools to list available capabilities.`
   - Expected behavior: The bundled MCP process starts with `npx -y semesh mcp` and authenticates using the reviewer account.
   - Expected result: The capability catalog is discoverable as MCP tools.

## Negative Test Cases

1. **No confirmation for a paid action**
   - Scenario: The user asks to run a metered image or model capability without approving the displayed cost.
   - Expected behavior: The plugin stops at the quote and requests confirmation; it does not use `--confirm` or charge the account.

2. **No confirmation for deployment**
   - Scenario: The user asks to deploy a local project but does not confirm the production action.
   - Expected behavior: The plugin explains the target, auth, database, and billing scope and asks for confirmation before invoking `semesh deploy`.

3. **Invalid or missing credentials**
   - Scenario: No Semesh login session or API key exists.
   - Expected behavior: The plugin explains how to run `semesh login` or set `SEMESH_API_KEY`; it does not fabricate credentials or attempt a paid action.

## Release Notes

Initial public submission. Semesh provides a Codex workflow for deploying agent-built apps with login, a managed database, usage-based billing, and end-user payments. The plugin also bundles the public Semesh CLI/MCP capability catalog. Paid, deployment, publishing, and destructive actions require explicit user confirmation.

## Submission Gate

Submit only after all of the following are true:

- The OpenAI Platform organization has Apps Management write access for the submitter.
- StructureIntelligence Inc. has a verified business identity in the same OpenAI Platform organization.
- `https://semesh.io/support` is live and contains a public support path.
- A reviewer credential and sample app are available through the portal without MFA or private-network access.
- The plugin passes local validation and a clean-environment install test.
