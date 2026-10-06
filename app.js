const $ = id => document.getElementById(id);
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function cards(el, items) {
  el.innerHTML = items.map(i =>
    `<a class="card" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}${i.verified ? '' : '<span class="tag">要確認</span>'}${i.channel ? `<br><small>${esc(i.channel)}</small>` : ''}</a>`
  ).join('');
}

function show(d, btn) {
  document.querySelectorAll('.dis').forEach(b => b.classList.toggle('on', b === btn));
  $('name').textContent = d.name;
  $('summary').textContent = d.summary;
  cards($('videos'), d.videos);
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
