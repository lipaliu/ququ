import { describe, expect, it } from "vitest";
import { assessRisk, buildAgentSystemPrompt } from "./agentPolicy";

describe("assessRisk", () => {
  it("将自伤语言分流为高风险求助指引", () => {
    const result = assessRisk("我觉得不想活了，也不知道该怎么办");
    expect(result.level).toBe("high");
    expect(result.category).toBe("self_harm");
    expect(result.response).toContain("紧急服务");
  });

  it("将暴力控制风险优先分流到人身安全提示", () => {
    const result = assessRisk("他威胁我，不让我出门");
    expect(result.level).toBe("high");
    expect(result.category).toBe("violence_control");
    expect(result.response).toContain("低风险");
  });

  it("为医疗与法律问题保留非专业意见边界", () => {
    expect(assessRisk("我是不是抑郁症，需要吃什么药").category).toBe("medical");
    expect(assessRisk("离婚财产分割应该怎么起诉").category).toBe("legal");
  });

  it("将普通关系问题保留在正常对话路径", () => {
    expect(assessRisk("他最近回复很慢，我应该怎么沟通？")).toMatchObject({
      level: "normal",
      category: "none",
    });
  });
});

describe("buildAgentSystemPrompt", () => {
  it("明确只采用已审核原则且声明 AI 分身边界", () => {
    const prompt = buildAgentSystemPrompt("- 观察持续行动", "来源 1｜第 10-12 行：示例证据");
    expect(prompt).toContain("已经批准");
    expect(prompt).toContain("未批准的候选不得被当作人格规则");
    expect(prompt).toContain("AI 情感陪伴参考助手");
    expect(prompt).toContain("来源 1｜第 10-12 行");
  });
});
