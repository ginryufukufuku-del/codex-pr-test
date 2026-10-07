// AI監督(動画管理者)
// Claude が「監督」として、各社の動画生成API(サブエージェント)を使い、
// 企画 → ショット生成 → 出来の確認(状態・光) → 撮り直し → 色/明るさ/トリミング調整 → 音入れ → 編集(つなぎ)
// までを統括する。動画の加工は ffmpeg で行う。
// 有料の歯止め: 動画生成の回数上限をサーバー側で強制し、Claude の往復回数にも上限を設ける。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFile } = require('child_process');

const MODEL = process.env.DIRECTOR_MODEL || 'claude-opus-5-5';
const MAX_TURNS = 40;                                     // Claude との往復の上限
const PRICE = { input: 4, output: 20 };                   // claude-opus-5-5 の $/100万トークン(目安表示用)
const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';
const dataDir = () => process.env.DATA_DIR || path.join(__dirname, 'projects');
const ID_RE = /^[\w-]{1,32}$/;

let providers = {};
const projects = new Map();
let running = null;                                       // 同時に動かす監督は1人まで

function init(p) { providers = p; }

// ---------- ffmpeg ----------
function ff(args, timeout = 600000) {
  return new Promise(ok => execFile(ffmpegPath(), ['-hide_banner', '-y', ...args], { maxBuffer: 64 * 1024 * 1024, timeout },
    (err, stdout, stderr) => ok({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) })));
}
async function ffmpegAvailable() { return (await ff(['-version'], 15000)).code === 0; }
async function probe(file) {
  const { stderr } = await ff(['-i', file], 30000);
  const d = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const v = stderr.match(/Video: .*?, (\d{2,5})x(\d{2,5})/);
  return { duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + (+d[3]) : 0, width: v ? +v[1] : 0, height: v ? +v[2] : 0, hasAudio: /Audio: /.test(stderr) };
}
async function frames(file, dur, dir, tag) {
  const out = [];
  for (const [i, r] of [0.1, 0.5, 0.9].entries()) {
    const f = path.join(dir, `${tag}_f${i}.jpg`);
    await ff(['-ss', String(Math.max(0, dur * r).toFixed(2)), '-i', file, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '4', f], 60000);
    if (fs.existsSync(f)) out.push(fs.readFileSync(f).toString('base64'));
  }
  return out;
}
async function brightness(file) {            // 平均の明るさ(0〜255)。光の当たり具合の目安
  const { stdout, stderr } = await ff(['-i', file, '-vf', 'fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], 120000);
  const vals = [...(stdout + stderr).matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map(m => +m[1]);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}
const clamp = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

// 1ショットを、共通の解像度・フレームレート・音声形式にそろえ、色/明るさ/トリミングを反映する
async function normalizeShot(s, W, H, out) {
  const e = s.edit || {};
  const info = await probe(s.file);
  const start = clamp(e.trim_start_sec, 0, info.duration, 0);
  const end = clamp(e.trim_end_sec, 0, info.duration, 0);
  const len = Math.max(0.5, info.duration - start - end);
  const b = clamp(e.brightness, -0.3, 0.3, 0), c = clamp(e.contrast, 0.5, 1.5, 1), sat = clamp(e.saturation, 0, 2, 1), w = clamp(e.warmth, -1, 1, 0);
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,` +
    `eq=brightness=${b}:contrast=${c}:saturation=${sat},colorbalance=rm=${(w * 0.15).toFixed(3)}:bm=${(-w * 0.15).toFixed(3)},format=yuv420p`;
  const args = ['-ss', String(start), '-t', String(len), '-i', s.file];
  let amap = '0:a';
  if (!info.hasAudio) { args.push('-f', 'lavfi', '-t', String(len), '-i', 'anullsrc=r=48000:cl=stereo'); amap = '1:a'; }
  args.push('-filter_complex', `[0:v]${vf}[v];[${amap}]aresample=48000,aformat=channel_layouts=stereo[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', out);
  const r = await ff(args);
  if (r.code !== 0) throw new Error('ショットの整形に失敗: ' + r.stderr.slice(-300));
  return (await probe(out)).duration;
}

// ---------- 監督の道具(Claude が呼ぶツール) ----------
const TOOLS = [
  { name: 'plan_production', description: '最初に必ず呼ぶ。作品の企画(ショット構成・各ショットのカメラと光の当て方・音・編集方針)を保存する。後から呼び直して計画を更新してもよい。',
    input_schema: { type: 'object', properties: {
      title: { type: 'string' },
      shots: { type: 'array', items: { type: 'object', properties: {
        shot_id: { type: 'string', description: '英数字・ハイフン(例: s1)' }, purpose: { type: 'string', description: '物語上の役割' },
        prompt: { type: 'string', description: '動画生成AIに渡す本文(被写体・動き)' }, camera: { type: 'string' }, lighting: { type: 'string', description: '光の当て方(方向・質・色温度・時間帯)' }
      }, required: ['shot_id', 'purpose', 'prompt', 'camera', 'lighting'] } },
      audio: { type: 'object', properties: { bgm_mood: { type: 'string' }, original_audio: { type: 'string', enum: ['keep', 'mute'] }, narration_script: { type: 'string', description: 'ナレーション原稿(音声化はしない。台本として利用者に渡す)' } }, required: ['bgm_mood', 'original_audio'] },
      edit: { type: 'object', properties: { transition: { type: 'string', enum: ['cut', 'fade'] }, notes: { type: 'string' } }, required: ['transition'] }
    }, required: ['title', 'shots', 'audio', 'edit'] } },
  { name: 'generate_shot', description: '【有料】サブエージェント(動画生成AI)に1ショットを生成させ、完成まで待つ。回数上限あり。prompt にはカメラと光の指示も含めた完成形を書く。撮り直しにも使う。',
    input_schema: { type: 'object', properties: { shot_id: { type: 'string' }, prompt: { type: 'string' } }, required: ['shot_id', 'prompt'] } },
  { name: 'review_shot', description: '生成済みショットの状態を確認する。長さ・解像度・音声の有無・平均の明るさ(0〜255)と、開始/中間/終盤のコマ画像を返す。光の当たり方、破綻、計画との一致を目で確かめるのに使う。',
    input_schema: { type: 'object', properties: { shot_id: { type: 'string' } }, required: ['shot_id'] } },
  { name: 'set_shot_edit', description: 'ショットの細かな調整(小回り)。前後のトリミングと、色・明るさの補正(光の当て方の後処理)。値は省略すると変更なし。',
    input_schema: { type: 'object', properties: {
      shot_id: { type: 'string' }, trim_start_sec: { type: 'number' }, trim_end_sec: { type: 'number' },
      brightness: { type: 'number', description: '-0.3〜0.3(0=そのまま)' }, contrast: { type: 'number', description: '0.5〜1.5(1=そのまま)' },
      saturation: { type: 'number', description: '0〜2(1=そのまま)' }, warmth: { type: 'number', description: '-1(青み)〜1(暖色)' },
      include: { type: 'boolean', description: 'false で完成版から外す' }
    }, required: ['shot_id'] } },
  { name: 'set_audio', description: '音入れの設定。元の音(生成AIが付けた音)とBGMの音量、終わりのフェードアウト。BGMは利用者がアップロードした場合のみ使える。',
    input_schema: { type: 'object', properties: {
      original_volume: { type: 'number', description: '0〜1.5' }, bgm_volume: { type: 'number', description: '0〜1.5' }, fade_out_sec: { type: 'number', description: '0〜5' }
    }, required: ['original_volume', 'bgm_volume', 'fade_out_sec'] } },
  { name: 'render_final', description: '計画と調整を反映して完成版を書き出す(つなぎ・色・音入れ)。完成版の長さとコマ画像を返すので、最終確認に使う。必要なら調整して何度でも書き出し直してよい(無料)。',
    input_schema: { type: 'object', properties: {
      order: { type: 'array', items: { type: 'string' }, description: '使うショットIDの並び順' },
      transition: { type: 'string', enum: ['cut', 'fade'] }, fade_sec: { type: 'number', description: '0.2〜1.5' }
    }, required: ['order', 'transition'] } }
];

const SYSTEM = `あなたは動画制作の「監督(動画管理者)」です。利用者の依頼から短い動画を完成させるまで、全工程を統括します。
部下として動画生成AI(サブエージェント)を generate_shot で使えます。生成は有料で、回数に上限があります。

進め方:
1. plan_production で企画を立てる(ショット構成、各ショットのカメラ、光の当て方、音、つなぎ方)。ショット数は指定上限以内。
2. 各ショットを generate_shot で生成し、すぐ review_shot で出来を確認する。光の向き・明るさ・色温度、被写体の破綻、計画との一致を見る。
3. 小さな問題は set_shot_edit(トリミング、明るさ・コントラスト・彩度・色温度)で直す。撮り直しは、作品として使えない重大な問題で、かつ上限に余裕があるときだけ。
4. set_audio で音入れを決め、render_final で完成版を書き出し、返ってきたコマで最終確認する。必要なら調整して書き出し直す。
5. 最後に、利用者向けに日本語で短く報告する: 完成した内容、各ショットで何を確認し何を直したか、使った生成回数、ナレーション原稿(あれば。音声化はしていないと明記)、気になる残課題。

注意: 確認していないことを「確認した」と書かない。上限で作れなかったショットがあれば正直に書く。`;

// ---------- プロジェクト ----------
function publicView(p) {
  return { id: p.id, status: p.status, brief: p.brief, title: p.plan?.title || '', plan: p.plan, log: p.log.slice(-200),
    shots: Object.values(p.shots).map(s => ({ id: s.id, status: s.status, attempts: s.attempts, duration: s.info?.duration, brightness: s.brightness, edit: s.edit })),
    generations: { used: p.used, max: p.maxGenerations }, finalReady: !!p.finalFile && fs.existsSync(p.finalFile),
    cost: { inputTokens: p.usage.input, outputTokens: p.usage.output, usd: +(p.usage.input * PRICE.input / 1e6 + p.usage.output * PRICE.output / 1e6).toFixed(3) },
    error: p.error || null };
}
const say = (p, kind, text) => p.log.push({ t: new Date().toISOString(), kind, text: String(text).slice(0, 4000) });

async function waitForVideo(prov, job, p) {
  for (let i = 0; i < 120; i++) {                          // 5秒×120 = 最大10分
    if (p.stop) throw new Error('停止しました');
    await new Promise(ok => setTimeout(ok, 5000));
    const r = await prov.poll(job);
    if (r.status === 'failed') throw new Error(r.error || '生成に失敗');
    if (r.status === 'done') return r;
  }
  throw new Error('生成がタイムアウトしました');
}

async function runTool(p, name, input) {
  input = input && typeof input === 'object' ? input : {};
  if (name === 'plan_production') {
    if (!Array.isArray(input.shots) || !input.shots.length) return { error: 'shots が空です' };
    if (input.shots.length > p.maxShots) return { error: `ショット数は ${p.maxShots} 以内にしてください` };
    for (const s of input.shots) if (!ID_RE.test(String(s.shot_id))) return { error: `shot_id が不正です: ${s.shot_id}` };
    p.plan = input;
    for (const s of input.shots) p.shots[s.shot_id] ||= { id: s.shot_id, status: 'planned', attempts: 0, edit: {} };
    return { ok: true, message: `計画を保存しました(${input.shots.length}ショット)` };
  }
  const shot = p.shots[String(input.shot_id)];
  if (name === 'generate_shot') {
    if (!shot) return { error: '計画にないショットです。先に plan_production に入れてください' };
    if (p.used >= p.maxGenerations) return { error: `生成回数の上限(${p.maxGenerations}回)に達しました。これ以上は生成できません` };
    const prompt = String(input.prompt || '').trim().slice(0, 2000);
    if (!prompt) return { error: 'prompt が空です' };
    const prov = providers[p.provider];
    p.used++; shot.attempts++; shot.status = 'generating';
    say(p, 'paid', `【有料】${shot.id} を生成(${p.used}/${p.maxGenerations}回目)`);
    try {
      const job = { provider: p.provider, ...(await prov.start({ prompt, aspect: p.aspect, model: p.model })) };
      const done = await waitForVideo(prov, job, p);
      const file = path.join(p.dir, `shot_${shot.id}_${shot.attempts}.mp4`);
      if (done.localFile) fs.copyFileSync(done.localFile, file);
      else {
        const res = await fetch(done.videoUrl, { headers: prov.dlHeaders(), redirect: 'follow', signal: AbortSignal.timeout(180000) });
        if (!res.ok) throw new Error('動画の取得に失敗 ' + res.status);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
      shot.file = file; shot.prompt = prompt; shot.info = await probe(file); shot.status = 'generated';
      return { ok: true, shot_id: shot.id, duration_sec: shot.info.duration, resolution: `${shot.info.width}x${shot.info.height}`, has_audio: shot.info.hasAudio, generations_left: p.maxGenerations - p.used };
    } catch (e) { shot.status = 'failed'; return { error: String(e.message).slice(0, 300), generations_left: p.maxGenerations - p.used }; }
  }
  if (name === 'review_shot') {
    if (!shot?.file) return { error: 'まだ生成されていないショットです' };
    shot.brightness = await brightness(shot.file);
    const imgs = await frames(shot.file, shot.info.duration, p.dir, `rev_${shot.id}_${shot.attempts}`);
    shot.status = 'reviewed';
    return { images: imgs, text: JSON.stringify({ shot_id: shot.id, duration_sec: shot.info.duration, resolution: `${shot.info.width}x${shot.info.height}`, has_audio: shot.info.hasAudio, avg_brightness_0_255: shot.brightness, frames: '開始10%・中間50%・終盤90%' }) };
  }
  if (name === 'set_shot_edit') {
    if (!shot) return { error: '計画にないショットです' };
    const e = shot.edit;
    for (const [k, lo, hi] of [['trim_start_sec', 0, 60], ['trim_end_sec', 0, 60], ['brightness', -0.3, 0.3], ['contrast', 0.5, 1.5], ['saturation', 0, 2], ['warmth', -1, 1]])
      if (typeof input[k] === 'number') e[k] = clamp(input[k], lo, hi, 0);
    if (typeof input.include === 'boolean') e.include = input.include;
    return { ok: true, shot_id: shot.id, edit: e };
  }
  if (name === 'set_audio') {
    p.audio = { original_volume: clamp(input.original_volume, 0, 1.5, 1), bgm_volume: clamp(input.bgm_volume, 0, 1.5, 0.3), fade_out_sec: clamp(input.fade_out_sec, 0, 5, 1) };
    return { ok: true, audio: p.audio, bgm_available: !!p.bgmFile };
  }
  if (name === 'render_final') {
    const order = (Array.isArray(input.order) ? input.order : []).map(String).filter(id => p.shots[id]?.file && p.shots[id].edit.include !== false);
    if (!order.length) return { error: '使えるショットがありません(未生成か、除外されています)' };
    const [W, H] = p.aspect === '9:16' ? [720, 1280] : [1280, 720];
    const parts = [], durs = [];
    for (const [i, id] of order.entries()) {
      const out = path.join(p.dir, `norm_${i}.mp4`);
      durs.push(await normalizeShot(p.shots[id], W, H, out)); parts.push(out);
    }
    const fade = input.transition === 'fade' && parts.length > 1 ? clamp(input.fade_sec, 0.2, 1.5, 0.5) : 0;
    const joined = path.join(p.dir, 'joined.mp4');
    let r;
    if (!fade) {
      const list = path.join(p.dir, 'list.txt');
      fs.writeFileSync(list, parts.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      r = await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
    } else {
      const fc = []; let v = '[0:v]', a = '[0:a]', offset = 0;
      for (let i = 1; i < parts.length; i++) {
        offset += durs[i - 1] - fade;
        fc.push(`${v}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}[v${i}]`, `${a}[${i}:a]acrossfade=d=${fade}[a${i}]`);
        v = `[v${i}]`; a = `[a${i}]`;
      }
      r = await ff([...parts.flatMap(f => ['-i', f]), '-filter_complex', fc.join(';'), '-map', v, '-map', a, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', joined]);
    }
    if (r.code !== 0) return { error: 'つなぎに失敗: ' + r.stderr.slice(-300) };
    const total = (await probe(joined)).duration;
    const au = p.audio || { original_volume: 1, bgm_volume: 0.3, fade_out_sec: 1 };
    const fo = Math.min(au.fade_out_sec, total / 2);
    const final = path.join(p.dir, 'final.mp4');
    if (p.bgmFile) {
      r = await ff(['-i', joined, '-stream_loop', '-1', '-i', p.bgmFile, '-filter_complex',
        `[0:a]volume=${au.original_volume}[a0];[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${au.bgm_volume},atrim=0:${total.toFixed(3)}[a1];` +
        `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,afade=t=out:st=${Math.max(0, total - fo).toFixed(3)}:d=${fo.toFixed(3)}[a]`,
        '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(3), final]);
    } else {
      r = await ff(['-i', joined, '-af', `volume=${au.original_volume},afade=t=out:st=${Math.max(0, total - fo).toFixed(3)}:d=${fo.toFixed(3)}`, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', final]);
    }
    if (r.code !== 0) return { error: '音入れに失敗: ' + r.stderr.slice(-300) };
    p.finalFile = final;
    const info = await probe(final);
    return { images: await frames(final, info.duration, p.dir, 'final'), text: JSON.stringify({ ok: true, duration_sec: info.duration, resolution: `${info.width}x${info.height}`, shots_used: order, transition: fade ? 'fade' : 'cut', bgm: !!p.bgmFile, audio: au }) };
  }
  return { error: '不明なツールです: ' + name };
}

// ツールの結果を Claude に返す形(画像は base64 の image ブロック)
function toToolResult(id, r) {
  if (r.images) return { type: 'tool_result', tool_use_id: id, content: [...r.images.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } })), { type: 'text', text: r.text }] };
  return { type: 'tool_result', tool_use_id: id, is_error: !!r.error, content: JSON.stringify(r) };
}

function createClient() {
  if (process.env.DIRECTOR_MOCK === '1') return require('./test/director-mock').mockClient();   // テスト用(APIを呼ばない)
  const Anthropic = require('@anthropic-ai/sdk');
  return new (Anthropic.default || Anthropic)();          // ANTHROPIC_API_KEY を環境変数から読む
}

async function directorLoop(p) {
  const Anthropic = require('@anthropic-ai/sdk'), A = Anthropic.default || Anthropic;
  const client = createClient();
  const messages = [{ role: 'user', content:
    `依頼: ${p.brief}\n縦横比: ${p.aspect}\nショット数の上限: ${p.maxShots}\n動画生成の回数上限: ${p.maxGenerations}(撮り直しを含む)\nBGM: ${p.bgmFile ? '利用者がアップロード済み' : 'なし(元の音のみ)'}\n使用する動画生成AI: ${providers[p.provider].name}${p.model ? ' / ' + p.model : ''}` }];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (p.stop) { p.status = 'stopped'; say(p, 'info', '停止しました'); return; }
    let res;
    try {
      res = await client.beta.messages.create({
        model: MODEL, max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',   // 安全面で断られた場合に、推奨の別モデルで自動再実行
        output_config: { effort: 'high' },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM, tools: TOOLS, messages
      });
    } catch (e) {
      const msg = e instanceof A.AuthenticationError ? 'Claude の APIキーが無効です'
        : e instanceof A.RateLimitError ? 'Claude API の利用上限に達しました。時間をおいて再実行してください'
        : e instanceof A.APIError ? `Claude API エラー ${e.status}: ${e.message}` : String(e.message || e);
      p.status = 'error'; p.error = msg; say(p, 'error', msg); return;
    }
    p.usage.input += (res.usage?.input_tokens || 0) + (res.usage?.cache_creation_input_tokens || 0) + (res.usage?.cache_read_input_tokens || 0) * 0.1;
    p.usage.output += res.usage?.output_tokens || 0;
    for (const b of res.content) if (b.type === 'text' && b.text.trim()) say(p, 'director', b.text);
    if (res.stop_reason === 'refusal') { p.status = 'error'; p.error = '監督(Claude)がこの依頼を断りました'; say(p, 'error', p.error); return; }
    messages.push({ role: 'assistant', content: res.content });      // 応答は丸ごと追記(履歴は書き換えない)
    if (res.stop_reason === 'pause_turn') continue;
    if (res.stop_reason === 'max_tokens') { p.status = 'error'; p.error = '応答が長すぎて途中で切れました'; say(p, 'error', p.error); return; }
    const uses = res.content.filter(b => b.type === 'tool_use');
    if (res.stop_reason === 'end_turn' || !uses.length) { p.status = 'done'; return; }
    const results = [];
    for (const u of uses) {
      say(p, 'tool', `${u.name} ${JSON.stringify(u.input).slice(0, 300)}`);
      let r;
      try { r = await runTool(p, u.name, u.input); } catch (e) { r = { error: String(e.message || e).slice(0, 300) }; }
      if (r.error) say(p, 'warn', `${u.name}: ${r.error}`);
      results.push(toToolResult(u.id, r));
    }
    messages.push({ role: 'user', content: results });             // 複数ツールの結果は1つのメッセージで返す
  }
  p.status = 'error'; p.error = `往復の上限(${MAX_TURNS}回)に達しました`; say(p, 'error', p.error);
}

// ---------- 外部から使う関数(server.js が呼ぶ) ----------
function configured() { return process.env.DIRECTOR_MOCK === '1' || !!process.env.ANTHROPIC_API_KEY; }

function start({ brief, aspect, provider, model, maxShots, maxGenerations, bgmFile }) {
  if (running && ['running'].includes(running.status)) throw new Error('別の監督作業が実行中です。終わるか停止してから始めてください');
  const id = crypto.randomUUID(), dir = path.join(dataDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  const p = { id, dir, brief, aspect, provider, model, maxShots, maxGenerations, used: 0, plan: null, shots: {}, log: [],
    usage: { input: 0, output: 0 }, status: 'running', audio: null, bgmFile: null, finalFile: null, stop: false };
  if (bgmFile) { p.bgmFile = path.join(dir, 'bgm' + path.extname(bgmFile)); fs.renameSync(bgmFile, p.bgmFile); }
  projects.set(id, p); running = p;
  say(p, 'info', `監督が作業を開始しました(生成上限 ${maxGenerations} 回)`);
  directorLoop(p).catch(e => { p.status = 'error'; p.error = String(e.message || e); say(p, 'error', p.error); })
    .finally(() => { p.usage.input = Math.round(p.usage.input); });
  return id;
}
const get = id => { const p = projects.get(id); return p && publicView(p); };
const finalFile = id => projects.get(id)?.finalFile || null;
function stop(id) { const p = projects.get(id); if (p) p.stop = true; return !!p; }
const uploadDir = () => { const d = path.join(dataDir(), '_uploads'); fs.mkdirSync(d, { recursive: true }); return d; };

module.exports = { init, configured, ffmpegAvailable, start, get, finalFile, stop, uploadDir, MODEL, _runTool: runTool, _normalizeShot: normalizeShot };
