import { mkdir, readFile, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const OUTPUT_DIR = "/home/ubuntu/persona-extraction/map-chunks";
const PREVIOUS_OUTPUT = "/home/ubuntu/persona-extraction/chunk-cards.jsonl";
const MAX_CHARS = 48000;
const MAX_LINES = 2400;

async function loadCompletedKeys() {
  try {
    const raw = await readFile(PREVIOUS_OUTPUT, "utf8");
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
    if (buffer.length && (buffer.length >= MAX_LINES || size + text.length + 1 > MAX_CHARS)) {
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

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  await mkdir(OUTPUT_DIR, { recursive: true });
  const completed = await loadCompletedKeys();
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const manifest = [];
  try {
    const [sources] = await connection.query("SELECT id, source_key AS sourceKey FROM corpus_sources ORDER BY id ASC");
    for (const source of sources) {
      const [rows] = await connection.query(
        "SELECT start_line AS startLine, end_line AS endLine, unit_text AS unitText FROM corpus_units WHERE source_id = ? ORDER BY unit_number ASC",
        [source.id],
      );
      for (const [index, chunk] of chunkRows(rows).entries()) {
        const chunkKey = `${source.sourceKey}:${index + 1}:${chunk[0].startLine}-${chunk.at(-1).endLine}`;
        if (completed.has(chunkKey)) continue;
        const safeName = chunkKey.replaceAll(/[^a-zA-Z0-9]+/g, "_");
        const file = `${OUTPUT_DIR}/${safeName}.txt`;
        const content = [
          `源文件键：${source.sourceKey}`,
          `连续原文定位：第 ${chunk[0].startLine}–${chunk.at(-1).endLine} 行`,
          `分块键：${chunkKey}`,
          "",
          ...chunk.map((row) => `[${row.startLine}-${row.endLine}] ${row.unitText}`),
        ].join("\n");
        await writeFile(file, content, "utf8");
        manifest.push({ chunkKey, sourceId: source.id, startLine: chunk[0].startLine, endLine: chunk.at(-1).endLine, file });
      }
    }
  } finally {
    await connection.end();
  }
  await writeFile(`${OUTPUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2), "utf8");
  console.log(JSON.stringify({ remainingChunkCount: manifest.length, manifestFile: `${OUTPUT_DIR}/manifest.json` }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
