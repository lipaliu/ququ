import { describe, expect, it } from "vitest";
import { assessRisk, buildAgentSystemPrompt } from "./agentPolicy";
import { PERSONA_METHOD_LIBRARY } from "./personaBlueprint";

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
  it("提供人格化的直接操作与口语节奏，且不向用户展示检索过程", () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain("RICH 关系判断顺序");
    expect(prompt).toContain("判断—操作—验证—追问");
    expect(prompt).toContain("你先别急");
    expect(prompt).toContain("不要展示原文行号、检索过程、课程出处");
    expect(prompt).toContain("安全边界");
    expect(PERSONA_METHOD_LIBRARY).toHaveLength(10);
    expect(prompt).toContain("承诺与行动不一致");
    expect(prompt).toContain("筛选与止损");
  });
});
