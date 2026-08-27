import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type SourceManifest = {
  originalPath: string;
  byteCount: number;
  logicalLineCount: number;
  sha256: string;
};

function countPhysicalLines(raw: string) {
  const rows = raw.split(/\r\n|\n|\r/);
  return raw.endsWith("\n") || raw.endsWith("\r") ? rows.length - 1 : rows.length;
}

describe("source corpus integrity", () => {
  it("keeps the imported corpus baseline aligned with both supplied files", async () => {
    const manifestFile = new URL("../docs/source-manifest.json", import.meta.url);
    const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as { sourceOrder: SourceManifest[] };

    for (const source of manifest.sourceOrder) {
      const bytes = await readFile(source.originalPath);
      const raw = bytes.toString("utf8");
      expect(bytes.length).toBe(source.byteCount);
      expect(countPhysicalLines(raw)).toBe(source.logicalLineCount);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
    }
  });
});
