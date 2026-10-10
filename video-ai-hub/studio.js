// AI制作チーム(4人のエージェント)
//  ①脚本家 ②撮影・生成担当 ③監督 ④最終チェック が、共有の「制作ノート」を見ながら
//  「案を出す → ほかの3人が意見 → 書き手が直す(採否と理由を返す) → もう一度確認」を繰り返して質を上げる。
//  参考: FilmAgent(批評→修正→検証/討論→判定)、Camera Artist(脚本・場面・ショットの3段の絵コンテ)、
//        制作者の実践(生成前に人物の見た目を固定、ショットの境目のコマでつながりを確認)。
// 有料の歯止め: 動画生成の回数と、Claude の呼び出し回数に上限を設け、サーバー側で強制する。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const media = require('./media'), voice = require('./voice');

const MODEL = process.env.STUDIO_MODEL || 'claude-opus-5-5';
const MAX_CLAUDE_CALLS = 80;
const PRICE = { input: 4, output: 20 };   // claude-opus-5-5 の $/100万トークン(目安)
const NATIVE_AUDIO = new Set(['veo']);    // 映像と一緒に音声(セリフ・環境音)も作れる生成AI
const dataDir = () => process.env.DATA_DIR || path.join(__dirname, 'projects');
const ID_RE = /^[\w-]{1,32}$/;
const clamp = media.clamp;

let providers = {};
const projects = new Map();
let current = null;
function init(p) { providers = p; }

// ---------- 4人のエージェント ----------
const COMMON = `あなたは、AIだけで構成された4人の映像制作チームの一員です。
メンバー: ①脚本家 ②撮影・生成担当 ③監督 ④最終チェック。全員が同じ「制作ノート」を見て、互いの案に率直に意見を言い、より良い作品にします。
共通のルール:
- 日本語で、具体的かつ簡潔に書く。指摘には必ず「どう直すか」を添える。
- 確認していないことを確認したと書かない。画像で見えないことは「見えない」と書く。
- 素材は権利的に使ってよいもの(利用者が用意した文章、著作権の切れた原作、利用条件を守った読み上げ音声)だけを使う前提で考える。
- 動画生成AIは、ボールなど小さく速い物体、指先、文字、群衆の細部、長いセリフの口の動きが苦手。これらに頼らない演出を選ぶ。
- 登場人物の見た目は、最初に決めた設定文(キャラクター設定)を全ショットでそのまま使い、ぶれさせない。`;

const AGENTS = {
  writer: { name: '①脚本家', system: `あなたは①脚本家です。原作と依頼から、指定の長さに収まる映像用の脚本を書きます。
- 場面を「ビート」(数秒の出来事)に分け、各ビートの秒数を決める。合計は目標の長さ前後。ビート数はショット数の上限以内。
- 登場人物ごとに、見た目の設定文(顔立ち・髪・服装・年齢感)と声の希望(性別・口調)を決める。
- 画面内で話すセリフは短く(口の動きのズレが目立たないように)。説明はナレーションに回す。
- 原作の事実(人物名・出来事)を勝手に変えない。脚色した点は自分で明記する。` },
  camera: { name: '②撮影・生成担当', system: `あなたは②撮影・生成担当です。脚本をカメラワークと人物の位置関係(立ち位置・向き・前後関係)に落とし込み、動画生成AIへの指示文を書き、出来上がった映像を自分の目で確認します。
- ショットごとに、画角(寄り/引き)、カメラの高さと角度、動き、レンズ感、人物の配置、光(方向・質・色温度・時間帯)を決める。
- 隣り合うショットで、光の向き・時間帯・人物の左右の位置(イマジナリーライン)をそろえる。
- 生成AIへの指示文には、登場人物の設定文をそのまま入れる。
- 生成された映像の確認では、絵コンテ(ショット表)から外れていれば撮り直し、計画どおりでも不自然なら理由を書く。` },
  director: { name: '③監督', system: `あなたは③監督です。作品全体を最初から最後まで一気通貫で見て、秒ごとのタイムライン(どのコマで何を見せ、いつ誰が何を話すか)を決めます。
- 声の配役: 渡された読み上げ音声の候補から、各登場人物とナレーターに合う声を選ぶ。候補がなければ声は使わない。
- セリフとナレーションの配置: 各ショットの何秒目に入れるかを決め、ショットの長さを超えないようにする。
- 「ファクトチェック」: セリフやナレーションが、映像の状況(誰が映っているか、口が動いているか、場所や時間帯)と合っているか、原作の事実と矛盾しないかを確かめる。
- 口が映っているのに後から付けた声を当てると、口の動きは合わない。その場合はナレーション(画面外の声)に変えるか、口が映らない配置を選ぶ。` },
  checker: { name: '④最終チェック', system: `あなたは④最終チェックです。完成に近い映像を、他の3人から独立した目で厳しく判定します。
- 見る点: 効果音・BGM・声の音量と配置、照明(光の向き・明るさ・色)のつながり、人物と物の配置、ドラマの流れ(話がつながるか)、カメラワークの一貫性、ショットの境目の不自然さ。
- 直すべき点は、担当者(②撮影・生成担当/③監督)と、具体的な直し方(数値)を付けて指示する。
- 小さな好みの違いで差し戻さない。作品として問題がある点だけを挙げる。` }
};

// ---------- 出力の形(JSONスキーマ) ----------
const S = (props, req) => ({ type: 'object', properties: props, required: req || Object.keys(props) });
const str = { type: 'string' }, num = { type: 'number' }, bool = { type: 'boolean' };
const arr = items => ({ type: 'array', items });
const SCHEMA = {
  script: S({ title: str, logline: str, adaptation_notes: str,
    characters: arr(S({ id: str, name: str, appearance: str, voice_hint: str })),
    beats: arr(S({ beat_id: str, duration_sec: num, description: str, on_screen_dialogue: arr(S({ character_id: str, line: str })), narration: str })) }),
  shots: S({ shots: arr(S({ shot_id: str, beat_id: str, duration_sec: num, shot_size: str, angle: str, movement: str, blocking: str, lighting: str, prompt: str })) }),
  timeline: S({
    voices: arr(S({ role: str, speaker_id: num, reason: str })),
    cues: arr(S({ shot_id: str, offset_sec: num, kind: { type: 'string', enum: ['narration', 'dialogue'] }, role: str, text: str })),
    grades: arr(S({ shot_id: str, brightness: num, contrast: num, saturation: num, warmth: num, trim_start_sec: num, trim_end_sec: num })),
    transition: { type: 'string', enum: ['cut', 'fade'] }, original_volume: num, bgm_volume: num, notes: str }),
  critique: S({ verdict: { type: 'string', enum: ['ok', 'revise'] },
    comments: arr(S({ severity: { type: 'string', enum: ['high', 'medium', 'low'] }, about: str, comment: str, suggestion: str })) }),
  reply: S({ responses: arr(S({ to: str, adopted: bool, reason: str })) }),
  shotReview: S({ accept: bool, reason: str, revised_prompt: str }),
  factcheck: S({ checks: arr(S({ cue_index: num, ok: bool, issue: str })),
    cue_updates: arr(S({ cue_index: num, offset_sec: num, text: str, kind: { type: 'string', enum: ['narration', 'dialogue'] }, remove: bool })), notes: str }),
  final: S({ verdict: { type: 'string', enum: ['pass', 'fix'] }, summary: str,
    fixes: arr(S({ owner: { type: 'string', enum: ['camera', 'director', 'writer'] }, shot_id: str,
      kind: { type: 'string', enum: ['grade', 'trim', 'audio_timing', 'regenerate', 'other'] }, detail: str,
      brightness: num, contrast: num, saturation: num, warmth: num, trim_start_sec: num, trim_end_sec: num, cue_index: num, offset_sec: num, revised_prompt: str },
    ['owner', 'shot_id', 'kind', 'detail'])) })
};
SCHEMA.revision = k => S({ revised: SCHEMA[k], responses: SCHEMA.reply.properties.responses });

// ---------- Claude の呼び出し ----------
function createClient() {
  if (process.env.STUDIO_MOCK === '1') return require('./test/studio-mock').mockClient();   // テスト用(APIを呼ばない)
  const A = require('@anthropic-ai/sdk');
  return new (A.default || A)();          // ANTHROPIC_API_KEY を環境変数から読む
}

async function ask(p, agent, stage, task, schema, images = []) {
  if (p.stop) throw new Error('停止しました');
  if (p.calls >= MAX_CLAUDE_CALLS) throw new Error(`Claude の呼び出し回数の上限(${MAX_CLAUDE_CALLS}回)に達しました`);
  p.calls++;
  const { betaJSONSchemaOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/json-schema');
  const content = [...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: im.data } })),
    { type: 'text', text: `【工程:${stage}】\n${task}` }];
  let res;
  try {
    res = await p.client.beta.messages.parse({
      model: MODEL, max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',   // 安全面で断られたら推奨の別モデルで自動再実行
      output_config: { effort: 'high', format: betaJSONSchemaOutputFormat(schema) },
      system: [{ type: 'text', text: `${COMMON}\n\n${AGENTS[agent].system}`, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }]
    });
  } catch (e) {
    const A = require('@anthropic-ai/sdk'), K = A.default || A;
    throw new Error(e instanceof K.AuthenticationError ? 'Claude の APIキーが無効です'
      : e instanceof K.RateLimitError ? 'Claude API の利用上限に達しました。時間をおいて再実行してください'
      : e instanceof K.APIError ? `Claude API エラー ${e.status}: ${e.message}` : String(e.message || e));
  }
  const u = res.usage || {};
  p.usage.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
  p.usage.output += u.output_tokens || 0;
  if (res.stop_reason === 'refusal') throw new Error(`${AGENTS[agent].name}(Claude)がこの依頼を断りました`);
  if (res.stop_reason === 'max_tokens') throw new Error(`${AGENTS[agent].name}の答えが長すぎて途中で切れました`);
  if (!res.parsed_output) throw new Error(`${AGENTS[agent].name}の答えを読み取れませんでした`);
  return res.parsed_output;
}

// ---------- 制作ノートと会話ログ ----------
const say = (p, agent, kind, text) => p.log.push({ t: new Date().toISOString(), agent: agent ? AGENTS[agent]?.name || agent : 'システム', kind, text: String(text).slice(0, 6000) });
const brief = obj => JSON.stringify(obj, null, 1).slice(0, 20000);
function context(p, forWriter) {
  return `依頼: ${p.brief}\n目標の長さ: 約${p.targetSec}秒 / 縦横比: ${p.aspect} / ショット数の上限: ${p.maxShots}\n` +
    `動画生成AI: ${providers[p.provider].name}${p.model ? ' / ' + p.model : ''}(映像と同時に音声も作れるか: ${p.nativeAudio ? 'はい' : 'いいえ'})\n` +
    `原作: ${p.source.title ? `${p.source.author}『${p.source.title}』` : '利用者の文章'}${p.source.truncated ? '(長いため先頭のみ)' : ''}\n` +
    `---原作ここから---\n${forWriter ? p.source.text : p.source.text.slice(0, 6000)}\n---原作ここまで---`;
}

// 「案 → 意見 → 修正(採否と理由) → 再確認」を、全員OKか上限回数まで繰り返す
async function debate(p, stage, author, critics, schemaKey, draftTask, extra = '') {
  let draft = await ask(p, author, stage, `${context(p, author === 'writer')}\n${extra}\n\n${draftTask}`, SCHEMA[schemaKey]);
  say(p, author, 'draft', `${stage}の案を出しました。`);
  p.notebook[schemaKey] = draft;
  for (let round = 1; round <= p.rounds; round++) {
    const reviews = await Promise.all(critics.map(c => ask(p, c, `${stage}への意見(${round}回目)`,
      `${context(p, false)}\n${extra}\n\n${AGENTS[author].name}の${stage}案:\n${brief(draft)}\n\nあなたの担当の視点から意見を述べてください。問題がなければ verdict を ok に。`, SCHEMA.critique)));
    reviews.forEach((r, i) => {
      say(p, critics[i], r.verdict === 'ok' ? 'ok' : 'comment', r.verdict === 'ok' && !r.comments.length ? '問題ありません。'
        : r.comments.map(c => `[${c.severity}] ${c.about}: ${c.comment} → ${c.suggestion}`).join('\n'));
    });
    const open = reviews.flatMap((r, i) => r.verdict === 'revise' ? r.comments.filter(c => c.severity !== 'low').map(c => ({ from: AGENTS[critics[i]].name, ...c })) : []);
    if (!open.length) { say(p, null, 'info', `${stage}: 全員が了承しました。`); break; }
    const rev = await ask(p, author, `${stage}の修正(${round}回目)`,
      `${context(p, author === 'writer')}\n${extra}\n\nあなたの${stage}案:\n${brief(draft)}\n\n他のメンバーからの意見:\n${brief(open)}\n\n` +
      `意見を検討して案を直してください。採用しない意見は、理由を responses に書いてください(この工程の最終判断はあなたです)。`, SCHEMA.revision(schemaKey));
    draft = rev.revised; p.notebook[schemaKey] = draft;
    say(p, author, 'reply', rev.responses.map(r => `${r.adopted ? '採用' : '見送り'}: ${r.to} — ${r.reason}`).join('\n') || '修正しました。');
    if (round === p.rounds) say(p, null, 'info', `${stage}: 話し合いの上限に達したため、${AGENTS[author].name}の判断で確定しました。`);
  }
  return draft;
}

// ---------- 生成(サブエージェント=動画生成AI) ----------
async function generate(p, shot, prompt) {
  if (p.used >= p.maxGenerations) throw new Error(`生成回数の上限(${p.maxGenerations}回)に達しました`);
  const prov = providers[p.provider];
  p.used++; shot.attempts++; shot.status = 'generating';
  say(p, 'camera', 'paid', `【有料】${shot.id} を生成します(${p.used}/${p.maxGenerations}回目)`);
  const job = { provider: p.provider, ...(await prov.start({ prompt: prompt.slice(0, 2000), aspect: p.aspect, model: p.model })) };
  let done;
  for (let i = 0; i < 120 && !done; i++) {                // 最大10分
    if (p.stop) throw new Error('停止しました');
    await new Promise(ok => setTimeout(ok, +process.env.STUDIO_POLL_MS || 5000));
    const r = await prov.poll(job);
    if (r.status === 'failed') throw new Error(r.error || '生成に失敗');
    if (r.status === 'done') done = r;
  }
  if (!done) throw new Error('生成がタイムアウトしました');
  const file = path.join(p.dir, `shot_${shot.id}_${shot.attempts}.mp4`);
  if (done.localFile) fs.copyFileSync(done.localFile, file);
  else {
    const res = await fetch(done.videoUrl, { headers: prov.dlHeaders(), redirect: 'follow', signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error('動画の取得に失敗 ' + res.status);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  shot.file = file; shot.prompt = prompt; shot.info = await media.probe(file); shot.status = 'generated';
  shot.brightness = await media.brightness(file);
}

async function produceShots(p) {
  const plan = p.notebook.shots.shots;
  let prevLast = null;
  for (const s of plan) {
    const shot = p.shots[s.shot_id];
    let prompt = s.prompt;
    while (shot.attempts < 2 && p.used < p.maxGenerations) {          // 1ショットにつき撮り直しは1回まで
      try { await generate(p, shot, prompt); }
      catch (e) { shot.status = 'failed'; say(p, 'camera', 'error', `${shot.id}: ${e.message}`); if (/停止|上限/.test(e.message)) throw e; break; }
      const imgs = await media.framesSpread(shot.file, shot.info.duration, 3, p.dir, `rev_${shot.id}_${shot.attempts}`);
      const review = await ask(p, 'camera', `${shot.id}の出来の確認`,
        `ショット表のこのショット:\n${brief(s)}\n登場人物の設定:\n${brief(p.notebook.script.characters)}\n` +
        `測定値: 長さ ${shot.info.duration.toFixed(1)}秒 / ${shot.info.width}x${shot.info.height} / 平均の明るさ ${shot.brightness}(0〜255) / 音声 ${shot.info.hasAudio ? 'あり' : 'なし'}\n` +
        `画像: 開始付近・中間・終盤のコマ${prevLast ? '、最後の1枚は前のショットの最後のコマ(つながりの確認用)' : ''}。\n` +
        `絵コンテから外れていれば撮り直し(accept=false と、直した指示文)。残りの生成回数: ${p.maxGenerations - p.used}回。`,
        SCHEMA.shotReview, prevLast ? [...imgs, prevLast] : imgs);
      say(p, 'camera', review.accept ? 'ok' : 'comment', `${shot.id}: ${review.accept ? '採用' : '撮り直したい'} — ${review.reason}`);
      shot.review = review.reason;
      if (review.accept || shot.attempts >= 2 || p.used >= p.maxGenerations) break;
      prompt = review.revised_prompt || prompt;
    }
    if (shot.file) prevLast = (await media.framesAt(shot.file, [Math.max(0, shot.info.duration - 0.2)], p.dir, `last_${shot.id}`))[0] || prevLast;
  }
}

// ---------- 声(VOICEVOX)とファクトチェック ----------
async function synthCues(p) {
  const tl = p.notebook.timeline, speakers = p.speakers;
  const voiceOf = role => tl.voices.find(v => v.role === role)?.speaker_id;
  for (const [i, c] of tl.cues.entries()) {
    c.file = null; c.duration = null;
    const sp = voiceOf(c.role) ?? voiceOf('narrator');
    if (!speakers.length || sp === undefined || !speakers.some(s => s.id === sp) || !c.text?.trim()) continue;
    try {
      const f = path.join(p.dir, `voice_${i}_${crypto.randomBytes(3).toString('hex')}.wav`);
      await voice.synthesize(c.text.slice(0, 400), sp, f);
      c.file = f; c.duration = (await media.probe(f)).duration;
      const s = speakers.find(x => x.id === sp); p.credits.add(`VOICEVOX:${s.character}`);
    } catch (e) { say(p, 'director', 'error', `声の作成に失敗(${c.role}): ${e.message}`); }
  }
}

async function factCheck(p) {
  const tl = p.notebook.timeline;
  const imgs = [];
  for (const [i, c] of tl.cues.entries()) {
    const shot = p.shots[c.shot_id];
    if (c.kind === 'dialogue' && shot?.file && imgs.length < 8) {
      const [f] = await media.framesAt(shot.file, [Math.min(shot.info.duration - 0.1, Math.max(0, c.offset_sec + 0.3))], p.dir, `fc_${i}`);
      if (f) imgs.push({ ...f, note: `セリフ${i}(${c.shot_id} の ${c.offset_sec}秒)` });
    }
  }
  const shots = Object.values(p.shots).map(s => ({ shot_id: s.id, duration_sec: s.info?.duration ?? null, generated: !!s.file }));
  const cues = tl.cues.map((c, i) => ({ cue_index: i, ...c, file: undefined, voice_duration_sec: c.duration }));
  const fc = await ask(p, 'director', 'ファクトチェック(セリフ・口の動き・状況・原作との整合)',
    `${context(p, false)}\n脚本:\n${brief(p.notebook.script)}\n生成済みショット:\n${brief(shots)}\nセリフとナレーション(声の実際の長さつき):\n${brief(cues)}\n` +
    `画像: ${imgs.map(m => m.note).join(' / ') || 'なし'}\n` +
    `各セリフについて、映像の状況と合うか、口が映っていて後付けの声とズレないか、ショットの長さに収まるか、原作の事実と矛盾しないかを確認し、必要なら cue_updates で直してください。`,
    SCHEMA.factcheck, imgs);
  const bad = fc.checks.filter(c => !c.ok);
  say(p, 'director', bad.length ? 'comment' : 'ok', bad.length ? bad.map(c => `セリフ${c.cue_index}: ${c.issue}`).join('\n') : 'セリフ・ナレーションは映像と原作に合っています。');
  let changed = 0;
  for (const u of fc.cue_updates) {
    const c = tl.cues[u.cue_index]; if (!c) continue;
    if (u.remove) { c.removed = true; changed++; continue; }
    if (typeof u.offset_sec === 'number') c.offset_sec = u.offset_sec;
    if (u.kind) c.kind = u.kind;
    if (u.text && u.text !== c.text) { c.text = u.text; c.file = null; }
    changed++;
  }
  tl.cues = tl.cues.filter(c => !c.removed);
  if (changed) { say(p, 'director', 'reply', `${changed}件のセリフ・ナレーションを直しました。${fc.notes || ''}`); await synthCues(p); }
  p.notebook.factcheck = fc;
}

// ---------- 編集・書き出し ----------
async function render(p) {
  const tl = p.notebook.timeline;
  const order = p.notebook.shots.shots.map(s => s.shot_id).filter(id => p.shots[id]?.file);
  if (!order.length) throw new Error('使えるショットがありません');
  const [W, H] = p.aspect === '9:16' ? [720, 1280] : [1280, 720];
  const parts = [], durs = [];
  for (const [i, id] of order.entries()) {
    const g = tl.grades.find(x => x.shot_id === id) || {};
    const out = path.join(p.dir, `norm_${i}.mp4`);
    durs.push(await media.normalizeShot(p.shots[id].file, { ...g, ...(p.shots[id].fix || {}) }, W, H, out)); parts.push(out);
  }
  const fade = tl.transition === 'fade' && parts.length > 1 ? 0.5 : 0;
  const j = await media.join(parts, durs, fade, p.dir);
  const cues = tl.cues.filter(c => c.file && order.includes(c.shot_id))
    .map(c => ({ file: c.file, at: j.starts[order.indexOf(c.shot_id)] + clamp(c.offset_sec, 0, 600, 0) }));
  const final = path.join(p.dir, 'final.mp4');
  await media.mixAudio(j.file, j.total, { originalVolume: tl.original_volume, bgmFile: p.bgmFile, bgmVolume: tl.bgm_volume, fadeOut: 1, cues }, final);
  p.finalFile = final;
  return { order, starts: j.starts, total: j.total };
}

async function finalCheck(p, layout, round) {
  const n = Math.min(14, Math.max(6, Math.round(layout.total / 2)));
  const imgs = await media.framesSpread(p.finalFile, layout.total, n, p.dir, `final_${round}`);
  const vol = await media.volume(p.finalFile);
  const cues = p.notebook.timeline.cues.map((c, i) => ({ cue_index: i, shot_id: c.shot_id, offset_sec: c.offset_sec, kind: c.kind, text: c.text, voiced: !!c.file }));
  return ask(p, 'checker', `完成版の最終チェック(${round}回目)`,
    `${context(p, false)}\n脚本:\n${brief(p.notebook.script)}\nショット表:\n${brief(p.notebook.shots)}\n` +
    `完成版: 長さ ${layout.total.toFixed(1)}秒、各ショットの開始秒 ${brief(layout.order.map((id, i) => ({ shot_id: id, start_sec: +layout.starts[i].toFixed(2) })))}\n` +
    `音量: 平均 ${vol.mean_db}dB / 最大 ${vol.max_db}dB、BGM ${p.bgmFile ? 'あり' : 'なし'}\nセリフとナレーション:\n${brief(cues)}\n` +
    `画像: 完成版を等間隔に${imgs.length}枚(秒: ${imgs.map(i => i.t).join(', ')})。\n` +
    `合格なら verdict=pass。直す点は fixes に、担当者と数値付きで。撮り直し(regenerate)は生成回数が残っている場合のみ(残り ${p.maxGenerations - p.used}回)。`,
    SCHEMA.final, imgs);
}

async function applyFixes(p, fixes) {
  let n = 0;
  for (const f of fixes) {
    const shot = p.shots[f.shot_id];
    if ((f.kind === 'grade' || f.kind === 'trim') && shot) {
      shot.fix = { ...(shot.fix || {}) };
      for (const k of ['brightness', 'contrast', 'saturation', 'warmth', 'trim_start_sec', 'trim_end_sec']) if (typeof f[k] === 'number') shot.fix[k] = f[k];
      n++;
    } else if (f.kind === 'audio_timing' && typeof f.cue_index === 'number' && p.notebook.timeline.cues[f.cue_index] && typeof f.offset_sec === 'number') {
      p.notebook.timeline.cues[f.cue_index].offset_sec = f.offset_sec; n++;
    } else if (f.kind === 'regenerate' && shot && f.revised_prompt && p.used < p.maxGenerations) {
      try { await generate(p, shot, f.revised_prompt); n++; } catch (e) { say(p, 'camera', 'error', `${shot.id} の撮り直しに失敗: ${e.message}`); }
    }
  }
  return n;
}

// ---------- 全体の流れ ----------
async function run(p) {
  const step = s => { p.phase = s; say(p, null, 'phase', s); };
  step('1. 脚本(①が書き、②③④が意見)');
  const script = await debate(p, '脚本', 'writer', ['camera', 'director', 'checker'], 'script',
    'この原作と依頼から映像用の脚本を書いてください。');
  step('2. 撮影設計(②がショット表を作り、③④が意見)');
  const shots = await debate(p, 'ショット表', 'camera', ['director', 'checker'], 'shots',
    `脚本に沿ってショット表を作ってください。shot_id は英数字とハイフン(例: s1)。ショット数は${p.maxShots}以内。`, `脚本:\n${brief(script)}`);
  shots.shots = shots.shots.filter(s => ID_RE.test(s.shot_id)).slice(0, p.maxShots);
  if (!shots.shots.length) throw new Error('有効なショットがありません');
  for (const s of shots.shots) p.shots[s.shot_id] = { id: s.shot_id, status: 'planned', attempts: 0 };
  step('3. タイムラインと声の配役(③が決め、④が意見)');
  const voiceList = p.speakers.length ? p.speakers.map(s => `${s.id}: ${s.label}`).join('\n') : '(読み上げ音声は使えません。声は付けず、voices と cues の音声は空でよい)';
  await debate(p, 'タイムライン', 'director', ['checker'], 'timeline',
    '脚本とショット表から、秒ごとのタイムライン(セリフ・ナレーションの位置、声の配役、各ショットの色・明るさ・トリミング、つなぎ方、音量)を決めてください。role はナレーターなら narrator、人物なら character_id。',
    `脚本:\n${brief(script)}\nショット表:\n${brief(shots)}\n読み上げ音声の候補(speaker_id: 名前):\n${voiceList}\nBGM: ${p.bgmFile ? 'あり' : 'なし'}`);
  step('4. 生成(②が動画生成AIに作らせ、自分で確認・撮り直し)【有料】');
  await produceShots(p);
  step('5. 声入れとファクトチェック(③)');
  await synthCues(p);
  await factCheck(p);
  step('6. 編集・書き出し');
  let layout = await render(p);
  for (let round = 1; round <= p.rounds; round++) {
    step(`7. 最終チェック(④)${round}回目`);
    const fin = await finalCheck(p, layout, round);
    p.notebook.final = fin;
    say(p, 'checker', fin.verdict === 'pass' ? 'ok' : 'comment', `${fin.verdict === 'pass' ? '合格' : '直す点あり'}: ${fin.summary}` +
      (fin.fixes.length ? '\n' + fin.fixes.map(f => `[${f.owner}/${f.kind}] ${f.shot_id}: ${f.detail}`).join('\n') : ''));
    if (fin.verdict === 'pass') break;
    const applied = await applyFixes(p, fin.fixes);
    if (!applied) { say(p, null, 'info', '自動で直せる指摘がないため、ここで確定しました(残りの指摘は報告に残します)。'); break; }
    say(p, null, 'info', `${applied}件を直して書き出し直します。`);
    layout = await render(p);
  }
  p.status = 'done'; p.phase = '完成';
  fs.writeFileSync(path.join(p.dir, 'credits.txt'), [...p.credits].join('\n') + '\n');
  say(p, null, 'info', `完成しました。生成 ${p.used}回 / Claude ${p.calls}回。クレジット: ${[...p.credits].join(' / ')}`);
}

// ---------- 外部から使う関数(server.js が呼ぶ) ----------
function configured() { return process.env.STUDIO_MOCK === '1' || !!process.env.ANTHROPIC_API_KEY; }

async function start(o) {
  if (current && current.status === 'running') throw new Error('別の制作が実行中です。終わるか停止してから始めてください');
  const id = crypto.randomUUID(), dir = path.join(dataDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  const p = { id, dir, brief: o.brief, source: o.source, targetSec: o.targetSec, aspect: o.aspect, provider: o.provider, model: o.model,
    nativeAudio: NATIVE_AUDIO.has(o.provider), maxShots: o.maxShots, maxGenerations: o.maxGenerations, rounds: o.rounds,
    used: 0, calls: 0, usage: { input: 0, output: 0 }, notebook: {}, shots: {}, log: [], phase: '準備', status: 'running', stop: false,
    bgmFile: null, finalFile: null, speakers: o.useVoice ? await voice.speakers() : [],
    credits: new Set([`映像: ${providers[o.provider].name} で生成`, `脚本・演出: Claude (Anthropic) による4エージェント`]), client: null };
  if (o.source.credit) p.credits.add(o.source.credit);
  if (o.bgmFile) { p.bgmFile = path.join(dir, 'bgm' + path.extname(o.bgmFile)); fs.renameSync(o.bgmFile, p.bgmFile); p.credits.add('BGM: 利用者が用意した音源(利用条件は利用者が確認)'); }
  p.client = createClient();
  projects.set(id, p); current = p;
  say(p, null, 'info', `制作を開始しました。生成の上限 ${p.maxGenerations}回、話し合いは各工程 最大${p.rounds}回。読み上げ音声: ${p.speakers.length ? p.speakers.length + '種類' : 'なし'}`);
  run(p).catch(e => { p.status = /停止/.test(e.message) ? 'stopped' : 'error'; p.error = String(e.message || e); say(p, null, 'error', p.error); })
    .finally(() => { p.usage.input = Math.round(p.usage.input); });
  return id;
}

function view(id) {
  const p = projects.get(id); if (!p) return null;
  return { id: p.id, status: p.status, phase: p.phase, error: p.error || null, log: p.log.slice(-400), notebook: p.notebook,
    shots: Object.values(p.shots).map(s => ({ id: s.id, status: s.status, attempts: s.attempts, duration: s.info?.duration, brightness: s.brightness, review: s.review })),
    generations: { used: p.used, max: p.maxGenerations }, claudeCalls: p.calls, credits: [...p.credits],
    cost: { usd: +(p.usage.input * PRICE.input / 1e6 + p.usage.output * PRICE.output / 1e6).toFixed(3) },
    finalReady: !!p.finalFile && fs.existsSync(p.finalFile) && p.status === 'done' };
}
const finalFile = id => { const p = projects.get(id); return p?.status === 'done' ? p.finalFile : null; };
function stop(id) { const p = projects.get(id); if (p) p.stop = true; return !!p; }
const uploadDir = () => { const d = path.join(dataDir(), '_uploads'); fs.mkdirSync(d, { recursive: true }); return d; };

module.exports = { init, configured, start, view, finalFile, stop, uploadDir, MODEL, AGENTS, SCHEMA };
