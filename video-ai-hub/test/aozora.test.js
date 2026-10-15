// 青空文庫の本文取り出しのテスト(ネットに接続しない)
const assert = require('assert');
const { extract, decode } = require('../aozora');

// Shift_JIS の「吾輩は猫である」を正しく読めること
const sjis = Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html;charset=Shift_JIS"></head><body>', 'latin1');
const body = Buffer.concat([sjis, Buffer.from('8ce1947982cd944c82c582a082e9', 'hex'), Buffer.from('</body></html>', 'latin1')]);
assert(decode(body, 'text/html').includes('吾輩は猫である'));

// ルビ(読みがな)と注記を除き、題名・著者・本文を取り出すこと
const html = `<h1 class="title">吾輩は猫である</h1><h2 class="author">夏目漱石</h2>
<div class="main_text"><ruby><rb>吾輩</rb><rp>(</rp><rt>わがはい</rt><rp>)</rp></ruby>は猫である。<br />名前はまだ無い。</div>
<div class="bibliographical_information">底本:…</div>`;
const x = extract(html);
assert.strictEqual(x.title, '吾輩は猫である');
assert.strictEqual(x.author, '夏目漱石');
assert.strictEqual(x.text, '吾輩は猫である。\n名前はまだ無い。');
assert(!x.text.includes('わがはい') && !x.text.includes('底本'));
console.log('OK: aozora');
