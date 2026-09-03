"use client";

import { useCallback, useEffect, useState } from "react";
import {
  currentSettleUser,
  isValidInvocationId,
  settleLoginPath,
  settleLogoutPath,
  type PreparedPolishAction,
  type SettleUser,
} from "@/lib/semesh";
import {
  challengePreparedPolishRequestPersistence,
  createPolishRequest,
  explicitEffectZero,
  mayClearPolishRecoveryAfterEffectZero,
  recoverPolishRequestStorage,
  removePolishRequestStorage,
  writePolishRequestStorage,
} from "@/lib/polish-operation.mjs";
import { PoweredBySemesh } from "@/components/powered-by-semesh";

type Snippet = { id: number; title: string; body: string; created_at: string };
type PolishRequest = {
  version: 2;
  persistenceEpoch: 0 | 1;
  effectMayHaveStarted: boolean;
  idempotencyKey: string;
  input: string;
  principalId: string;
  prepared?: PreparedPolishAction;
  invocationId?: string;
  result?: string;
};

const POLISH_HARD_STOP_MESSAGE =
  "Polish recovery is hard-stopped because browser storage contains unresolved evidence that could not be safely restored or removed. Do not reload or retry; no fresh prepare or paid request will be sent from this tab.";

function browserPolishStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function apiErrorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const error = value as { message?: unknown; code?: unknown };
    if (typeof error.message === "string") return error.message;
    if (typeof error.code === "string") return error.code;
  }
  return "The request could not be completed.";
}

export default function Home() {
  const [user, setUser] = useState<SettleUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snippetsLoaded, setSnippetsLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [polishRequest, setPolishRequest] = useState<PolishRequest | null>(null);
  const [polishStorageVolatile, setPolishStorageVolatile] = useState(false);
  const [polishHardStopped, setPolishHardStopped] = useState(false);
  const [note, setNote] = useState<string>("");
  const visibleNote = polishHardStopped ? POLISH_HARD_STOP_MESSAGE : note;

  const refresh = useCallback(async () => {
    const res = await fetch("/api/snippets", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || json.error) {
      setNote(apiErrorMessage(json.error));
      return;
    }
    setSnippets(Array.isArray(json.snippets) ? json.snippets : []);
    setSnippetsLoaded(true);
  }, []);

  useEffect(() => {
    currentSettleUser().then((u) => {
      const principalId = u?.id || u?.sub || "";
      const stored = principalId
        ? recoverPolishRequestStorage(browserPolishStorage(), principalId)
        : {
            ok: true,
            request: null,
            shouldClear: false,
            hardStop: false,
            paidContinuationAllowed: true,
          };
      if (!stored.paidContinuationAllowed || stored.hardStop) {
        setPolishRequest(null);
        setPolishHardStopped(true);
        setNote(POLISH_HARD_STOP_MESSAGE);
      } else if (stored.request) {
        const recovered = stored.request as PolishRequest;
        setPolishRequest(recovered);
        setBody(recovered.result || recovered.input);
        setNote(
          recovered.invocationId
            ? `Recovered invocation ${recovered.invocationId}. Retry reuses the persisted canonical request and Idempotency-Key; observation uses only this invocation_id.`
            : "Recovered a pending polish request. Once quoted, retry reuses its exact persisted canonical request and Idempotency-Key."
        );
      } else if (!stored.ok) {
        setNote("Browser session storage is unavailable. A paid invoke will remain blocked unless an exact prepared request can be written and read back.");
      }
      setUser(u);
      setAuthChecked(true);
    });
    refresh();
  }, [refresh]);

  async function save() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/snippets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const json = await res.json();
      if (json.error) setNote(apiErrorMessage(json.error));
      else {
        setTitle("");
        setBody("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  // Prepare is effect-zero. Its exact UnitActionRef, Catalog pin, model choice pin, messages-only
  // input, quote reference, and deadline are synchronously persisted with the key before effect.
  async function polish() {
    const principalId = user?.id || user?.sub || "";
    if (!user || !principalId) {
      setNote("Sign in with a valid Semesh identity before polishing.");
      return;
    }
    if (!polishRequest && !body.trim()) return;
    if (!polishRequest && body.trim().length > 10000) {
      setNote("Limit polish input to 10000 characters.");
      return;
    }
    if (polishHardStopped) {
      setNote(POLISH_HARD_STOP_MESSAGE);
      return;
    }
    let request = polishRequest || {
      ...createPolishRequest(body.trim(), principalId),
    } as PolishRequest;
    if (!polishRequest) {
      setPolishRequest(request);
      writePolishRequestStorage(browserPolishStorage(), request);
    }
    let retained = request;
    let volatileRecovery = polishStorageVolatile;
    setPolishing(true);
    setNote("");
    try {
      if (!request.prepared) {
        const prepareResponse = await fetch("/api/polish", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": request.idempotencyKey,
          },
          body: JSON.stringify({ mode: "prepare", body: request.input }),
        });
        const preparedJSON = await prepareResponse.json();
        if (!prepareResponse.ok || preparedJSON.error || !preparedJSON.prepared) {
          setNote(
            `${apiErrorMessage(preparedJSON.error)} No paid effect started; canonical Search/Detail/quote failed closed without a legacy fallback.`
          );
          setPolishRequest(null);
          removePolishRequestStorage(browserPolishStorage(), principalId);
          return;
        }

        request = { ...request, prepared: preparedJSON.prepared } as PolishRequest;
        retained = request;
        setPolishRequest(request);
      }

      if (!request.invocationId) {
        const persistenceProof = challengePreparedPolishRequestPersistence(
          browserPolishStorage(),
          request
        );
        request = persistenceProof.request as PolishRequest;
        retained = request;
        setPolishRequest(request);
        if (!persistenceProof.ok) {
          if (!persistenceProof.restored) {
            setPolishHardStopped(true);
            setNote(
              "Paid invoke was not sent, and browser storage could not restore the prior persistence epoch after the failed challenge. Hard stop: do not reload or retry this request."
            );
          } else {
            setNote(
              "Paid invoke was not sent: browser session storage did not retain and read back the newly challenged persistence epoch, possible-effect marker, full prepared request, and Idempotency-Key."
            );
          }
          return;
        }
      }

      const invokeResponse = await fetch("/api/polish", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": request.idempotencyKey,
        },
        body: JSON.stringify(
          request.invocationId
            ? {
                mode: "observe",
                prepared: request.prepared,
                invocation_id: request.invocationId,
              }
            : { mode: "invoke", prepared: request.prepared }
        ),
      });
      const json = await invokeResponse.json();
      const hasReturnedInvocationId =
        json !== null &&
        typeof json === "object" &&
        Object.prototype.hasOwnProperty.call(json, "invocation_id");
      const returnedInvocationId = isValidInvocationId(json?.invocation_id)
        ? json.invocation_id as string
        : null;
      if (hasReturnedInvocationId && returnedInvocationId === null) {
        setNote(
          `The response carried an invalid invocation identity. It was rejected; recovery retains ${retained.invocationId ? `invocation ${retained.invocationId}` : "the persisted Idempotency-Key"}.`
        );
        return;
      }
      if (
        returnedInvocationId &&
        (returnedInvocationId === retained.idempotencyKey ||
          (retained.invocationId !== undefined && returnedInvocationId !== retained.invocationId))
      ) {
        setNote(
          `The response carried a conflicting invocation identity. It was rejected; recovery retains ${retained.invocationId ? `invocation ${retained.invocationId}` : "the persisted Idempotency-Key"}.`
        );
        return;
      }

      const learnedInvocationId = !retained.invocationId && returnedInvocationId !== null;
      if (returnedInvocationId) {
        retained = { ...retained, invocationId: returnedInvocationId };
        // Retain the newest valid identity in memory before any browser-storage operation.
        setPolishRequest(retained);
      }
      if (typeof json.polished === "string") {
        retained = { ...retained, result: json.polished };
        setBody(json.polished);
      }
      setPolishRequest(retained);
      const retainedPersisted = writePolishRequestStorage(browserPolishStorage(), retained);
      if (retainedPersisted) {
        volatileRecovery = false;
        setPolishStorageVolatile(false);
      } else if (learnedInvocationId && retained.invocationId) {
        const invalidated = removePolishRequestStorage(browserPolishStorage(), principalId);
        if (!invalidated) {
          setPolishHardStopped(true);
          setNote(
            `Invocation ${retained.invocationId} is retained in memory, but browser storage neither saved it nor verified removal of the older no-ID record. Hard stop: do not reload or retry; this tab will send no further request.`
          );
          return;
        }
        volatileRecovery = true;
        setPolishStorageVolatile(true);
      }

      if (!invokeResponse.ok || json.error) {
        if (
          explicitEffectZero(json) &&
          mayClearPolishRecoveryAfterEffectZero(retained, json)
        ) {
          setPolishRequest(null);
          removePolishRequestStorage(browserPolishStorage(), principalId);
          setNote(`${apiErrorMessage(json.error)} The platform explicitly reports no effect; start a fresh discovery and quote.`);
        } else {
          setNote(
            `${apiErrorMessage(json.error)} Outcome remains uncertain. ${retained.invocationId ? `Observe only invocation ${retained.invocationId}${volatileRecovery ? " from this tab; do not reload or replay" : " using its persisted identity"}.` : "Retry only the exact persisted canonical request with the same Idempotency-Key."}`
          );
        }
        return;
      }

      const receiptAuthoritative =
        json.receipt &&
        (json.settlement_status === "captured" || json.settlement_status === "released");
      const totalTokens =
        json.usage &&
        Number.isSafeInteger(json.usage.total_tokens) &&
        json.usage.total_tokens >= 0
          ? json.usage.total_tokens
          : null;
      if (
        receiptAuthoritative &&
        (json.state === "succeeded" || json.state === "failed" || json.state === "canceled")
      ) {
        const amount = json.settlement_status === "captured"
          ? `${json.captured_aev_atoms} Aev atoms captured`
          : `${json.released_aev_atoms} Aev atoms released`;
        setNote(
          json.state === "succeeded"
            ? `Polished${totalTokens === null ? "" : ` · ${totalTokens} model tokens`} · terminal receipt reports ${amount} for invocation ${json.invocation_id}.`
            : `Invocation ${json.invocation_id} ended ${json.state}; terminal receipt reports ${amount}.`
        );
        setPolishRequest(null);
        removePolishRequestStorage(browserPolishStorage(), principalId);
      } else {
        setNote(
          `Invocation ${retained.invocationId || "is pending"} is ${json.state || "unknown"}; settlement remains unknown until its exact terminal receipt is available. ${retained.invocationId && volatileRecovery ? `Do not reload or replay; observe only invocation ${retained.invocationId} from this tab.` : "Retry reuses the stored request and key."}`
        );
      }
    } catch {
      setNote(
        `Network outcome is unknown. ${retained.invocationId ? `Observe only the newest invocation ${retained.invocationId}${volatileRecovery ? " from this tab; do not reload or replay" : " using its persisted identity"}.` : "Retry uses the exact persisted canonical request and Idempotency-Key."}`
      );
    } finally {
      setPolishing(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px 64px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, letterSpacing: -0.5 }}>Snippet Vault</h1>
          <p style={{ margin: "4px 0 0", color: "#9aa3b2", fontSize: 14 }}>
            Save snippets, polish them with one quoted Model Unit Action. Shipped by an agent on Semesh.
          </p>
        </div>
        <div style={{ textAlign: "right", fontSize: 13 }}>
          {!authChecked ? (
            <span style={{ color: "#9aa3b2" }}>…</span>
          ) : user ? (
            <>
              <div style={{ color: "#9aa3b2" }}>{user.email || "signed in"}</div>
              <a href={settleLogoutPath()} style={linkStyle}>Sign out</a>
            </>
          ) : (
            <a href={settleLoginPath("/")} style={{ ...linkStyle, ...primaryLinkStyle }}>
              Sign in
            </a>
          )}
        </div>
      </header>

      <section style={cardStyle}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          style={inputStyle}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          readOnly={!!polishRequest}
          placeholder="Paste a snippet or note…"
          rows={5}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={save} disabled={busy} style={buttonStyle}>
            {busy ? "Saving…" : "Save snippet"}
          </button>
          <button onClick={polish} disabled={polishing || !user || polishHardStopped} style={ghostButtonStyle}>
            {polishing ? "Polishing…" : polishRequest?.invocationId ? "Observe same invocation" : polishRequest ? "Retry same request" : "Polish with AI (paid)"}
          </button>
        </div>
        {visibleNote && <p style={{ margin: 0, fontSize: 13, color: "#9aa3b2" }}>{visibleNote}</p>}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 15, color: "#9aa3b2", fontWeight: 600, margin: "0 0 12px" }}>
          Your snippets {snippets.length ? `(${snippets.length})` : ""}
        </h2>
        {!snippetsLoaded ? (
          <p style={{ color: "#6b7280", fontSize: 14 }}>
            {visibleNote ? "Snippets are unavailable; the previous list was not replaced with an empty result." : "Loading snippets…"}
          </p>
        ) : snippets.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: 14 }}>Nothing saved yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {snippets.map((s) => (
              <li key={s.id} style={cardStyle}>
                <strong style={{ fontSize: 15 }}>{s.title}</strong>
                <pre style={preStyle}>{s.body}</pre>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{s.created_at}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer style={{ marginTop: 40, textAlign: "center" }}>
        {/* Optional badge — delete the import and this line to remove. */}
        <PoweredBySemesh />
      </footer>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#141822",
  border: "1px solid #232a37",
  borderRadius: 12,
  padding: 16,
  marginTop: 20,
  display: "grid",
  gap: 12,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0b0d12",
  border: "1px solid #2a3240",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#e7e9ee",
  fontSize: 14,
};
const buttonStyle: React.CSSProperties = {
  background: "#6366f1",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "transparent",
  border: "1px solid #2a3240",
  color: "#c7cdda",
};
const preStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 13,
  color: "#c7cdda",
};
const linkStyle: React.CSSProperties = { color: "#9aa3b2", textDecoration: "none" };
const primaryLinkStyle: React.CSSProperties = {
  color: "#fff",
  background: "#6366f1",
  padding: "8px 14px",
  borderRadius: 8,
  fontWeight: 600,
};
