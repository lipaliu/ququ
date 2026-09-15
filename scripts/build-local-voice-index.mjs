import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SOURCE_BASELINES = {
  course: {
    sourceKey: "course-1-23",
    displayName: "曲曲课程1-23.txt",
    sha256: "792624f9eda9feae5aa1cb48a657cc283332238cc3afa5483f95604d11d18e97",
    byteCount: 4_943_952,
    lineCount: 179_083,
  },
  live: {
    sourceKey: "live-2022-2026-complete",
    displayName: "2022-2026年直播【完整版】(2).txt",
    sha256: "7d051d3434ba68825e293e4feae6374dba502e1198d4fc283cfe4107a6eb01e1",
    byteCount: 10_872_508,
    lineCount: 403_052,
  },
};

const VOICE_MARKERS = [
  "我跟你讲", "你知道吗", "对吧", "姐妹们", "就是说", "首先", "那么", "其实", "我认为", "我觉得",
  "你先别急", "关键不在", "重点是", "本质上", "为什么", "是不是", "有没有", "你听懂了吗", "明白吗",
  "不要", "一定要", "必须", "先", "然后", "所以", "但是", "因为", "如果", "那你就",
];

const SPEECH_SIGNALS = [
  ["question", /[？?]|吗(?:[，。！？?!]|$)|是不是|有没有|为什么|怎么(?:办|做|想|说)/],
  ["directive", /不要|别再|一定要|必须|你先|那你就|你现在/],
  ["judgment", /本质|核心|关键|重点|我认为|我跟你讲/],
  ["contrast", /不是.{0,40}(?:而是|是)|但是|可是|反而|相反/],
  ["example", /比如|举个例子|我给你举|你看|就像/],
  ["story", /我(?:曾经|后来|当时|以前|有一次|发现|遇到)/],
  ["validation", /看他|看她|验证|标准|做到|行动|结果/],
];

function parseArgs() {
  const values = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    values.set(process.argv[index], process.argv[index + 1]);
  }
  const coursePath = values.get("--course");
  const livePath = values.get("--live");
  const output = values.get("--output");
  if (!coursePath || !livePath || !output) {
    throw new Error("Usage: node scripts/build-local-voice-index.mjs --course <path> --live <path> --output <sqlite3>");
  }
  return { coursePath, livePath, output };
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE sources (
      source_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      original_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      byte_count INTEGER NOT NULL,
      line_count INTEGER NOT NULL,
      blank_line_count INTEGER NOT NULL,
      character_count INTEGER NOT NULL,
      indexed_at TEXT NOT NULL
    );
    CREATE TABLE lines (
      source_key TEXT NOT NULL,
      line_number INTEGER NOT NULL,
      line_text TEXT NOT NULL,
      line_hash TEXT NOT NULL,
      is_blank INTEGER NOT NULL,
      character_count INTEGER NOT NULL,
      PRIMARY KEY (source_key, line_number)
    ) WITHOUT ROWID;
    CREATE VIRTUAL TABLE lines_fts USING fts5(
      source_key UNINDEXED,
      line_number UNINDEXED,
      line_text,
      tokenize='trigram'
    );
    CREATE TABLE utterances (
      id INTEGER PRIMARY KEY,
      source_key TEXT NOT NULL,
      utterance_number INTEGER NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      utterance_text TEXT NOT NULL,
      utterance_hash TEXT NOT NULL,
      character_count INTEGER NOT NULL,
      UNIQUE (source_key, utterance_number)
    );
    CREATE TABLE analysis_jobs (
      job_key TEXT PRIMARY KEY,
      source_key TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      line_count INTEGER NOT NULL,
      character_count INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE voice_marker_counts (
      source_key TEXT NOT NULL,
      marker TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL,
      first_line INTEGER,
      PRIMARY KEY (source_key, marker)
    ) WITHOUT ROWID;
    CREATE TABLE speech_signal_counts (
      source_key TEXT NOT NULL,
      signal TEXT NOT NULL,
      line_count INTEGER NOT NULL,
      first_line INTEGER,
      PRIMARY KEY (source_key, signal)
    ) WITHOUT ROWID;
    CREATE INDEX utterances_source_range_idx ON utterances(source_key, start_line, end_line);
    CREATE INDEX analysis_jobs_source_range_idx ON analysis_jobs(source_key, start_line, end_line);
  `);
}

function countOccurrences(text, marker) {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(marker, offset)) >= 0) {
    count += 1;
    offset += marker.length;
  }
  return count;
}

async function indexSource(db, path, baseline) {
  const metadata = await stat(path);
  const sourceHash = await hashFile(path);
  if (metadata.size !== baseline.byteCount || sourceHash !== baseline.sha256) {
    throw new Error(`${baseline.displayName} 完整性核验失败，停止读取。`);
  }

  const insertLine = db.prepare("INSERT INTO lines VALUES (?, ?, ?, ?, ?, ?)");
  const insertFts = db.prepare("INSERT INTO lines_fts(source_key, line_number, line_text) VALUES (?, ?, ?)");
  const insertUtterance = db.prepare(`INSERT INTO utterances
    (source_key, utterance_number, start_line, end_line, utterance_text, utterance_hash, character_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertJob = db.prepare(`INSERT INTO analysis_jobs
    (job_key, source_key, start_line, end_line, line_count, character_count, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const markerCounts = new Map(VOICE_MARKERS.map((marker) => [marker, { count: 0, firstLine: null }]));
  const signalCounts = new Map(SPEECH_SIGNALS.map(([signal]) => [signal, { count: 0, firstLine: null }]));

  let lineNumber = 0;
  let blankLineCount = 0;
  let characterCount = 0;
  let utteranceNumber = 0;
  let utteranceLines = [];
  let utteranceCharacters = 0;
  let jobNumber = 0;
  let jobStartLine = 1;
  let jobLineCount = 0;
  let jobCharacters = 0;
  let jobHash = createHash("sha256");

  const flushUtterance = () => {
    if (!utteranceLines.length) return;
    utteranceNumber += 1;
    const text = utteranceLines.map((line) => line.text).join("\n");
    insertUtterance.run(
      baseline.sourceKey,
      utteranceNumber,
      utteranceLines[0].number,
      utteranceLines.at(-1).number,
      text,
      createHash("sha256").update(text).digest("hex"),
      text.length,
    );
    utteranceLines = [];
    utteranceCharacters = 0;
  };

  const flushJob = () => {
    if (!jobLineCount) return;
    jobNumber += 1;
    const endLine = jobStartLine + jobLineCount - 1;
    insertJob.run(
      `${baseline.sourceKey}:${jobNumber}:${jobStartLine}-${endLine}`,
      baseline.sourceKey,
      jobStartLine,
      endLine,
      jobLineCount,
      jobCharacters,
      jobHash.digest("hex"),
    );
    jobStartLine = endLine + 1;
    jobLineCount = 0;
    jobCharacters = 0;
    jobHash = createHash("sha256");
  };

  db.exec("BEGIN");
  const reader = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of reader) {
    lineNumber += 1;
    const isBlank = line.trim().length === 0;
    if (isBlank) blankLineCount += 1;
    characterCount += line.length;
    const lineHash = createHash("sha256").update(line).digest("hex");
    insertLine.run(baseline.sourceKey, lineNumber, line, lineHash, isBlank ? 1 : 0, line.length);
    insertFts.run(baseline.sourceKey, lineNumber, line);

    for (const marker of VOICE_MARKERS) {
      const occurrences = countOccurrences(line, marker);
      if (!occurrences) continue;
      const current = markerCounts.get(marker);
      current.count += occurrences;
      current.firstLine ??= lineNumber;
    }
    for (const [signal, pattern] of SPEECH_SIGNALS) {
      if (!pattern.test(line)) continue;
      const current = signalCounts.get(signal);
      current.count += 1;
      current.firstLine ??= lineNumber;
    }

    if (isBlank) {
      flushUtterance();
    } else {
      utteranceLines.push({ number: lineNumber, text: line });
      utteranceCharacters += line.length;
      if (utteranceLines.length >= 12 || utteranceCharacters >= 600) flushUtterance();
    }

    jobHash.update(`${lineNumber}\t${line}\n`);
    jobLineCount += 1;
    jobCharacters += line.length;
    if (jobLineCount >= 2400 || jobCharacters >= 48_000) flushJob();

    if (lineNumber % 5_000 === 0) {
      db.exec("COMMIT; BEGIN");
      process.stdout.write(`${JSON.stringify({ sourceKey: baseline.sourceKey, indexedLines: lineNumber })}\n`);
    }
  }
  flushUtterance();
  flushJob();
  db.exec("COMMIT");

  if (lineNumber !== baseline.lineCount) {
    throw new Error(`${baseline.displayName} 行数核验失败：预期 ${baseline.lineCount}，实际 ${lineNumber}`);
  }

  const insertMarker = db.prepare("INSERT INTO voice_marker_counts VALUES (?, ?, ?, ?)");
  const insertSignal = db.prepare("INSERT INTO speech_signal_counts VALUES (?, ?, ?, ?)");
  db.exec("BEGIN");
  for (const [marker, value] of markerCounts) insertMarker.run(baseline.sourceKey, marker, value.count, value.firstLine);
  for (const [signal, value] of signalCounts) insertSignal.run(baseline.sourceKey, signal, value.count, value.firstLine);
  db.prepare("INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    baseline.sourceKey,
    baseline.displayName,
    path,
    sourceHash,
    metadata.size,
    lineNumber,
    blankLineCount,
    characterCount,
    new Date().toISOString(),
  );
  db.exec("COMMIT");

  return { ...baseline, originalPath: path, blankLineCount, characterCount, utteranceCount: utteranceNumber, analysisJobCount: jobNumber };
}

async function main() {
  const { coursePath, livePath, output } = parseArgs();
  await mkdir(dirname(output), { recursive: true });
  try {
    await stat(output);
    throw new Error(`输出数据库已存在，为避免覆盖已处理语料而停止：${output}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const db = new DatabaseSync(output);
  try {
    createSchema(db);
    const sources = [];
    sources.push(await indexSource(db, coursePath, SOURCE_BASELINES.course));
    sources.push(await indexSource(db, livePath, SOURCE_BASELINES.live));
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); ANALYZE;");
    const summary = {
      indexVersion: 1,
      createdAt: new Date().toISOString(),
      output,
      totalLineCount: sources.reduce((sum, source) => sum + source.lineCount, 0),
      totalCharacterCount: sources.reduce((sum, source) => sum + source.characterCount, 0),
      totalUtteranceCount: sources.reduce((sum, source) => sum + source.utteranceCount, 0),
      totalAnalysisJobCount: sources.reduce((sum, source) => sum + source.analysisJobCount, 0),
      sources,
      privacy: "原文仅保存在本机 SQLite 索引中；不得提交 Git 或上传。",
    };
    await writeFile(`${output}.summary.json`, JSON.stringify(summary, null, 2), "utf8");
    process.stdout.write(`${JSON.stringify({ completed: true, ...summary })}\n`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
