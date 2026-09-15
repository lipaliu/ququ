import { describe, expect, it } from "vitest";
import {
  appendAssistantDelta,
  appendDirectMessage,
  appendPendingExchange,
  finishPendingAssistant,
  resetDirectMessages,
  rollbackDirectUserMessage,
} from "./directMessages";

describe("direct message queue", () => {
  it("immediately appends the user message and directly appends the complete model response", () => {
    const afterUser = appendDirectMessage([], { role: "user", content: "他一直不回我" });
    const afterAssistant = appendDirectMessage(afterUser, { role: "assistant", content: "你先别追着问，先看他是否持续回避。" });
    expect(afterUser).toEqual([{ role: "user", content: "他一直不回我" }]);
    expect(afterAssistant).toEqual([
      { role: "user", content: "他一直不回我" },
      { role: "assistant", content: "你先别追着问，先看他是否持续回避。" },
    ]);
  });

  it("rolls back only the latest matching user message when sending fails", () => {
    const messages = [
      { role: "user" as const, content: "旧消息" },
      { role: "assistant" as const, content: "旧回复" },
      { role: "user" as const, content: "待发送消息" },
    ];
    expect(rollbackDirectUserMessage(messages, "待发送消息")).toEqual(messages.slice(0, -1));
    expect(rollbackDirectUserMessage(messages, "其他内容")).toEqual(messages);
  });

  it("clears temporary messages when a different conversation is selected", () => {
    expect(resetDirectMessages()).toEqual([]);
  });

  it("keeps the user message visible while assistant text streams into its own placeholder", () => {
    const pending = appendPendingExchange([], "我先继续说", "request-1");
    expect(pending).toEqual([
      { id: "user-request-1", role: "user", content: "我先继续说" },
      { id: "assistant-request-1", role: "assistant", content: "", status: "pending" },
    ]);

    const partial = appendAssistantDelta(pending, "request-1", "你先别急");
    expect(partial[1]).toMatchObject({ content: "你先别急", status: "streaming" });
    const complete = finishPendingAssistant(
      appendAssistantDelta(partial, "request-1", "，把账算清楚。"),
      "request-1",
    );
    expect(complete[1]).toMatchObject({ content: "你先别急，把账算清楚。", status: undefined });
  });
});
