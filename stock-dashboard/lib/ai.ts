import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `あなたは日本株の個人投資家向けアシスタントです。与えられた株価データとニュース見出しだけを根拠に、日本語で簡潔に答えます。
出力は次の形式:
【背景】値動きの要因を1〜2文
【示唆】「買い時」「様子見」「要注意」「利確検討」のいずれかを明示し、理由を1〜2文
【リスク】反対シナリオを1文
与えられていない数値・決算内容・ニュースは推測で補わず、不明なら「情報不足」と書くこと。断定は避け、最終判断は本人が行う前提とする。`;

export async function generateComment(context: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "ANTHROPIC_API_KEY が未設定のため、AIコメントは無効です。";
  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    max_tokens: 700,
    system: SYSTEM,
    messages: [{ role: "user", content: context }],
  });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}
