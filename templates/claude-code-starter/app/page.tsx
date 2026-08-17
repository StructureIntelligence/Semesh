"use client";

import { useEffect, useState } from "react";
import { PoweredBySemesh } from "../components/powered-by-semesh";

type Me = { authenticated: boolean; user?: { email?: string; name?: string } };

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Semesh injects these auth endpoints at the edge for every deployed app.
    fetch("/__semesh/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Me | null) => setMe(j))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const name = me?.user?.name || me?.user?.email || "there";

  return (
    <main style={{ fontFamily: "system-ui", padding: 32, maxWidth: 640, margin: "0 auto" }}>
      <h1>Claude Code Starter</h1>

      {loading ? (
        <p>Checking your session…</p>
      ) : me?.authenticated ? (
        <>
          <p>
            Hi <strong>{name}</strong> — you are signed in.
          </p>
          <p>
            <a href="/__semesh/logout">Sign out</a>
          </p>
        </>
      ) : (
        <>
          <p>You are not signed in yet.</p>
          <p>
            {/* Lazy auth: login is only triggered when the user clicks. */}
            <a href="/__semesh/login?return_to=/">Sign in with Semesh</a>
          </p>
        </>
      )}

      <PoweredBySemesh />
    </main>
  );
}
