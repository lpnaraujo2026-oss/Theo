// Conversa com o Claude (API da Anthropic), com resposta em fluxo.
import { authorized, fail } from "./_util.js";

export const config = { runtime: "edge" };

const MODELS = {
  quick: process.env.THEO_MODEL_QUICK || "claude-haiku-5-5",
  default: process.env.THEO_MODEL_DEFAULT || "claude-sonnet-5-5",
  complex: process.env.THEO_MODEL_COMPLEX || "claude-opus-5-5",
};

const BASE = "Você é THEO, assistente de estudo bíblico e teológico de Luiz Araújo. Siga com precisão as instruções e o formato pedidos na mensagem do usuário.";

export default async function handler(req) {
  if (req.method !== "POST") return fail("invalid_request", 405);
  if (!authorized(req)) return fail("session_expired", 401, "senha inválida");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fail("sampling_disabled", 503, "ANTHROPIC_API_KEY não configurada");

  let body;
  try { body = await req.json(); } catch { return fail("invalid_request", 400); }
  const tier = MODELS[body.tier] ? body.tier : "default";
  const images = Array.isArray(body.images) ? body.images.slice(0, 5) : [];

  // Mensagens: texto único ou lista de turnos.
  let messages;
  if (Array.isArray(body.messages) && body.messages.length) {
    messages = body.messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") }));
  } else {
    messages = [{ role: "user", content: String(body.prompt || "") }];
  }
  if (images.length) {
    const last = messages[messages.length - 1];
    last.content = [
      ...images.map(im => ({ type: "image", source: { type: "base64", media_type: im.media_type || "image/jpeg", data: im.data } })),
      { type: "text", text: typeof last.content === "string" ? last.content : "" },
    ];
  }

  // O acervo vai num bloco de sistema em cache: as perguntas seguintes ficam bem mais baratas.
  const system = [{ type: "text", text: BASE }];
  if (body.acervo) system.push({ type: "text", text: String(body.acervo), cache_control: { type: "ephemeral" } });

  const upstream = await fetch((process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODELS[tier], max_tokens: Math.min(+body.max_tokens || 8000, 16000), system, messages, stream: true }),
    signal: req.signal,
  });

  if (!upstream.ok) {
    let msg = "";
    try { msg = (await upstream.json())?.error?.message || ""; } catch {}
    const code = upstream.status === 429 ? "rate_limited" : upstream.status === 401 ? "sampling_disabled" : upstream.status === 400 ? "invalid_request" : "upstream_error";
    return fail(code, upstream.status, msg);
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      let buf = "", truncated = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            let ev;
            try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") controller.enqueue(enc.encode(ev.delta.text));
            else if (ev.type === "message_delta" && ev.delta?.stop_reason === "max_tokens") truncated = true;
            else if (ev.type === "error") controller.enqueue(enc.encode("\u0000ERROR"));
          }
        }
        if (truncated) controller.enqueue(enc.encode("\u0000TRUNCATED"));
      } catch (e) {
        controller.enqueue(enc.encode("\u0000ERROR"));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-theo-model": MODELS[tier] },
  });
}
