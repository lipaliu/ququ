import { describe, expect, it } from "vitest";
import { appendDirectMessage, resetDirectMessages, rollbackDirectUserMessage } from "./directMessages";

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
});
