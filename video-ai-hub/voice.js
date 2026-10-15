// 語りの声: VOICEVOX ENGINE(無料の日本語読み上げ。利用者のMacで起動しておく)
// 流れ: /audio_query で読み方を作る → /synthesis で WAV を作る。話者の一覧は /speakers。
// 利用条件: 「VOICEVOX:キャラ名」のクレジット表記が必要。条件はキャラクターごとに異なるため、公式の規約を確認すること。
const fs = require('fs');

const base = () => (process.env.VOICEVOX_URL || 'http://127.0.0.1:50021').replace(/\/$/, '');

async function speakers() {
  try {
    const r = await fetch(base() + '/speakers', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const list = await r.json();
    return list.flatMap(s => (s.styles || []).map(st => ({ id: st.id, character: s.name, style: st.name, label: `${s.name}(${st.name})` })));
  } catch { return []; }   // 起動していなければ空
}

async function synthesize(text, speakerId, outFile) {
  const q = await fetch(`${base()}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`, { method: 'POST', signal: AbortSignal.timeout(30000) });
  if (!q.ok) throw new Error('VOICEVOX audio_query に失敗 ' + q.status);
  const query = await q.json();
  const s = await fetch(`${base()}/synthesis?speaker=${speakerId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query), signal: AbortSignal.timeout(120000)
  });
  if (!s.ok) throw new Error('VOICEVOX synthesis に失敗 ' + s.status);
  fs.writeFileSync(outFile, Buffer.from(await s.arrayBuffer()));
  return outFile;
}

module.exports = { speakers, synthesize };
