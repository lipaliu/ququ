import { mkdir, readFile, writeFile } from "node:fs/promises";

const INPUT_FILE = "/home/ubuntu/persona-v2-extraction/v2-persona-cards.jsonl";
const OUTPUT_DIR = "/home/ubuntu/persona-v2-extraction";
const OUTPUT_FILE = `${OUTPUT_DIR}/compiled-persona-system.json`;

const outputSchema = {
  type: "json_schema",
  json_schema: {
    name: "compiled_persona_system",
    strict: true,
    schema: {
      type: "object",
      properties: {
        identity: { type: "string" },
        worldview: { type: "array", maxItems: 12, items: { type: "string" } },
        decisionSequence: { type: "array", maxItems: 8, items: { type: "string" } },
        methods: {
          type: "array",
          maxItems: 45,
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              diagnosis: { type: "string" },
              action: { type: "string" },
              validation: { type: "string" },
              question: { type: "string" },
              speechCue: { type: "string" },
              boundaries: { type: "string" },
            },
            required: ["topic", "diagnosis", "action", "validation", "question", "speechCue", "boundaries"],
            additionalProperties: false,
          },
        },
        voiceRules: { type: "array", maxItems: 12, items: { type: "string" } },
        prohibitedPatterns: { type: "array", maxItems: 12, items: { type: "string" } },
      },
      required: ["identity", "worldview", "decisionSequence", "methods", "voiceRules", "prohibitedPatterns"],
      additionalProperties: false,
    },
  },
};

async function callModel(prompt, attempt = 1) {
  const response = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: "你是严谨的中文人格系统架构师。只输出合规 JSON，不杜撰任何未被输入卡片支持的规则。" },
        { role: "user", content: prompt },
      ],
      response_format: outputSchema,
      max_completion_tokens: 8000,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      return callModel(prompt, attempt + 1);
    }
    throw new Error(`人格体系聚合失败：${response.status} ${text.slice(0, 300)}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("人格体系聚合未返回文本。");
  return JSON.parse(content);
}

async function main() {
  if (!process.env.OPENAI_API_BASE || !process.env.OPENAI_API_KEY) throw new Error("缺少沙箱模型环境变量。");
  const raw = await readFile(INPUT_FILE, "utf8");
  const chunks = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const cards = chunks.flatMap((chunk) => chunk.cards.map((card) => ({ ...card, source: chunk.sourceKey, startLine: chunk.startLine, endLine: chunk.endLine })));
  const sourceCoverage = chunks.map((chunk) => `${chunk.sourceKey}:${chunk.startLine}-${chunk.endLine}`).join("; ");
  const prompt = `以下是来自完整新版语料集（2022–2026直播 + 曲曲课程）的 ${cards.length} 张已原文锚定人格卡片。请把它们去重、归纳为一个能直接驱动多轮情感对话的完整人格系统。

必须保留的能力：关系判断、现实条件评估、亲密关系推进、沟通冲突、筛选与边界、情感决策、个人成长、案例拆解、关键追问、直接口语风格。

请将方法写成“诊断 → 用户立刻怎么做 → 如何验证 → 只问一个关键问题”的行动结构。不能编造具体金额、天数、百分比、案例结局或未出现的价值观；遇到不同语料观点冲突时，写出适用条件，而不是强行统一。语气规则是口语化、急促、直截但不能羞辱或操控用户。禁止生成检索、出处展示、心理诊断、法律策略或医疗处方。

全量分块覆盖：${sourceCoverage}

人格卡片：
${JSON.stringify(cards)}`;
  const compiled = await callModel(prompt);
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify({
    corpusVersion: "2026-08-28-v2",
    chunkCount: chunks.length,
    sourceCoverage,
    sourceCardCount: cards.length,
    compiled,
  }, null, 2), "utf8");
  console.log(JSON.stringify({ completed: true, chunkCount: chunks.length, sourceCardCount: cards.length, methodCount: compiled.methods.length, output: OUTPUT_FILE }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
