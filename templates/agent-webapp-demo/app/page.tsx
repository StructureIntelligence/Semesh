"use client";

import { useCallback, useEffect, useState } from "react";
import {
  currentSettleUser,
  settleLoginPath,
  settleLogoutPath,
  type SettleUser,
} from "@/lib/semesh";
import {
  createPolishOperation,
  resolveStoredPolishOperation,
  POLISH_OPERATION_STORAGE_KEY,
} from "@/lib/polish-operation.mjs";
import { PoweredBySemesh } from "@/components/powered-by-semesh";

type Snippet = { id: number; title: string; body: string; created_at: string };
type PolishOperation = {
  id: string;
  input: string;
  principalId: string;
  result?: string;
};

function loadPolishOperation(principalId: string): {
  operation: PolishOperation | null;
  shouldClear: boolean;
} {
  if (typeof window === "undefined") return { operation: null, shouldClear: false };
  return resolveStoredPolishOperation(
    sessionStorage.getItem(POLISH_OPERATION_STORAGE_KEY),
    principalId
  ) as { operation: PolishOperation | null; shouldClear: boolean };
}

function storePolishOperation(value: PolishOperation | null) {
  if (typeof window === "undefined") return;
  if (value) sessionStorage.setItem(POLISH_OPERATION_STORAGE_KEY, JSON.stringify(value));
  else sessionStorage.removeItem(POLISH_OPERATION_STORAGE_KEY);
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
  const [polishOperation, setPolishOperation] = useState<PolishOperation | null>(null);
  const [note, setNote] = useState<string>("");

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
      setUser(u);
      setAuthChecked(true);
      const principalId = u?.id || u?.sub || "";
      const stored = principalId
        ? loadPolishOperation(principalId)
        : { operation: null, shouldClear: false };
      if (stored.operation) {
        setPolishOperation(stored.operation);
        setBody(stored.operation.result || stored.operation.input);
        setNote(`Recovered uncertain polish operation ${stored.operation.id}. Retry same operation reuses the exact original input and Idempotency-Key.`);
      } else if (stored.shouldClear) {
        storePolishOperation(null);
      }
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

  // One immutable body/key pair represents one logical paid operation. Unknown outcomes keep both
  // across reload and only trusted platform capture evidence is rendered as captured money.
  async function polish() {
    const principalId = user?.id || user?.sub || "";
    if (!user || !principalId) {
      setNote("Sign in with a valid Semesh identity before polishing.");
      return;
    }
    if (!polishOperation && !body.trim()) return;
    if (!polishOperation && body.trim().length > 10000) {
      setNote("Limit polish input to 10000 characters.");
      return;
    }
    const operation = polishOperation || {
      ...createPolishOperation(body.trim(), principalId),
    } as PolishOperation;
    if (!polishOperation) {
      setPolishOperation(operation);
      storePolishOperation(operation);
    }
    setPolishing(true);
    setNote("");
    try {
      const res = await fetch("/api/polish", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": operation.id,
        },
        body: JSON.stringify({ body: operation.input }),
      });
      const json = await res.json();
      const captured = json.settlement_status === "captured" &&
        typeof json.captured_aev === "number" &&
        Number.isFinite(json.captured_aev) &&
        json.captured_aev >= 0;

      // login_required is a pre-invocation rejection, so there is no uncertain paid effect to retain.
      if (res.status === 401) {
        setNote(apiErrorMessage(json.error));
        setPolishOperation(null);
        storePolishOperation(null);
        return;
      }
      if (!res.ok || json.error) {
        setNote(captured
          ? `${apiErrorMessage(json.error)} Trusted evidence reports ${json.captured_aev} Aev captured for operation ${operation.id}; inspect its platform record before retrying.`
          : `${apiErrorMessage(json.error)} Settlement is unknown for operation ${operation.id}; Retry same operation sends the exact original input and Idempotency-Key.`);
        return;
      }

      const polished = typeof json.polished === "string" ? json.polished : operation.input;
      setBody(polished);
      if (json.settlement_status === "not_applicable") {
        setNote(json.note || "Local polish completed without a paid operation.");
        setPolishOperation(null);
        storePolishOperation(null);
      } else if (captured) {
        setNote(`Polished · trusted platform evidence reports ${json.captured_aev} Aev captured.`);
        setPolishOperation(null);
        storePolishOperation(null);
      } else {
        const pending = { ...operation, result: polished };
        setPolishOperation(pending);
        storePolishOperation(pending);
        setNote(`Polished output is preserved, but settlement is unknown for operation ${operation.id}. Retry same operation sends the exact original input and Idempotency-Key.`);
      }
    } catch {
      setNote(`Network outcome is unknown for operation ${operation.id}. Retry same operation sends the exact original input and Idempotency-Key.`);
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
            Save snippets, polish them with one paid AI call. Shipped by an agent on Semesh.
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
          readOnly={!!polishOperation}
          placeholder="Paste a snippet or note…"
          rows={5}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={save} disabled={busy} style={buttonStyle}>
            {busy ? "Saving…" : "Save snippet"}
          </button>
          <button onClick={polish} disabled={polishing || !user} style={ghostButtonStyle}>
            {polishing ? "Polishing…" : polishOperation ? "Retry same operation" : "Polish with AI (paid)"}
          </button>
        </div>
        {note && <p style={{ margin: 0, fontSize: 13, color: "#9aa3b2" }}>{note}</p>}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 15, color: "#9aa3b2", fontWeight: 600, margin: "0 0 12px" }}>
          Your snippets {snippets.length ? `(${snippets.length})` : ""}
        </h2>
        {!snippetsLoaded ? (
          <p style={{ color: "#6b7280", fontSize: 14 }}>
            {note ? "Snippets are unavailable; the previous list was not replaced with an empty result." : "Loading snippets…"}
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
