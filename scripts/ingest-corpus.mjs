import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import mysql from "mysql2/promise";

const SOURCE_SPECS = [
  {
    sourceKey: "live-2025-complete",
    displayName: "16.2025年直播【完整版】.txt",
    path: "/home/ubuntu/upload/16.2025年直播【完整版】.txt",
    originalSha256: "4abce1ab938d5d442fb12f82681b5449a3bf5649bace88c7364508f36b4c8aad",
    originalByteCount: 576734,
    expectedLogicalLineCount: 20693,
  },
  {
    sourceKey: "course-1-23",
    displayName: "曲曲课程1-23.txt",
    path: "/home/ubuntu/upload/曲曲课程1-23.txt",
    originalSha256: "792624f9eda9feae5aa1cb48a657cc283332238cc3afa5483f95604d11d18e97",
    originalByteCount: 4943952,
    expectedLogicalLineCount: 179083,
  },
  {
    sourceKey: "live-2022-2026-complete",
    displayName: "2022-2026年直播【完整版】(2).txt",
    path: "/home/ubuntu/upload/2022-2026年直播【完整版】(2).txt",
    originalSha256: "7d051d3434ba68825e293e4feae6374dba502e1198d4fc283cfe4107a6eb01e1",
    originalByteCount: 10872508,
    expectedLogicalLineCount: 403052,
  },
];

const EXPRESSIONS = ["我跟你讲", "你知道吗", "对吧", "姐妹们", "就是说", "首先", "那么", "其实", "我认为", "我觉得"];
const TAG_RULES = [
  ["关系判断", ["关系", "交换", "需求", "价值", "付出", "边界", "利益"]],
  ["亲密关系", ["男人", "女性", "恋爱", "结婚", "婚姻", "前任", "第三者", "相亲"]],
  ["沟通策略", ["表达", "沟通", "争执", "说话", "聊天", "植入", "追问"]],
  ["自我建设", ["自我", "成长", "价值框架", "学习", "工作", "赚钱", "独立"]],
  ["情感决策", ["选择", "决定", "离婚", "分手", "留下", "发展", "判断"]],
  ["风险边界", ["暴力", "自杀", "伤害", "抑郁", "报警", "律师", "医院", "疾病"]],
];

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isSectionHeading(line) {
  const normalized = line.trim();
  return /^(第[一二三四五六七八九十百0-9]+[章节课]|[一二三四五六七八九十]+、|[0-9]+[.、])/.test(normalized)
    && normalized.length <= 80;
}

function annotateLines(lines) {
  const joined = lines.map((entry) => entry.text).join("\n");
  const annotations = [];
  for (const [label, terms] of TAG_RULES) {
    const evidence = lines.find((entry) => terms.some((term) => entry.text.includes(term)));
    if (evidence) annotations.push({ category: "topic", label, evidenceLineNumber: evidence.number });
  }
  const question = lines.find((entry) => /[？?]|吗|是不是|有没有|如何|为什么/.test(entry.text));
  if (question) annotations.push({ category: "questioning", label: "追问或澄清", evidenceLineNumber: question.number });
  const direct = lines.find((entry) => /本质|我认为|核心|重点|不要|一定要|必须/.test(entry.text));
  if (direct) annotations.push({ category: "rhythm", label: "直接判断", evidenceLineNumber: direct.number });
  const story = lines.find((entry) => /我(曾经|后来|当时|现在|小时候|发现)/.test(entry.text));
  if (story) annotations.push({ category: "rhythm", label: "个人叙事", evidenceLineNumber: story.number });
  return { joined, annotations };
}

function inferUnitKind(lines) {
  const joined = lines.map((entry) => entry.text).join("\n");
  if (/自杀|自伤|他伤|暴力|报警|疾病|医院|律师|法律/.test(joined)) return "risk";
  if (/[？?]|吗|是不是|有没有|如何|为什么/.test(joined)) return "question";
  if (/我(曾经|后来|当时|现在|小时候|发现)/.test(joined)) return "story";
  if (/不要|一定要|应该|需要|建议|可以|先/.test(joined)) return "strategy";
  if (/本质|我认为|核心|重点/.test(joined)) return "assertion";
  return "mixed";
}

function splitPassageIntoUnits(passage) {
  const lines = passage.passage_text.split("\n").map((text, offset) => ({
    text,
    number: Number(passage.start_line) + offset,
  }));
  const units = [];
  let current = [];
  for (const line of lines) {
    current.push(line);
    const naturalEnd = /[。！？?!]$/.test(line.text.trim()) || /(?:对吧|知道吗|是不是|有没有)$/.test(line.text.trim());
    if (current.length >= 4 || naturalEnd) {
      units.push(current);
      current = [];
    }
  }
  if (current.length) units.push(current);
  return units;
}

async function createSemanticUnits(connection, sourceId) {
  await connection.query("DELETE FROM corpus_units WHERE source_id = ?", [sourceId]);
  const [passages] = await connection.query(
    `SELECT id, section_id, passage_number, start_line, passage_text
     FROM corpus_passages WHERE source_id = ? ORDER BY passage_number ASC`,
    [sourceId],
  );
  const rows = [];
  let unitNumber = 0;
  for (const passage of passages) {
    for (const unit of splitPassageIntoUnits(passage)) {
      unitNumber += 1;
      const { annotations } = annotateLines(unit);
      rows.push([
        sourceId,
        passage.section_id,
        passage.id,
        unitNumber,
        unit[0].number,
        unit.at(-1).number,
        unit.map((entry) => entry.text).join("\n"),
        inferUnitKind(unit),
        JSON.stringify(annotations),
        JSON.stringify([]),
        "none",
        JSON.stringify([]),
        "generated",
      ]);
      if (rows.length >= 500) {
        await connection.query(
          `INSERT INTO corpus_units
            (source_id, section_id, passage_id, unit_number, start_line, end_line, unit_text, unit_kind, topic_json, expression_hits_json, case_type, boundary_tags_json, annotation_status)
           VALUES ?`,
          [rows.splice(0, rows.length)],
        );
      }
    }
  }
  if (rows.length) {
    await connection.query(
      `INSERT INTO corpus_units
        (source_id, section_id, passage_id, unit_number, start_line, end_line, unit_text, unit_kind, topic_json, expression_hits_json, case_type, boundary_tags_json, annotation_status)
       VALUES ?`,
      [rows],
    );
  }
  return unitNumber;
}

async function queryRows(connection, sql, values) {
  const [rows] = await connection.query(sql, values);
  return rows;
}

async function upsertSource(connection, source) {
  await connection.query(
    `INSERT INTO corpus_sources
      (source_key, display_name, original_sha256, original_byte_count, expected_logical_line_count, status, processing_note)
     VALUES (?, ?, ?, ?, ?, 'processing', '严格按源文件顺序读取中')
     ON DUPLICATE KEY UPDATE
      display_name = VALUES(display_name),
      original_sha256 = VALUES(original_sha256),
      original_byte_count = VALUES(original_byte_count),
      expected_logical_line_count = VALUES(expected_logical_line_count),
      processed_line_count = 0,
      blank_line_count = 0,
      status = 'processing',
      processing_note = '严格按源文件顺序重新读取中'`,
    [source.sourceKey, source.displayName, source.originalSha256, source.originalByteCount, source.expectedLogicalLineCount],
  );
  const rows = await queryRows(connection, "SELECT id FROM corpus_sources WHERE source_key = ?", [source.sourceKey]);
  return rows[0].id;
}

async function insertRows(connection, rows) {
  if (!rows.length) return;
  await connection.query(
    `INSERT INTO corpus_lines (source_id, line_number, line_text, line_hash, is_blank)
     VALUES ?
     ON DUPLICATE KEY UPDATE line_text = VALUES(line_text), line_hash = VALUES(line_hash), is_blank = VALUES(is_blank)`,
    [rows],
  );
}

function buildPassageRow(sourceId, sectionId, passageNumber, passage) {
  const { joined, annotations } = annotateLines(passage);
  return [
    sourceId,
    sectionId,
    passageNumber,
    passage[0].number,
    passage.at(-1).number,
    passage.length,
    joined,
    "blank_line_or_12_lines",
    JSON.stringify(annotations),
    "generated",
  ];
}

async function insertPassages(connection, rows) {
  if (!rows.length) return;
  await connection.query(
    `INSERT INTO corpus_passages
      (source_id, section_id, passage_number, start_line, end_line, line_count, passage_text, segmentation_method, annotation_json, annotation_status)
     VALUES ?`,
    [rows],
  );
}

async function prepareSections(connection, sourceId, source) {
  await connection.query("DELETE FROM corpus_units WHERE source_id = ?", [sourceId]);
  await connection.query("DELETE FROM corpus_passages WHERE source_id = ?", [sourceId]);
  await connection.query("DELETE FROM corpus_sections WHERE source_id = ?", [sourceId]);
  const [result] = await connection.query(
    `INSERT INTO corpus_sections (source_id, title, section_kind, start_line, end_line, detection_method, review_status)
     VALUES (?, ?, 'source_root', 1, ?, 'source_file_root', 'approved')`,
    [sourceId, source.displayName, source.expectedLogicalLineCount],
  );
  return result.insertId;
}

async function ingestSource(connection, source) {
  const sourceId = await upsertSource(connection, source);
  const rootSectionId = await prepareSections(connection, sourceId, source);
  let activeSectionId = rootSectionId;
  let totalLines = 0;
  let blankLines = 0;
  let passageNumber = 0;
  let pendingRows = [];
  let pendingPassages = [];
  let passage = [];
  let activeDetectedSection = null;
  const expressionEvidence = new Map();

  const flushPassage = async () => {
    if (!passage.length) return;
    passageNumber += 1;
    pendingPassages.push(buildPassageRow(sourceId, activeSectionId, passageNumber, passage));
    passage = [];
    if (pendingPassages.length >= 250) {
      await insertPassages(connection, pendingPassages);
      pendingPassages = [];
    }
  };

  const flushRows = async () => {
    await insertRows(connection, pendingRows);
    pendingRows = [];
  };

  const input = createReadStream(source.path, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    totalLines += 1;
    const isBlank = line.trim().length === 0;
    if (isBlank) blankLines += 1;
    pendingRows.push([sourceId, totalLines, line, sha256(line), isBlank]);
    for (const expression of EXPRESSIONS) {
      if (line.includes(expression) && !expressionEvidence.has(expression)) {
        expressionEvidence.set(expression, totalLines);
      }
    }

    if (isSectionHeading(line)) {
      await flushPassage();
      if (activeDetectedSection) {
        await connection.query("UPDATE corpus_sections SET end_line = ? WHERE id = ?", [totalLines - 1, activeDetectedSection.id]);
      }
      const [result] = await connection.query(
        `INSERT INTO corpus_sections (source_id, parent_section_id, title, section_kind, start_line, end_line, detection_method, review_status)
         VALUES (?, ?, ?, 'detected_chapter', ?, ?, 'exact_heading_regex', 'needs_review')`,
        [sourceId, rootSectionId, line.trim(), totalLines, source.expectedLogicalLineCount],
      );
      activeDetectedSection = { id: result.insertId };
      activeSectionId = result.insertId;
    }

    if (isBlank) {
      await flushPassage();
    } else {
      passage.push({ number: totalLines, text: line });
      if (passage.length === 12) await flushPassage();
    }

    if (pendingRows.length >= 500) await flushRows();
    if (totalLines % 5000 === 0) {
      await connection.query(
        "UPDATE corpus_sources SET processed_line_count = ?, blank_line_count = ?, processing_note = ? WHERE id = ?",
        [totalLines, blankLines, `已顺序处理至第 ${totalLines} 行`, sourceId],
      );
    }
  }
  await flushRows();
  await flushPassage();
  await insertPassages(connection, pendingPassages);
  if (activeDetectedSection) {
    await connection.query("UPDATE corpus_sections SET end_line = ? WHERE id = ?", [totalLines, activeDetectedSection.id]);
  }

  if (totalLines !== source.expectedLogicalLineCount) {
    throw new Error(`${source.displayName} 行数核验失败：预期 ${source.expectedLogicalLineCount}，实际 ${totalLines}`);
  }
  await connection.query(
    `UPDATE corpus_sources
     SET processed_line_count = ?, blank_line_count = ?, status = 'completed', processing_note = '逐行导入、段落切分与基础标注已完成', processed_at = NOW()
     WHERE id = ?`,
    [totalLines, blankLines, sourceId],
  );
  const unitNumber = await createSemanticUnits(connection, sourceId);
  return { sourceId, totalLines, blankLines, passageNumber, unitNumber, expressionEvidence };
}

async function refreshExpressionKnowledge(connection, results) {
  await connection.query("DELETE FROM knowledge_entries WHERE category = 'expression'");
  const rows = [];
  for (const result of results) {
    for (const [expression, lineNumber] of result.expressionEvidence.entries()) {
      rows.push([
        "expression",
        expression,
        `原始语料中出现的高辨识度表达，需由审核人确认是否纳入分身语言风格。`,
        JSON.stringify([{ sourceId: result.sourceId, lineStart: lineNumber, lineEnd: lineNumber }]),
        1,
        "pending",
      ]);
    }
  }
  if (rows.length) {
    await connection.query(
      `INSERT INTO knowledge_entries (category, title, summary, evidence_json, occurrence_count, review_status) VALUES ?`,
      [rows],
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for corpus ingestion.");
  const onlyIndex = process.argv.indexOf("--only");
  const onlySourceKey = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
  const sourcesToIngest = onlySourceKey
    ? SOURCE_SPECS.filter((source) => source.sourceKey === onlySourceKey)
    : SOURCE_SPECS;
  if (!sourcesToIngest.length) throw new Error(`未找到待导入来源：${onlySourceKey ?? ""}`);
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const results = [];
    for (const source of sourcesToIngest) {
      results.push(await ingestSource(connection, source));
    }
    if (!onlySourceKey) await refreshExpressionKnowledge(connection, results);
    console.log(JSON.stringify({
      completed: true,
      sources: results.map(({ sourceId, totalLines, blankLines, passageNumber, unitNumber }) => ({ sourceId, totalLines, blankLines, passageNumber, unitNumber })),
    }));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
