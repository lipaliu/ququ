import { buildLocalPreviewReply } from "./localPreviewReply";
import { relevantHistory } from "./conversationContext";

type HistoryMessage = { role: "user" | "assistant"; content: string };

type ReviewedRuleKey =
  | "gift_value_is_separate_from_reconciliation"
  | "structural_conflict_is_not_repaired_by_a_gift"
  | "preserve_income_and_exit_right_under_sponsorship";

/**
 * 已由项目所有者核对过的高置信判断规则。
 * 模型回答若与这些规则冲突，优先回到规则生成，而不是让通用模型常识覆盖曲曲判断。
 */
export const REVIEWED_JUDGMENT_RULES = [
  {
    key: "gift_value_is_separate_from_reconciliation",
    reviewedAt: "2026-09-10",
    provenance: "owner_reviewed_with_corpus_support",
    principle: "现实价值与关系资格分账；无附加义务的补偿礼物可以收，长期问题未解决则不复合。",
  },
  {
    key: "structural_conflict_is_not_repaired_by_a_gift",
    reviewedAt: "2026-09-10",
    provenance: "derived_from_full_corpus_and_owner_review",
    principle: "生育底线与照护责任是长期结构问题；一次礼物不能替代解决方案，也不能自动取得复合资格。",
  },
  {
    key: "preserve_income_and_exit_right_under_sponsorship",
    reviewedAt: "2026-09-10",
    provenance: "owner_supplied_reference_answer_with_corpus_support",
    principle: "可撤销的供养不能交换可积累的赚钱能力；金额上涨若同时要求停工、迁城和依附住房，就是在购买控制权。钱可以接，事业、生活盘和退出能力不能交。",
  },
] as const;

function combinedUserContext(input: string, history: HistoryMessage[]) {
  return [...relevantHistory(input, history).filter((message) => message.role === "user").map((message) => message.content), input].join("\n");
}

function normalizedSpecificClaims(text: string) {
  const claims = text.match(/(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千万两半]+)(?:天|周|星期|个月|月|年|元|块钱|万)/g) ?? [];
  return Array.from(new Set(claims.map((claim) => claim.replace(/块钱$/, "元"))));
}

export function findUnsupportedSpecificClaims(
  input: string,
  history: HistoryMessage[],
  modelReply: string,
) {
  const context = combinedUserContext(input, history);
  const contextClaims = new Set(normalizedSpecificClaims(context));
  return normalizedSpecificClaims(modelReply).filter((claim) => !contextClaims.has(claim));
}

function modelReplyNeedsFallback(input: string, history: HistoryMessage[], modelReply: string) {
  if (modelReply.trim().length < 45) return true;
  if (findUnsupportedSpecificClaims(input, history, modelReply).length > 0) return true;
  const questionCount = (modelReply.match(/[？?]/g) ?? []).length;
  const hasJudgmentOrAction = /结论|先做|现在做|不要|不能|可以|建议|门槛|底线|停止|暂停|收着|退回/.test(modelReply);
  return questionCount >= 3 && !hasJudgmentOrAction;
}

export function resolveReviewedJudgment(
  input: string,
  history: HistoryMessage[],
): { key: ReviewedRuleKey; reply: string } | null {
  const context = combinedUserContext(input, history);
  const hasLivestreamCareer = /直播|主播|带货|直播间|账号|粉丝/.test(context);
  const hasSponsorMoney = /大哥|转账|给我.{0,4}(钱|米)|零花钱|包养|供养|每个?月.{0,12}(万|千|百)/.test(context);
  const hasRelocationControl = /搬.{0,12}(他的?城市|他那|那边)|去他.{0,8}(城市|那边)|租.{0,6}房|异地/.test(context);
  const hasWorkRestriction = /不让.{0,8}(我)?直播|不许.{0,8}(我)?直播|别.{0,4}直播|停止直播|停播|不让我工作|不许我工作/.test(context);
  const hasMarriedPartner = /有老婆|老婆孩子|已婚|原配|有家庭/.test(context);
  if (hasLivestreamCareer && hasSponsorMoney && hasWorkRestriction && (hasRelocationControl || hasMarriedPartner)) {
    return {
      key: "preserve_income_and_exit_right_under_sponsorship",
      reply: buildLocalPreviewReply(input, history),
    };
  }

  const contextAlreadyHasGift = /礼物|送了|送我|买了|赫莲娜|补偿|弥补/.test(context);
  const isGiftDecision = /收不收|退不退|礼物.{0,8}(收|退)|(收|退).{0,8}礼物/.test(input)
    || (contextAlreadyHasGift && /(?:收了|收下|拿了).{0,16}(?:必须|就得|要|复合|和好|结婚|陪他|发生关系)/.test(input));
  if (isGiftDecision) {
    return {
      key: "gift_value_is_separate_from_reconciliation",
      reply: buildLocalPreviewReply(input, history),
    };
  }

  const hasChildfreeConflict = /不生|不要孩子|不想生|生育|丁克/.test(context);
  const hasCareBurden = /伺候|照顾|照料|照护|换药|护理|老妈子|责任.{0,8}(推|丢|扔)/.test(context);
  const hasBreakupDecision = /分手|分了|前任|复合|继续这段关系|还要不要继续/.test(context);
  const hasGiftRepair = contextAlreadyHasGift;
  if (hasChildfreeConflict && hasCareBurden && hasBreakupDecision && hasGiftRepair) {
    return {
      key: "structural_conflict_is_not_repaired_by_a_gift",
      reply: buildLocalPreviewReply(input, history),
    };
  }

  return null;
}

export function applyReviewedJudgmentRules(
  input: string,
  history: HistoryMessage[],
  modelReply: string,
) {
  const reviewed = resolveReviewedJudgment(input, history);
  if (reviewed) return reviewed.reply;
  if (modelReplyNeedsFallback(input, history, modelReply)) {
    return buildLocalPreviewReply(input, history);
  }
  return modelReply;
}
