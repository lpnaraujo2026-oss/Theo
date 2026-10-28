// Reconhecimento de fala para aparelhos sem ditado no navegador (ex.: Meta Quest).
import { authorized, fail, json, bytesToB64 } from "./_util.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") return fail("invalid_request", 405);
  if (!authorized(req)) return fail("session_expired", 401);
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return fail("stt_disabled", 503, "GOOGLE_API_KEY não configurada");
  const type = (req.headers.get("content-type") || "").toLowerCase();
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return json({ text: "" });
  const encoding = type.includes("ogg") ? "OGG_OPUS" : "WEBM_OPUS";
  const r = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      config: { encoding, sampleRateHertz: 48000, languageCode: "pt-BR", enableAutomaticPunctuation: true, model: "latest_long" },
      audio: { content: bytesToB64(bytes) },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return fail("stt_error", r.status, d?.error?.message || "");
  const text = (d.results || []).map(x => x.alternatives?.[0]?.transcript || "").join(" ").trim();
  return json({ text });
}
