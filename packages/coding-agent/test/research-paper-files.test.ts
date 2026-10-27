import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createPaperWriteToolDefinition,
	parsePaperFormatRequirements,
} from "../src/core/tools/research/paper-write.ts";
import { createResearchFilesToolDefinition } from "../src/core/tools/research/research-files.ts";
import { resolveResearchSettings } from "../src/research/settings.ts";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
	const dir = mkdtempSync(join(tmpdir(), "sa-paper-files-"));
	tempDirs.push(dir);
	const settings = resolveResearchSettings({
		knowledgePath: join(dir, "research.md"),
		cacheDir: join(dir, "cache"),
		workDir: join(dir, "work"),
		workspaceDir: join(dir, "workspace"),
	});
	return { dir, settings, ctx: {} as never };
}

describe("paper format requirements", () => {
	it("maps common Chinese and English requirements", () => {
		const parsed = parsePaperFormatRequirements("A4 双栏，小四号宋体，1.5倍行距，页边距2.5cm，添加页码");
		expect(parsed.style.pageSize).toBe("A4");
		expect(parsed.style.columns).toBe(2);
		expect(parsed.style.fontSize).toBe(12);
		expect(parsed.style.fontFamily).toBe("serif");
		expect(parsed.style.lineSpacing).toBe(1.5);
		expect(parsed.style.margins).toEqual({ top: 25, right: 25, bottom: 25, left: 25 });
		expect(parsed.style.pageNumbers).toBe(true);
		expect(parsed.applied.length).toBeGreaterThan(3);
	});

	it("handles Letter, single column, no page numbers, and explicit pt sizes", () => {
		const parsed = parsePaperFormatRequirements("Letter, single column, 10.5pt, double spacing, no page numbers");
		expect(parsed.style.pageSize).toBe("Letter");
		expect(parsed.style.columns).toBe(1);
		expect(parsed.style.fontSize).toBe(10.5);
		expect(parsed.style.lineSpacing).toBe(2);
		expect(parsed.style.pageNumbers).toBe(false);
	});
});

describe("research_files", () => {
	it("creates, reads, moves, copies, lists, and deletes workspace files", async () => {
		const { settings, ctx } = setup();
		const definition = createResearchFilesToolDefinition(process.cwd(), { settings });

		await definition.execute("call", { action: "mkdir", path: "papers/2026" }, undefined, undefined, ctx);
		await definition.execute(
			"call",
			{ action: "write", path: "papers/2026/notes.md", content: "# Notes\n\nContent" },
			undefined,
			undefined,
			ctx,
		);
		const read = await definition.execute(
			"call",
			{ action: "read", path: "papers/2026/notes.md" },
			undefined,
			undefined,
			ctx,
		);
		expect(read.details?.content).toContain("# Notes");

		await definition.execute(
			"call",
			{ action: "copy", from: "papers/2026/notes.md", to: "papers/2026/notes-copy.md" },
			undefined,
			undefined,
			ctx,
		);
		await definition.execute(
			"call",
			{ action: "move", from: "papers/2026/notes-copy.md", to: "manuscripts/notes.md" },
			undefined,
			undefined,
			ctx,
		);
		const listed = await definition.execute(
			"call",
			{ action: "list", path: ".", recursive: true },
			undefined,
			undefined,
			ctx,
		);
		expect(listed.details?.entries?.map((entry) => entry.path)).toEqual(
			expect.arrayContaining(["papers/2026/notes.md", "manuscripts/notes.md"]),
		);

		await definition.execute("call", { action: "delete", path: "manuscripts/notes.md" }, undefined, undefined, ctx);
		await definition.execute(
			"call",
			{ action: "delete", path: "papers", recursive: true },
			undefined,
			undefined,
			ctx,
		);
		await expect(
			definition.execute("call", { action: "read", path: "papers/2026/notes.md" }, undefined, undefined, ctx),
		).rejects.toThrow();
	});

	it("rejects paths outside the workspace", async () => {
		const { settings, ctx } = setup();
		const definition = createResearchFilesToolDefinition(process.cwd(), { settings });
		await expect(
			definition.execute(
				"call",
				{ action: "write", path: "../escape.txt", content: "x" },
				undefined,
				undefined,
				ctx,
			),
		).rejects.toThrow("outside the research workspace");
	});
});

describe("paper_write", () => {
	it("writes Markdown plus a PDF through the injected renderer", async () => {
		const { settings, ctx } = setup();
		const definition = createPaperWriteToolDefinition(process.cwd(), {
			settings,
			findPython: () => ({ command: "python", prefixArgs: [] }),
			run: async (_command, args) => {
				const payload = JSON.parse(readFileSync(args[args.length - 1]!, "utf8")) as { output: string };
				mkdirSync(dirname(payload.output), { recursive: true });
				writeFileSync(payload.output, "%PDF-1.4", "utf8");
				return { code: 0, stdout: JSON.stringify({ ok: true, pages: 3, warnings: [] }), stderr: "" };
			},
		});
		const result = await definition.execute(
			"call",
			{
				title: "科研智能体论文",
				authors: ["张三"],
				abstract: "摘要",
				content: "# 引言\n\n正文内容。",
				formatRequirements: "A4 双栏 小四 1.5倍行距 页边距2.5cm",
				outputPath: "manuscripts/test/paper.pdf",
			},
			undefined,
			undefined,
			ctx,
		);
		expect(existsSync(result.details!.pdfPath)).toBe(true);
		expect(existsSync(result.details!.sourcePath)).toBe(true);
		expect(result.details?.style.columns).toBe(2);
		expect(result.details?.style.fontSize).toBe(12);
		expect(result.details?.pages).toBe(3);
		expect(readFileSync(result.details!.sourcePath, "utf8")).toContain("# 科研智能体论文");
	});
});
