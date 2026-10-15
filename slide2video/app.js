const W = 1280, H = 720, FPS = 30;
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const slides = [
  { title: 'はじめに', body: 'このアプリはスライドを動画に変換します。', seconds: 3, img: null },
  { title: '使い方', body: 'スライドを追加して、書き出しを押すだけです。', seconds: 3, img: null },
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

function drawSlide(s) {
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
}

function drawIdle() { drawSlide(slides[0] || { title: '', body: '', seconds: 1 }); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;

async function playAll() {
  for (let i = 0; i < slides.length; i++) {
    drawSlide(slides[i]);
    await sleep(Math.max(0.5, slides[i].seconds) * 1000);
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
  const stream = canvas.captureStream(FPS);
  const type = ['video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start();
  await playAll();
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
      <input type="file" accept="image/*"><button class="del">削除</button></div>`;
    const [t, b] = [el.querySelector('input[type=text]'), el.querySelector('textarea')];
    const n = el.querySelector('input[type=number]');
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
    el.querySelector('.del').onclick = () => { slides.splice(i, 1); render(); drawIdle(); };
    box.appendChild(el);
  });
}

$('add').onclick = () => { slides.push({ title: '', body: '', seconds: 3, img: null }); render(); };
render();
drawIdle();
