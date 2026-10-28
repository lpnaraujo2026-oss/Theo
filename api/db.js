// Banco de dados do THEO: coleções de documentos JSON (livros, academico, ...).
// GET  /api/db?col=livros             -> { docs: { id: dados, ... } }
// GET  /api/db?col=academico&id=progresso -> { data: {...} | null }
// POST /api/db { col, id, op: "set"|"update"|"delete", data }
import { authorized, fail, json, redis, hasRedis } from "./_util.js";

export const config = { runtime: "edge" };

const okName = s => typeof s === "string" && /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(s);

export default async function handler(req) {
  if (!authorized(req)) return fail("session_expired", 401);
  if (!hasRedis()) return fail("db_disabled", 503, "banco não configurado");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const col = url.searchParams.get("col"), id = url.searchParams.get("id");
    if (!okName(col)) return fail("invalid_request", 400);
    if (id) {
      if (!okName(id)) return fail("invalid_request", 400);
      const v = await redis("HGET", "col:" + col, id);
      return json({ data: v ? JSON.parse(v) : null });
    }
    const flat = (await redis("HGETALL", "col:" + col)) || [];
    const docs = {};
    for (let i = 0; i < flat.length; i += 2) {
      try { docs[flat[i]] = JSON.parse(flat[i + 1]); } catch {}
    }
    return json({ docs });
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return fail("invalid_request", 400); }
    const { col, id, op } = b;
    if (!okName(col) || !okName(id)) return fail("invalid_request", 400);
    const key = "col:" + col;
    if (op === "delete") { await redis("HDEL", key, id); return json({ ok: true }); }
    let data = b.data && typeof b.data === "object" ? b.data : {};
    if (op === "update") {
      const cur = await redis("HGET", key, id);
      data = { ...(cur ? JSON.parse(cur) : {}), ...data };
      for (const k of Object.keys(data)) if (data[k] && data[k].__delete__) delete data[k];
    } else if (op !== "set") return fail("invalid_request", 400);
    await redis("HSET", key, id, JSON.stringify(data));
    return json({ ok: true, data });
  }
  return fail("invalid_request", 405);
}
