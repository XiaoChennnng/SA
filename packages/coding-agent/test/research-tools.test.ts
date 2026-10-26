import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { createCitationToolDefinition } from "../src/core/tools/research/citation.ts";
import { createExperimentLogToolDefinition } from "../src/core/tools/research/experiment-log.ts";
import { createLatexBuildToolDefinition } from "../src/core/tools/research/latex-build.ts";
import { createPaperReadToolDefinition } from "../src/core/tools/research/paper-read.ts";
import { createPaperSearchToolDefinition } from "../src/core/tools/research/paper-search.ts";
import { createPythonRunToolDefinition } from "../src/core/tools/research/python-run.ts";
import { createResearchNoteToolDefinition } from "../src/core/tools/research/research-note.ts";
import { resolveResearchSettings } from "../src/research/settings.ts";
import { ResearchStore } from "../src/research/store.ts";
import type { Paper, PaperText } from "../src/research/types.ts";

const tempDirs: string[] = [];
const stores: ResearchStore[] = [];

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sa-research-tools-"));
	tempDirs.push(dir);
	return dir;
}

function setup() {
	const dir = tempDir();
	const settings = resolveResearchSettings({
		databasePath: join(dir, "research.db"),
		cacheDir: join(dir, "cache"),
		workDir: join(dir, "work"),
		maxResults: 5,
		requestTimeoutMs: 5_000,
	});
	const store = new ResearchStore(settings.databasePath);
	stores.push(store);
	return { dir, settings, store, ctx: {} as unknown as ExtensionToolContext };
}

const PAPER: Paper = {
	id: "doi:10.1234/example",
	title: "Attention Is All You Need",
	authors: ["Ashish Vaswani", "Noam Shazeer"],
	year: 2017,
	venue: "NeurIPS",
	abstract: "The dominant sequence transduction models use recurrent networks.",
	doi: "10.1234/example",
	url: "https://doi.org/10.1234/example",
	pdfUrl: "https://example.com/paper.pdf",
	openAccess: true,
	sources: ["crossref"],
};

const TEXT: PaperText = {
	paper: PAPER,
	text: "Page one text\fPage two text\fPage three text",
	pages: ["Page one text", "Page two text", "Page three text"],
	extractedWith: "pdftotext",
	cached: false,
};

describe("research tools", () => {
	it("searches, saves, and formats papers", async () => {
		const { settings, store, ctx } = setup();
		const search = vi.fn(async () => ({
			papers: [PAPER],
			errors: [{ source: "pubmed" as const, message: "rate limited" }],
		}));
		const definition = createPaperSearchToolDefinition(process.cwd(), { settings, store, search });
		const result = await definition.execute("call", { query: "attention", limit: 3 }, undefined, undefined, ctx);
		expect(search).toHaveBeenCalledOnce();
		const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
		expect(text).toContain("Attention Is All You Need");
		expect(text).toContain("pubmed: rate limited");
		expect(result.details?.savedIds).toEqual([PAPER.id]);
		expect(store.getPaper(PAPER.id)?.title).toBe(PAPER.title);
	});

	it("reads page ranges and reports truncation", async () => {
		const { settings, store, ctx } = setup();
		const definition = createPaperReadToolDefinition(process.cwd(), {
			settings,
			store,
			load: async () => TEXT,
		});
		const result = await definition.execute(
			"call",
			{ paper: PAPER.doi!, pageStart: 2, maxChars: 1000 },
			undefined,
			undefined,
			ctx,
		);
		const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
		expect(text).toContain("--- Page 2 ---");
		expect(text).toContain("Page two text");
		expect(text).not.toContain("--- Page 1 ---");
		expect(result.details?.returnedPages).toEqual([2, 3]);
	});

	it("saves, searches, and lists research notes", async () => {
		const { settings, store, ctx } = setup();
		const definition = createResearchNoteToolDefinition(process.cwd(), { settings, store });
		const saved = await definition.execute(
			"call",
			{ action: "save", content: "Gradient checkpointing saves memory.", paperId: PAPER.id, tags: ["memory"] },
			undefined,
			undefined,
			ctx,
		);
		const noteId = saved.details?.note?.id;
		expect(noteId).toBeTruthy();
		const found = await definition.execute(
			"call",
			{ action: "search", query: "checkpointing" },
			undefined,
			undefined,
			ctx,
		);
		expect(found.details?.notes?.[0]?.id).toBe(noteId);
		const listed = await definition.execute("call", { action: "list", paperId: PAPER.id }, undefined, undefined, ctx);
		expect(listed.details?.notes).toHaveLength(1);
	});

	it("records and compares experiments", async () => {
		const { settings, store, ctx } = setup();
		const definition = createExperimentLogToolDefinition(process.cwd(), { settings, store });
		const first = await definition.execute(
			"call",
			{
				action: "save",
				name: "baseline",
				config: { lr: 0.1 },
				metrics: { accuracy: 0.8, loss: 0.5 },
				status: "completed",
			},
			undefined,
			undefined,
			ctx,
		);
		const second = await definition.execute(
			"call",
			{
				action: "save",
				name: "tuned",
				config: { lr: 0.05 },
				metrics: { accuracy: 0.85, loss: 0.4 },
				status: "completed",
			},
			undefined,
			undefined,
			ctx,
		);
		const firstId = first.details?.experiment?.id;
		const secondId = second.details?.experiment?.id;
		expect(firstId && secondId).toBeTruthy();
		const compared = await definition.execute(
			"call",
			{ action: "compare", ids: [firstId!, secondId!] },
			undefined,
			undefined,
			ctx,
		);
		const text = compared.content.map((part) => (part.type === "text" ? part.text : "")).join("");
		expect(text).toContain("accuracy");
		expect(text).toContain("+0.05");
		expect(text).toContain("6.2%");
	});

	it("adds, exports, and validates BibTeX citations", async () => {
		const { dir, settings, store, ctx } = setup();
		const definition = createCitationToolDefinition(dir, {
			settings,
			store,
			lookup: async () => PAPER,
		});
		const added = await definition.execute(
			"call",
			{ action: "add", identifier: PAPER.doi! },
			undefined,
			undefined,
			ctx,
		);
		expect(added.details?.citation?.key).toMatch(/^vaswani2017/);
		const exported = await definition.execute("call", { action: "export" }, undefined, undefined, ctx);
		const path = exported.details?.path;
		expect(path).toBeTruthy();
		if (!path) throw new Error("missing export path");
		expect(readFileSync(path, "utf8")).toContain("@article{vaswani2017");
		const validated = await definition.execute("call", { action: "validate", file: path }, undefined, undefined, ctx);
		expect(validated.details?.problems).toEqual([]);
	});

	it("compiles LaTeX through an injected runner", async () => {
		const { dir, settings, ctx } = setup();
		writeFileSync(join(dir, "main.tex"), "\\documentclass{article}\\begin{document}Hi\\end{document}");
		const definition = createLatexBuildToolDefinition(dir, {
			settings,
			isAvailable: () => true,
			run: async (_command, _args, cwd) => {
				writeFileSync(join(cwd, "main.pdf"), "%PDF-1.4");
				return { code: 0, output: "Output written on main.pdf", timedOut: false };
			},
		});
		const result = await definition.execute("call", { path: "main.tex" }, undefined, undefined, ctx);
		expect(result.details?.success).toBe(true);
		expect(result.details?.pdfPath).toBe(join(dir, "main.pdf"));
	});

	it("runs Python through an injected interpreter and logs the experiment", async () => {
		const { settings, store, ctx } = setup();
		const definition = createPythonRunToolDefinition(process.cwd(), {
			settings,
			store,
			isAvailable: () => true,
			run: async () => ({ code: 0, stdout: "accuracy=0.9\n", stderr: "", timedOut: false }),
		});
		const result = await definition.execute(
			"call",
			{ code: "print('accuracy=0.9')", saveExperiment: true, experimentName: "python check" },
			undefined,
			undefined,
			ctx,
		);
		expect(result.details?.exitCode).toBe(0);
		expect(result.details?.stdout).toContain("accuracy=0.9");
		expect(result.details?.experimentId).toBeTruthy();
		const experimentId = result.details?.experimentId;
		expect(experimentId).toBeTruthy();
		if (!experimentId) throw new Error("missing experiment id");
		expect(store.getExperiment(experimentId)?.name).toBe("python check");
	});
});
