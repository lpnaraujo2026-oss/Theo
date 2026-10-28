// Capas dos livros.
// GET    /api/capa?id=...   imagem (pública, para funcionar em <img>)
// POST   /api/capa { type, data(base64) } -> { id, url }
// DELETE /api/capa?id=...
import { authorized, fail, json, redis, hasRedis, b64ToBytes } from "./_util.js";

export const config = { runtime: "edge" };

const okId = s => typeof s === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(s);

export default async function handler(req) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    if (!okId(id)) return fail("invalid_request", 400);
    if (hasRedis()) {
      const v = await redis("HGET", "capas", id);
      if (v) {
        const { t, d } = JSON.parse(v);
        return new Response(b64ToBytes(d), { headers: { "content-type": t || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
      }
    }
    // Capas migradas do Claude ficam como arquivos estáticos.
    return Response.redirect(new URL(`/capas/${id}.jpg`, url.origin), 302);
  }

  if (!authorized(req)) return fail("session_expired", 401);
  if (!hasRedis()) return fail("db_disabled", 503);

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return fail("invalid_request", 400); }
    if (!b.data || typeof b.data !== "string") return fail("invalid_request", 400);
    if (b.data.length > 6_000_000) return fail("too_large", 413);
    const nid = crypto.randomUUID().replace(/-/g, "");
    await redis("HSET", "capas", nid, JSON.stringify({ t: b.type || "image/jpeg", d: b.data }));
    return json({ id: nid, url: "/_blob/" + nid });
  }
  if (req.method === "DELETE") {
    if (!okId(id)) return fail("invalid_request", 400);
    const n = await redis("HDEL", "capas", id);
    return json({ deleted: !!n });
  }
  return fail("invalid_request", 405);
}
