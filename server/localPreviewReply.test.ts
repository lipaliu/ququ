import { describe, expect, it } from "vitest";
import { buildLocalPreviewReply } from "./localPreviewReply";

describe("buildLocalPreviewReply", () => {
  it("turns a childfree, caregiving and gift-repair conflict into direct actions", () => {
    const reply = buildLocalPreviewReply("交往五年，我明确不生孩子；他家想留在北京，他生病后一直让我换药，分手后又送昂贵礼物，我要不要复合？");
    expect(reply).toContain("现在不要复合");
    expect(reply).toContain("把照护停下来");
    expect(reply).toContain("不能默认由你托底");
    expect(reply).toContain("能花一次钱，不等于");
    expect(reply).toContain("五年已经花掉了");
  });

  it("does not invent an exact relationship duration", () => {
    expect(buildLocalPreviewReply("交往多年，分手后要不要复合？")).toContain("过去这些年已经花掉了");
  });

  it("answers a gift decision follow-up directly from prior context", () => {
    const reply = buildLocalPreviewReply("那礼物收不收，退不退？", [{
      role: "user",
      content: "交往五年，我不生孩子，他把照护推给我，他家还希望留在北京，分手后送了昂贵礼物。",
    }]);
    expect(reply.startsWith("先收着，不退。")).toBe(true);
    expect(reply).toContain("不生育这个长期底线、照护责任和边界、城市、工作和家庭安排");
    expect(reply).toContain("收礼物和复合是两笔账");
    expect(reply).toContain("最多算他对过去关系的一点回补");
    expect(reply).toContain("不是用四千块买走你不生育的底线、你的城市和家庭资源、复合资格");
    expect(reply).toContain("问题没解决，你还是不能复合");
    expect(reply).not.toContain("人格底稿");
    expect(reply).not.toContain("我只问一句");
  });

  it("answers the supplied two-turn test without repeating the first-turn analysis", () => {
    const first = "38岁北京人，谈了五年，明确不生孩子。他家想留北京，他生病后一直让我换药。我们分手后，他送了一套四千块的赫莲娜，我觉得是在补偿。";
    const second = buildLocalPreviewReply("那礼物收不收，退不退？", [
      { role: "user", content: first },
      { role: "assistant", content: buildLocalPreviewReply(first) },
    ]);
    expect(second.startsWith("先收着，不退。")).toBe(true);
    expect(second).toContain("你们现在已经分手");
    expect(second).not.toContain("你现在做三件事");
    expect(second).not.toContain("五年已经花掉了");
  });

  it("does not accept a gift that explicitly purchases relationship obligations", () => {
    const reply = buildLocalPreviewReply("这个礼物收不收？", [{
      role: "user",
      content: "他说我收下礼物就必须跟他复合。",
    }]);
    expect(reply.startsWith("先不收，退回去。")).toBe(true);
    expect(reply).toContain("买你的选择权");
  });
});
