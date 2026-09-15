import { describe, expect, it, vi } from "vitest";
import { streamGuestReply, streamingGuestInputSchema } from "./streamingChat";
import { generateLocalVoiceReplyStream } from "./localVoiceClient";

vi.mock("./localVoiceClient", () => ({
  canUseLocalVoiceModel: () => true,
  generateLocalVoiceReplyStream: vi.fn(async (_content, _history, onDelta) => {
    onDelta("先判断她愿意提供什么内容，以及观众为什么愿意持续观看。");
    return "先判断她愿意提供什么内容，以及观众为什么愿意持续观看。";
  }),
}));
vi.mock("./_core/env", () => ({ ENV: { forgeApiKey: "", isProduction: false } }));

describe("streaming guest chat", () => {
  it("streams generation with the reviewed judgment rather than replaying a fixed answer", async () => {
    const deltas: string[] = [];
    const result = await streamGuestReply({
      content: "我做主播，有个大哥每月给我六七万，但不让我直播，要我搬到他的城市并住他租的房，我该怎么办？",
      history: [],
    }, (delta) => deltas.push(delta));

    expect(deltas.length).toBeGreaterThan(0);
    expect(generateLocalVoiceReplyStream).toHaveBeenLastCalledWith(
      expect.any(String), [], expect.any(Function), 120_000,
      expect.stringContaining("可撤销的供养不能交换可积累的赚钱能力"),
    );
    expect(result.riskCategory).toBe("none");
  });

  it("rejects empty messages before opening a stream", () => {
    expect(streamingGuestInputSchema.safeParse({ content: "", history: [] }).success).toBe(false);
  });

  it("routes a new case to generation without the old case, then preserves its follow-up", async () => {
    const old = { role: "user" as const, content: "我做主播，大哥每个月给我六七万，不让我直播，要我搬到他的城市租房。" };
    const next = { role: "user" as const, content: "我有个朋友长得像赵露思，准备开始做娱乐直播，抗拒爱情大哥，该怎么办？" };
    const deltas: string[] = [];
    await streamGuestReply({ content: next.content, history: [old] }, delta => deltas.push(delta));
    expect(generateLocalVoiceReplyStream).toHaveBeenLastCalledWith(next.content, [], expect.any(Function), 120_000, "");
    expect(deltas.join("")).not.toMatch(/六七万|重庆|复合/);
    await streamGuestReply({ content: "那她没才艺怎么办？", history: [old, next] }, () => {});
    expect(generateLocalVoiceReplyStream).toHaveBeenLastCalledWith("那她没才艺怎么办？", [next], expect.any(Function), 120_000, "");
  });
});
