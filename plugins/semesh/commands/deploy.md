---
description: Check Semesh deploy readiness and observe existing deployments; new source deployment is currently unavailable
---

Prepare the app in the current directory, report the current deployment availability truth, and observe existing deployment records when ids are provided.

Steps:

1. Confirm auth: run `semesh whoami --json`. If it returns 401, tell the user to run `semesh login` (or set `SEMESH_API_KEY`) and stop — never proceed past a 401.
2. Read the mutation tool before packaging anything:
   ```bash
   semesh tool show app_deployments.create --json
   ```
3. Inspect the project shape and run the authenticated, read-only preflight:
   ```bash
   semesh deploy preflight . --full-stack --json
   ```
   Read tool `availability` plus preflight `admission.can_start_now`, `code`, `message`, and `fix`. Production deployment authorization is currently unavailable: `app_deployments.create` is disabled and deploy fails closed with `deployment_authorization_unavailable` before upload, build, payment, publication, or a live URL. Report that result and stop without a mutation.
4. For ids that already exist, use `semesh deploy status <app-id> --json`, `semesh deploy logs <build-id> --json`, and `semesh deploy url <app-id> --json`. Existing observation does not authorize a new release, and queued/candidate/preview state is not serving proof.
5. When deployment authorization becomes available and both checks allow the operation, the intended full-stack command is `semesh deploy . --name "$(basename "$PWD")" --full-stack --wait --json` (drop `--full-stack` for a plain static site). Report a live URL only from a successful serving response or URL readback; never construct one.
6. If the user wants an already serving app to charge end users, explain end-user-pays: the app attaches `X-Semesh-Payer` so each call is billed to the signed-in user's Aev balance, with a quote before spend and terminal capture evidence afterward.

A direct user request authorizes ordinary paid invocation, deploy, and mechanical publish without a duplicate confirmation. Quote/preflight informs cost and availability; it is not a second confirmation. Ask for a separate confirmation only for destructive, high-impact, authorization-expanding, truly irreversible, or explicitly `requires_confirmation` actions. Mechanical protocol checks are intended to publish automatically after authorization is available; there is no default human approval queue. If an already-started deployment's `--wait` times out, poll `semesh deploy status <app-id> --json` rather than concluding failure.
