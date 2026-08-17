# Claude Code Starter — agent notes

This is a tiny Next.js app meant to be built by a coding agent and shipped on
Semesh (a product of StructureIntelligence Inc.).

## Check deployment readiness

```
semesh login
semesh tool show app_deployments.create --json
semesh deploy preflight . --full-stack --json
```

Production deployment authorization is currently unavailable: `app_deployments.create` is disabled and source deploy fails closed with `deployment_authorization_unavailable`. Do not claim a build, charge, publication, or live URL. When authorization becomes available and both checks allow it, the intended command is `semesh deploy . --full-stack --wait --json`; the deployment contract then includes:

- **Semesh OAuth login** in `lazy` mode — sign-in only happens when the user
  clicks. Auth endpoints `/__semesh/login`, `/__semesh/logout`, and `/__semesh/me`
  are injected at the edge; you do not implement them.
- **A managed database** (declared under `stack.database`). At runtime the app
  receives `SEMESH_PROJECT_ID` and `SEMESH_PROJECT_SERVER_KEY`; see
  `app/api/hello/route.ts` for a query example.

## Where things live

- `semesh.json` — the deploy manifest (framework, auth, database).
- `app/page.tsx` — one page that greets the signed-in user or shows a sign-in prompt.
- `app/api/hello/route.ts` — server route doing a managed-DB roundtrip.
- `components/powered-by-semesh.tsx` — optional badge, safe to delete.

## Adding capabilities

To call Semesh metered capabilities or payments, read the agent guide at
https://semesh.io/agent.md for the exact request bodies. Do not invent
endpoints — if unsure of a request shape, leave a TODO and consult agent.md.
