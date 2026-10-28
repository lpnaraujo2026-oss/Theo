// Importação única: leva a Estante e o progresso do curso (exportados do Claude) para o banco.
// Só importa se o banco estiver vazio, a menos que venha { force: true }.
import { authorized, fail, json, redis, redisPipeline, hasRedis } from "./_util.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") return fail("invalid_request", 405);
  if (!authorized(req)) return fail("session_expired", 401);
  if (!hasRedis()) return fail("db_disabled", 503);
  let b = {};
  try { b = await req.json(); } catch {}
  const n = await redis("HLEN", "col:livros");
  if (n > 0 && !b.force) return json({ importados: 0, jaExistiam: n });

  const origin = new URL(req.url).origin;
  const livros = await (await fetch(origin + "/seed/livros.json")).json();
  const ids = Object.keys(livros);
  const cmds = [];
  for (let i = 0; i < ids.length; i += 100) {
    const args = ["HSET", "col:livros"];
    for (const id of ids.slice(i, i + 100)) args.push(id, JSON.stringify(livros[id]));
    cmds.push(args);
  }
  try {
    const prog = await (await fetch(origin + "/seed/progresso.json")).json();
    if (prog && Object.keys(prog).length) cmds.push(["HSET", "col:academico", "progresso", JSON.stringify(prog)]);
  } catch {}
  await redisPipeline(cmds);
  return json({ importados: ids.length });
}
