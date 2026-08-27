import { describe, expect, it } from "vitest";
import { getCorpusOverview, getPassageContent, getSectionContent, getSectionsForSource, getSourceLines } from "./db";

describe("corpus traceability", () => {
  it("retrieves stored source lines by their original line range", async () => {
    const overview = await getCorpusOverview();
    const source = overview.sources.find((item) => item.sourceKey === "live-2025-complete");
    expect(source).toBeDefined();
    const lines = await getSourceLines({ sourceId: source!.id, startLine: 1, endLine: 3 });
    expect(lines.map((line) => line.lineNumber)).toEqual([1, 2, 3]);
    expect(lines[0]?.lineText).toBe("不显示直播网络差");
  }, 15000);

  it("traces an automatically detected section to passages and units", async () => {
    const overview = await getCorpusOverview();
    const course = overview.sources.find((item) => item.sourceKey === "course-1-23");
    expect(course).toBeDefined();
    const sections = await getSectionsForSource(course!.id);
    const chapter = sections.find((section) => section.sectionKind === "detected_chapter");
    expect(chapter).toBeDefined();
    const sectionContent = await getSectionContent(chapter!.id);
    expect(sectionContent?.passages.length).toBeGreaterThan(0);
    const firstPassage = sectionContent!.passages[0]!;
    const passageContent = await getPassageContent(firstPassage.id);
    expect(passageContent?.units.length).toBeGreaterThan(0);
    expect(passageContent?.units[0]?.startLine).toBeGreaterThanOrEqual(firstPassage.startLine);
    expect(passageContent?.units.at(-1)?.endLine).toBeLessThanOrEqual(firstPassage.endLine);
  }, 15000);

  it("keeps source-derived review evidence linked to a source line range", async () => {
    const overview = await getCorpusOverview();
    const framework = overview.reviews.find((item) => item.category === "framework");
    expect(framework).toBeDefined();
    const evidence = framework!.evidenceJson as Array<{ sourceId?: number; lineStart?: number; lineEnd?: number }>;
    expect(evidence[0]?.sourceId).toBeTypeOf("number");
    expect(evidence[0]?.lineStart).toBeTypeOf("number");
    expect(evidence[0]?.lineEnd).toBeTypeOf("number");
  }, 15000);
});
