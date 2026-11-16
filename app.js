"use strict";
/* Reels Atölyesi — tamamen tarayıcıda çalışır (sunucu yok). Gemini API: anlatım, ses (TTS), SEO. */
const $ = s => document.querySelector(s);
const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const VOICES = [["Kore", "Sağlam"], ["Puck", "Neşeli"], ["Charon", "Bilgilendirici"], ["Fenrir", "Heyecanlı"], ["Aoede", "Ferah"], ["Leda", "Genç"], ["Orus", "Kararlı"], ["Zephyr", "Parlak"], ["Sulafat", "Sıcak"], ["Achernar", "Yumuşak"], ["Gacrux", "Olgun"], ["Algenib", "Kalın"]];
const S = { photos: [], segs: [], audio: [], seo: null, busy: false };
const MAXP = 12;

// ---------------------------------------------------------------- yardımcılar
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); }
function showErr(e) { const b = $("#err"); if (!e) { b.hidden = true; return; } b.textContent = String(e.message || e); b.hidden = false; b.scrollIntoView({ block: "center", behavior: "smooth" }); }
async function busy(btn, fn) {
  if (S.busy) return; S.busy = true; showErr(null); btn.classList.add("busy");
  try { return await fn(); } catch (e) { console.error(e); showErr(e); } finally { btn.classList.remove("busy"); S.busy = false; }
}
function lsGet(k, d = "") { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* özel gezinme */ } }
const key = () => $("#apiKey").value.trim();

// ---------------------------------------------------------------- Gemini çağrısı
async function gem(models, body, tries = 4) {
  if (!key()) throw new Error("Önce Google (Gemini) API anahtarını girin.");
  let lastErr;
  for (const model of models) {
    for (let i = 0; i < tries; i++) {
      let r, j;
      try {
        r = await fetch(`${API}${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key() }, body: JSON.stringify(body) });
        j = await r.json().catch(() => ({}));
      } catch (e) { lastErr = new Error("Ağ hatası: " + e.message); await sleep(1500 * (i + 1)); continue; }
      if (r.ok) return j;
      const msg = j.error?.message || ("HTTP " + r.status);
      lastErr = new Error(`${model}: ${msg}`);
      if (r.status === 429 || r.status === 503 || r.status === 500) {
        const m = /retry in ([\d.]+)s/i.exec(msg) || /"retryDelay":\s*"(\d+)/.exec(JSON.stringify(j));
        const wait = Math.min(60, m ? Math.ceil(+m[1]) + 1 : 6 * (i + 1));
        if (r.status === 429 && /quota|billing|limit: 0/i.test(msg) && !m) break;
        gem.onWait?.(wait); await sleep(wait * 1000); continue;
      }
      if (r.status === 404 || (r.status === 400 && /not found|not supported|unknown model/i.test(msg))) break;  // sonraki model
      throw lastErr;   // 400/401/403: anahtar, istek hatası
    }
  }
  throw lastErr || new Error("Gemini yanıt vermedi");
}
const textOf = j => (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
function parseJSON(t) {
  t = String(t || "").trim();
  const f = /```(?:json)?\s*([\s\S]*?)```/i.exec(t); if (f) t = f[1].trim();
  try { return JSON.parse(t); } catch { /* süslü parantez aralığı */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("Gemini geçerli JSON döndürmedi.");
}
const textModels = () => [...new Set([$("#mText").value.trim() || "gemini-2.5-flash", "gemini-flash-latest"])];
const ttsModels = () => [...new Set([$("#mTts").value.trim() || "gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"])];

// ---------------------------------------------------------------- ayarlar
(function init() {
  $("#apiKey").value = lsGet("rs-key"); $("#mText").value = lsGet("rs-mtext", "gemini-2.5-flash"); $("#mTts").value = lsGet("rs-mtts", "gemini-2.5-flash-preview-tts");
  $("#voice").innerHTML = VOICES.map(([n, d]) => `<option value="${n}">${n} — ${d}</option>`).join("");
  $("#voice").value = lsGet("rs-voice", "Kore"); $("#vstyle").value = lsGet("rs-vstyle", $("#vstyle").value);
  for (const [id, k] of [["#apiKey", "rs-key"], ["#mText", "rs-mtext"], ["#mTts", "rs-mtts"], ["#voice", "rs-voice"], ["#vstyle", "rs-vstyle"]]) $(id).addEventListener("change", () => lsSet(k, $(id).value.trim()));
  $("#keyShow").onclick = () => { const i = $("#apiKey"); i.type = i.type === "password" ? "text" : "password"; $("#keyShow").textContent = i.type === "password" ? "Göster" : "Gizle"; };
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  let dp; addEventListener("beforeinstallprompt", e => { e.preventDefault(); dp = e; $("#installBtn").hidden = false; });
  $("#installBtn").onclick = () => dp?.prompt();
  gem.onWait = s => { $("#voiceState").textContent = `Kota sınırı: ${s} sn bekleniyor…`; };
})();

// ---------------------------------------------------------------- fotoğraflar
$("#drop").addEventListener("click", e => { if (e.target.tagName !== "INPUT") $("#files").click(); });
$("#files").onchange = async e => {
  const list = [...e.target.files]; e.target.value = "";
  for (const f of list) {
    if (S.photos.length >= MAXP) { toast(`En fazla ${MAXP} fotoğraf`); break; }
    try { S.photos.push(await loadPhoto(f)); } catch { toast("Bir fotoğraf okunamadı: " + f.name); }
  }
  resetDerived(); renderThumbs();
};
async function loadPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const sc = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const s2 = Math.min(1, 768 / Math.max(c.width, c.height));
  const t = document.createElement("canvas"); t.width = Math.round(c.width * s2); t.height = Math.round(c.height * s2);
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  return { img: c, thumb: t.toDataURL("image/jpeg", .5), b64: t.toDataURL("image/jpeg", .82).split(",")[1], name: file.name };
}
function resetDerived() { S.segs = []; S.audio = []; renderSegs(); $("#genVoice").disabled = true; $("#render").disabled = true; $("#voiceState").textContent = ""; }
function renderThumbs() {
  $("#thumbs").innerHTML = S.photos.map((p, i) => `<div class="th"><img src="${p.thumb}" alt=""><b>${i + 1}</b><div class="tools"><button data-m="-1" data-i="${i}" aria-label="Sola">◀</button><button data-d="${i}" aria-label="Sil">✕</button><button data-m="1" data-i="${i}" aria-label="Sağa">▶</button></div></div>`).join("");
}
$("#thumbs").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.d != null) S.photos.splice(+b.dataset.d, 1);
  else { const i = +b.dataset.i, j = i + +b.dataset.m; if (j < 0 || j >= S.photos.length) return; [S.photos[i], S.photos[j]] = [S.photos[j], S.photos[i]]; }
  resetDerived(); renderThumbs();
};

// ---------------------------------------------------------------- anlatım
$("#genScript").onclick = () => busy($("#genScript"), async () => {
  if (!S.photos.length) throw new Error("Önce en az bir fotoğraf ekleyin.");
  const n = S.photos.length, total = +$("#dur").value, per = Math.max(8, Math.round(total / n * 2.4));
  const prompt = `Sen Türkiye'de Instagram Reels ve YouTube Shorts için çalışan usta bir video metin yazarısın. Aşağıdaki ${n} fotoğrafı sırayla gösteren dikey bir video için TÜRKÇE sesli anlatım yaz.
Kurallar:
- Tam olarak ${n} bölüm yaz: her fotoğrafa bir bölüm, fotoğraf sırasıyla.
- Her bölüm yaklaşık ${per} kelime (toplam süre ~${total} sn). Kısa, akıcı, konuşma diliyle, sesli okunacağı için rakamları ve kısaltmaları okunuşuyla yaz.
- Üslup: ${$("#tone").value}. İlk bölüm izleyiciyi ilk 2 saniyede yakalayan bir kanca cümlesiyle başlasın.${$("#cta").checked ? " Son bölüm kısa bir “takip et” çağrısıyla bitsin." : ""}
- Yalnızca fotoğrafta gerçekten görünenleri ve kullanıcının notunu esas al; görmediğin yer, isim, tarih ya da istatistik uydurma. Emin değilsen genel ve ilham verici anlat.
- Emoji, hashtag, sahne yönergesi ya da tırnak kullanma; sadece okunacak metin.
Kullanıcının notu: ${$("#topic").value.trim() || "(yok — fotoğraflardan çıkar)"}`;
  const parts = [{ text: prompt }];
  S.photos.forEach((p, i) => { parts.push({ text: `Fotoğraf ${i + 1}:` }, { inlineData: { mimeType: "image/jpeg", data: p.b64 } }); });
  const j = await gem(textModels(), { contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: .8,
    responseSchema: { type: "OBJECT", properties: { segments: { type: "ARRAY", items: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] } } }, required: ["segments"] } } });
  const segs = (parseJSON(textOf(j)).segments || []).map(s => String(s.text || "").trim()).filter(Boolean);
  if (!segs.length) throw new Error("Anlatım üretilemedi, tekrar deneyin.");
  while (segs.length < n) segs.push(""); segs.length = n;
  S.segs = segs; S.audio = []; renderSegs(); $("#genVoice").disabled = false; $("#render").disabled = true;
});
function renderSegs() {
  $("#segs").innerHTML = S.segs.map((t, i) => `<div class="seg"><img src="${S.photos[i]?.thumb || ""}" alt=""><div><textarea data-s="${i}" rows="3">${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</textarea>
    <div class="sub"><span>${wc(t)} kelime</span><button class="btn ghost mini" type="button" data-play="${i}" ${S.audio[i] ? "" : "hidden"}>▶ Dinle</button></div></div></div>`).join("");
}
const wc = t => (t.trim() ? t.trim().split(/\s+/).length : 0);
$("#segs").addEventListener("input", e => { const i = e.target.dataset.s; if (i == null) return; S.segs[+i] = e.target.value; S.audio[+i] = null; $("#render").disabled = true; e.target.closest(".seg").querySelector("[data-play]").hidden = true; e.target.closest(".seg").querySelector(".sub span").textContent = wc(e.target.value) + " kelime"; });
$("#segs").addEventListener("click", e => { const b = e.target.closest("[data-play]"); if (b) playBuf(S.audio[+b.dataset.play]); });
let actxShared;
function actx() { actxShared = actxShared || new (window.AudioContext || window.webkitAudioContext)(); if (actxShared.state === "suspended") actxShared.resume(); return actxShared; }
function playBuf(buf) { if (!buf) return; const a = actx(), s = a.createBufferSource(); s.buffer = buf; s.connect(a.destination); s.start(); }

// ---------------------------------------------------------------- ses (TTS)
function pcmToBuffer(b64, mime) {
  const rate = +(/rate=(\d+)/.exec(mime || "") || [0, 24000])[1];
  const bin = atob(b64), n = bin.length >> 1, a = actx(), buf = a.createBuffer(1, n, rate), ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 32768) v -= 65536; ch[i] = v / 32768; }
  return trimSilence(a, buf);
}
function trimSilence(a, buf) {
  const d = buf.getChannelData(0), th = .012, pad = Math.round(.06 * buf.sampleRate);
  let s = 0, e = d.length - 1; while (s < e && Math.abs(d[s]) < th) s++; while (e > s && Math.abs(d[e]) < th) e--;
  s = Math.max(0, s - pad); e = Math.min(d.length - 1, e + pad); if (e - s < 2000) return buf;
  const o = a.createBuffer(1, e - s + 1, buf.sampleRate); o.getChannelData(0).set(d.subarray(s, e + 1)); return o;
}
$("#genVoice").onclick = () => busy($("#genVoice"), async () => {
  const voice = $("#voice").value, style = $("#vstyle").value.trim(), st = $("#voiceState");
  for (let i = 0; i < S.segs.length; i++) {
    if (S.audio[i]) continue;
    const text = S.segs[i].trim(); if (!text) { S.audio[i] = actx().createBuffer(1, 2400, 24000); continue; }
    st.textContent = `Ses üretiliyor… ${i + 1}/${S.segs.length}`;
    const j = await gem(ttsModels(), { contents: [{ parts: [{ text: `Şunu ${style || "doğal bir anlatıcı gibi"}, Türkçe olarak oku: ${text}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } });
    const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
    if (!part) throw new Error("Ses verisi gelmedi (model metni okumak yerine yanıt vermiş olabilir). Tekrar deneyin.");
    S.audio[i] = pcmToBuffer(part.inlineData.data, part.inlineData.mimeType);
    renderSegsKeep();
  }
  const tot = S.audio.reduce((a, b) => a + b.duration, 0);
  st.textContent = `Ses hazır · toplam ~${tot.toFixed(0)} sn`; $("#render").disabled = false;
});
function renderSegsKeep() { document.querySelectorAll("[data-play]").forEach(b => b.hidden = !S.audio[+b.dataset.play]); }

// ---------------------------------------------------------------- video
const GAP = .25, LEAD = .35, TAIL = .9, FADE = .4;
function plan() {
  let t = LEAD; const tl = S.audio.map((b, i) => { const s = { i, start: t, dur: b.duration + GAP }; t += s.dur; return s; });
  tl[0].start = 0; tl[0].dur += LEAD; tl.at(-1).dur += TAIL;
  const total = tl.reduce((a, s) => a + s.dur, 0);
  let acc = 0; tl.forEach(s => { s.v0 = acc; acc += s.dur; s.audioAt = s.v0 + (s.i === 0 ? LEAD : 0); });
  return { tl, total };
}
function chunksOf(text, dur) {
  const w = text.trim().split(/\s+/).filter(Boolean), out = []; if (!w.length) return out;
  const sz = w.length > 14 ? 4 : 3; for (let i = 0; i < w.length; i += sz) out.push(w.slice(i, i + sz));
  const len = out.map(c => c.join(" ").length + 3), sum = len.reduce((a, b) => a + b, 0); let t = 0;
  return out.map((c, k) => { const d = dur * len[k] / sum, r = { words: c, t0: t, t1: t + d }; t += d; return r; });
}
function blurBg(img, W, H) {
  const sm = document.createElement("canvas"); sm.width = 24; sm.height = Math.max(8, Math.round(24 * H / W));
  const c = sm.getContext("2d"), k = Math.max(sm.width / img.width, sm.height / img.height);
  c.drawImage(img, (sm.width - img.width * k) / 2, (sm.height - img.height * k) / 2, img.width * k, img.height * k);
  const big = document.createElement("canvas"); big.width = W; big.height = H; const g = big.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(sm, 0, 0, W, H); g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, 0, W, H); return big;
}
function drawPhoto(g, img, bg, W, H, z, mode, dir) {
  if (mode === "blur") {
    g.drawImage(bg, 0, 0);
    const k = Math.min(W / img.width, H / img.height) * (1 + .06 * z), w = img.width * k, h = img.height * k;
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  } else {
    const k = Math.max(W / img.width, H / img.height) * (1 + .12 * z), w = img.width * k, h = img.height * k;
    const px = (W - w) * (.5 + dir * (.5 - z) * .5), py = (H - h) / 2;
    g.drawImage(img, px, py, w, h);
  }
}
function drawCaption(g, W, H, ch, active) {
  let fs = Math.round(W * .075); g.textAlign = "left"; g.textBaseline = "middle"; g.lineJoin = "round";
  const words = ch.words; let lines = [words];
  const meas = () => lines.map(l => g.measureText(l.join(" ")).width);
  g.font = `800 ${fs}px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif`;
  while (Math.max(...meas()) > W * .86 && fs > W * .045) { fs -= 2; g.font = `800 ${fs}px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif`; }
  if (Math.max(...meas()) > W * .86 && words.length > 1) { const m = Math.ceil(words.length / 2); lines = [words.slice(0, m), words.slice(m)]; }
  const lh = fs * 1.25, y0 = H * .72 - (lines.length - 1) * lh / 2; let wi = 0;
  lines.forEach((l, li) => {
    const full = g.measureText(l.join(" ")).width, sp = g.measureText(" ").width; let x = (W - full) / 2; const y = y0 + li * lh;
    l.forEach(w => {
      g.lineWidth = fs * .22; g.strokeStyle = "rgba(0,0,0,.92)"; g.strokeText(w, x, y);
      g.fillStyle = wi === active ? "#ffd43b" : "#ffffff"; g.fillText(w, x, y); x += g.measureText(w).width + sp; wi++;
    });
  });
}
$("#render").onclick = () => busy($("#render"), async () => {
  if (S.audio.some(a => !a) || S.audio.length !== S.photos.length) throw new Error("Önce sesi üretin.");
  if (typeof MediaRecorder === "undefined") throw new Error("Bu tarayıcı video kaydını desteklemiyor (Chrome, Edge ya da güncel Safari kullanın).");
  const W = +$("#res").value, H = Math.round(W * 16 / 9), mode = $("#fit").value, subsOn = $("#subs").value === "on";
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
  const { tl, total } = plan(), bgs = S.photos.map(p => mode === "blur" ? blurBg(p.img, W, H) : null);
  const caps = tl.map(s => chunksOf(S.segs[s.i], S.audio[s.i].duration));
  const a = actx(), dest = a.createMediaStreamDestination();
  const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || "";
  const stream = cv.captureStream(30); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: W >= 1000 ? 7e6 : 4e6, audioBitsPerSecond: 128000 });
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => rec.onstop = r);
  let wl; try { wl = await navigator.wakeLock?.request("screen"); } catch { /* yok */ }
  const prog = $("#prog"), st = $("#renderState"); prog.hidden = false; prog.value = 0; $("#result").hidden = true;
  const draw = t => {
    t = Math.min(Math.max(0, t), total - .001);
    let k = tl.findIndex(s => t < s.v0 + s.dur); if (k < 0) k = tl.length - 1;
    const s = tl[k], lt = t - s.v0, z = lt / s.dur, dir = k % 2 ? -1 : 1;
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    if (k > 0 && lt < FADE) { drawPhoto(g, S.photos[k - 1].img, bgs[k - 1], W, H, 1, mode, (k - 1) % 2 ? -1 : 1); g.globalAlpha = lt / FADE; }
    drawPhoto(g, S.photos[k].img, bgs[k], W, H, z, mode, dir); g.globalAlpha = 1;
    if (subsOn) {
      const at = t - s.audioAt, list = caps[k]; const c = list.find(c => at >= c.t0 && at < c.t1);
      if (c) { const dd = c.t1 - c.t0, nw = c.words.length, active = Math.min(nw - 1, Math.floor((at - c.t0) / dd * nw)); drawCaption(g, W, H, c, active); }
    }
  };
  draw(0); rec.start(250);
  const t0 = a.currentTime + .25;
  const srcs = tl.map(s => { const n = a.createBufferSource(); n.buffer = S.audio[s.i]; n.connect(dest); n.start(t0 + s.audioAt); return n; });
  st.textContent = "Video oluşturuluyor… ekranı kapatmayın.";
  await new Promise(res => {
    const id = setInterval(() => {
      const t = a.currentTime - t0; draw(t); prog.value = Math.min(1, t / total); st.textContent = `Video oluşturuluyor… %${Math.min(100, Math.round(t / total * 100))}`;
      if (t >= total) { clearInterval(id); res(); }
    }, 1000 / 30);
    const raf = () => { if (a.currentTime - t0 < total) { draw(a.currentTime - t0); requestAnimationFrame(raf); } }; requestAnimationFrame(raf);
  });
  await sleep(300); srcs.forEach(n => { try { n.stop(); } catch { /* bitmiş */ } }); rec.stop(); await stopped; wl?.release?.().catch(() => {});
  const type = (rec.mimeType || mime || "video/webm").split(";")[0], ext = type.includes("mp4") ? "mp4" : "webm";
  const blob = new Blob(chunks, { type }); if (blob.size < 2000) throw new Error("Video oluşturulamadı (boş çıktı).");
  if (S.url) URL.revokeObjectURL(S.url); S.url = URL.createObjectURL(blob); S.blob = blob; S.file = `reels-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}.${ext}`;
  $("#player").src = S.url; $("#dl").href = S.url; $("#dl").download = S.file; $("#result").hidden = false; prog.hidden = true;
  st.textContent = `Hazır · ${(blob.size / 1048576).toFixed(1)} MB · ${total.toFixed(0)} sn`;
  $("#fmtNote").textContent = ext === "webm" ? "Bu tarayıcı WebM üretti; Instagram MP4 ister. Telefonda Chrome/Safari ya da bilgisayarda Chrome/Edge kullanırsanız MP4 çıkar, ya da dosyayı bir dönüştürücüyle MP4'e çevirin." : "MP4 hazır: indirip Instagram / YouTube uygulamasından yükleyebilirsiniz.";
  const f = new File([blob], S.file, { type }); const can = navigator.canShare?.({ files: [f] }); $("#share").hidden = !can;
  $("#share").onclick = () => navigator.share({ files: [f], title: "Reels" }).catch(() => {});
  $("#result").scrollIntoView({ behavior: "smooth", block: "center" });
});

// ---------------------------------------------------------------- SEO
const trim = (s, n) => { s = String(s || "").trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };
function fitTags(arr, max = 500) { const out = []; let len = 0; for (let t of arr || []) { t = String(t).replace(/[#<>,]/g, "").trim(); if (!t) continue; const add = t.length + (out.length ? 1 : 0) + (/\s/.test(t) ? 2 : 0); if (len + add > max) break; if (out.some(x => x.toLowerCase() === t.toLowerCase())) continue; out.push(t); len += add; } return out; }
const hash = arr => (arr || []).map(h => "#" + String(h).replace(/[#\s]+/g, "")).filter(h => h.length > 1);
$("#genSeo").onclick = () => busy($("#genSeo"), async () => {
  if (!S.segs.some(Boolean) && !$("#topic").value.trim()) throw new Error("Önce anlatımı yazın ya da bir konu girin.");
  const narr = S.segs.join(" "), search = $("#useSearch").checked;
  const prompt = `Sen YouTube Shorts ve Instagram Reels SEO uzmanısın. Türkiye'deki izleyiciler için aşağıdaki video için en yüksek arama görünürlüğünü hedefleyen metinleri yaz.
Video konusu/notu: ${$("#topic").value.trim() || "(belirtilmedi)"}
Videodaki anlatım: ${narr || "(yok)"}
${search ? "Önce Google Arama ile bu konudaki güncel, gerçekten aranan Türkçe anahtar kelimeleri ve trend ifadeleri bul, onları kullan." : ""}
Kurallar:
- YouTube başlığı en fazla 70 karakter; ana anahtar kelime başa yakın, merak uyandırıcı, clickbait değil, sonunda #Shorts yazma (açıklamaya koy).
- YouTube açıklaması: ilk 2 satırda ana anahtar kelimeyi içeren çekici özet (arama sonuçlarında görünen kısım), sonra 2-3 cümle doğal ve anahtar kelime zengin metin, sonunda 3-5 hashtag ve #Shorts. Videoda olmayan şeyi vaat etme.
- YouTube etiketleri: 12-20 adet, en önemlisi ilk, uzun kuyruk ifadeler dahil, toplam 500 karakteri geçmesin.
- Instagram açıklaması: ilk satır güçlü kanca, 2-4 kısa satır, bir eylem çağrısı (kaydet/paylaş/yorum), sonda 3-5 alakalı hashtag. Ayrıca Instagram için tek cümlelik erişilebilirlik alt metni (alt_text) yaz.
- Kapak üzerine yazılacak 3-5 kelimelik kısa bir metin öner.
- Hepsi akıcı, doğal Türkçe olsun; anahtar kelimeyi zorla tekrarlama.
Yalnızca şu JSON'u döndür (başka metin yok): {"keywords":[""],"youtube":{"title":"","description":"","tags":[""],"hashtags":[""]},"instagram":{"caption":"","hashtags":[""],"alt_text":""},"cover_text":""}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: .6 } };
  if (search) body.tools = [{ google_search: {} }]; else body.generationConfig.responseMimeType = "application/json";
  let j;
  try { j = await gem(textModels(), body); }
  catch (e) { if (!search) throw e; delete body.tools; body.generationConfig.responseMimeType = "application/json"; j = await gem(textModels(), body); }
  const d = parseJSON(textOf(j)), yt = d.youtube || {}, ig = d.instagram || {};
  const note = $("#aiNote").checked ? "\n\nAnlatım yapay zekâ ile seslendirilmiştir." : "";
  const ytH = hash(yt.hashtags).slice(0, 5); if (!ytH.some(h => h.toLowerCase() === "#shorts")) ytH.push("#Shorts");
  let ytDesc = String(yt.description || "").trim(); ytDesc = ytDesc.replace(/(\s*#\S+)+\s*$/, "").trim() + note + "\n\n" + ytH.join(" ");
  const igH = hash(ig.hashtags).slice(0, 5);
  let igCap = String(ig.caption || "").trim().replace(/(\s*#\S+)+\s*$/, "").trim() + note + "\n\n" + igH.join(" ");
  S.seo = {
    "YouTube Shorts": [["Başlık", trim(yt.title, 100)], ["Açıklama", trim(ytDesc, 4900)], ["Etiketler (virgülle)", fitTags(yt.tags).join(", ")]],
    "Instagram Reels": [["Açıklama (caption)", trim(igCap, 2150)], ["Alt metin", trim(ig.alt_text, 100)]],
    "Ekstra": [["Anahtar kelimeler", (d.keywords || []).join(", ")], ["Kapak yazısı", trim(d.cover_text, 40)]],
  };
  renderSeo();
});
function renderSeo() {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  $("#seo").innerHTML = `<div class="seoCard"><button class="btn primary" id="copyAll">Hepsini kopyala</button></div>` + Object.entries(S.seo).map(([h, fs], gi) =>
    `<div class="seoCard"><h3>${h}</h3>${fs.map(([l, v], fi) => `<div class="field"><div class="fh"><span>${l} · ${v.length} karakter</span><button class="btn ghost mini" type="button" data-copy="${gi}.${fi}">Kopyala</button></div><textarea rows="${Math.min(10, Math.max(2, Math.ceil(v.length / 48)))}" data-f="${gi}.${fi}">${esc(v)}</textarea></div>`).join("")}</div>`).join("");
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  toast("Kopyalandı ✓");
}
$("#seo").addEventListener("click", e => {
  if (e.target.id === "copyAll") { copyText(Object.entries(S.seo).map(([h, fs]) => `== ${h} ==\n` + fs.map(([l], fi) => `${l}:\n${document.querySelector(`[data-f="${Object.keys(S.seo).indexOf(h)}.${fi}"]`).value}`).join("\n\n")).join("\n\n")); return; }
  const b = e.target.closest("[data-copy]"); if (b) copyText(document.querySelector(`[data-f="${b.dataset.copy}"]`).value);
});
