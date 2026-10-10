// 4人のエージェントの制作の流れを、代役(API不使用・無料)で最初から最後まで通すテスト
// 実行: npm test(ffmpeg が必要)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  const mock = require('./studio-mock');
  const vv = await mock.startMockVoicevox();
  Object.assign(process.env, { STUDIO_MOCK: '1', STUDIO_POLL_MS: '10', DATA_DIR: tmp, VOICEVOX_URL: vv.url });
  const media = require('../media'), studio = require('../studio');
  studio.init({ mock: mock.mockProvider(tmp) });

  const id = await studio.start({ brief: '野球の逆転サヨナラを30秒で', source: { text: '九回裏、二死満塁。打者は…', title: '', author: '' },
    targetSec: 30, aspect: '16:9', provider: 'mock', model: undefined, maxShots: 3, maxGenerations: 5, rounds: 2, useVoice: true, bgmFile: null });
  let v;
  for (let i = 0; i < 600; i++) { v = studio.view(id); if (v.status !== 'running') break; await new Promise(ok => setTimeout(ok, 200)); }
  if (v.status !== 'done') { console.log(v.log.map(l => `${l.agent} ${l.kind}: ${l.text}`).join('\n')); }
  assert.strictEqual(v.status, 'done', v.error);

  // 4人全員が発言し、意見→修正のやり取りがあること
  const agents = new Set(v.log.map(l => l.agent));
  for (const a of ['①脚本家', '②撮影・生成担当', '③監督', '④最終チェック']) assert(agents.has(a), a + ' の発言がない');
  assert(v.log.some(l => l.agent === '①脚本家' && l.kind === 'reply' && /採用/.test(l.text)), '脚本家が意見に回答していない');
  // 撮り直し(s2 が1回差し戻し)と、生成回数の記録
  assert.strictEqual(v.shots.find(s => s.id === 's2').attempts, 2);
  assert.strictEqual(v.generations.used, 4);
  // ファクトチェックで画面内のセリフがナレーションに変わったこと
  assert.strictEqual(v.notebook.timeline.cues[1].kind, 'narration');
  // 最終チェックの指摘(明るさ)を反映して再書き出し → 合格
  assert.strictEqual(v.notebook.final.verdict, 'pass');
  // 完成版: 映像と音声があり、長さが3ショット分(フェードの重なりを引く)
  const info = await media.probe(studio.finalFile(id));
  assert(info.hasAudio && info.width === 1280 && info.height === 720, JSON.stringify(info));
  assert(info.duration > 7 && info.duration < 9.5, '長さ ' + info.duration);
  const vol = await media.volume(studio.finalFile(id));
  assert(vol.max_db > -30, '声・音が入っていない ' + JSON.stringify(vol));
  // クレジット(VOICEVOX の表記が入ること)
  assert(v.credits.includes('VOICEVOX:テスト話者'), JSON.stringify(v.credits));
  assert(fs.readFileSync(path.join(tmp, id, 'credits.txt'), 'utf8').includes('VOICEVOX:テスト話者'));
  // Claude への要求の形(モデル・構造化出力・安全装置・画像)
  const reqs = mock.requests;
  assert(reqs.every(r => r.model === 'claude-opus-5-5' && r.output_config.format.type === 'json_schema' && r.fallbacks === 'default' && r.betas.includes('server-side-fallback-2026-07-01')));
  assert(reqs.some(r => r.messages[0].content.some(c => c.type === 'image')), 'コマ画像が渡されていない');
  console.log(`OK: Claude ${v.claudeCalls}回 / 生成 ${v.generations.used}回 / 完成 ${info.duration.toFixed(1)}秒 / 発言 ${v.log.length}件`);
  vv.close();
})().catch(e => { console.error('NG:', e.message); process.exit(1); });
