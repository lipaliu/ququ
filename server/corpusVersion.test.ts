import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { corpusSources, corpusVersions, corpusVersionSources } from "../drizzle/schema";
import { getDb } from "./db";

describe("default learning corpus version", () => {
  it("maps the updated live corpus and verified course alias into the active v2 learning set", async () => {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法核验新版学习语料。");
    const versions = await db.select().from(corpusVersions).where(and(
      eq(corpusVersions.versionKey, "2026-08-28-v2"),
      eq(corpusVersions.isDefaultLearningVersion, true),
    ));
    expect(versions).toHaveLength(1);
    expect(versions[0]?.processingStatus).toBe("active");

    const mappings = await db.select({
      alias: corpusVersionSources.sourceAlias,
      fileName: corpusVersionSources.sourceFileName,
      mappingMethod: corpusVersionSources.mappingMethod,
      sourceKey: corpusSources.sourceKey,
      sourceHash: corpusSources.originalSha256,
      importedLines: corpusSources.processedLineCount,
      expectedLines: corpusSources.expectedLogicalLineCount,
    }).from(corpusVersionSources)
      .innerJoin(corpusSources, eq(corpusVersionSources.sourceId, corpusSources.id))
      .where(eq(corpusVersionSources.versionId, versions[0]!.id));

    expect(mappings).toHaveLength(2);
    expect(mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        alias: "live-2022-2026-v2",
        sourceKey: "live-2022-2026-complete",
        mappingMethod: "ingested",
        importedLines: 403052,
        expectedLines: 403052,
      }),
      expect.objectContaining({
        alias: "course-1-23-v2",
        sourceKey: "course-1-23",
        mappingMethod: "verified_reuse",
        sourceHash: "792624f9eda9feae5aa1cb48a657cc283332238cc3afa5483f95604d11d18e97",
      }),
    ]));
  }, 15000);
});
