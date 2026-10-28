/* Ponte do THEO: oferece ao app as mesmas funções que ele usava dentro do Claude
   (sample, db, assets), agora falando com as funções do próprio site.
   Também cuida da senha, da voz do servidor (Google) e do microfone gravado. */
(function () {
  "use strict";
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  let senha = LS.get("theo.senha") || "";
  const H = (extra = {}) => ({ "x-theo-senha": senha, ...extra });
  let caps = { claude: false, voz: false, banco: false };

  /* ---------------- senha ---------------- */
  function gate() {
    return new Promise(resolve => {
      const box = document.createElement("div");
      box.id = "theoGate";
      box.innerHTML = `<form><div class="g-brand">T<b>H</b>EO</div><p>Digite a senha de acesso.</p>
        <input type="password" autocomplete="current-password" placeholder="Senha" aria-label="Senha">
        <button type="submit">Entrar</button><small></small></form>`;
      const st = document.createElement("style");
      st.textContent = `#theoGate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#000;font-family:"Hanken Grotesk",system-ui,sans-serif;color:#EAF2FF}
        #theoGate form{display:grid;gap:12px;width:min(340px,86vw);text-align:center}
        #theoGate .g-brand{font-family:Saira,system-ui,sans-serif;font-weight:600;font-size:2.2rem;letter-spacing:.45em;padding-left:.45em}
        #theoGate .g-brand b{color:#E3B866;font-weight:600}
        #theoGate input{font:inherit;font-size:1.05rem;padding:12px 14px;border-radius:10px;border:1px solid rgba(120,175,255,.4);background:#07112a;color:#fff}
        #theoGate button{font:inherit;font-weight:600;font-size:1rem;padding:12px;border-radius:10px;border:0;background:#6FD3FF;color:#02122a;cursor:pointer}
        #theoGate small{color:#FF9A9A;min-height:1.2em}`;
      document.head.append(st);
      document.body.append(box);
      const f = box.querySelector("form"), inp = box.querySelector("input"), msg = box.querySelector("small");
      setTimeout(() => inp.focus(), 50);
      f.onsubmit = async e => {
        e.preventDefault();
        senha = inp.value;
        msg.textContent = "Verificando…";
        const ok = await ping();
        if (ok) { LS.set("theo.senha", senha); box.remove(); resolve(); }
        else msg.textContent = "Senha incorreta.";
      };
    });
  }
  async function ping() {
    try {
      const r = await fetch("/api/ping", { headers: H() });
      const d = await r.json();
      caps = d;
      return r.ok && d.ok;
    } catch (e) { return false; }
  }
  const ready = (async () => {
    if (!(await ping())) {
      if (document.readyState === "loading") await new Promise(r => document.addEventListener("DOMContentLoaded", r));
      await gate();
    }
    window.THEO_CAPS = caps;
    document.dispatchEvent(new CustomEvent("theo:caps", { detail: caps }));
    return caps;
  })();

  /* ---------------- imagens ---------------- */
  function blobToB64(blob) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  }
  async function shrink(blob, max = 1600) {
    try {
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
    } catch (e) { return blob; }
  }

  /* ---------------- sample (Claude) ---------------- */
  function parseLoose(t) {
    try { return JSON.parse(t); } catch (e) {}
    const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) try { return JSON.parse(f[1]); } catch (e) {}
    const a = Math.min(...["{", "["].map(c => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
    const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (a !== Infinity && b > a) try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {}
    return undefined;
  }
  async function sample(input, opts = {}) {
    await ready;
    const body = { tier: opts.modelTier || "default" };
    if (typeof input === "string") body.prompt = input; else body.messages = input;
    if (typeof window.THEO_ACERVO === "function") { try { body.acervo = window.THEO_ACERVO(); } catch (e) {} }
    if (opts.images) {
      const list = Array.from(opts.images.length != null ? opts.images : [opts.images]).slice(0, 5);
      body.images = [];
      for (const im of list) { const sm = await shrink(im); body.images.push({ media_type: "image/jpeg", data: await blobToB64(sm) }); }
    }
    let text = "";
    let r;
    try {
      r = await fetch("/api/chat", { method: "POST", headers: H({ "content-type": "application/json" }), body: JSON.stringify(body), signal: opts.signal });
    } catch (e) {
      throw { code: e && e.name === "AbortError" ? "cancelled" : "upstream_error", message: String(e) };
    }
    if (!r.ok) {
      let d = {}; try { d = await r.json(); } catch (e) {}
      if (r.status === 401 && d.code === "session_expired") { LS.del("theo.senha"); }
      throw { code: d.code || "upstream_error", message: d.message || "" };
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let truncated = false, errored = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        let delta = dec.decode(value, { stream: true });
        if (delta.includes("\u0000")) {
          if (delta.includes("\u0000TRUNCATED")) truncated = true;
          if (delta.includes("\u0000ERROR")) errored = true;
          delta = delta.replace(/\u0000(TRUNCATED|ERROR)/g, "");
        }
        if (!delta) continue;
        text += delta;
        if (opts.onText) { try { opts.onText({ text, delta }); } catch (e) { console.error(e); } }
      }
    } catch (e) {
      throw { code: e && e.name === "AbortError" ? "cancelled" : "upstream_error", text };
    }
    if (errored) throw { code: "upstream_error", text };
    if (!text.trim()) throw { code: "empty_completion" };
    return { text, truncated, modelTierApplied: body.tier };
  }
  sample.json = async (input, opts = {}) => {
    const r = await sample(input, opts);
    const v = parseLoose(r.text);
    if (v === undefined) throw { code: "invalid_json", text: r.text };
    return v;
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 3, maxInputBytes: 20e6, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } });

  /* ---------------- db ---------------- */
  const colCache = {}, colSubs = {}, docSubs = {};
  async function fetchCol(col) {
    const r = await fetch(`/api/db?col=${encodeURIComponent(col)}`, { headers: H() });
    if (!r.ok) throw { code: "upstream_error" };
    const d = await r.json();
    colCache[col] = d.docs || {};
    return colCache[col];
  }
  function snapCol(col) {
    const docs = Object.entries(colCache[col] || {}).map(([id, v]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(v)) }));
    return { docs, size: docs.length, empty: !docs.length };
  }
  function notifyCol(col) { (colSubs[col] || []).forEach(s => { try { s.cb(snapCol(col)); } catch (e) { console.error(e); } }); }
  function notifyDoc(col, id, val) { (docSubs[col + "/" + id] || []).forEach(s => { try { s.cb({ id, exists: val != null, data: () => (val == null ? undefined : JSON.parse(JSON.stringify(val))) }); } catch (e) {} }); }
  async function write(col, id, op, data) {
    const r = await fetch("/api/db", { method: "POST", headers: H({ "content-type": "application/json" }), body: JSON.stringify({ col, id, op, data }) });
    if (!r.ok) { let d = {}; try { d = await r.json(); } catch (e) {} throw { code: d.code || "upstream_error" }; }
    const d = await r.json();
    if (colCache[col]) { if (op === "delete") delete colCache[col][id]; else colCache[col][id] = d.data; notifyCol(col); }
    notifyDoc(col, id, op === "delete" ? null : d.data);
  }
  function docRef(col, id) {
    return {
      id,
      async get() { await ready; const r = await fetch(`/api/db?col=${encodeURIComponent(col)}&id=${encodeURIComponent(id)}`, { headers: H() }); const d = await r.json(); return { id, exists: d.data != null, data: () => d.data }; },
      async set(data) { await ready; return write(col, id, "set", data); },
      async update(data) { await ready; return write(col, id, "update", data); },
      async delete() { await ready; return write(col, id, "delete"); },
      onSnapshot(cb, err) {
        const k = col + "/" + id; (docSubs[k] = docSubs[k] || []).push({ cb, err });
        this.get().then(s => cb(s)).catch(e => err && err(e));
        return () => { docSubs[k] = (docSubs[k] || []).filter(s => s.cb !== cb); };
      },
    };
  }
  let importTried = false;
  const db = {
    collection(col) {
      return {
        doc: id => docRef(col, id),
        onSnapshot(cb, err) {
          (colSubs[col] = colSubs[col] || []).push({ cb, err });
          const load = async () => {
            try {
              await ready;
              let docs = await fetchCol(col);
              if (col === "livros" && !Object.keys(docs).length && !importTried) {
                importTried = true;
                const r = await fetch("/api/importar", { method: "POST", headers: H({ "content-type": "application/json" }), body: "{}" });
                if (r.ok) docs = await fetchCol(col);
              }
              notifyCol(col);
            } catch (e) { err && err(e); }
          };
          load();
          const t = setInterval(load, 120000);
          document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
          return () => { clearInterval(t); colSubs[col] = (colSubs[col] || []).filter(s => s.cb !== cb); };
        },
      };
    },
    doc(path) { const [col, id] = String(path).split("/"); return docRef(col, id); },
  };

  /* ---------------- assets (capas) ---------------- */
  const assets = {
    async upload(blob, opt = {}) {
      await ready;
      const data = await blobToB64(blob);
      const r = await fetch("/api/capa", { method: "POST", headers: H({ "content-type": "application/json" }), body: JSON.stringify({ type: opt.type || blob.type || "image/jpeg", data }) });
      if (!r.ok) { let d = {}; try { d = await r.json(); } catch (e) {} throw { code: d.code || "upstream_error" }; }
      return r.json();
    },
    async delete(ref) {
      const id = String(ref).replace(/^.*\//, "");
      const r = await fetch("/api/capa?id=" + encodeURIComponent(id), { method: "DELETE", headers: H() });
      return r.ok ? r.json() : { deleted: false };
    },
    async list() { return { assets: [], usage: {} }; },
  };

  window.claude = {
    async use(name) {
      const c = await ready;
      if (name === "sample") return c.claude ? sample : null;
      if (name === "db") return c.banco ? db : null;
      if (name === "assets") return c.banco ? assets : null;
      return null;
    },
  };

  /* ---------------- voz do servidor (Google) ---------------- */
  let audioEl = null, unlocked = false;
  function ensureAudio() { if (!audioEl) { audioEl = new Audio(); audioEl.preload = "auto"; } return audioEl; }
  // Desbloqueia o áudio no primeiro toque (exigência dos navegadores, inclusive do Quest).
  function silentWav() {
    const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const w = (o, str) => [...str].forEach((c, i) => b[o + i] = c.charCodeAt(0));
    w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true); b.fill(128, 44);
    let s = ""; b.forEach(x => s += String.fromCharCode(x)); return "data:audio/wav;base64," + btoa(s);
  }
  function unlock() {
    if (unlocked) return; unlocked = true;
    const a = ensureAudio();
    a.src = silentWav();
    a.play().catch(() => {});
  }
  ["pointerdown", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, unlock, { once: false, passive: true }));

  const ttsCache = new Map();
  async function ttsUrl(text, tune) {
    const k = JSON.stringify([text, tune && tune.vel, tune && tune.tom]);
    if (ttsCache.has(k)) return ttsCache.get(k);
    const p = (async () => {
      const r = await fetch("/api/tts", {
        method: "POST", headers: H({ "content-type": "application/json" }),
        body: JSON.stringify({ text, rate: tune && tune.vel != null ? +tune.vel : 0, pitch: tune && tune.tom != null ? (+tune.tom - 1) * 10 : 0 }),
      });
      if (!r.ok) { let m = ""; try { const d = await r.json(); m = d.message || d.code || ""; } catch (e) {} throw new Error("servidor de voz " + r.status + (m ? " (" + m.slice(0, 120) + ")" : "")); }
      return URL.createObjectURL(await r.blob());
    })();
    ttsCache.set(k, p);
    p.catch(() => ttsCache.delete(k));
    if (ttsCache.size > 40) ttsCache.delete(ttsCache.keys().next().value);
    return p;
  }
  // speak(text, {tune, onStart, onProgress(0..1), onEnd, onError}) -> { stop() }
  function speak(text, o = {}) {
    let stopped = false;
    const a = ensureAudio();
    ttsUrl(text, o.tune).then(url => {
      if (stopped) return;
      a.onended = () => { if (!stopped) o.onEnd && o.onEnd(); };
      a.onerror = () => { if (!stopped) o.onError && o.onError(); };
      a.ontimeupdate = () => { if (!stopped && a.duration) o.onProgress && o.onProgress(a.currentTime / a.duration); };
      a.src = url; a.currentTime = 0;
      a.play().then(() => o.onStart && o.onStart()).catch(e => { if (!stopped) o.onError && o.onError(new Error("o navegador bloqueou o som; toque na tela e tente de novo")); });
    }).catch(e => { if (!stopped) o.onError && o.onError(e); });
    return { stop() { stopped = true; try { a.pause(); } catch (e) {} } };
  }
  window.THEO_VOZ = {
    available: () => !!caps.voz,
    speak,
    prefetch: (text, tune) => { if (caps.voz) ttsUrl(text, tune).catch(() => {}); },
    stopAll() { if (audioEl) try { audioEl.pause(); } catch (e) {} },
  };

  /* ---------------- microfone gravado (quando o navegador não tem ditado) ---------------- */
  // start({onLevel, onText, onState}) -> { stop() }  Para sozinho após ~1,6 s de silêncio.
  async function record(o = {}) {
    await ready;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
    const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    mr.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 1024; src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    let spoke = false, lastLoud = performance.now(), t0 = performance.now(), raf = 0, ended = false;
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
      const rms = Math.sqrt(s / buf.length);
      o.onLevel && o.onLevel(rms);
      const now = performance.now();
      if (rms > 0.035) { spoke = true; lastLoud = now; }
      if ((spoke && now - lastLoud > 1600) || now - t0 > 55000 || (!spoke && now - t0 > 9000)) return finish();
      raf = requestAnimationFrame(loop);
    };
    function finish() {
      if (ended) return; ended = true;
      cancelAnimationFrame(raf);
      try { mr.stop(); } catch (e) {}
    }
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop()); try { ac.close(); } catch (e) {}
      o.onState && o.onState("transcrevendo");
      try {
        const blob = new Blob(chunks, { type: (mr.mimeType || "audio/webm").split(";")[0] });
        if (!spoke || blob.size < 2000) { o.onText && o.onText(""); return; }
        const r = await fetch("/api/stt", { method: "POST", headers: H({ "content-type": blob.type }), body: blob });
        const d = await r.json();
        o.onText && o.onText(r.ok ? d.text || "" : "", r.ok ? null : d);
      } catch (e) { o.onText && o.onText("", e); }
    };
    mr.start(250); loop();
    o.onState && o.onState("ouvindo");
    return { stop: finish };
  }
  window.THEO_MIC = { available: () => !!(caps.voz && navigator.mediaDevices && window.MediaRecorder), record };
})();
