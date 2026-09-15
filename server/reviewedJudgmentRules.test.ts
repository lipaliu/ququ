import { describe, expect, it } from "vitest";
import {
  applyReviewedJudgmentRules,
  findUnsupportedSpecificClaims,
  resolveReviewedJudgment,
  REVIEWED_JUDGMENT_RULES,
} from "./reviewedJudgmentRules";

describe("reviewed judgment rules", () => {
  it("overrides a generic model answer that contradicts a reviewed core judgment", () => {
    const reply = applyReviewedJudgmentRules("那礼物收不收，退不退？", [{
      role: "user",
      content: "我们已经分手，他送礼物补偿我，长期问题还没解决。",
    }], "不收，立刻退回去，断得干净。假设再观察三个月。");
    expect(reply.startsWith("先收着，不退。")).toBe(true);
    expect(reply).toContain("关系不恢复");
    expect(reply).not.toContain("三个月");
    expect(REVIEWED_JUDGMENT_RULES[0].principle).toContain("关系资格分账");
  });

  it("answers the reviewed structural case before a small local model can dilute the judgment", () => {
    const resolved = resolveReviewedJudgment(
      "我们谈了五年，我明确不生孩子，他生病后长期让我照护。最近分手，他又送了我四千元的礼物，我该不该复合？",
      [],
    );
    expect(resolved?.key).toBe("structural_conflict_is_not_repaired_by_a_gift");
    expect(resolved?.reply).toContain("现在不要复合");
    expect(resolved?.reply).toContain("礼物先不算改变");
    expect(resolved?.reply).toContain("没有，就维持分手");
  });

  it("resolves an omitted gift reference from conversation history", () => {
    const resolved = resolveReviewedJudgment("如果他说收了就必须复合呢？", [{
      role: "user",
      content: "我们分手后，他送了我一件礼物。",
    }]);
    expect(resolved?.key).toBe("gift_value_is_separate_from_reconciliation");
    expect(resolved?.reply.startsWith("先不收，退回去。")).toBe(true);
    expect(resolved?.reply).toContain("买你的选择权");
  });

  it("rejects time and money claims that were not supplied by the conversation", () => {
    expect(findUnsupportedSpecificClaims(
      "他总说会改，我要不要继续？",
      [],
      "再观察三个月，让他每周转给你两千元。",
    )).toEqual(["三个月", "两千元"]);

    const reply = applyReviewedJudgmentRules(
      "他总说会改，我要不要继续？",
      [],
      "再观察三个月，让他每周转给你两千元。",
    );
    expect(reply).not.toContain("三个月");
    expect(reply).not.toContain("两千元");
  });

  it("routes sponsorship plus work and location control to the independence ledger", () => {
    const input = "我做主播，认识一个有老婆孩子的大哥。他最近每个月给我六七万，但不让我直播，要我搬到他的城市，还说帮我租房，我该怎么做？";
    const resolved = resolveReviewedJudgment(input, []);
    expect(resolved?.key).toBe("preserve_income_and_exit_right_under_sponsorship");
    expect(resolved?.reply).toContain("直播不要停");
    expect(resolved?.reply).toContain("工作、社交、住在哪里，以及你什么时候可以离开");
    expect(resolved?.reply).toContain("可撤销现金流");
    expect(resolved?.reply).toContain("别人随时能关掉的一根水管");
    expect(resolved?.reply).not.toContain("重庆");
    expect(resolved?.reply).not.toContain("六七十");
    expect(resolved?.reply).not.toContain("复合的门槛");
    expect(resolved?.reply).not.toContain("礼物先不算改变");
    expect(resolved?.reply).not.toContain("夫妻共同财产");
  });

  it("does not apply an old sponsor case to a new friend or her follow-up", () => {
    const old = { role: "user" as const, content: "我做主播，大哥每个月给我六七万，不让我直播，要我搬到他的城市租房。" };
    const next = { role: "user" as const, content: "我我有个朋友长得像赵露思，有15000粉丝，准备做娱乐直播，目标是挣钱，但抗拒爱情大哥，怎么做？" };
    expect(resolveReviewedJudgment(next.content, [old])).toBeNull();
    expect(resolveReviewedJudgment("那她没有才艺怎么办？", [old, next])).toBeNull();
    const reply = applyReviewedJudgmentRules(next.content, [old], "太短");
    expect(reply).not.toMatch(/六七万|重庆|复合/);
  });

  it("does not invent the amount or city for another sponsorship case", () => {
    const resolved = resolveReviewedJudgment("我做主播，大哥每个月给我两万，不让我直播，要我搬到他的城市租房。", []);
    expect(resolved?.reply).not.toMatch(/六七万|六七十|重庆|半个月/);
  });
});
