# Notes for an agent working in this repo

**Snippet Vault** is a compact Next.js demo: Semesh login, managed SQLite, and one paid polish Action. It uses the canonical Service Unit contract, not a capability/tool compatibility surface.

## Non-negotiable paid path

- Keep network integration in `lib/semesh.ts`: anonymous/no-store/credentials-omitted public Search → token-pinned public Unit Detail → authenticated effect-zero Action quote → exact Action invoke → Invocation observation → terminal receipt.
- Obtain `meta.catalog_token` only from the immediately preceding Search and send it only as `X-Semesh-Catalog-Token` to the matching public Detail GET. Never configure, log, persist, expose, or forward it to quote/invoke.
- Select one nested Action, require exactly `effect.requires_confirmation === false`, and preserve its exact `{unit_id,unit_revision,action_id,action_revision}` and `{view_generation,view_digest}` Catalog pin. Revisions and digests are lowercase `sha256:` plus 64 hex.
- Keep confirmation fields projection-specific: Detail uses only `effect.requires_confirmation`; the quote response must echo only top-level `confirmation_required:false`.
- Select `deepseek-v3` only from one exact Detail `model_choices[].ref` and preserve its advertised opaque `model_revision` byte-for-byte. Require that choice to be selectable, non-callable, Group-free, and targeted exactly once at the selected UnitActionRef. Quote with `{unit_action_ref,catalog,model_choice_pin,input,budget,deadline}`. Invoke with `{unit_action_ref,catalog,model_choice_pin,quote_reference,input,confirmed_effect_digest,deadline}` and the stable `Idempotency-Key` header.
- The UI must persist that complete invoke request and the key before the effect POST. Retry the exact stored request; never re-run Search/Detail/quote after a prepared request has crossed or may have crossed invoke.
- Keep identities separate: `idempotencyKey` is request replay identity; returned `invocation_id` is observation/receipt identity. Once an id is known, observe that id rather than inventing one from the key.
- Only the exact terminal `/v1/invocations/{invocation_id}/receipt` document may establish captured/released settlement. Bind its Invocation/replay/settlement identities, Unit/Action/Catalog/model pins, quote reference and receipt, digests, and safe atom conservation; HTTP success, provider output, and headers cannot upgrade settlement.
- Require `success === true` on every canonical Search, Detail, quote, invoke, observation, and receipt envelope before trusting `data`, pins, output, or settlement.
- Preserve the canonical JSON-integer atom wire shape. Accept only non-negative `Number.isSafeInteger` Aev amounts, and fail closed on strings, fractions, negatives, or values above `2^53 - 1`; never let a rounded number establish settlement.
- Missing configuration or any invalid/unavailable canonical response fails closed before invoke whenever the absence is known. Never add a legacy capability, generic billing quote, provider endpoint, or local execution fallback.
- The template configures one Model Unit Action. Detail must advertise the exact draft-2020-12 messages-only chat input schema; this app sends `{messages:[{role:"system",content:string},{role:"user",content:string}]}` and keeps the exact two-field `model_choice_pin` beside, never inside, input. Accept successful output only under the exact draft-2020-12 schema as `{message:{role:"assistant",content:nonempty string},usage:{total_tokens:integer>=0}}`, with `additionalProperties:false` at every object schema; never fall back to `{text}`, in-input `model_choice`, provider `choices`, `output`, or raw content. DeepSeek is not a Unit or provider binding.

## Other boundaries

- Resolve the stable same-origin Semesh principal before every database operation. Never derive row ownership from payer/session secrets.
- Keep database and API credentials server-side.
- `components/powered-by-semesh.tsx` is optional and user-deletable.

Run `npm test` and `npm run build` after changing the template.

© StructureIntelligence Inc.
