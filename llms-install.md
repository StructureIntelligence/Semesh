# Installing the Semesh MCP server (for Cline and other MCP clients)

The Semesh MCP server is a published npm package that runs over **stdio** — no build step, no clone. To install it, add this entry to your MCP settings (for Cline: `cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "semesh": {
      "command": "npx",
      "args": ["-y", "semesh", "mcp"],
      "env": {
        "SEMESH_API_KEY": "<your Semesh API key>"
      }
    }
  }
}
```

## Auth
- Get a Semesh API key at https://semesh.io, set it as `SEMESH_API_KEY`.
- Or, instead of the env var, run `npm i -g semesh && semesh login` once (browser approval); the server reuses the stored session.

## What it does
`npx -y semesh mcp` exposes the Semesh Service Unit catalog and its nested Actions over MCP: discover with Search, inspect token-pinned Unit detail, request an input-aware quote, invoke the selected Action, then observe its Invocation and receipt. The official canonical Service Unit search path is `GET /v1/service-units/search?q={query}&scope={public|accessible|owned}`. The supported non-canonical read-only compatibility aliases are `GET /v1/services/search`, `GET /v1/units/{id...}`, and `GET /v1/groups/{id}`; each calls the same canonical handler and returns byte-identical `data`, with no independent catalog or execution authority. New clients must use the canonical routes. Send the bounded `meta.catalog_token` as `X-Semesh-Catalog-Token` only on the exact advertised Guide, Group, or Unit GET; never send it to quote, invoke, or another origin. `scope=public` Search/Detail is anonymous; `scope=accessible` and `scope=owned` are authenticated actor-specific states and must not enter a shared cache. The official canonical Service Unit action paths are `POST /v1/service-units/{unit_id}/actions/{action_id}/quote`, `POST /v1/service-units/{unit_id}/actions/{action_id}/invoke`, and `GET /v1/service-units/{unit_id}/actions/{action_id}/invocations/{invocation_id}`. The official canonical Invocation read paths are `GET /v1/invocations/{invocation_id}/receipt` and `GET /v1/invocations/{invocation_id}/events`. A canonical Service Unit Action quote is authenticated and effect-zero: it creates no hold, charge, ledger entry, or provider call. Authenticate before every canonical Service Unit Action quote or invoke; Search and public Detail remain anonymous. Preserve the exact `UnitActionRef`, Catalog pin and canonical input through quote/invoke, then observe the returned `invocation_id`; do not substitute the `Idempotency-Key`. A same-key byte-identical replay returns the same Invocation, provider result, receipt, and settlement reference without increasing provider effects, captures, or owner grants. Semesh publishes one public Model Service Unit; DeepSeek is a versioned choice advertised in an Action's `model_choices`, not a Unit, separate domain, Group, Action, or provider. Select the exact `{model_id,model_revision}` ref for `deepseek-v3` and repeat it as the `model_choice_pin` sibling of `input` in quote and invoke; never insert it into the closed messages-only input. Search may report `matched_choice=deepseek`, but quote, invoke, result, receipt, and same-key replay must preserve the same exact `UnitActionRef` and `model_choice_pin`. Retired legacy execution identities and resource-specific execution routes return only effect-zero `410 legacy_protocol_retired`; they never proxy, translate, execute, call a provider, or move money. A direct user request authorizes ordinary paid invocation, deploy, and mechanical publish without a duplicate confirmation. Quote/preflight informs cost and availability; it is not a second confirmation. Ask for a separate confirmation only for destructive, high-impact, authorization-expanding, truly irreversible, or explicitly `requires_confirmation` actions. Passing mechanical protocol checks publish and become discoverable automatically; there is no default human approval queue. Aev is the platform accounting unit. Card top-up is contained and Legal remains unverified; do not claim card funding is available.

Production deployment authorization is currently unavailable: `app_deployments.create` is disabled and source deploy fails closed with `deployment_authorization_unavailable` before upload, build, payment, publication, or a live URL. Deployment is a Platform Action, not a Service Unit: read the current agent guide or deploy help, then run `semesh deploy preflight . --full-stack --json`; existing status/logs/URL readback is observation, not authorization for a new release. The automatic mechanical publication policy applies when deployment authorization becomes available, not to today's denial.

## Verify
- The package is published on npm as `semesh` and listed in the official MCP Registry as `io.semesh/cli`.
- `npx -y semesh mcp` starts a newline-delimited JSON-RPC 2.0 stdio server; an `initialize` request returns `serverInfo.name = "semesh"`.
