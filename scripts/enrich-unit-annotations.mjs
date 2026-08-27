import mysql from "mysql2/promise";

const EXPRESSIONS = ["我跟你讲", "你知道吗", "对吧", "姐妹们", "就是说", "首先", "那么", "其实", "我认为", "我觉得"];

function expressionHitsSql() {
  return `JSON_MERGE_PRESERVE(
    ${EXPRESSIONS.map((expression) => `IF(unit_text LIKE '%${expression}%', JSON_ARRAY('${expression}'), JSON_ARRAY())`).join(",\n    ")}
  )`;
}

async function linkReviewEvidence(connection) {
  const [items] = await connection.query("SELECT id, evidence_json FROM review_items");
  for (const item of items) {
    const evidence = typeof item.evidence_json === "string" ? JSON.parse(item.evidence_json) : item.evidence_json;
    if (!Array.isArray(evidence) || !evidence[0]?.sourceId || !evidence[0]?.lineStart) continue;
    const [units] = await connection.query(
      `SELECT id, source_id AS sourceId, start_line AS startLine, end_line AS endLine
       FROM corpus_units
       WHERE source_id = ? AND start_line <= ? AND end_line >= ?
       ORDER BY unit_number ASC LIMIT 80`,
      [evidence[0].sourceId, evidence[0].lineEnd, evidence[0].lineStart],
    );
    const enriched = evidence.map((entry, index) => index === 0 ? {
      ...entry,
      unitEvidence: units.map((unit) => ({ unitId: unit.id, startLine: unit.startLine, endLine: unit.endLine })),
    } : entry);
    await connection.query("UPDATE review_items SET evidence_json = ? WHERE id = ?", [JSON.stringify(enriched), item.id]);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    await connection.query(`
      UPDATE corpus_units SET
        expression_hits_json = ${expressionHitsSql()},
        case_type = CASE
          WHEN unit_text REGEXP '选择|决定|留下|离开|要不要|是否' THEN 'decision'
          WHEN unit_text REGEXP '沟通|表达|争执|聊天|说话|追问' THEN 'communication'
          WHEN unit_text REGEXP '相亲|婚姻|恋爱|男人|女人|前任|第三者|结婚|分手' THEN 'relationship'
          WHEN unit_text REGEXP '钱|金钱|资源|投资|赚钱|资产|花钱' THEN 'financial'
          WHEN unit_kind = 'story' THEN 'other'
          ELSE 'none'
        END,
        boundary_tags_json = JSON_MERGE_PRESERVE(
          IF(unit_text REGEXP '自杀|自伤|他伤|暴力|威胁|强迫|胁迫', JSON_ARRAY('immediate_safety'), JSON_ARRAY()),
          IF(unit_text REGEXP '医院|疾病|诊断|抑郁|焦虑|药物|怀孕', JSON_ARRAY('medical_non_diagnostic'), JSON_ARRAY()),
          IF(unit_text REGEXP '律师|报警|起诉|法院|法律|离婚协议|抚养权', JSON_ARRAY('legal_non_advisory'), JSON_ARRAY()),
          IF(unit_text REGEXP '边界|不要|一定要|应该|风险|第三者', JSON_ARRAY('relationship_boundary'), JSON_ARRAY())
        )
    `);
    await linkReviewEvidence(connection);
    const [summary] = await connection.query(
      `SELECT
        COUNT(*) AS unitCount,
        SUM(JSON_LENGTH(expression_hits_json) > 0) AS unitsWithExpressionArray,
        SUM(case_type <> 'none') AS classifiedCaseUnits,
        SUM(JSON_LENGTH(boundary_tags_json) > 0) AS unitsWithBoundaryArray
       FROM corpus_units`,
    );
    console.log(JSON.stringify({ completed: true, summary: summary[0] }));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
