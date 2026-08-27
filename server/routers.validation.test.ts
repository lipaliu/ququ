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
});
