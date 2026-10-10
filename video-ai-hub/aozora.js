// 原作の読み込み: 青空文庫(著作権の切れた作品を公開)の作品ページから本文を取り出す。
// 取り扱い規準は公式ページ https://www.aozora.gr.jp/guide/kijyunn.html で確認すること。
const MAX_CHARS = 40000;   // 長編は先頭のみ使う(使った範囲は画面とエージェントに明示する)

function decode(buf, contentType) {
  const head = buf.subarray(0, 2048).toString('latin1');
  const cs = (/charset=["']?([\w-]+)/i.exec(contentType || '') || /charset=["']?([\w-]+)/i.exec(head) || [])[1] || 'shift_jis';
  try { return new TextDecoder(cs.toLowerCase()).decode(buf); } catch { return new TextDecoder('shift_jis').decode(buf); }
}

function extract(html) {
  const pick = re => ((re.exec(html) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
  const title = pick(/<h1[^>]*class="title"[^>]*>([\s\S]*?)<\/h1>/i);
  const author = pick(/<h2[^>]*class="author"[^>]*>([\s\S]*?)<\/h2>/i);
  let body = (/<div[^>]*class="main_text"[^>]*>([\s\S]*?)<div[^>]*class="bibliographical_information"/i.exec(html) || /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html) || [])[1] || '';
  body = body.replace(/<rt>[\s\S]*?<\/rt>|<rp>[\s\S]*?<\/rp>/gi, '')   // ルビ(読みがな)を除く
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/[ \t　]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const truncated = body.length > MAX_CHARS;
  return { title, author, text: truncated ? body.slice(0, MAX_CHARS) : body, truncated, totalChars: body.length };
}

async function fetchAozora(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URLが正しくありません'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('URLが正しくありません');
  if (u.hostname !== 'www.aozora.gr.jp' || !/^\/cards\/\d+\/files\/[\w-]+\.html$/.test(u.pathname)) throw new Error('青空文庫の作品ページ(www.aozora.gr.jp/cards/…/files/….html)を指定してください');
  u.protocol = 'https:';
  const r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('取得に失敗しました ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('ページが大きすぎます');
  const x = extract(decode(buf, r.headers.get('content-type')));
  if (!x.text) throw new Error('本文を取り出せませんでした');
  return { ...x, source: u.toString(), credit: `原作: ${x.author}『${x.title}』(青空文庫 ${u.toString()})` };
}

module.exports = { fetchAozora, extract, decode, MAX_CHARS };
