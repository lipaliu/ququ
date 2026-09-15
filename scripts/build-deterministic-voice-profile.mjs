import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const PATTERNS = [
  ["reframe_not_but", "不是……而是……的重构", /不是.{0,48}(?:而是|是)/g],
  ["conditional_if_then", "如果……就……的条件推演", /如果.{0,72}就/g],
  ["causal_because_so", "因为……所以……的因果推进", /因为.{0,96}所以/g],
  ["sequence_first_then", "先……再……的行动排序", /先.{0,56}再/g],
  ["question_to_reason", "为什么／怎么→因为／所以的自问自答", /(?:为什么|怎么).{0,96}(?:因为|所以)/g],
  ["rhetorical_to_judgment", "是不是／有没有→判断词的反问推进", /(?:是不是|有没有).{0,96}(?:其实|本质|关键|所以|我认为|我觉得)/g],
  ["judgment_to_action", "本质／关键／核心→动作要求", /(?:本质|关键|核心|重点).{0,120}(?:不要|别|必须|一定要|你要|你先|先)/g],
  ["example_to_conclusion", "举例→所以／其实的归纳", /(?:比如|举个例子|我给你举|打个比方).{0,160}(?:所以|其实|本质|关键)/g],
  ["directive_chain", "不要／必须／先的连续指令", /(?:不要|别|必须|一定要|你先).{0,80}(?:不要|别|必须|一定要|你先|然后|再)/g],
  ["validation_chain", "行动／做到／结果→判断的验证", /(?:行动|做到|结果|验证|看他|看她).{0,96}(?:所以|说明|代表|判断|证明)/g],
];

const TOPICS = [
  ["relationship_exchange", "关系、交换与价值", ["关系", "交换", "价值", "付出", "得到", "需求"]],
  ["gift_repair", "礼物、花钱与补偿", ["礼物", "送礼", "补偿", "弥补", "花钱", "付钱"]],
  ["marriage_childfree", "婚姻、生育与孩子", ["结婚", "婚姻", "生育", "孩子", "不生", "生孩子"]],
  ["breakup_reconcile", "分手、复合与前任", ["分手", "复合", "前任", "继续这段", "挽回"]],
  ["care_responsibility", "照护、疾病与责任", ["照顾", "照护", "伺候", "生病", "疾病", "责任"]],
  ["sunk_cost", "沉没成本与舍不得", ["沉没成本", "舍不得", "多年", "五年", "投入", "成本"]],
  ["city_family", "城市、工作与家庭安排", ["北京", "城市", "工作", "家庭", "父母", "买房", "户口"]],
  ["promise_action", "承诺、行动与验证", ["承诺", "画饼", "行动", "做到", "结果", "验证"]],
  ["boundary_screening", "边界、筛选与止损", ["边界", "筛选", "止损", "底线", "选择", "标准"]],
  ["communication", "沟通、表达与追问", ["沟通", "表达", "追问", "提问", "说清楚", "回答"]],
];

const MARKERS = [
  "我跟你讲", "你知道吗", "对吧", "姐妹们", "就是说", "首先", "那么", "其实", "我认为", "我觉得",
  "关键不在", "重点是", "本质上", "为什么", "是不是", "有没有", "明白吗", "不要", "一定要", "必须",
  "你先", "然后", "所以", "但是", "因为", "如果", "那你就",
];

function parseArgs() {
  const values = new Map();
  for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
  const db = values.get("--db");
  const output = values.get("--output");
  if (!db || !output) throw new Error("Usage: node scripts/build-deterministic-voice-profile.mjs --db <sqlite3> --output <json>");
  return { db, output };
}

function normalize(text) {
  return text.replace(/[\s\p{P}\p{S}]+/gu, "");
}

function addEvidence(collection, evidence, limit = 24) {
  if (collection.length >= limit) return;
  if (collection.some((item) => item.sourceKey === evidence.sourceKey && Math.abs(item.line - evidence.line) < 20)) return;
  collection.push(evidence);
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deterministic_voice_patterns (
      pattern_key TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL,
      utterance_count INTEGER NOT NULL,
      evidence_json TEXT NOT NULL,
      analysis_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deterministic_topic_counts (
      topic_key TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      matching_line_count INTEGER NOT NULL,
      occurrence_count INTEGER NOT NULL,
      evidence_json TEXT NOT NULL,
      analysis_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deterministic_marker_phrases (
      marker TEXT NOT NULL,
      following_phrase TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL,
      evidence_json TEXT NOT NULL,
      analysis_version TEXT NOT NULL,
      PRIMARY KEY (marker, following_phrase)
    );
  `);
}

async function main() {
  const args = parseArgs();
  const db = new DatabaseSync(args.db);
  createSchema(db);

  const sources = db.prepare("SELECT source_key, line_count, sha256 FROM sources ORDER BY source_key").all();
  const totalLines = sources.reduce((sum, source) => sum + Number(source.line_count), 0);
  if (totalLines !== 582_135) throw new Error(`Expected 582135 indexed lines, found ${totalLines}`);

  const patternStats = new Map(PATTERNS.map(([key, description]) => [key, { description, occurrences: 0, utterances: 0, evidence: [] }]));
  const markerPhrases = new Map(MARKERS.map((marker) => [marker, new Map()]));
  const utteranceRows = db.prepare("SELECT source_key, start_line, end_line, utterance_text FROM utterances ORDER BY source_key, utterance_number");
  let utterancesProcessed = 0;
  for (const row of utteranceRows.iterate()) {
    utterancesProcessed += 1;
    const compact = normalize(row.utterance_text);
    for (const [key, _description, regex] of PATTERNS) {
      regex.lastIndex = 0;
      let match;
      let matchedUtterance = false;
      while ((match = regex.exec(compact))) {
        matchedUtterance = true;
        const stat = patternStats.get(key);
        stat.occurrences += 1;
        addEvidence(stat.evidence, { sourceKey: row.source_key, line: row.start_line, endLine: row.end_line });
        if (match[0].length === 0) regex.lastIndex += 1;
      }
      if (matchedUtterance) patternStats.get(key).utterances += 1;
    }
    for (const marker of MARKERS) {
      let offset = 0;
      while ((offset = compact.indexOf(marker, offset)) >= 0) {
        const phrase = compact.slice(offset + marker.length, offset + marker.length + 8);
        if (phrase.length >= 2) {
          const phrases = markerPhrases.get(marker);
          const current = phrases.get(phrase) ?? { count: 0, evidence: [] };
          current.count += 1;
          addEvidence(current.evidence, { sourceKey: row.source_key, line: row.start_line, endLine: row.end_line }, 8);
          phrases.set(phrase, current);
        }
        offset += marker.length;
      }
    }
  }

  const topicStats = new Map(TOPICS.map(([key, description]) => [key, { description, lines: 0, occurrences: 0, evidence: [] }]));
  const lineRows = db.prepare("SELECT source_key, line_number, line_text FROM lines ORDER BY source_key, line_number");
  let linesProcessed = 0;
  let charactersProcessed = 0;
  for (const row of lineRows.iterate()) {
    linesProcessed += 1;
    charactersProcessed += row.line_text.length;
    for (const [key, _description, terms] of TOPICS) {
      let lineOccurrences = 0;
      for (const term of terms) {
        let offset = 0;
        while ((offset = row.line_text.indexOf(term, offset)) >= 0) {
          lineOccurrences += 1;
          offset += term.length;
        }
      }
      if (!lineOccurrences) continue;
      const stat = topicStats.get(key);
      stat.lines += 1;
      stat.occurrences += lineOccurrences;
      addEvidence(stat.evidence, { sourceKey: row.source_key, line: row.line_number });
    }
  }
  if (linesProcessed !== totalLines) throw new Error(`Line scan stopped early at ${linesProcessed}`);

  db.exec("BEGIN");
  db.prepare("DELETE FROM deterministic_voice_patterns").run();
  db.prepare("DELETE FROM deterministic_topic_counts").run();
  db.prepare("DELETE FROM deterministic_marker_phrases").run();
  const insertPattern = db.prepare("INSERT INTO deterministic_voice_patterns VALUES (?, ?, ?, ?, ?, 'deterministic-v1')");
  for (const [key, stat] of patternStats) insertPattern.run(key, stat.description, stat.occurrences, stat.utterances, JSON.stringify(stat.evidence));
  const insertTopic = db.prepare("INSERT INTO deterministic_topic_counts VALUES (?, ?, ?, ?, ?, 'deterministic-v1')");
  for (const [key, stat] of topicStats) insertTopic.run(key, stat.description, stat.lines, stat.occurrences, JSON.stringify(stat.evidence));
  const insertPhrase = db.prepare("INSERT INTO deterministic_marker_phrases VALUES (?, ?, ?, ?, 'deterministic-v1')");
  const topMarkerPhrases = {};
  for (const [marker, phrases] of markerPhrases) {
    const top = [...phrases.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], "zh-CN")).slice(0, 12);
    topMarkerPhrases[marker] = top.map(([phrase, value]) => ({ phrase, count: value.count, evidence: value.evidence }));
    for (const [phrase, value] of top) insertPhrase.run(marker, phrase, value.count, JSON.stringify(value.evidence));
  }
  db.exec("COMMIT");

  const summary = {
    version: "deterministic-v1",
    generatedAt: new Date().toISOString(),
    sourceHashes: sources.map((source) => ({ sourceKey: source.source_key, sha256: source.sha256, lines: source.line_count })),
    coverage: { linesProcessed, charactersProcessed, utterancesProcessed },
    patterns: Object.fromEntries([...patternStats].map(([key, stat]) => [key, stat])),
    topics: Object.fromEntries([...topicStats].map(([key, stat]) => [key, stat])),
    topMarkerPhrases,
  };
  summary.contentHash = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
  await writeFile(args.output, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ version: summary.version, contentHash: summary.contentHash, coverage: summary.coverage })}\n`);
}

await main();
