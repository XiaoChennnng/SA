import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchCnki } from "../src/research/providers/cnki.ts";
import { searchNstl } from "../src/research/providers/nstl.ts";
import { searchWanfang } from "../src/research/providers/wanfang.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sa-chinese-sources-"));
	tempDirs.push(dir);
	return dir;
}

describe("Chinese source adapters", () => {
	it("runs a configured CNKI command and reports a missing configuration", async () => {
		const dir = tempDir();
		const script = join(dir, "cnki.mjs");
		writeFileSync(
			script,
			'console.log(JSON.stringify([{ title: "CNKI " + process.argv[2], authors: ["A"], year: 2024, url: "https://example.com" }]));',
			"utf8",
		);
		const papers = await searchCnki("测试", {
			limit: 3,
			timeoutMs: 10_000,
			cnkiCommand: `"${process.execPath}" "${script}" {query} {limit}`,
		});
		expect(papers[0]?.title).toBe("CNKI 测试");
		expect(papers[0]?.sources).toEqual(["cnki"]);
		await expect(searchCnki("测试", { limit: 3, timeoutMs: 1_000 })).rejects.toThrow("CNKI has no public search API");
	});

	it("runs a configured NSTL institutional command", async () => {
		const dir = tempDir();
		const script = join(dir, "nstl.mjs");
		writeFileSync(
			script,
			'console.log(JSON.stringify({ results: [{ title: "NSTL " + process.argv[2], authors: ["B"], year: 2022, doi: "10.1234/nstl.1" }] }));',
			"utf8",
		);
		const papers = await searchNstl("科技报告", {
			limit: 2,
			timeoutMs: 10_000,
			nstlCommand: `"${process.execPath}" "${script}" {query} {limit}`,
		});
		expect(papers[0]?.title).toBe("NSTL 科技报告");
		expect(papers[0]?.doi).toBe("10.1234/nstl.1");
		expect(papers[0]?.sources).toEqual(["nstl"]);
		await expect(searchNstl("科技报告", { limit: 2, timeoutMs: 1_000 })).rejects.toThrow(
			"institutional Web Services",
		);
	});

	it("requires a Wanfang APP_KEY before calling the API", async () => {
		await expect(searchWanfang("人工智能", { limit: 3, timeoutMs: 1_000 })).rejects.toThrow("APP_KEY");
	});
});
