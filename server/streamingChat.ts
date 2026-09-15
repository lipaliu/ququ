import { setTimeout as delay } from "node:timers/promises";
import { relevantHistory } from "./conversationContext";
import { z } from "zod";
import { assessRisk, buildAgentSystemPrompt } from "./agentPolicy";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { buildLocalPreviewReply } from "./localPreviewReply";
import {
  canUseLocalVoiceModel,
  generateLocalVoiceReplyStream,
  type LocalVoiceHistoryMessage,
} from "./localVoiceClient";
import { applyReviewedJudgmentRules, resolveReviewedJudgment, REVIEWED_JUDGMENT_RULES } from "./reviewedJudgmentRules";

export const streamingGuestInputSchema = z.object({
  content: z.string().trim().min(1, "请先输入想聊的内容。").max(4000, "单条消息请控制在 4000 字以内。"),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
  })).max(10).default([]),
});

export type StreamingGuestInput = z.infer<typeof streamingGuestInputSchema>;
export type StreamReplyEvent =
  | { type: "delta"; delta: string }
  | { type: "done"; riskCategory: string }
  | { type: "error"; message: string };

async function emitCompletedText(text: string, onDelta: (delta: string) => void) {
  for (let offset = 0; offset < text.length; offset += 12) {
    onDelta(text.slice(offset, offset + 12));
    await delay(14);
  }
}

export async function streamGuestReply(
  input: StreamingGuestInput,
  onDelta: (delta: string) => void,
) {
  input = { ...input, history: relevantHistory(input.content, input.history) };
  const risk = assessRisk(input.content);
  if (risk.level !== "normal") {
    await emitCompletedText(risk.response ?? "我很重视你的安全，请优先联系当地专业支持。", onDelta);
    return { riskCategory: risk.category };
  }

  const reviewed = resolveReviewedJudgment(input.content, input.history);
  const useLocalModel = !ENV.forgeApiKey && !ENV.isProduction && canUseLocalVoiceModel();
  const generateReviewedCase = useLocalModel && reviewed?.key === "preserve_income_and_exit_right_under_sponsorship";
  if (reviewed && !generateReviewedCase) {
    await emitCompletedText(reviewed.reply, onDelta);
    return { riskCategory: "none" };
  }

  if (!ENV.forgeApiKey && !ENV.isProduction) {
    if (useLocalModel) {
      try {
        const judgment = generateReviewedCase
          ? `${REVIEWED_JUDGMENT_RULES.find(rule => rule.key === reviewed?.key)?.principle ?? ""} 开头明确：不附带停播迁城义务的支持可以收，直播继续，自己原来的生活要保留。拒绝的是停播迁城要求，不能笼统说拒绝他。解释接受支持和答应条件为何是两回事，再讲长期打算。不能因金额上涨就断言对方必然有某种动机。`
          : "";
        await generateLocalVoiceReplyStream(input.content, input.history, onDelta, 120_000, judgment);
        return { riskCategory: "none" };
      } catch (error) {
        console.warn("Streaming local voice model failed; using deterministic fallback.", error);
      }
    }
    await emitCompletedText(buildLocalPreviewReply(input.content, input.history), onDelta);
    return { riskCategory: "none" };
  }

  const response = await invokeLLM({
    model: "gpt-5-mini",
    maxTokens: 1200,
    messages: [
      { role: "system", content: buildAgentSystemPrompt() },
      ...input.history.map((message) => ({ role: message.role, content: message.content })),
      { role: "user", content: input.content },
    ],
  });
  const raw = response.choices[0]?.message?.content;
  const modelReply = typeof raw === "string" ? raw.trim() : "";
  const reply = applyReviewedJudgmentRules(
    input.content,
    input.history as LocalVoiceHistoryMessage[],
    modelReply || buildLocalPreviewReply(input.content, input.history),
  );
  await emitCompletedText(reply, onDelta);
  return { riskCategory: "none" };
}
