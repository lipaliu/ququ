import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { invokeLLM, listLLMModels } from "./_core/llm";
import { assessRisk, buildAgentSystemPrompt } from "./agentPolicy";
import * as db from "./db";

const scenarioSchema = z.enum(["relationship", "communication", "decision", "general"]);
const reviewStatusSchema = z.enum(["approved", "needs_revision", "rejected"]);

function assertAdmin(role: string | undefined) {
  if (role !== "admin") throw new Error("仅项目管理员可审核语料与表达原则。");
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  corpus: router({
    overview: protectedProcedure.query(({ ctx }) => {
      assertAdmin(ctx.user.role);
      return db.getCorpusOverview();
    }),
    sourceLines: protectedProcedure.input(z.object({
      sourceId: z.number().int().positive(),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
    }).refine((value) => value.endLine >= value.startLine && value.endLine - value.startLine < 250, "单次最多查看 250 行。"))
      .query(({ ctx, input }) => {
        assertAdmin(ctx.user.role);
        return db.getSourceLines(input);
      }),
    sections: protectedProcedure.input(z.object({ sourceId: z.number().int().positive() }))
      .query(({ ctx, input }) => {
        assertAdmin(ctx.user.role);
        return db.getSectionsForSource(input.sourceId);
      }),
    sectionContent: protectedProcedure.input(z.object({ sectionId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        assertAdmin(ctx.user.role);
        const result = await db.getSectionContent(input.sectionId);
        if (!result) throw new Error("未找到该章节。");
        return result;
      }),
    passageContent: protectedProcedure.input(z.object({ passageId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        assertAdmin(ctx.user.role);
        const result = await db.getPassageContent(input.passageId);
        if (!result) throw new Error("未找到该段落。");
        return result;
      }),
    updateReview: protectedProcedure.input(z.object({
      id: z.number().int().positive(),
      status: reviewStatusSchema,
      reviewerNote: z.string().max(800).optional(),
    })).mutation(({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      return db.updateReviewItem(input);
    }),
    updateSectionReview: protectedProcedure.input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["approved", "rejected"]),
    })).mutation(({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      return db.updateSectionReview(input);
    }),
  }),
  chat: router({
    listConversations: protectedProcedure.query(({ ctx }) => db.listConversations(ctx.user.id)),
    createConversation: protectedProcedure.input(z.object({
      title: z.string().trim().min(1).max(120),
      scenario: scenarioSchema,
    })).mutation(({ ctx, input }) => db.createConversation({ ...input, userId: ctx.user.id })),
    messages: protectedProcedure.input(z.object({ conversationId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const conversation = await db.getConversation(input.conversationId, ctx.user.id);
        if (!conversation) throw new Error("未找到该对话。");
        return db.listChatMessages(input.conversationId);
      }),
    send: protectedProcedure.input(z.object({
      conversationId: z.number().int().positive(),
      content: z.string().trim().min(1, "请先输入想聊的内容。").max(4000, "单条消息请控制在 4000 字以内。"),
    })).mutation(async ({ ctx, input }) => {
      const conversation = await db.getConversation(input.conversationId, ctx.user.id);
      if (!conversation) throw new Error("未找到该对话。");
      const risk = assessRisk(input.content);
      await db.appendChatMessage({
        conversationId: input.conversationId,
        role: "user",
        content: input.content,
        riskLevel: risk.level,
      });

      if (risk.level !== "normal") {
        const assistant = await db.appendChatMessage({
          conversationId: input.conversationId,
          role: "assistant",
          content: risk.response ?? "我很重视你的安全，请优先联系当地专业支持。",
          riskLevel: risk.level,
          citationsJson: [{ type: "safety_policy", category: risk.category }],
        });
        return { message: assistant, riskCategory: risk.category };
      }

      const [history, approvedPrinciples, passages, modelCatalog] = await Promise.all([
        db.listChatMessages(input.conversationId),
        db.getApprovedReviewItems(),
        db.findRelevantPassages(input.content),
        listLLMModels(),
      ]);
      const model = modelCatalog.data.find((candidate) => candidate.id === "gpt-5-mini")?.id ?? modelCatalog.data[0]?.id;
      const evidence = passages.map((passage) => `来源 ${passage.sourceId}｜第 ${passage.startLine}-${passage.endLine} 行：\n${passage.passageText}`).join("\n\n---\n\n");
      const approved = approvedPrinciples.map((item) => `- ${item.title}：${item.content}`).join("\n");
      const response = await invokeLLM({
        model,
        maxTokens: 900,
        messages: [
          { role: "system", content: buildAgentSystemPrompt(approved, evidence) },
          ...history.slice(-12).map((message) => ({ role: message.role, content: message.content })),
        ],
      });
      const rawContent = response.choices[0]?.message?.content;
      const content = (typeof rawContent === "string" ? rawContent.trim() : "")
        || "我现在没有生成出合适的回复。你愿意换一种方式，把最让你卡住的具体场景说给我听吗？";
      const citations = passages.map((passage) => ({
        sourceId: passage.sourceId,
        passageId: passage.id,
        startLine: passage.startLine,
        endLine: passage.endLine,
      }));
      const assistant = await db.appendChatMessage({
        conversationId: input.conversationId,
        role: "assistant",
        content,
        riskLevel: "normal",
        citationsJson: citations,
      });
      return { message: assistant, riskCategory: "none" as const };
    }),
  }),
});

export type AppRouter = typeof appRouter;
