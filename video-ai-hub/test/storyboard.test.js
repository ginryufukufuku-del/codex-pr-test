// 脚本・絵コンテ スタジオの JSON → AI制作チームの脚本・ショット表 の変換と、絵コンテから始める制作の流れのテスト
// 実行: npm test(ffmpeg が必要。API は呼ばない)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const sb = require('../storyboard');

const project = {
  title: '最後の観測者', logline: '少女が父の信号への返信を受け取る', theme: '想いは時間を越えて届く', world: 'SF（宇宙・未来）', tone: '叙情的', aspect: '16:9',
  characters: [{ id: 'm', name: 'ミナ', age: '17', desc: '観測ステーションの少女', speech: '短く淡々と' }, { id: 'f', name: '父', age: '45', desc: '天文学者', speech: '穏やか' },
    { id: 'n', name: 'N', desc: 'ナレーション' }],
  beats: [{ id: 'b1', name: '起' }, { id: 'b2', name: '承' }],
  scenes: [   // 配列の順と、ビートの順が逆(並べ替えを確認する)
    { id: 's2', beatId: 'b2', place: '居住区', time: '夜', chars: ['m', 'f'], summary: '父の記録映像', cuts: [
      { shot: 'MS', angle: 'アイレベル', move: 'ドリーイン', comp: '日の丸（中央）', sec: 4, action: 'ホログラムの父', dialogue: '父（声）「観測を続けてくれ」' },
      { shot: 'CU', angle: 'アイレベル', move: 'FIX', comp: '三分割', sec: 3, action: 'ミナの表情', dialogue: 'ミナ「届くって、何が」' }] },
    { id: 's1', beatId: 'b1', place: 'ドーム', time: '夜', chars: ['m'], summary: '孤独な日常', cuts: [
      { shot: 'EWS', angle: 'アイレベル', move: 'FIX', comp: '引き（余白大）', sec: 3, action: '宇宙に浮かぶステーション', dialogue: 'N「十年が過ぎた」', sketch: 'data:image/jpeg;base64,xx' },
      { shot: 'XX', angle: '', move: '', comp: '', sec: 2.5, action: '端末の画面', dialogue: '', aiPrompt: 'insert shot of a terminal screen, custom prompt' }] },
  ]
};

(async () => {
  // シーン番号はビート順
  const sc = sb.scenesOf(project);
  assert.deepStrictEqual(sc.map(s => s.scene.id), ['s1', 's2']);
  assert.strictEqual(sc[0].sec, 5.5);

  const plan = sb.toPlan(project, 2, 2);
  assert.strictEqual(plan.range, 'S2');
  assert.deepStrictEqual(plan.shots.shots.map(s => s.shot_id), ['c3', 'c4']);           // 作品全体での通し番号
  assert.strictEqual(plan.targetSec, 7);
  const [b3, b4] = plan.script.beats;
  assert.strictEqual(b3.narration, '観測を続けてくれ');                                   // 画面外の声はナレーション
  assert.deepStrictEqual(b3.on_screen_dialogue, []);
  assert.deepStrictEqual(b4.on_screen_dialogue, [{ character_id: 'c1', line: '届くって、何が' }]);
  assert.deepStrictEqual(plan.script.characters.map(c => c.name), ['ミナ', '父']);          // ナレーターは人物に入れない
  assert(/medium shot/.test(plan.shots.shots[0].prompt) && /ミナ: 17歳/.test(plan.shots.shots[0].prompt));

  const p1 = sb.toPlan(project, 1);
  assert.strictEqual(p1.script.beats[0].narration, '十年が過ぎた');
  assert.strictEqual(p1.shots.shots[1].prompt, 'insert shot of a terminal screen, custom prompt');   // 動画制作スタジオで直したプロンプトを優先
  assert.strictEqual(p1.shots.shots[1].shot_size, 'ミディアム(腰上)');                         // 不明な画面サイズは MS 扱い
  assert(!JSON.stringify(p1).includes('base64'), '手描きの絵が混ざっている');

  assert.throws(() => sb.toPlan(project, 0), /範囲/);
  assert.throws(() => sb.toPlan(project, 2, 1), /範囲/);
  const big = { ...project, scenes: [{ id: 'x', cuts: Array.from({ length: 13 }, () => ({ sec: 1 })) }] };
  assert.throws(() => sb.toPlan(big, 1), /12カットまで/);
  const long = { ...project, scenes: [{ id: 'x', cuts: [{ sec: 60 }, { sec: 61 }] }] };
  assert.throws(() => sb.toPlan(long, 1), /120秒まで/);
  assert.throws(() => sb.toPlan({}, 1), /JSONではありません/);

  // 絵コンテから始める制作: 脚本・ショット表の話し合いを省いて完成まで進む
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sb-'));
  const mock = require('./studio-mock');
  Object.assign(process.env, { STUDIO_MOCK: '1', STUDIO_POLL_MS: '10', DATA_DIR: tmp });
  const media = require('../media'), studio = require('../studio');
  studio.init({ mock: mock.mockProvider(tmp) });
  const id = await studio.start({ brief: plan.brief, source: { text: plan.sourceText, title: '', author: '' }, targetSec: plan.targetSec, aspect: '16:9',
    provider: 'mock', model: undefined, maxShots: plan.maxShots, maxGenerations: 4, rounds: 1, useVoice: false, bgmFile: null, plan });
  let v;
  for (let i = 0; i < 600; i++) { v = studio.view(id); if (v.status !== 'running') break; await new Promise(ok => setTimeout(ok, 200)); }
  if (v.status !== 'done') console.log(v.log.map(l => `${l.agent} ${l.kind}: ${l.text}`).join('\n'));
  assert.strictEqual(v.status, 'done', v.error);
  const stages = mock.requests.map(r => (/【工程:([^】]+)】/.exec(r.messages[0].content.at(-1).text) || [])[1]);
  assert(!stages.some(s => s === '脚本' || s === 'ショット表' || /^脚本への意見|^ショット表への意見/.test(s)), '脚本・ショット表の話し合いが省かれていない');
  assert.deepStrictEqual(v.shots.map(s => s.id), ['c3', 'c4']);
  assert(v.credits.some(c => c.includes('最後の観測者') && c.includes('S2')), JSON.stringify(v.credits));
  const info = await media.probe(studio.finalFile(id));
  assert(info.duration > 4 && info.width === 1280, JSON.stringify(info));
  console.log(`OK: storyboard(${stages.length}回の Claude 呼び出しで完成 ${info.duration.toFixed(1)}秒)`);
})().catch(e => { console.error('NG:', e.message); process.exit(1); });
