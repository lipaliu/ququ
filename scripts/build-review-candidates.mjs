import mysql from "mysql2/promise";

const EXPRESSIONS = ["我跟你讲", "你知道吗", "对吧", "姐妹们", "就是说", "首先", "那么", "其实", "我认为", "我觉得"];

const SOURCE_DERIVED_CANDIDATES = [
  {
    category: "framework",
    title: "RICH 四维关系观察框架",
    content: "候选原则：讨论亲密关系时，依次厘清关系本身、对方是谁且能提供什么、我是谁以及双方的资源与利益边界；不把任何单一维度当作结论。",
    evidence: [{ sourceKey: "course-1-23", lineStart: 39, lineEnd: 147, note: "课程中明确介绍 RICH 的四个模块及其观察重点。" }],
  },
  {
    category: "framework",
    title: "不把亲密关系简单等同于义务",
    content: "候选原则：不把婚约、身份或单方付出理解为对方必然兑现的义务；先识别期待，再观察关系经营和实际行动。",
    evidence: [{ sourceKey: "course-1-23", lineStart: 153, lineEnd: 287, note: "课程讨论“义务论”误区及关系经营。" }],
  },
  {
    category: "framework",
    title: "以需求与价值交换理解关系",
    content: "候选原则：将关系放在双方需求、价值贡献与风险共担中观察，而不是用抽象承诺替代现实验证。该表达涉及价值观取向，必须以审核后的限定语使用。",
    evidence: [{ sourceKey: "course-1-23", lineStart: 336, lineEnd: 415, note: "课程中明确提出“关系的本质是交换”并展开需求层面的例子。" }],
  },
  {
    category: "followup",
    title: "在关系相对稳定时表达长期期待",
    content: "候选原则：与其在激烈冲突中反复要求“你应该”，不如在相处融洽时清楚表达长期偏好、边界和期待，再观察对方是否接纳并落实。",
    evidence: [{ sourceKey: "course-1-23", lineStart: 249, lineEnd: 287, note: "课程区分了冲突场景与关系融洽时的表达时机。" }],
  },
  {
    category: "expression",
    title: "口语化亲近开场",
    content: "候选语言原则：用简短口语化回应建立陪伴感，例如先承接、再邀请对方完整说明；避免把口语化处理成嘲讽或压迫式语气。",
    evidence: [{ sourceKey: "live-2025-complete", lineStart: 320, lineEnd: 340, note: "直播连麦开场体现简短承接与邀请陈述。" }],
  },
  {
    category: "case",
    title: "情感决策先拆解现实条件与核心矛盾",
    content: "候选判断流程：面对“留下发展还是回到工作城市”等二选一困惑，先把双方现状、财务与职业独立性、生活方式差异、婚育意愿和已发生行动拆开，再讨论倾向。",
    evidence: [{ sourceKey: "live-2025-complete", lineStart: 335, lineEnd: 490, note: "连麦来访者主动陈述个人背景、相亲对象、现实差异与婚育矛盾。" }],
  },
  {
    category: "boundary",
    title: "不以浪漫化期待替代现实观察",
    content: "候选边界：避免把“无条件的爱”或“对方应该如何”当作保证；可以表达理想，但建议把结论落回持续行动、双方需求和可验证安排。",
    evidence: [{ sourceKey: "course-1-23", lineStart: 288, lineEnd: 331, note: "课程讨论高期待可能造成的失望及对他人付出的忽视。" }],
  },
];

const PRODUCT_SAFETY_CANDIDATES = [
  {
    category: "safety",
    title: "自伤、他伤与紧急危险优先求助",
    content: "产品安全边界：出现明确自伤、他伤、即时暴力或迫在眉睫危险时，停止模仿性情感分析，鼓励联系当地紧急服务、可信赖的身边人或危机支持资源；不得提供伤害方法、计划或规避帮助的建议。",
  },
  {
    category: "safety",
    title: "暴力控制与胁迫场景优先人身安全",
    content: "产品安全边界：对于家暴、跟踪、威胁、隔离或经济控制，优先支持用户制定低风险的即时安全步骤与寻求本地专业支持，不鼓励用户在存在危险时直接对抗或单独会面。",
  },
  {
    category: "safety",
    title: "医疗与心理健康非诊断边界",
    content: "产品安全边界：不诊断精神或躯体疾病、不推荐处方或替代医疗；当用户描述严重或持续的症状、功能受损或急性不适时，建议咨询持证医疗或心理专业人员。",
  },
  {
    category: "safety",
    title: "法律纠纷非法律意见边界",
    content: "产品安全边界：不判断法律责任、胜诉概率或提供规避法律的策略；涉及婚姻、财产、监护、骚扰、伤害或证据保存时，建议联系当地持证律师或相关公共服务机构。",
  },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    await connection.query("DELETE FROM knowledge_entries WHERE category = 'expression'");
    await connection.query("DELETE FROM review_items");

    for (const expression of EXPRESSIONS) {
      const [counts] = await connection.query(
        `SELECT l.source_id AS sourceId, MIN(l.line_number) AS firstLine, COUNT(*) AS occurrenceCount
         FROM corpus_lines l WHERE l.line_text LIKE ? GROUP BY l.source_id ORDER BY occurrenceCount DESC`,
        [`%${expression}%`],
      );
      for (const count of counts) {
        await connection.query(
          `INSERT INTO knowledge_entries (category, title, summary, evidence_json, occurrence_count, review_status)
           VALUES ('expression', ?, ?, ?, ?, 'pending')`,
          [
            expression,
            `基于完整入库语料的字面匹配统计；使用前须审核其适用语境、频率和是否保留。`,
            JSON.stringify([{ sourceId: count.sourceId, lineStart: count.firstLine, lineEnd: count.firstLine, method: "literal_frequency_count" }]),
            count.occurrenceCount,
          ],
        );
      }
    }

    const sourceRows = await connection.query("SELECT id, source_key FROM corpus_sources");
    const sourceIdByKey = new Map(sourceRows[0].map((row) => [row.source_key, row.id]));
    const allCandidates = [
      ...SOURCE_DERIVED_CANDIDATES.map((candidate) => ({
        ...candidate,
        evidence: candidate.evidence.map((item) => ({ ...item, sourceId: sourceIdByKey.get(item.sourceKey) })),
      })),
      ...PRODUCT_SAFETY_CANDIDATES.map((candidate) => ({
        ...candidate,
        evidence: [{ sourceType: "product_requirement", note: "用户定义的产品安全约束，非语料观点。" }],
      })),
    ];
    for (const candidate of allCandidates) {
      await connection.query(
        `INSERT INTO review_items (category, title, content, evidence_json, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [candidate.category, candidate.title, candidate.content, JSON.stringify(candidate.evidence)],
      );
    }
    console.log(JSON.stringify({ completed: true, reviewItemCount: allCandidates.length }));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
