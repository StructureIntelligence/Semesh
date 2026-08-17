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
`npx -y semesh mcp` runs the Semesh capability-invoke MCP server: discover with search, inspect with show, request an input-aware quote, then call the selected entrypoint. The canonical HTTP invoke path is `POST /v1/capabilities/{id}/invoke`; `POST /v1/tools/{id}/call` is a compatibility alias only. A direct user request authorizes ordinary paid invocation, deploy, and mechanical publish without a duplicate confirmation. Quote/preflight informs cost and availability; it is not a second confirmation. Ask for a separate confirmation only for destructive, high-impact, authorization-expanding, truly irreversible, or explicitly `requires_confirmation` actions. Passing mechanical protocol checks publish and become discoverable automatically; there is no default human approval queue. Aev is the platform accounting unit. Card top-up is contained and Legal remains unverified; do not claim card funding is available.

Production deployment authorization is currently unavailable: `app_deployments.create` is disabled and source deploy fails closed with `deployment_authorization_unavailable` before upload, build, payment, publication, or a live URL. Check `semesh tool show app_deployments.create --json` and `semesh deploy preflight . --full-stack --json`; existing status/logs/URL readback is observation, not authorization for a new release. The automatic mechanical publication policy applies when deployment authorization becomes available, not to today's denial.

## Verify
- The package is published on npm as `semesh` and listed in the official MCP Registry as `io.semesh/cli`.
- `npx -y semesh mcp` starts a newline-delimited JSON-RPC 2.0 stdio server; an `initialize` request returns `serverInfo.name = "semesh"`.
