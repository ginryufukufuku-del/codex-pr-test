// 脚本・絵コンテ スタジオ(script-studio)のプロジェクト JSON を、AI制作チームの「脚本」と「ショット表」に変換する。
// 絵コンテを使うと、①脚本家と②撮影・生成担当の話し合い(脚本・ショット表の工程)を省き、その分の Claude 呼び出しを減らせる。
// 動画生成は1回の制作で最大120秒・12ショットまでなので、作品全体ではなく、続いたシーンの範囲を選んで作る。
const MAX_SEC = 120, MAX_SHOTS = 12;
const SHOT_JA = { EWS: '大遠景', LS: 'ロング(引き)', FS: 'フルショット(全身)', KS: 'ニーショット(膝上)', MS: 'ミディアム(腰上)', MCU: 'バスト(胸上)', CU: 'アップ(顔)', ECU: '超アップ(目元など)', INS: 'インサート(物のアップ)' };
const SHOT_EN = { EWS: 'extreme wide shot', LS: 'wide shot', FS: 'full shot', KS: 'medium long shot', MS: 'medium shot', MCU: 'medium close-up', CU: 'close-up', ECU: 'extreme close-up', INS: 'insert shot of an object' };
const NARRATOR = /^(N|Ｎ|ナレーション|ナレーター|ナレ)$/;
const OFFSCREEN = /（声）|\(声\)|OFF|ＯＦＦ|V\.?O\.?|Ｖ．?Ｏ/i;

const str = (v, n = 2000) => String(v ?? '').trim().slice(0, n);

// ビートの順に並べたシーン一覧(script-studio と同じ並び・番号)
function scenesOf(project) {
  if (!project || !Array.isArray(project.scenes)) throw new Error('脚本・絵コンテ スタジオで書き出したJSONではありません');
  const order = (project.beats || []).map(b => b.id);
  const rank = s => { const i = order.indexOf(s.beatId); return i < 0 ? 999 : i; };
  return project.scenes.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s], i) => {
    const cuts = (Array.isArray(s.cuts) ? s.cuts : []).filter(c => c && typeof c === 'object');
    return { no: i + 1, scene: s, cuts, sec: cuts.reduce((a, c) => a + Math.max(0.5, +c.sec || 0), 0) };
  });
}

// "名前「台詞」" / "名前:台詞" を分解する。名前がなければ null
function splitLine(line) {
  const m = /^([^「」:：]{1,20})「(.*?)」?$/.exec(line) || /^([^:：「]{1,20})[:：]\s*(.+)$/.exec(line);
  return m ? { who: m[1].replace(/（.*?）|\(.*?\)/g, '').trim(), raw: m[1], text: m[2].trim() } : null;
}

// from〜to(1始まり、両端を含む)のシーンを、制作チームの script / shots に変換する
function toPlan(project, from, to = from) {
  const all = scenesOf(project);
  from = Math.trunc(+from); to = Math.trunc(+to);
  if (!(from >= 1 && to >= from && to <= all.length)) throw new Error(`シーンの範囲が正しくありません(1〜${all.length})`);
  const picked = all.slice(from - 1, to);
  const cuts = picked.flatMap(p => p.cuts.map(c => ({ c, p })));
  const total = picked.reduce((a, p) => a + p.sec, 0);
  if (!cuts.length) throw new Error('選んだシーンにカットがありません');
  if (cuts.length > MAX_SHOTS) throw new Error(`選んだ範囲は${cuts.length}カットあります。1回の制作は${MAX_SHOTS}カットまでです。範囲を狭めてください`);
  if (total > MAX_SEC) throw new Error(`選んだ範囲は${Math.round(total)}秒あります。1回の制作は${MAX_SEC}秒までです。範囲を狭めてください`);

  const people = (project.characters || []).filter(ch => ch && str(ch.name) && !NARRATOR.test(str(ch.name)));
  const idOf = new Map(people.map((ch, i) => [str(ch.name), `c${i + 1}`]));
  const used = new Set(picked.flatMap(p => p.scene.chars || []));
  const cast = people.filter(ch => used.has(ch.id) || cuts.some(({ c }) => String(c.dialogue || '').includes(str(ch.name))));
  const characters = cast.map(ch => ({ id: idOf.get(str(ch.name)), name: str(ch.name, 40),
    appearance: [str(ch.age) && str(ch.age) !== '—' ? `${str(ch.age)}歳` : '', str(ch.desc, 300)].filter(Boolean).join('、') || '(設定なし)',
    voice_hint: str(ch.speech, 100) || '(指定なし)' }));
  const looks = characters.map(c => `${c.name}: ${c.appearance}`).join(' / ');

  // カット番号は作品全体での通し番号(script-studio・動画制作スタジオと同じ)
  let no = all.slice(0, from - 1).reduce((a, p) => a + p.cuts.length, 0);
  const beats = [], shots = [];
  for (const { c, p } of cuts) {
    no++;
    const sec = Math.max(0.5, Math.min(60, +c.sec || 3));
    const dialogue = [], narration = [];
    for (const raw of String(c.dialogue || '').split('\n').map(s => s.trim()).filter(Boolean)) {
      const l = splitLine(raw);
      // 話者なし・ナレーター・画面外の声(「父（声）」「OFF」「VO」)はナレーションとして扱う
      if (!l || NARRATOR.test(l.who) || OFFSCREEN.test(l.raw)) narration.push(l ? l.text : raw);
      else dialogue.push({ character_id: idOf.get(l.who) || l.who, line: l.text });
    }
    const place = `${str(p.scene.place, 80) || '場所未定'}(${str(p.scene.time, 10)})`;
    beats.push({ beat_id: `b${no}`, duration_sec: sec, description: `${place} ${str(c.action, 400)}${c.sound ? ` 〔音: ${str(c.sound, 80)}〕` : ''}`, on_screen_dialogue: dialogue, narration: narration.join(' ') });
    const shot = SHOT_EN[c.shot] ? c.shot : 'MS';
    const prompt = str(c.aiPrompt, 1800) || [`${SHOT_EN[shot]}, ${str(c.angle, 30)}, ${str(c.move, 30)}.`, place + '.', str(c.action, 400),
      looks && `Characters: ${looks}.`, `Style: ${str(project.world, 40)}, ${str(project.tone, 40)}. About ${sec} seconds, one continuous shot.`].filter(Boolean).join(' ');
    shots.push({ shot_id: `c${no}`, beat_id: `b${no}`, duration_sec: sec, shot_size: SHOT_JA[shot], angle: str(c.angle, 40) || 'アイレベル',
      movement: str(c.move, 40) || 'FIX', blocking: `構図: ${str(c.comp, 40) || '三分割'}。${str(c.action, 300)}`,
      lighting: `${str(p.scene.time, 10) || '昼'}の光。前後のカットと光の向き・色をそろえる`, prompt: prompt.slice(0, 2000) });
  }
  const range = from === to ? `S${from}` : `S${from}〜S${to}`;
  const script = { title: str(project.title, 100) || '無題', logline: str(project.logline, 300),
    adaptation_notes: `脚本・絵コンテ スタジオの ${range}(${cuts.length}カット・${Math.round(total)}秒)をそのまま使用。カットの秒数・セリフは絵コンテのとおり。`,
    characters, beats };
  const summary = picked.map(p => `S${p.no} ${str(p.scene.place, 60)}: ${str(p.scene.summary, 300)}`).join('\n');
  return { script, shots: { shots }, targetSec: Math.round(total), maxShots: shots.length, range,
    brief: `『${script.title}』の ${range} を絵コンテどおりに映像化する。${str(project.theme, 200) ? 'テーマ: ' + str(project.theme, 200) : ''}`.trim(),
    sourceText: `${script.logline}\n${summary}`.trim(), aspect: str(project.aspect, 10) };
}

module.exports = { scenesOf, toPlan, splitLine, MAX_SEC, MAX_SHOTS };
