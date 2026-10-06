const $ = id => document.getElementById(id);
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function cards(el, items) {
  el.innerHTML = items.map(i =>
    `<a class="card" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}${i.verified ? '' : '<span class="tag">要確認</span>'}${i.channel ? `<br><small>${esc(i.channel)}</small>` : ''}</a>`
  ).join('');
}

// URL全体・短縮URL・IDのどれを貼っても動画IDを取り出す
const ytId = x => (String(x).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/) || String(x).match(/^([\w-]{11})$/) || [])[1] || '';

function play(v) {
  v = {...v, id: ytId(v.id)};
  if (!v.id) return;
  const p = $('player');
  p.hidden = false;
  p.innerHTML = `<div class="frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?rel=0" title="${esc(v.title)}" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` +
    `<p class="alt">${esc(v.title)} / 再生できない場合: <a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener noreferrer">YouTubeで開く</a></p>`;
  p.scrollIntoView({behavior: 'smooth'});
}

function videoCards(el, items) {
  el.innerHTML = '';
  items.forEach(v => {
    if (!v.id) { cards(el.appendChild(document.createElement('div')), [v]); return; }
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `▶ ${esc(v.title)}${v.channel ? `<br><small>${esc(v.channel)}</small>` : ''}`;
    b.onclick = () => play(v);
    el.append(b);
  });
}

function show(d, btn) {
  $('player').hidden = true;
  $('player').innerHTML = '';
  document.querySelectorAll('.dis').forEach(b => b.classList.toggle('on', b === btn));
  $('name').textContent = d.name;
  $('summary').textContent = d.summary;
  videoCards($('videos'), d.videos);
  cards($('channels'), d.channels);
  cards($('sites'), d.sites);
  $('detail').hidden = false;
}

fetch('data/diseases.json').then(r => r.json()).then(({diseases}) => {
  diseases.forEach(d => {
    const b = document.createElement('button');
    b.className = 'dis';
    b.textContent = d.name;
    b.onclick = () => show(d, b);
    $('diseases').append(b);
  });
}).catch(() => { $('diseases').textContent = 'データ読込失敗。python3 -m http.server で起動してください。'; });
