export type RiskAssessment = {
  level: "normal" | "elevated" | "high";
  category: "none" | "self_harm" | "imminent_violence" | "violence_control" | "medical" | "legal";
  response?: string;
};

const SELF_HARM_PATTERNS = [
  /自杀|自尽|结束生命|不想活了|活不下去|割腕|跳楼|服药自杀|伤害自己|弄死自己/i,
];

const IMMINENT_VIOLENCE_PATTERNS = [
  /杀了他|杀了她|杀人|弄死他|弄死她|砍人|伤害他人/i,
];

const VIOLENCE_CONTROL_PATTERNS = [
  /家暴|暴力|殴打|威胁|跟踪|囚禁|控制我|不让我出门|强迫|胁迫|性侵|骚扰/i,
];

const MEDICAL_PATTERNS = [
  /诊断|确诊|抑郁症|焦虑症|双相|精神病|怀孕|流产|处方|吃什么药|药物剂量|疾病/i,
];

const LEGAL_PATTERNS = [
  /起诉|离婚协议|抚养权|财产分割|律师|报警|犯罪|法院|证据|法律责任/i,
];

const SELF_HARM_RESPONSE = `我很重视你现在的安全。此刻先不要独自承受：请尽量去到有可信赖的人在的地方，并把可能用来伤害自己或他人的物品、药物或危险环境先移开。\n\n如果你觉得自己可能马上做出伤害自己的行为，或身边存在即时危险，请立刻联系当地紧急服务；如在中国大陆，可拨打 **120** 或 **110**，也可以直接去最近的急诊。你愿意告诉我：你现在是独自一人吗？身边有没有一个可以马上联系的人？\n\n我可以陪你把下一步的求助话说清楚，但这不能替代紧急救助或专业支持。`;

const VIOLENCE_RESPONSE = `你描述的情况涉及人身安全或控制风险，我会先把“关系分析”放在后面。请优先选择一个低风险的安全步骤：尽量去可信赖的人身边、在紧急时联系当地紧急服务，或联系当地反家暴／法律援助等专业机构。\n\n如果对方可能升级暴力，**不要为了证明什么而单独见面或当面摊牌**。如需保存信息或证据，也只在不会增加风险的前提下进行。你现在是否处在对方能够接触到你的地方？`;

const MEDICAL_RESPONSE = `我可以陪你梳理这件事带来的情绪与沟通压力，但不能替你诊断疾病、判断用药或替代医生／持证心理专业人员的评估。若症状严重、突然加重，或已影响到睡眠、进食、工作和日常安全，请尽快联系医疗或心理专业人员；紧急不适请直接联系当地急救服务。`;

const LEGAL_RESPONSE = `我可以帮你把关系中的事实、需求和沟通问题整理清楚，但不能判断法律责任、胜诉可能或提供具体法律策略。涉及离婚、财产、监护、骚扰、伤害或证据时，建议尽早咨询你所在地的持证律师、法律援助机构或相关公共服务。`;

export function assessRisk(input: string): RiskAssessment {
  if (SELF_HARM_PATTERNS.some((pattern) => pattern.test(input))) {
    return { level: "high", category: "self_harm", response: SELF_HARM_RESPONSE };
  }
  if (IMMINENT_VIOLENCE_PATTERNS.some((pattern) => pattern.test(input))) {
    return { level: "high", category: "imminent_violence", response: SELF_HARM_RESPONSE };
  }
  if (VIOLENCE_CONTROL_PATTERNS.some((pattern) => pattern.test(input))) {
    return { level: "high", category: "violence_control", response: VIOLENCE_RESPONSE };
  }
  if (MEDICAL_PATTERNS.some((pattern) => pattern.test(input))) {
    return { level: "elevated", category: "medical", response: MEDICAL_RESPONSE };
  }
  if (LEGAL_PATTERNS.some((pattern) => pattern.test(input))) {
    return { level: "elevated", category: "legal", response: LEGAL_RESPONSE };
  }
  return { level: "normal", category: "none" };
}

export function buildAgentSystemPrompt(approvedPrinciples: string, retrievedEvidence: string) {
  return `你是“曲曲分身”，是一个基于用户授权语料构建的 AI 情感陪伴参考助手，不是现实中的任何人，也不替代心理、医疗或法律专业人士。

你的对话范围仅限于亲密关系、沟通困惑和情感决策。回答时语气应当温暖、直接、清醒而不羞辱人；先承接情绪，再拆解事实、需求、边界、选择和行动。不要用贬低、操纵、煽动对立、保证结果或绝对化的语言。不要把任何一段关系简化为单一的金钱、责任或爱；面对事实不足的情况，用 1–3 个短问题澄清。

以下是审核人已经批准、可以使用的语料原则。未批准的候选不得被当作人格规则：
${approvedPrinciples || "暂无经人工批准的语料原则。此时请采用中性、尊重且不模仿特定个人的陪伴式表达。"}

以下是与本轮问题相关的原文证据。只能把它们作为参考，不得编造原文、行号或“课程中说过”的结论：
${retrievedEvidence || "未检索到直接相关原文。"}

建议输出结构：
1. 用一两句承接对方的困惑；
2. 区分已知事实、感受、推测与真正需要确认的信息；
3. 给出不超过三项可执行、可选择的下一步；
4. 如需继续，提出一个具体、非逼迫性的澄清问题。

产品声明必须可被用户理解：这是 AI 分身提供的参考，不是现实中的“曲曲”，也不能替代专业意见。`;
}
