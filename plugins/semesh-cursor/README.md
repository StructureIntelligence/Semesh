# Semesh — Cursor plugin

Discover and invoke Semesh capabilities, inspect deployment readiness, and observe existing
deployments. Production deployment authorization is currently unavailable: `app_deployments.create`
is disabled and source deploy fails closed with `deployment_authorization_unavailable`. The plugin bundles the Semesh MCP server so
Cursor can search and invoke the full capability catalog (web search/scrape, LLMs, image/video,
managed SQL, hosted agents) — every call metered, with a cost quote up front.

## What this plugin ships

- **MCP server** (`./mcp.json`) — `npx -y semesh mcp`. Authenticated by your `semesh login`
  session or `SEMESH_API_KEY`.
- **Rule** (`./rules/semesh.mdc`) — teaches the agent the search → inspect → call workflow and
  the deploy / end-user-pays recipes.
- **Skill** (`./skills/semesh/SKILL.md`) — model-invoked guidance for when/how to use Semesh.

## Setup (once)

```bash
npm install -g semesh@latest
semesh login        # browser approval — or set SEMESH_API_KEY=sk-semesh-... for headless
```

## Install

- **Marketplace:** search "Semesh" in the Cursor plugin marketplace once approved.
- **One-click MCP:** see the "Add to Cursor" badge at https://semesh.io/docs
- **Local test:** copy this `semesh/` dir into `~/.cursor/plugins/local/` and reload Cursor.

---

> **Maintainer note (validate before submitting):** Cursor's `.cursor-plugin/plugin.json` and
> `marketplace.json` schemas evolve. Confirm field names (`mcpServers`/`rules`/`skills`, `owner.email`,
> `category`) against the current docs at https://cursor.com/docs before submitting at
> https://cursor.com/marketplace/publish. `category: "Payments"` matches a category visible in the
> in-app marketplace; adjust if Cursor renames it.
