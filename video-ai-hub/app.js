const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = u => /^https?:\/\//i.test(u) ? u : '#';
const KEY = 'video-ai-hub-v1';
const STATUS = ['生成中', '成功', '失敗', '保留'];
// 公式トップページのみ掲載。Soraは2026-04に提供終了のため除外。
const DEFAULT_PROVIDERS = [
  { name: 'Google Veo / Flow', url: 'https://labs.google/flow', note: '音声付き生成に対応' },
  { name: 'Runway', url: 'https://runwayml.com', note: '編集・制御機能が豊富' },
  { name: 'Kling AI', url: 'https://klingai.com', note: '' },
  { name: 'Luma Dream Machine', url: 'https://lumalabs.ai', note: '' },
  { name: 'Pika', url: 'https://pika.art', note: '' },
  { name: 'Hailuo AI (MiniMax)', url: 'https://hailuoai.video', note: '' },
  { name: 'Dreamina (Seedance)', url: 'https://dreamina.capcut.com', note: 'ByteDance系' },
  { name: 'Wan', url: 'https://wan.video', note: 'Alibaba系' }
];
let db = { providers: DEFAULT_PROVIDERS, jobs: [] };
try { const s = localStorage.getItem(KEY); if (s) db = JSON.parse(s); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };

async function copy(t) { try { await navigator.clipboard.writeText(t); return true; } catch { $('prompt').select(); return document.execCommand('copy'); } }

$('pf').onsubmit = e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  $('prompt').value = [f.subject, f.camera && `カメラ: ${f.camera}`, f.style && `スタイル: ${f.style}`, `アスペクト比 ${f.aspect}`, `長さ ${f.dur}`].filter(Boolean).join('。');
};
$('copyBtn').onclick = async () => { $('copyBtn').textContent = (await copy($('prompt').value)) ? 'コピーしました' : '失敗'; setTimeout(() => $('copyBtn').textContent = 'コピー', 1500); };

function renderProviders() {
  $('providers').innerHTML = db.providers.map((p, i) => `<div class="card"><b>${esc(p.name)}</b><small>${esc(p.note)}</small>
    <div class="row"><button data-a="open" data-i="${i}">開く</button><button data-a="log" data-i="${i}">記録</button><button data-a="delp" data-i="${i}">✕</button></div></div>`).join('');
}
$('providers').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const p = db.providers[+b.dataset.i], a = b.dataset.a, pr = $('prompt').value.trim();
  if (a === 'open') { if (pr) await copy(pr); window.open(safeUrl(p.url), '_blank', 'noopener,noreferrer'); }
  if (a === 'log') {
    if (!pr) return alert('プロンプトを入力してください');
    db.jobs.unshift({ id: Date.now(), provider: p.name, prompt: pr, status: '生成中', result: '', memo: '', at: new Date().toLocaleString('ja-JP') });
    save(); renderJobs();
  }
  if (a === 'delp' && confirm(`${p.name} を削除しますか?`)) { db.providers.splice(+b.dataset.i, 1); save(); renderProviders(); }
};
$('addp').onsubmit = e => {
  e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
  if (!/^https?:\/\//i.test(f.url)) return alert('URLは http(s):// で始めてください');
  db.providers.push(f); save(); e.target.reset(); renderProviders();
};

// 同じプロンプトの履歴をまとめて並べて比較できるようにグループ化
function renderJobs() {
  if (!db.jobs.length) { $('jobs').innerHTML = '<p class="hint">まだ記録がありません。</p>'; return; }
  const g = {}; db.jobs.forEach(j => (g[j.prompt] ||= []).push(j));
  $('jobs').innerHTML = Object.entries(g).map(([pr, js]) => `<div class="gp"><h3>${esc(pr)}</h3>${js.map(j => `<div class="job">
    <p><b>${esc(j.provider)}</b> <select data-a="st" data-id="${j.id}">${STATUS.map(s => `<option${s === j.status ? ' selected' : ''}>${s}</option>`).join('')}</select>
    <small>${esc(j.at)}</small> <button data-a="delj" data-id="${j.id}">削除</button></p>
    <p><input data-a="res" data-id="${j.id}" value="${esc(j.result)}" placeholder="結果の動画URL" size="30">
    ${j.result ? `<a href="${esc(safeUrl(j.result))}" target="_blank" rel="noopener noreferrer">開く</a>` : ''}</p>
    <p><input data-a="memo" data-id="${j.id}" value="${esc(j.memo)}" placeholder="メモ(画質・動き・コストなど)" size="30"></p></div>`).join('')}</div>`).join('');
}
const job = el => db.jobs.find(j => j.id === +el.dataset.id);
$('jobs').onchange = e => { const j = job(e.target), a = e.target.dataset.a; if (!j) return;
  if (a === 'st') j.status = e.target.value; if (a === 'res') j.result = e.target.value.trim(); if (a === 'memo') j.memo = e.target.value; save(); renderJobs(); };
$('jobs').onclick = e => { const b = e.target.closest('button'); if (b?.dataset.a === 'delj' && confirm('削除しますか?')) { db.jobs = db.jobs.filter(j => j.id !== +b.dataset.id); save(); renderJobs(); } };

$('exportBtn').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' })); a.download = 'video-ai-hub.json'; a.click(); };
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async e => { try { const d = JSON.parse(await e.target.files[0].text()); if (!Array.isArray(d.providers) || !Array.isArray(d.jobs)) throw 0; db = d; save(); renderProviders(); renderJobs(); } catch { alert('読み込めませんでした'); } };

renderProviders(); renderJobs();

// ---- API生成(サーバー経由。キーはサーバー側のみ) ----
let apiProvs = [];
const hdr = () => $('token').value ? { 'x-app-token': $('token').value } : {};
async function api(path, opt = {}) {
  const r = await fetch(path, { ...opt, headers: { 'content-type': 'application/json', ...hdr() } });
  if (r.status === 401) $('tokenRow').hidden = false;
  return r;
}
async function initApi() {
  try {
    const r = await api('/api/providers');
    if (r.status === 401) { $('apiSec').hidden = false; $('genSt').textContent = 'トークンを入力して再読み込みしてください'; return; }
    if (!r.ok) return;
    apiProvs = (await r.json()).filter(p => p.configured);
  } catch { return; }          // 静的ホスティング時はAPIセクションを出さない
  if (!apiProvs.length) return;
  $('apiSec').hidden = false;
  $('apiProv').innerHTML = apiProvs.map(p => `<option value="${esc(p.id)}">${esc(p.name)}【有料】</option>`).join('');
  const setAsp = () => {
    const p = apiProvs.find(x => x.id === $('apiProv').value), m = $('apiModel');
    $('apiAspect').innerHTML = p.aspects.map(a => `<option>${esc(a)}</option>`).join('');
    m.hidden = !p.models;
    if (p.models) { m.innerHTML = p.models.map((x, i) => `<option value="${esc(x.id)}" data-a="${x.aspect}">${esc(x.label)}</option>`).join(''); }
    setAspUse();
  };
  // 縦横比を送らないモデルでは選択を無効化(指定が無視されることを明示)
  const setAspUse = () => { const o = $('apiModel').selectedOptions[0]; $('apiAspect').disabled = !$('apiModel').hidden && o?.dataset.a === 'false'; };
  $('apiProv').onchange = setAsp; $('apiModel').onchange = setAspUse; setAsp();
}
$('paidOk').onchange = () => { $('genBtn').disabled = !$('paidOk').checked; };
$('genBtn').onclick = async () => {
  if (!$('paidOk').checked) return;          // 有料確認なしでは呼ばない
  $('paidOk').checked = false; $('genBtn').disabled = true;   // 1回ごとに再確認
  const pr = $('prompt').value.trim(), st = $('genSt'), btn = $('genBtn');
  if (!pr) return alert('プロンプトを入力してください');
  btn.disabled = true; $('vid').hidden = true; st.textContent = '送信中…';
  const pv = apiProvs.find(p => p.id === $('apiProv').value);
  const j = { id: Date.now(), provider: pv.name + '(API)', prompt: pr, status: '生成中', result: '', memo: '', at: new Date().toLocaleString('ja-JP') };
  db.jobs.unshift(j); save(); renderJobs();
  try {
    let r = await api('/api/generate', { method: 'POST', body: JSON.stringify({ provider: pv.id, prompt: pr, aspect: $('apiAspect').value, model: $('apiModel').hidden ? undefined : $('apiModel').value, confirmPaid: true }) });
    const g = await r.json(); if (!r.ok) throw new Error(g.error);
    for (let i = 0; i < 120; i++) {           // 最大約10分
      await new Promise(ok => setTimeout(ok, 5000));
      r = await api('/api/jobs/' + g.id); const s = await r.json(); if (!r.ok) throw new Error(s.error);
      st.textContent = '生成中… ' + (i + 1) * 5 + '秒';
      if (s.status === 'failed') throw new Error(s.error || '失敗');
      if (s.status === 'done') {
        r = await fetch('/api/jobs/' + g.id + '/video', { headers: hdr() }); if (!r.ok) throw new Error('動画取得失敗');
        $('vid').src = URL.createObjectURL(await r.blob()); $('vid').hidden = false;
        j.status = '成功'; j.memo = 'API生成(再生はこのセッション内のみ。保存は動画を右クリック)'; st.textContent = '完了'; return;
      }
    }
    throw new Error('タイムアウト');
  } catch (e) { j.status = '失敗'; j.memo = String(e.message).slice(0, 200); st.textContent = '失敗: ' + j.memo; }
  finally { save(); renderJobs(); }
};
initApi();
