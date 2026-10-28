// Servidor local para testes: serve /public e executa as funções de /api.
// Simula o Redis (Upstash REST) em memória e, se MOCK=1, também Claude e Google.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = +process.env.PORT || 3000;
const store = new Map();
const H = k => store.get(k) || store.set(k, new Map()).get(k);
function cmd([c, k, ...a]) {
  c = c.toUpperCase();
  if (c === "HGET") return H(k).get(a[0]) ?? null;
  if (c === "HSET") { let n = 0; for (let i = 0; i < a.length; i += 2) { if (!H(k).has(a[i])) n++; H(k).set(a[i], a[i + 1]); } return n; }
  if (c === "HGETALL") return [...H(k)].flat();
  if (c === "HDEL") return H(k).delete(a[0]) ? 1 : 0;
  if (c === "HLEN") return H(k).size;
  throw new Error("cmd " + c);
}
process.env.KV_REST_API_URL = `http://localhost:${PORT}/__redis`;
process.env.KV_REST_API_TOKEN = "dev";
if (process.env.MOCK) {
  process.env.ANTHROPIC_API_KEY = "mock"; process.env.ANTHROPIC_BASE_URL = `http://localhost:${PORT}/__anthropic`;
  process.env.GOOGLE_API_KEY = "mock"; process.env.GOOGLE_TTS_BASE = `http://localhost:${PORT}/__google`;
}
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };
const body = req => new Promise(r => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/__redis") { const b = JSON.parse(await body(req)); res.end(JSON.stringify({ result: cmd(b) })); return; }
    if (url.pathname === "/__redis/pipeline") { const b = JSON.parse(await body(req)); res.end(JSON.stringify(b.map(x => ({ result: cmd(x) })))); return; }
    if (url.pathname === "/__anthropic/v1/messages") {
      const b = JSON.parse(await body(req));
      fs.writeFileSync(root + "/.last-chat.json", JSON.stringify(b, null, 1));
      const reply = process.env.MOCK_REPLY || JSON.stringify({ titulo: "Teste", cenas: [{ fala: "Primeira cena de teste, senhor.", chave: "Chave um", visual: { tipo: "destaque", titulo: "Um", frase: "Frase um" }, notas: [] }, { fala: "Segunda cena.", chave: "Chave dois", visual: { tipo: "destaque", titulo: "Dois", frase: "Frase dois" }, notas: [] }] });
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (let i = 0; i < reply.length; i += 40) { res.write(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: reply.slice(i, i + 40) } })}\n\n`); await new Promise(r => setTimeout(r, 30)); }
      res.end(`data: {"type":"message_stop"}\n\n`); return;
    }
    if (url.pathname.startsWith("/__google")) { const wav = fs.readFileSync(root + "/scripts/test.mp3"); res.end(JSON.stringify({ audioContent: wav.toString("base64") })); return; }
    const rewrite = url.pathname.match(/^\/_blob\/(.+)$/);
    if (rewrite) { url.pathname = "/api/capa"; url.searchParams.set("id", rewrite[1]); }
    if (url.pathname.startsWith("/api/")) {
      const mod = await import(root + url.pathname + ".js?" + Date.now());
      const b = ["GET", "HEAD"].includes(req.method) ? undefined : await body(req);
      const r = await mod.default(new Request(url, { method: req.method, headers: req.headers, body: b }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      if (r.body) { const rd = r.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; res.write(value); } }
      res.end(); return;
    }
    let p = path.join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
    if (!fs.existsSync(p)) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  } catch (e) { console.error(e); res.writeHead(500); res.end(String(e)); }
}).listen(PORT, () => console.log("THEO local em http://localhost:" + PORT));
