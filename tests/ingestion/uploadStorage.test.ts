import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { storeUpload, UPLOAD_KINDS } from "../../src/ingestion/uploadStorage";

/**
 * A minimal stand-in for the `File` a Next.js server action receives from
 * `FormData` — just enough surface for `storeUpload` to use.
 */
function fakeFile(
  name: string,
  content: string,
  size?: number,
): {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
} {
  const buffer = Buffer.from(content, "utf-8");
  return {
    name,
    size: size ?? buffer.byteLength,
    async arrayBuffer() {
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    },
  };
}

const written: string[] = [];

async function keepForCleanup(
  result: Awaited<ReturnType<typeof storeUpload>>,
): Promise<void> {
  if (result.kind === "ok") written.push(result.value.path);
}

describe("upload storage", () => {
  afterEach(async () => {
    while (written.length > 0) {
      const filePath = written.pop() as string;
      await rm(filePath, { force: true });
    }
  });

  it("stores a valid workbook under data/uploads and returns its path", async () => {
    const result = await storeUpload(
      fakeFile("August.xlsx", "not a real workbook"),
      "budgetWorkbook",
    );
    await keepForCleanup(result);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(path.dirname(result.value.path)).toBe(
      path.resolve(__dirname, "../../data/uploads"),
    );
    const onDisk = await readFile(result.value.path, "utf-8");
    expect(onDisk).toBe("not a real workbook");
  });

  it("rejects an unsupported extension", async () => {
    const result = await storeUpload(fakeFile("statement.pdf", "x"), "budgetWorkbook");
    expect(result.kind).toBe("insufficient-data");
  });

  it("accepts either extension a portfolio snapshot allows", async () => {
    const xlsx = await storeUpload(fakeFile("holdings.xlsx", "x"), "portfolioSnapshot");
    const csv = await storeUpload(fakeFile("holdings.csv", "x"), "portfolioSnapshot");
    await keepForCleanup(xlsx);
    await keepForCleanup(csv);

    expect(xlsx.kind).toBe("ok");
    expect(csv.kind).toBe("ok");
  });

  it("rejects an empty file", async () => {
    const result = await storeUpload(fakeFile("empty.xlsx", "", 0), "budgetWorkbook");
    expect(result.kind).toBe("insufficient-data");
  });

  it("rejects a file over the size limit for its kind", async () => {
    const result = await storeUpload(
      fakeFile("huge.xlsx", "x", UPLOAD_KINDS.budgetWorkbook.maxBytes + 1),
      "budgetWorkbook",
    );
    expect(result.kind).toBe("insufficient-data");
  });

  it("never lets the browser-supplied name choose the path, even with traversal characters", async () => {
    const result = await storeUpload(
      fakeFile("../../../../etc/passwd.xlsx", "x"),
      "budgetWorkbook",
    );
    await keepForCleanup(result);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // The written path stays inside data/uploads no matter what the name claimed.
    expect(path.dirname(result.value.path)).toBe(
      path.resolve(__dirname, "../../data/uploads"),
    );
    expect(result.value.path).not.toContain("..");
    expect(result.value.path).not.toContain("etc");
  });

  it("rejects a null byte in the supplied name rather than passing it through", async () => {
    const result = await storeUpload(fakeFile("evil\0.xlsx", "x"), "budgetWorkbook");
    await keepForCleanup(result);

    // Whatever the outcome, nothing containing a raw null byte reaches disk.
    if (result.kind === "ok") {
      expect(result.value.path).not.toContain("\0");
    }
  });

  it("keeps a human-readable trace of the original name for provenance", async () => {
    const result = await storeUpload(
      fakeFile("August Household Budget.xlsx", "x"),
      "budgetWorkbook",
    );
    await keepForCleanup(result);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(path.basename(result.value.path)).toContain("August-Household-Budget");
    expect(result.value.originalName).toBe("August Household Budget.xlsx");
  });

  it("assigns two uploads of the same name different files", async () => {
    const first = await storeUpload(fakeFile("same.xlsx", "one"), "budgetWorkbook");
    const second = await storeUpload(fakeFile("same.xlsx", "two"), "budgetWorkbook");
    await keepForCleanup(first);
    await keepForCleanup(second);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;
    expect(first.value.path).not.toBe(second.value.path);
  });

  it("cleanup removes the file it wrote", async () => {
    const result = await storeUpload(fakeFile("temp.xlsx", "x"), "budgetWorkbook");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    await result.value.cleanup();
    await expect(readFile(result.value.path)).rejects.toThrow();
  });
});
