// テスト用の代役(APIを呼ばない・料金がかからない)
//  mockClient: Claude の代わりに、工程名に応じた決まった答えを返す(わざと1回「直して」と言う場面を含む)
//  mockProvider: 動画生成AIの代わりに ffmpeg でテスト映像を作る
//  startMockVoicevox: VOICEVOX ENGINE の代わりの小さなサーバー
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const media = require('../media');

const requests = [];   // テストで中身を確認するために記録する

const script = {
  title: '九回裏', logline: '最後の打席で逆転する', adaptation_notes: '原作の試合描写を30秒に凝縮',
  characters: [{ id: 'batter', name: '打者', appearance: '20代の男性、短髪、白いユニフォーム', voice_hint: '男性・力強い' }],
  beats: [
    { beat_id: 'b1', duration_sec: 3, description: '投手の構え', on_screen_dialogue: [], narration: '九回裏、二死満塁。' },
    { beat_id: 'b2', duration_sec: 3, description: '打者の表情', on_screen_dialogue: [{ character_id: 'batter', line: '来い!' }], narration: '' },
    { beat_id: 'b3', duration_sec: 3, description: '歓喜', on_screen_dialogue: [], narration: '逆転サヨナラ。' }
  ]
};
const shots = { shots: ['s1', 's2', 's3'].map((id, i) => ({ shot_id: id, beat_id: `b${i + 1}`, duration_sec: 3, shot_size: '寄り', angle: '目線', movement: '固定',
  blocking: '打者は画面右', lighting: '夕方の逆光', prompt: `${id}: 20代の男性、短髪、白いユニフォーム、夕方の逆光` })) };
const timeline = {
  voices: [{ role: 'narrator', speaker_id: 1, reason: '落ち着いた語り' }, { role: 'batter', speaker_id: 2, reason: '力強い男性' }],
  cues: [{ shot_id: 's1', offset_sec: 0.2, kind: 'narration', role: 'narrator', text: '九回裏、二死満塁。' },
    { shot_id: 's2', offset_sec: 0.5, kind: 'dialogue', role: 'batter', text: '来い!' },
    { shot_id: 's3', offset_sec: 0.3, kind: 'narration', role: 'narrator', text: '逆転サヨナラ。' }],
  grades: [{ shot_id: 's1', brightness: 0, contrast: 1.05, saturation: 1, warmth: 0.3, trim_start_sec: 0, trim_end_sec: 0 }],
  transition: 'fade', original_volume: 0.8, bgm_volume: 0.3, notes: '' };

function mockClient() {
  let scriptCritiques = 0, finalChecks = 0;
  const reviewed = {};
  return { beta: { messages: { parse: async req => {
    requests.push(req);
    const text = req.messages[0].content.at(-1).text;
    const stage = (/【工程:([^】]+)】/.exec(text) || [])[1] || '';
    const sys = req.system[0].text;
    const me = sys.includes('あなたは①脚本家') ? 'writer' : sys.includes('あなたは②撮影') ? 'camera' : sys.includes('あなたは③監督') ? 'director' : 'checker';
    let out;
    if (stage === '脚本') out = script;
    else if (stage.startsWith('脚本への意見')) {
      scriptCritiques++;
      out = scriptCritiques === 1 && me === 'camera'
        ? { verdict: 'revise', comments: [{ severity: 'medium', about: 'b2', comment: 'ボールの軌道は生成AIが苦手', suggestion: '打者の振り切りと観客の反応で表現する' }] }
        : { verdict: 'ok', comments: [] };
    } else if (stage.startsWith('脚本の修正')) out = { revised: script, responses: [{ to: '②撮影・生成担当', adopted: true, reason: 'ボールを映さない演出に変更' }] };
    else if (stage === 'ショット表') out = shots;
    else if (stage === 'タイムライン') out = timeline;
    else if (stage.includes('への意見')) out = { verdict: 'ok', comments: [] };
    else if (stage.endsWith('の出来の確認')) {
      const id = stage.split('の')[0];
      reviewed[id] = (reviewed[id] || 0) + 1;
      out = id === 's2' && reviewed[id] === 1 ? { accept: false, reason: '人物が左にいて絵コンテと逆', revised_prompt: 's2: 打者は画面右、夕方の逆光' } : { accept: true, reason: '計画どおり', revised_prompt: '' };
    } else if (stage.startsWith('ファクトチェック')) out = {
      checks: [{ cue_index: 0, ok: true, issue: '' }, { cue_index: 1, ok: false, issue: '口が映っているのに後付けの声で、口の動きが合わない' }, { cue_index: 2, ok: true, issue: '' }],
      cue_updates: [{ cue_index: 1, offset_sec: 0.4, text: '打者は心の中で叫んだ。来い!', kind: 'narration', remove: false }], notes: '画面内のセリフをナレーションに変更' };
    else if (stage.startsWith('完成版の最終チェック')) {
      finalChecks++;
      out = finalChecks === 1 ? { verdict: 'fix', summary: '1ショット目が暗い', fixes: [{ owner: 'camera', shot_id: 's1', kind: 'grade', detail: '明るさを上げる', brightness: 0.1 }] }
        : { verdict: 'pass', summary: '光と流れのつながりが自然', fixes: [] };
    } else throw new Error('想定外の工程: ' + stage);
    return { parsed_output: JSON.parse(JSON.stringify(out)), stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  } } } };
}

function mockProvider(dir) {
  let n = 0;
  return { name: 'テスト用の生成AI', paid: true, aspects: ['16:9', '9:16'], configured: () => true,
    async start({ prompt }) {
      const f = path.join(dir, `gen_${++n}.mp4`);
      const r = await media.ff(['-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=24:duration=3`, '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3',
        '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', f]);
      if (r.code) throw new Error(r.stderr.slice(-200));
      return { ref: f, prompt };
    },
    async poll(job) { return { status: 'done', localFile: job.ref }; },
    dlHeaders: () => ({}) };
}

async function startMockVoicevox() {
  const wav = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vv-')), 'v.wav');
  await media.ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', '-ar', '24000', wav]);
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'GET' && u.pathname === '/speakers') return res.end(JSON.stringify([{ name: 'テスト話者', styles: [{ name: 'ノーマル', id: 1 }, { name: '元気', id: 2 }] }]));
    if (req.method === 'POST' && u.pathname === '/audio_query') return res.end(JSON.stringify({ text: u.searchParams.get('text') }));
    if (req.method === 'POST' && u.pathname === '/synthesis') { res.setHeader('content-type', 'audio/wav'); return res.end(fs.readFileSync(wav)); }
    res.statusCode = 404; res.end();
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}

module.exports = { mockClient, mockProvider, startMockVoicevox, requests };
