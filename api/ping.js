// Verifica a senha e informa o que está configurado.
import { authorized, json, hasRedis } from "./_util.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  const ok = authorized(req);
  return json({
    ok,
    senha: !!process.env.SITE_PASSWORD,
    claude: ok && !!process.env.ANTHROPIC_API_KEY,
    voz: ok && !!process.env.GOOGLE_API_KEY,
    banco: ok && hasRedis(),
  }, ok ? 200 : 401);
}
