// Voz do THEO: Google Cloud Text-to-Speech.
import { authorized, fail, b64ToBytes } from "./_util.js";

export const config = { runtime: "edge" };

const FALLBACK = "pt-BR-Neural2-B";

async function synth(key, text, voice, rate, pitch) {
  const chirp = /Chirp/i.test(voice);
  const audioConfig = { audioEncoding: "MP3" };
  if (rate) audioConfig.speakingRate = Math.max(0.5, Math.min(2, rate));
  if (pitch && !chirp) audioConfig.pitch = Math.max(-10, Math.min(10, pitch));
  const r = await fetch(`${process.env.GOOGLE_TTS_BASE || "https://texttospeech.googleapis.com"}/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: { text }, voice: { languageCode: "pt-BR", name: voice }, audioConfig }),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, d };
}

export default async function handler(req) {
  if (req.method !== "POST") return fail("invalid_request", 405);
  if (!authorized(req)) return fail("session_expired", 401);
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return fail("tts_disabled", 503, "GOOGLE_API_KEY não configurada");
  let b;
  try { b = await req.json(); } catch { return fail("invalid_request", 400); }
  const text = String(b.text || "").slice(0, 4500);
  if (!text.trim()) return fail("invalid_request", 400);
  const voice = process.env.THEO_VOICE || "pt-BR-Chirp3-HD-Charon";
  const rate = b.rate ? +b.rate : 0, pitch = b.pitch ? +b.pitch : 0;

  let r = await synth(key, text, voice, rate, pitch);
  if (!r.ok && rate) r = await synth(key, text, voice, 0, pitch);
  if (!r.ok && voice !== FALLBACK) r = await synth(key, text, FALLBACK, rate, pitch);
  if (!r.ok) return fail("tts_error", r.status, r.d?.error?.message || "");
  return new Response(b64ToBytes(r.d.audioContent), {
    headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
  });
}
