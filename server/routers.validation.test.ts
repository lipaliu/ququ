import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "validation-user",
      email: "validation@example.com",
      name: "Validation User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("chat router input validation", () => {
  it("rejects invalid conversation inputs before any persistence or model call", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.chat.send({ conversationId: 0, content: "" })).rejects.toThrow();
    await expect(caller.chat.createConversation({ title: "", scenario: "general" })).rejects.toThrow();
  });

  it("allows an unauthenticated guest to use safety-routed chat without a database", async () => {
    const caller = appRouter.createCaller({ ...createContext(), user: null });
    const result = await caller.chat.guestSend({ content: "我是不是抑郁症，需要吃什么药", history: [] });
    expect(result.riskCategory).toBe("medical");
    expect(result.message.content).toContain("不能替你诊断");
  });

  it("bounds guest history and message content before any model call", async () => {
    const caller = appRouter.createCaller({ ...createContext(), user: null });
    await expect(caller.chat.guestSend({ content: "", history: [] })).rejects.toThrow();
    await expect(caller.chat.guestSend({
      content: "普通关系问题",
      history: Array.from({ length: 11 }, () => ({ role: "user" as const, content: "历史消息" })),
    })).rejects.toThrow();
  });

  it("keeps the supplied relationship context when the guest asks a short gift follow-up", async () => {
    const caller = appRouter.createCaller({ ...createContext(), user: null });
    const firstContent = "谈了五年，我明确不生孩子。他家想留北京，他生病后把换药交给我。我们分手后，他送了四千块的护肤品。";
    const first = await caller.chat.guestSend({ content: firstContent, history: [] });
    const second = await caller.chat.guestSend({
      content: "那礼物收不收，退不退？",
      history: [
        { role: "user", content: firstContent },
        { role: "assistant", content: first.message.content },
      ],
    });
    expect(second.message.content.startsWith("先收着，不退。")).toBe(true);
    expect(second.message.content).toContain("你们现在已经分手");
    expect(second.message.content).toContain("收礼物和复合是两笔账");
    expect(second.message.content).toContain("问题没解决，你还是不能复合");
    expect(second.message.content).not.toContain("你现在做三件事");
  });

  it("keeps a conditional gift from buying reconciliation rights", async () => {
    const caller = appRouter.createCaller({ ...createContext(), user: null });
    const firstContent = "我明确不生孩子，他生病后长期让我照护。我们分手后，他送了我礼物。";
    const result = await caller.chat.guestSend({
      content: "如果他说收了就必须复合呢？",
      history: [{ role: "user", content: firstContent }],
    });
    expect(result.message.content.startsWith("先不收，退回去。")).toBe(true);
    expect(result.message.content).toContain("买你的选择权");
  });

  it("answers a livestream sponsorship-control case instead of using the breakup template", async () => {
    const caller = appRouter.createCaller({ ...createContext(), user: null });
    const result = await caller.chat.guestSend({
      content: "我做主播，有个有老婆孩子的大哥，这两个月每月给我六七万，但不让我直播，要我去他的城市，还帮我租房，我该怎么做？",
      history: [],
    });
    expect(result.message.content).toContain("直播不要停");
    expect(result.message.content).toContain("钱为什么不拿");
    expect(result.message.content).toContain("这两件事不交换");
    expect(result.message.content).not.toContain("复合的门槛");
  });
});
