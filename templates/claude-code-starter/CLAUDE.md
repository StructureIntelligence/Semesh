# Claude Code Starter — agent notes

This is a tiny Next.js app meant to be built by a coding agent and shipped on
Semesh (a product of StructureIntelligence Inc.).

## Check deployment readiness

```
semesh login
semesh deploy preflight . --full-stack --json
```

`app_deployments.create` is the currently unavailable Platform Action for source deployment; it is
never a Service Unit or nested Unit Action. Use only the read-only preflight shown above. Production
deployment authorization is currently unavailable and preflight may return
`deployment_authorization_unavailable`. Do not claim a build, charge, publication, or live URL. The
application contract includes:

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

## Adding a paid Service Unit Action

Read <https://semesh.io/agent.md>, then follow the canonical target flow: anonymous public Search,
anonymous token-pinned Unit detail, authenticated payer-bound nested Action quote, exact prepared
invoke, observation by the returned top-level `invocation_id`, and the terminal receipt. For a Model
Action, require the exact closed draft-2020-12 messages-only input schema: required non-empty
`messages`, with closed `[role,content]` items, role enum `[system,user,assistant]`, and non-empty
content. Select `deepseek-v3` only from `actions[].model_choices[]`: require one selectable,
non-callable, Group-free entry whose exact
`ref={model_id:"deepseek-v3",model_revision:<advertised-revision>}` is placed by `targets[]` under the
selected `UnitActionRef`. Send that same exact `model_choice_pin` beside, never inside, `input` in
quote and invoke. Require the exact draft-2020-12 chat output schema: top-level required `[message,usage]`; message
required `[role,content]` with role `{type:string,enum:[assistant]}` and content
`{type:string,minLength:1}`; usage required `[total_tokens]` with integer minimum zero; and
`additionalProperties:false` on the top, message, and usage objects. Only then read canonical
`result.message.content` and usage. Reject `{text}` and provider-shaped fallbacks; never turn that
choice or a provider into a second Unit or Action identity. Quote, invoke response, observation,
terminal receipt, app result, and exact replay must bind the same choice pin; the strict nested
Action `result` itself remains only `message` + `usage`.

Before the effect-capable POST, persist the exact quote-derived invoke bytes (UnitActionRef, Catalog,
model choice pin, input, quote reference, confirmation digest, and RFC3339 deadline) together with one stable
`Idempotency-Key`. An uncertain retry must resend those exact bytes and key without another Search or
quote. The key identifies the replay request; `invocation_id` identifies observation and must remain
distinct. Treat only top-level, non-negative JSON safe-integer Aev atoms in the matching terminal
receipt as settlement authority; string or unsafe rounded atom values fail closed. The receipt must
also bind the key, Invocation, quote/settlement references, exact authorization, and all quote
digests. Current target routes may return `404` or malformed data before rollout; fail closed and do
not switch protocols.
