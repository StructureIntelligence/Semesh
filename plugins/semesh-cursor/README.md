# Semesh — Cursor plugin

Discover Semesh Service Units, invoke their nested Actions, inspect deployment readiness, and observe existing
deployments. Production deployment authorization is currently unavailable: `app_deployments.create`
is disabled and source deploy fails closed with `deployment_authorization_unavailable`. The plugin bundles the Semesh MCP server so
Cursor can search the Service Unit catalog and invoke nested Actions (web search/scrape, models,
image/video, managed SQL, hosted agents) with an exact quote before each paid invocation.

## What this plugin ships

- **MCP server** (`./mcp.json`) — `npx -y semesh mcp`. Authenticated by your `semesh login`
  session or `SEMESH_API_KEY`.
- **Rule** (`./rules/semesh.mdc`) — teaches the agent the search → inspect → call workflow and
  the deploy / end-user-pays recipes.
- **Skill** (`./skills/semesh/SKILL.md`) — model-invoked guidance for when/how to use Semesh.

## Setup (once)

```bash
npm install -g semesh@latest
semesh login        # browser approval — or set SEMESH_API_KEY=YOUR_API_KEY for headless
```

## Install

- **Marketplace:** search "Semesh" in the Cursor plugin marketplace once approved.
- **One-click MCP:** see the "Add to Cursor" badge at https://semesh.io/docs
- **Local test:** copy this `semesh/` dir into `~/.cursor/plugins/local/` and reload Cursor.

---

> **Maintainer note (validate before submitting):** Cursor's `.cursor-plugin/plugin.json` and
> `marketplace.json` schemas evolve. Confirm them against the current reference at
> https://cursor.com/docs/reference/plugins before submitting at https://cursor.com/marketplace/publish.
> `category` belongs to a marketplace plugin entry, while this per-plugin manifest carries the
> component paths and author metadata documented for `.cursor-plugin/plugin.json`.
