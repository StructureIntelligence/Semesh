# Notes for an agent working in this repo

This is the kind of app an agent builds and ships in one shot: a small, finished
full-stack web app on Semesh. It exists to *show the whole flow* — login, a
real database, and one paid action — not to be a big product.

## What it is

**Snippet Vault** — save text/code snippets to a managed database, and "polish"
any snippet with one metered AI capability call using explicit delegated-payer
admission. Do not infer capture from provider output or HTTP success.

## Shape

- **Framework:** Next.js (App Router). See `semesh.json` (`framework: nextjs`,
  lazy auth, sqlite database, runtime_api enabled).
- **Auth:** Semesh OAuth via the injected `/__semesh/*` edge routes
  (`login` / `logout` / `me`). No auth code to write.
- **Database:** Semesh managed SQLite, queried server-side in
  `lib/semesh.ts` → `dbQuery`. Table is created lazily.
- **Metered capability:** `app/api/polish/route.ts` calls `callCapability` and
  requires the end user's session as payer (`X-Semesh-Payer`) plus one stable
  `Idempotency-Key`. Missing payer fails with 401; there is no app-owner fallback.

## If you extend it

- Keep all Semesh calls in `lib/semesh.ts`. Don't sprinkle fetches around.
- Call money captured only from the explicit platform `x-semesh-charged-aev`
  header. Preserve valid output and retry the exact same input/key when the
  settlement outcome is unknown.
- The managed DB server key is **server-side only** — never expose it to the client.
- Before wiring a *real* capability, set `SEMESH_POLISH_CAPABILITY` and confirm
  the tool's exact input contract in the agent guide: https://semesh.io/agent.md
  (the `input` field names vary per capability). There's a `TODO` marking this.
- The "Powered by Semesh" badge in `components/powered-by-semesh.tsx` is
  optional and user-deletable.

© StructureIntelligence Inc.
