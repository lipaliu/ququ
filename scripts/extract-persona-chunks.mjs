import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const OUTPUT_DIR = "/home/ubuntu/persona-extraction";
const OUTPUT_FILE = `${OUTPUT_DIR}/chunk-cards.jsonl`;
const MODEL = "gpt-5-mini";
const CONCURRENCY = Number(process.env.PERSONA_CONCURRENCY ?? 6);
const MAX_CHARS = 48000;
const MAX_LINES = 2400;

const extractionSchema = {
  type: "json_schema",
  json_schema: {
    name: "persona_chunk_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        cards: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              dimension: { type: "string", enum: ["judgment", "operation", "case", "questioning", "worldview", "speech"] },
              pattern: { type: "string" },
              operational_method: { type: "string" },
              trigger: { type: "string" },
              caveat: { type: "string" },
              evidence_lines: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 5 },
            },
            required: ["dimension", "pattern", "operational_method", "trigger", "caveat", "evidence_lines"],
            additionalProperties: false,
          },
        },
        voice_features: { type: "array", maxItems: 8, items: { type: "string" } },
        chunk_assessment: { type: "string" },
      },
      required: ["cards", "voice_features", "chunk_assessment"],
      additionalProperties: false,
    },
  },
};

function parseArgs() {
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : undefined;
  return { limit: Number.isFinite(limit) ? limit : undefined };
}

async function loadDone() {
  try {
    const raw = await readFile(OUTPUT_FILE, "utf8");
    return new Set(raw.trim().split("\n").filter(Boolean).map((row) => JSON.parse(row).chunkKey));
  } catch {
    return new Set();
  }
}

function chunkRows(rows) {
  const chunks = [];
  let buffer = [];
  let size = 0;
  for (const row of rows) {
    const text = `${row.startLine}-${row.endLine}\t${row.unitText}`;
    const exceeds = buffer.length > 0 && (buffer.length >= MAX_LINES || size + text.length + 1 > MAX_CHARS);
    if (exceeds) {
      chunks.push(buffer);
      buffer = [];
      size = 0;
    }
    buffer.push(row);
    size += text.length + 1;
  }
  if (buffer.length) chunks.push(buffer);
  return chunks;
}

function makePrompt(chunk) {
  const startLine = chunk[0].startLine;
  const endLine = chunk.at(-1).endLine;
  const numberedText = chunk.map((row) => `[${row.startLine}-${row.endLine}] ${row.unitText}`).join("\n");
  return `以下是“曲曲”情感关系语料的一个连续原文片段（第 ${startLine}–${endLine} 行）。请做人格知识提炼，不要复述或评论语料。

目标是形成一个能给用户直接、清醒、可操作建议的情感关系分身。请只提取本片段中真正出现、可泛化的内容，并特别关注：
1. 关系判断的底层原则、价值取向与判断顺序；
2. 用户可立即执行的具体操作、沟通句式、观察周期或验证标准；
3. 案例中如何识别关键矛盾，而不是停留在情绪表面；
4. 会如何追问以快速拿到决定性事实；
5. 语言的口语化、直截了当、略有急促的节奏特征。

要求：卡片必须是中文转述，绝不大段引用原文，绝不捏造案例、价值观、数字、期限、金额、比例或操作细节。每张卡的 pattern 不得为空，evidence_lines 必须仅填写本片段中直接支持这张卡的实际行号。没有高价值内容时 cards 可以为空。每张卡须短、准、可执行；不要做温柔空话，不要写“建议多沟通”。

原文：
${numberedText}`;
}

async function callModel(prompt, attempt = 1) {
  const response = await fetch(`${process.env.BUILT_IN_FORGE_API_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.BUILT_IN_FORGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "你是严谨的中文语料人格分析师。严格遵循 JSON Schema，输出仅含 JSON。" },
        { role: "user", content: prompt },
      ],
      response_format: extractionSchema,
      max_completion_tokens: 1200,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
      return callModel(prompt, attempt + 1);
    }
    throw new Error(`模型请求失败：${response.status} ${text.slice(0, 280)}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("模型未返回可解析内容。");
  const analysis = JSON.parse(content);
  if (!Array.isArray(analysis.cards) || !Array.isArray(analysis.voice_features)) throw new Error("模型输出未通过数组字段校验。");
  return analysis;
}

function keepAnchoredCards(analysis, chunk) {
  const firstLine = chunk[0].startLine;
  const lastLine = chunk.at(-1).endLine;
  const cards = analysis.cards.filter((card) => (
    typeof card.pattern === "string" && card.pattern.trim().length > 0
    && Array.isArray(card.evidence_lines)
    && card.evidence_lines.length > 0
    && card.evidence_lines.every((line) => Number.isInteger(line) && line >= firstLine && line <= lastLine)
  ));
  return {
    ...analysis,
    cards,
    voice_features: analysis.voice_features.filter((item) => typeof item === "string" && item.trim().length > 0),
  };
}

async function main() {
  if (!process.env.DATABASE_URL || !process.env.BUILT_IN_FORGE_API_URL || !process.env.BUILT_IN_FORGE_API_KEY) {
    throw new Error("缺少数据库或模型服务环境变量。");
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  const { limit } = parseArgs();
  const done = await loadDone();
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [sources] = await connection.query("SELECT id, source_key AS sourceKey FROM corpus_sources ORDER BY id ASC");
    const jobs = [];
    for (const source of sources) {
      const [rows] = await connection.query(
        "SELECT start_line AS startLine, end_line AS endLine, unit_text AS unitText FROM corpus_units WHERE source_id = ? ORDER BY unit_number ASC",
        [source.id],
      );
      for (const [index, chunk] of chunkRows(rows).entries()) {
        const chunkKey = `${source.sourceKey}:${index + 1}:${chunk[0].startLine}-${chunk.at(-1).endLine}`;
        if (!done.has(chunkKey)) jobs.push({ chunkKey, sourceId: source.id, sourceKey: source.sourceKey, chunk });
      }
    }
    const selected = limit ? jobs.slice(0, limit) : jobs;
    console.log(JSON.stringify({ totalPendingChunks: jobs.length, processingChunks: selected.length, concurrency: CONCURRENCY }));
    for (let offset = 0; offset < selected.length; offset += CONCURRENCY) {
      const batch = selected.slice(offset, offset + CONCURRENCY);
      const results = await Promise.all(batch.map(async (job) => ({
        ...job,
        analysis: keepAnchoredCards(await callModel(makePrompt(job.chunk)), job.chunk),
      })));
      const serialized = results.map((item) => JSON.stringify({
        chunkKey: item.chunkKey,
        sourceId: item.sourceId,
        sourceKey: item.sourceKey,
        startLine: item.chunk[0].startLine,
        endLine: item.chunk.at(-1).endLine,
        sourceTextHash: createHash("sha256").update(item.chunk.map((row) => row.unitText).join("\n")).digest("hex"),
        ...item.analysis,
      })).join("\n");
      await appendFile(OUTPUT_FILE, `${serialized}\n`, "utf8");
      console.log(JSON.stringify({ completed: Math.min(offset + batch.length, selected.length), total: selected.length, lastChunk: batch.at(-1).chunkKey }));
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
