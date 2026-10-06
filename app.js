const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = u => /^https?:\/\//i.test(u) ? u : '#';
const KEY = 'opd-visual-v1';
const KINDS = ['学会・病院・医師', '病態メカニズム解説', 'その他'];
const SECTIONS = [
  ['videos', '① 解説動画'],
  ['channels', '② 専門チャンネル'],
  ['sites', '③ 無料で使えるサイト']
];
let data = { diseases: [] }, cur = null, edit = false;

// URL全体・短縮URL・IDのどれを貼っても動画IDを取り出す
const ytId = x => (String(x).match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/) || String(x).match(/^([\w-]{11})$/) || [])[1] || '';

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} };
async function load() {
  try { const s = localStorage.getItem(KEY); if (s) { data = JSON.parse(s); return; } } catch {}
  data = await (await fetch('data/diseases.json')).json();
}
const disease = () => data.diseases.find(d => d.id === cur);

function renderNav() {
  $('diseases').innerHTML = data.diseases.map(d =>
    `<button class="dis${d.id === cur ? ' on' : ''}" data-act="pick" data-id="${esc(d.id)}">${esc(d.name)}</button>`).join('');
}

function itemHtml(sec, i, it) {
  const tag = (it.verified ? '' : '<span class="tag">要確認</span>') + (it.kind ? `<span class="kind">${esc(it.kind)}</span>` : '');
  const sub = it.channel ? `<br><small>${esc(it.channel)}</small>` : '';
  const main = sec === 'videos'
    ? `<button class="card" data-act="play" data-i="${i}">▶ ${esc(it.title)}${tag}${sub}</button>`
    : `<a class="card" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${esc(it.title)}${tag}</a>`;
  const ctl = edit ? `<div class="ctl"><label><input type="checkbox" data-act="verify" data-sec="${sec}" data-i="${i}" ${it.verified ? 'checked' : ''}> 確認済み</label>
    <button data-act="del" data-sec="${sec}" data-i="${i}">削除</button></div>` : '';
  return `<div class="item">${main}${ctl}</div>`;
}

function formHtml(sec, d) {
  if (sec === 'videos') return `<form class="add" data-sec="videos">
    <b>動画を追加</b>
    <input name="url" placeholder="YouTubeのURLを貼り付け" required>
    <input name="title" placeholder="タイトル(空欄なら自動取得を試みます)">
    <input name="channel" placeholder="投稿元(学会・病院・医師名など)">
    <select name="kind">${KINDS.map(k => `<option>${k}</option>`).join('')}</select>
    <button>追加</button>
    <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(d.name)}" target="_blank" rel="noopener noreferrer">YouTubeで「${esc(d.name)}」を検索 ↗</a>
  </form>`;
  return `<form class="add" data-sec="${sec}">
    <b>${sec === 'channels' ? 'チャンネル' : 'サイト'}を追加</b>
    <input name="url" placeholder="URLを貼り付け(https://…)" required>
    <input name="title" placeholder="表示名" required>
    <button>追加</button>
  </form>`;
}

function renderDetail() {
  const d = disease(), el = $('detail');
  if (!d) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = (edit
      ? `<input id="dname" value="${esc(d.name)}" class="big"> <button data-act="delDisease">この疾患を削除</button>
         <textarea id="dsum" rows="2">${esc(d.summary)}</textarea>`
      : `<h2>${esc(d.name)}</h2><p>${esc(d.summary)}</p>`) +
    '<div id="player" hidden></div>' +
    SECTIONS.map(([sec, label]) => `<h3>${label}</h3>
      <div class="grid">${d[sec].map((it, i) => itemHtml(sec, i, it)).join('') || '<p class="hint">まだ登録がありません。</p>'}</div>
      ${edit ? formHtml(sec, d) : ''}`).join('');
}

function render() {
  renderNav(); renderDetail();
  $('tools').hidden = !edit;
  $('toggleEdit').textContent = edit ? '✔ 設定を終了' : '⚙ 設定(追加・編集)';
}

function play(v) {
  const p = $('player'), id = ytId(v.id);
  if (!id) return;
  p.hidden = false;
  p.innerHTML = `<div class="frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0" title="${esc(v.title)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
    <p class="alt">${esc(v.title)} / 再生できない場合: <a href="https://www.youtube.com/watch?v=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">YouTubeで開く</a></p>`;
  p.scrollIntoView({ behavior: 'smooth' });
}

async function oembed(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const d = disease(), a = t.dataset.act;
  if (a === 'pick') { cur = t.dataset.id; render(); }
  else if (a === 'play') play(d.videos[t.dataset.i]);
  else if (a === 'del' && confirm('削除しますか?')) { d[t.dataset.sec].splice(t.dataset.i, 1); save(); renderDetail(); }
  else if (a === 'delDisease' && confirm(`「${d.name}」を削除しますか?`)) {
    data.diseases = data.diseases.filter(x => x !== d); cur = null; save(); render();
  }
});
document.addEventListener('change', e => {
  const t = e.target, d = disease();
  if (t.dataset.act === 'verify') { d[t.dataset.sec][t.dataset.i].verified = t.checked; save(); renderDetail(); }
  else if (t.id === 'dname' && t.value.trim()) { d.name = t.value.trim(); save(); renderNav(); }
  else if (t.id === 'dsum') { d.summary = t.value; save(); }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('form.add'); if (!f) return;
  e.preventDefault();
  const d = disease(), sec = f.dataset.sec, v = Object.fromEntries(new FormData(f));
  if (sec === 'videos') {
    const id = ytId(v.url);
    if (!id) return alert('YouTubeのURLを認識できません。動画のURLを貼ってください。');
    let title = v.title.trim(), channel = v.channel.trim();
    if (!title || !channel) {
      const o = await oembed(id);
      title = title || (o && o.title) || '(タイトル未入力)';
      channel = channel || (o && o.author_name) || '';
    }
    d.videos.push({ title, id, channel, kind: v.kind, verified: false });
  } else {
    if (!/^https?:\/\//i.test(v.url)) return alert('URLは http:// または https:// で始めてください。');
    d[sec].push({ title: v.title.trim(), url: v.url.trim(), verified: false });
  }
  save(); renderDetail();
});

$('toggleEdit').onclick = () => { edit = !edit; render(); };
$('addDisease').onclick = () => {
  const n = $('newDisease').value.trim(); if (!n) return;
  const id = 'd' + Date.now();
  data.diseases.push({ id, name: n, summary: '', videos: [], channels: [], sites: [] });
  $('newDisease').value = ''; cur = id; save(); render();
};
$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'diseases.json'; a.click(); URL.revokeObjectURL(a.href);
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  try {
    const j = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(j.diseases)) throw 0;
    data = j; cur = null; save(); render();
  } catch { alert('読み込めないファイルです。'); }
  e.target.value = '';
};
$('resetBtn').onclick = async () => {
  if (!confirm('追加した内容をすべて消して初期データに戻します。よろしいですか?')) return;
  try { localStorage.removeItem(KEY); } catch {}
  await load(); cur = null; render();
};

load().then(render).catch(() => { $('diseases').textContent = 'データ読込失敗。python3 -m http.server で起動してください。'; });
