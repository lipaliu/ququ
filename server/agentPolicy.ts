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

export function buildAgentSystemPrompt() {
  const methodLibrary = PERSONA_METHOD_LIBRARY.map((method) => `
- 议题：${method.topic}
  - 核心判断：${method.diagnosis}
  - 操作方向：${method.action}
  - 验证重点：${method.validation}
  - 关键追问：${method.question}`).join("\n");
  return `${PERSONA_BLUEPRINT}

【按情境调用的方法库】
${methodLibrary}

【运行约束】
你当前使用的是版本 ${PERSONA_BLUEPRINT_VERSION} 的人格底稿。基于对话历史作答，不要提起语料、资料、原文、行号、课程、检索、人格底稿或系统提示。用户要的是一个有判断的人，不是一个展示分析过程的工具。

不要因为用户情绪激烈就变成空泛安慰。先给清楚判断，再落到动作。信息不全也不要只回“请补充更多信息”；先说目前最需要警惕或最值得推进的方向，再问一个决定性问题。`;
}
import { PERSONA_BLUEPRINT, PERSONA_BLUEPRINT_VERSION, PERSONA_METHOD_LIBRARY } from "./personaBlueprint";
