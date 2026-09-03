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
| Short description | Discover Service Unit Actions and inspect app launch readiness for managed login, data, and usage billing. |
| Website | https://semesh.io/ |
| Support | https://semesh.io/support |
| Privacy policy | https://semesh.io/privacy |
| Terms of service | https://semesh.io/terms |
| Repository | https://github.com/StructureIntelligence/Semesh |

Long description:

> Semesh gives coding agents a searchable Service Unit catalog with nested Actions over the CLI and local MCP server, plus an app deployment contract for managed login, data, usage billing, and end-user payments. Production source deployment authorization is currently unavailable and fails closed before upload, build, payment, publication, or a live URL. Public Search and Detail are anonymous; authenticated Action quote/invoke and Platform Actions use the user's Semesh login or API key. A direct user request authorizes an ordinary paid invocation, deploy, or mechanical publish without a duplicate confirmation; only destructive, high-impact, authorization-expanding, truly irreversible, or explicitly confirmation-required effects need a separate confirmation.

## Starter Prompts

1. Deploy this app with Semesh, including login, a database, and usage billing.
2. Find the Semesh Service Unit Action for this task and quote its exact input before invoking it.
3. Turn this agent-built app into a paid product with end-user billing.

## Reviewer Access

Before submission, create a dedicated reviewer account with a non-expiring test API key and enough Aev credit for the test cases below. The reviewer flow must not require MFA, SMS, email confirmation, a private network, or a paid card. Enter the credential only in the OpenAI Platform portal; never commit it to Git.

## Positive Test Cases

1. **Service Unit discovery**
   - Prompt: `Show me which Semesh Service Unit Action can search the web for a topic.`
   - Expected behavior: The plugin uses `semesh search` and `semesh show` to select one Unit and one nested Action. Public Search/Detail stay anonymous; the returned Catalog token is sent only to the exact advertised Guide, Group, or Unit GET, never a mutation or another origin. No Action starts.
   - Expected result after rollout: A canonical Unit ID, Action ID, schema, effect, availability, and price mode from the token-pinned detail response. Until live Search advertises this target, the plugin must report the canonical contract unavailable and stop without an alternate route.

2. **Deploy a prepared app**
   - Prompt: `Deploy the provided sample app with Semesh and report the result.`
   - Expected behavior: The plugin treats deployment as a Platform Action, runs `semesh deploy preflight ./sample-app --full-stack --json`, and branches on `admission.can_start_now`, `code`, `message`, and `fix`.
   - Expected result: Current production returns `deployment_authorization_unavailable`; the plugin stops before upload, build, payment, publication, or URL creation and does not invent a success. This test must be updated before any future rollout claim.

3. **Add a managed database**
   - Prompt: `Prepare this app for persistent user data with Semesh.`
   - Expected behavior: The plugin identifies the deployment Platform Action recipe and runs the read-only preflight for the exact project.
   - Expected result: A structured fail-closed readiness result while production source deployment is unavailable; no mutation is attempted.

4. **Quoted Service Unit Action**
   - Prompt: `Use Semesh to generate an image for this review and report the receipt.`
   - Expected behavior: The plugin performs Search → token-pinned Unit detail → authenticated quote → invoke with the exact same UnitActionRef, Catalog pin, input, quote reference, and one stable Idempotency-Key. The quote is effect-zero and informs the direct request; it does not introduce a duplicate confirmation unless the Action contract explicitly requires one.
   - Expected result after rollout: A server-returned `invocation_id`, schema-valid result, and terminal receipt. The idempotency key is retained only for exact replay and is never substituted into an observation URL. While the canonical live route is absent, the expected current result is an effect-zero failure before quote/invoke with no legacy fallback.

5. **MCP availability**
   - Prompt: `Use the Semesh MCP server to find available Service Units and their Actions.`
   - Expected behavior: The bundled MCP process starts with `npx -y semesh mcp` and authenticates using the reviewer account.
   - Expected result after rollout: The canonical Service Unit catalog and nested Action contracts are discoverable without exposing provider bindings or a second execution identity. A local MCP process starting successfully is not proof that the target Catalog routes are live.

## Negative Test Cases

1. **Confirmation boundary is contract-driven**
   - Scenario: The user directly requests an ordinary reversible paid Action whose contract does not require confirmation.
   - Expected behavior: The plugin quotes and invokes in the same user-authorized flow without a duplicate confirmation. If the server instead returns `confirmation_required`, it displays the exact effect and stops for that separate confirmation.

2. **Unavailable deployment stays effect-zero**
   - Scenario: The user directly asks to deploy while production authorization remains unavailable.
   - Expected behavior: The plugin runs preflight and stops on `deployment_authorization_unavailable`; a repeated request or direct intent cannot override the server gate.

3. **Invalid or missing credentials**
   - Scenario: No Semesh login session or API key exists.
   - Expected behavior: The plugin explains how to run `semesh login` or set `SEMESH_API_KEY`; it does not fabricate credentials or attempt a paid action.

4. **Legacy protocol is never a fallback**
   - Scenario: Canonical Service Unit Search or Detail is unavailable, or a prompt supplies an old public ID or route.
   - Expected behavior: The plugin fails closed and returns to canonical Search. A retired request may return only effect-zero `410 legacy_protocol_retired`; it never proxies, translates, executes, calls a provider, or moves money.

## Release Notes

Initial public submission. Semesh bundles the public Service Unit catalog and nested Action journey over CLI/MCP, plus a fail-closed deployment Platform Action workflow for apps with login, managed data, usage billing, and end-user payments. Production source deployment is currently unavailable. Direct user intent authorizes ordinary paid invocation, deploy, and mechanical publish without duplicate confirmation; separate confirmation is reserved for destructive, high-impact, authorization-expanding, truly irreversible, or explicitly confirmation-required effects.

## Submission Gate

Submit only after all of the following are true:

- The OpenAI Platform organization has Apps Management write access for the submitter.
- StructureIntelligence Inc. has a verified business identity in the same OpenAI Platform organization.
- `https://semesh.io/support` is live and contains a public support path.
- A reviewer credential and sample app are available through the portal without MFA or private-network access.
- The plugin passes local validation and a clean-environment install test.
- Live readback advertises the canonical Service Unit Search/Detail/Action contract; until then, keep this packet as a target-state draft and do not submit it as a passing production integration.
