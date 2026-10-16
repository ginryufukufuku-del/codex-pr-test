const W = 1280, H = 720, FPS = 30;
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const slides = [
  { title: 'はじめに', body: 'このアプリはスライドを動画に変換します。', seconds: 3, img: null, audio: null, caption: '' },
  { title: '使い方', body: 'スライドを追加して、書き出しを押すだけです。', seconds: 3, img: null, audio: null, caption: '' },
];

function wrap(text, maxWidth) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxWidth && line) { lines.push(line); line = ch; }
      else line += ch;
    }
    lines.push(line);
  }
  return lines;
}

function drawSlide(s, cap = capLines(s)[0]) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f2937'; ctx.fillRect(0, 0, W, 12);
  ctx.textBaseline = 'top';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.fillStyle = '#111';
  let y = 60;
  for (const l of wrap(s.title, W - 120)) { ctx.fillText(l, 60, y); y += 78; }
  const textW = s.img ? W / 2 - 80 : W - 120;
  ctx.font = '40px system-ui, sans-serif';
  ctx.fillStyle = '#333';
  y += 20;
  for (const l of wrap(s.body, textW)) { ctx.fillText(l, 60, y); y += 56; }
  if (s.img) {
    const box = { x: W / 2 + 20, y: 140, w: W / 2 - 80, h: H - 200 };
    const r = Math.min(box.w / s.img.width, box.h / s.img.height);
    const w = s.img.width * r, h = s.img.height * r;
    ctx.drawImage(s.img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  }
  if (cap) drawCaption(cap);
}

const capLines = (s) => (s.caption || '').split('\n').map((l) => l.trim()).filter(Boolean);

function drawCaption(text) {
  ctx.font = 'bold 38px system-ui, sans-serif';
  const lines = wrap(text, W - 200).slice(0, 3);
  const lh = 50, h = lines.length * lh + 24, y0 = H - h - 30;
  ctx.fillStyle = 'rgba(0,0,0,.72)';
  ctx.fillRect(60, y0, W - 120, h);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + 12 + i * lh));
  ctx.textAlign = 'left';
}

function drawIdle() { drawSlide(slides[0] || { title: '', body: '', seconds: 1 }); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;

let actx = null;
const audioCtx = () => (actx ||= new AudioContext());

async function setAudio(s, blob) {
  s.audio = await audioCtx().decodeAudioData(await blob.arrayBuffer());
}

// dest: 書き出し時は MediaStreamDestination、プレビュー時は null（スピーカーへ）
async function playAll(dest = null) {
  const c = audioCtx();
  await c.resume();
  for (const s of slides) {
    const caps = capLines(s);
    drawSlide(s, caps[0]);
    let sec = Math.max(0.5, s.seconds);
    if (s.audio) {
      const src = c.createBufferSource();
      src.buffer = s.audio;
      src.connect(dest || c.destination);
      src.start();
      sec = Math.max(sec, s.audio.duration + 0.3);
    }
    const n = Math.max(1, caps.length);
    for (let k = 0; k < n; k++) {
      if (k) drawSlide(s, caps[k]);
      await sleep((sec * 1000) / n);
    }
  }
}

function setBusy(b, msg = '') {
  busy = b;
  $('play').disabled = $('export').disabled = b;
  $('status').textContent = msg;
}

$('play').onclick = async () => {
  if (busy || !slides.length) return;
  setBusy(true, '再生中…');
  await playAll();
  setBusy(false);
};

$('export').onclick = async () => {
  if (busy || !slides.length) return;
  if (!window.MediaRecorder) { $('status').textContent = 'このブラウザは録画に未対応です'; return; }
  setBusy(true, '書き出し中…');
  $('download').hidden = true;
  const dest = audioCtx().createMediaStreamDestination();
  const stream = canvas.captureStream(FPS);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start();
  await playAll(dest);
  await sleep(200);
  rec.stop();
  await done;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const a = $('download');
  a.href = URL.createObjectURL(blob);
  a.download = 'slides.webm';
  a.hidden = false;
  setBusy(false, '完了：ダウンロードできます');
};

function render() {
  const box = $('slides');
  box.innerHTML = '';
  slides.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'slide';
    el.innerHTML = `<input type="text" placeholder="タイトル"><textarea placeholder="本文"></textarea>
      <div class="row"><label>秒 <input type="number" min="1" max="60"></label>
      <input type="file" accept="image/*"><button class="del">削除</button></div>
      <textarea class="cap" placeholder="字幕（改行で区切ると順番に切り替わります）"></textarea>
      <div class="row"><span>🎙</span><input type="file" class="aud" accept="audio/*">
      <button class="rec" type="button">録音</button><span class="ainfo"></span></div>`;
    const [t, b] = [el.querySelector('input[type=text]'), el.querySelector('textarea:not(.cap)')];
    const n = el.querySelector('input[type=number]');
    const cp = el.querySelector('.cap');
    cp.value = s.caption; cp.oninput = () => { s.caption = cp.value; drawSlide(s); };
    t.value = s.title; b.value = s.body; n.value = s.seconds;
    t.oninput = () => { s.title = t.value; drawSlide(s); };
    b.oninput = () => { s.body = b.value; drawSlide(s); };
    n.oninput = () => { s.seconds = Number(n.value) || 1; };
    el.onfocusin = () => drawSlide(s);
    el.querySelector('input[type=file]').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => { s.img = img; drawSlide(s); };
      img.src = URL.createObjectURL(f);
    };
    const info = el.querySelector('.ainfo'), recBtn = el.querySelector('.rec');
    const showAudio = () => (info.textContent = s.audio ? `${s.audio.duration.toFixed(1)}秒` : '');
    showAudio();
    el.querySelector('.aud').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { await setAudio(s, f); showAudio(); } catch { info.textContent = '読み込み失敗'; }
    };
    let mr = null;
    recBtn.onclick = async () => {
      if (mr) { mr.stop(); return; }
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: true });
        const parts = [];
        mr = new MediaRecorder(st);
        mr.ondataavailable = (e) => parts.push(e.data);
        mr.onstop = async () => {
          st.getTracks().forEach((t) => t.stop());
          mr = null; recBtn.textContent = '録音';
          try { await setAudio(s, new Blob(parts)); showAudio(); } catch { info.textContent = '録音失敗'; }
        };
        mr.start();
        recBtn.textContent = '■ 停止';
      } catch { info.textContent = 'マイクを使えません'; }
    };
    el.querySelector('.del').onclick = () => { slides.splice(i, 1); render(); drawIdle(); };
    box.appendChild(el);
  });
}

$('add').onclick = () => { slides.push({ title: '', body: '', seconds: 3, img: null, audio: null, caption: '' }); render(); };
render();
drawIdle();

const editor = $('editor'), toggle = $('toggle');
function setOutline(open) {
  editor.classList.toggle('collapsed', !open);
  toggle.setAttribute('aria-expanded', open);
  toggle.textContent = open ? 'アウトライン ▲' : 'アウトライン ▼（開く）';
}
toggle.onclick = () => setOutline(editor.classList.contains('collapsed'));
setOutline(!window.matchMedia('(orientation: portrait)').matches);
