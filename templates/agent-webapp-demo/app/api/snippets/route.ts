// Managed-database CRUD for snippets.
// GET  /api/snippets        -> list the signed-in user's snippets
// POST /api/snippets        -> create a snippet { title, body }
//
// The table is created lazily on first call. Semesh's managed SQLite is
// reached server-side via lib/semesh.ts (dbQuery), never from the browser.

import { dbQuery, resolveSettlePrincipal } from "@/lib/semesh";

export const dynamic = "force-dynamic";

async function ensureTable() {
  return dbQuery(
    `create table if not exists snippets (
       id integer primary key autoincrement,
       owner text not null,
       title text not null,
       body text not null,
       created_at text not null default (datetime('now'))
     )`
  );
}

function databaseFailure(result: { status: number; error?: string }) {
  const status = result.status >= 400 && result.status <= 599 ? result.status : 502;
  return Response.json(
    {
      error: {
        code: "database_query_failed",
        message: result.error || "The managed database query did not complete.",
      },
    },
    { status }
  );
}

export async function GET(req: Request) {
  const principal = await resolveSettlePrincipal(req);
  if (principal.ok === false) {
    return Response.json(
      { error: { code: principal.code, message: principal.message } },
      { status: principal.status }
    );
  }
  const table = await ensureTable();
  if (table.error) return databaseFailure(table);
  const result = await dbQuery(
    "select id, title, body, created_at from snippets where owner = ? order by id desc limit 100",
    [principal.principalId]
  );
  if (result.error) {
    return databaseFailure(result);
  }
  return Response.json({ snippets: result.payload });
}

export async function POST(req: Request) {
  const principal = await resolveSettlePrincipal(req);
  if (principal.ok === false) {
    return Response.json(
      { error: { code: principal.code, message: principal.message } },
      { status: principal.status }
    );
  }
  let body: { title?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const title = (body.title || "").trim().slice(0, 200);
  const text = (body.body || "").trim().slice(0, 10000);
  if (!title || !text) {
    return Response.json({ error: "title and body are required" }, { status: 400 });
  }
  const table = await ensureTable();
  if (table.error) return databaseFailure(table);
  const result = await dbQuery(
    "insert into snippets (owner, title, body) values (?, ?, ?)",
    [principal.principalId, title, text]
  );
  if (result.error) {
    return databaseFailure(result);
  }
  return Response.json({ ok: true });
}
