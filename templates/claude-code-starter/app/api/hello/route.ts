export const dynamic = "force-dynamic";

const BASE = (process.env.SEMESH_BASE_URL || "https://api.semesh.net").replace(/\/+$/, "");

// Example server route that touches the managed database.
// Semesh injects SEMESH_PROJECT_ID and SEMESH_PROJECT_SERVER_KEY
// into the runtime when the app declares a database in semesh.json.
async function dbQuery(sql: string) {
  const projectId = process.env.SEMESH_PROJECT_ID;
  const serverKey = process.env.SEMESH_PROJECT_SERVER_KEY;
  if (!projectId || !serverKey) {
    return { error: "database env not injected (SEMESH_PROJECT_ID / SEMESH_PROJECT_SERVER_KEY missing)" };
  }
  const res = await fetch(`${BASE}/v1/projects/${projectId}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${serverKey}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const text = await res.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, payload };
}

export async function GET() {
  const result = await dbQuery("select 1 as ok");
  return new Response(
    JSON.stringify({ message: "hello from claude-code-starter", db: result }),
    { headers: { "content-type": "application/json" } }
  );
}
