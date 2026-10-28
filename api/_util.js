// Utilidades compartilhadas pelas funções do THEO (Edge runtime).

export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export const fail = (code, status, message = "") => json({ code, message }, status);

// Senha de acesso: definida na Vercel como SITE_PASSWORD.
export function authorized(req) {
  const want = process.env.SITE_PASSWORD || "";
  if (!want) return true; // sem senha configurada, o site fica aberto
  const got = req.headers.get("x-theo-senha") || "";
  return got === want;
}

// Banco: Upstash Redis via REST (criado pela integração da Vercel).
function envFind(re) {
  try { for (const k of Object.keys(process.env)) if (re.test(k) && process.env[k]) return process.env[k]; } catch {}
  return "";
}
function redisCfg() {
  const e = process.env;
  const url = e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL || e.STORAGE_KV_REST_API_URL || e.REDIS_KV_REST_API_URL
    || envFind(/(KV_REST_API_URL|REDIS_REST_URL)$/);
  const token = e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN || e.STORAGE_KV_REST_API_TOKEN || e.REDIS_KV_REST_API_TOKEN
    || envFind(/(KV_REST_API_TOKEN|REDIS_REST_TOKEN)$/);
  return url && token ? { url, token } : null;
}
// Só os NOMES das variáveis do banco (nunca os valores), para diagnóstico.
export function bancoVars() {
  try { return Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH/i.test(k)); } catch { return []; }
}
export const hasRedis = () => !!redisCfg();

export async function redis(...cmd) {
  const cfg = redisCfg();
  if (!cfg) throw new Error("banco não configurado");
  const r = await fetch(cfg.url, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}

export async function redisPipeline(cmds) {
  const cfg = redisCfg();
  if (!cfg) throw new Error("banco não configurado");
  const r = await fetch(cfg.url.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  return r.json();
}

// Base64 <-> bytes sem Buffer (Edge).
export function bytesToB64(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}
export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
