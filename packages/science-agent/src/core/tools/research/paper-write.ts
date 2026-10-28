import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import { parseBibtex } from "../../../research/bibtex.ts";
import { PAPER_RENDER_SCRIPT } from "../../../research/paper-render-script.ts";
import { pythonPrefixArgs, resolvePythonCommand } from "../../../research/runtime.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import type { ToolWorkspace } from "../../workspace/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchFsFor, researchSettingsFor } from "./shared.ts";

const pageSizeSchema = Type.Union([Type.Literal("A4"), Type.Literal("Letter")]);

const marginsSchema = Type.Object({
	top: Type.Optional(Type.Number({ minimum: 5, maximum: 50, description: "Top margin in mm." })),
	right: Type.Optional(Type.Number({ minimum: 5, maximum: 50, description: "Right margin in mm." })),
	bottom: Type.Optional(Type.Number({ minimum: 5, maximum: 50, description: "Bottom margin in mm." })),
	left: Type.Optional(Type.Number({ minimum: 5, maximum: 50, description: "Left margin in mm." })),
});

const paperStyleSchema = Type.Object({
	pageSize: Type.Optional(pageSizeSchema),
	fontFamily: Type.Optional(Type.Union([Type.Literal("serif"), Type.Literal("sans")])),
	fontSize: Type.Optional(Type.Number({ minimum: 8, maximum: 16, description: "Body font size in points." })),
	lineSpacing: Type.Optional(Type.Number({ minimum: 1, maximum: 3, description: "Line spacing multiple." })),
	margins: Type.Optional(marginsSchema),
	columns: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2)])),
	coverPage: Type.Optional(Type.Boolean()),
	pageNumbers: Type.Optional(Type.Boolean()),
	headingNumbering: Type.Optional(Type.Boolean()),
	header: Type.Optional(Type.String()),
	footer: Type.Optional(Type.String()),
});

const paperWriteSchema = Type.Object({
	title: Type.String({ minLength: 1, description: "Paper title." }),
	authors: Type.Optional(Type.Array(Type.String(), { description: "Author names in display order." })),
	abstract: Type.Optional(Type.String({ description: "Abstract text." })),
	keywords: Type.Optional(Type.Array(Type.String())),
	content: Type.Optional(Type.String({ description: "Markdown body. Provide content or contentFile." })),
	contentFile: Type.Optional(
		Type.String({ description: "Path to a Markdown file to use as the body, relative to the working directory." }),
	),
	references: Type.Optional(Type.Array(Type.String(), { description: "Formatted reference lines." })),
	bibtex: Type.Optional(Type.String({ description: "BibTeX content whose entries are appended as references." })),
	bibtexPath: Type.Optional(Type.String({ description: "Path to a .bib file, relative to the working directory." })),
	style: Type.Optional(paperStyleSchema),
	formatRequirements: Type.Optional(
		Type.String({
			description: "Explicit formatting requirements (page size, columns, margins, font, size, spacing).",
		}),
	),
	outputPath: Type.Optional(
		Type.String({
			description: "PDF output path, relative to the research workspace (default: manuscripts/<slug>/paper.pdf).",
		}),
	),
});

export type PaperWriteToolInput = Static<typeof paperWriteSchema>;

export interface PaperStyle {
	pageSize: "A4" | "Letter";
	fontFamily: "serif" | "sans";
	fontSize: number;
	lineSpacing: number;
	margins: { top: number; right: number; bottom: number; left: number };
	columns: 1 | 2;
	coverPage: boolean;
	pageNumbers: boolean;
	headingNumbering: boolean;
	header: string;
	footer: string;
}

export interface PaperWriteToolDetails {
	pdfPath: string;
	sourcePath: string;
	pages: number;
	style: PaperStyle;
	warnings: string[];
	engine: "python-reportlab";
	appliedRequirements: string[];
}

export interface PaperWriteToolOptions extends Partial<ResearchToolOptions> {
	findPython?: () => { command: string; prefixArgs: string[] };
	run?: (
		command: string,
		args: string[],
		cwd: string,
		timeoutMs: number,
		signal?: AbortSignal,
	) => Promise<{ code: number | null; stdout: string; stderr: string }>;
}

export const paperWriteToolSystemPromptContribution = {
	snippet: "Typeset Markdown into a PDF with Python/reportlab (no LaTeX)",
	guidelines: [
		"Use when LaTeX is unavailable or a quick clean PDF is wanted",
		"Map explicit page size, column, margin, font, and spacing requirements to style fields",
	],
} as const;

const DEFAULTS: PaperStyle = {
	pageSize: "A4",
	fontFamily: "serif",
	fontSize: 11,
	lineSpacing: 1.5,
	margins: { top: 25, right: 25, bottom: 25, left: 25 },
	columns: 1,
	coverPage: false,
	pageNumbers: true,
	headingNumbering: true,
	header: "",
	footer: "",
};

function mergeMargins(
	base: PaperStyle["margins"],
	override: { top?: number; right?: number; bottom?: number; left?: number } | undefined,
): PaperStyle["margins"] {
	if (!override) return base;
	return {
		top: override.top ?? base.top,
		right: override.right ?? base.right,
		bottom: override.bottom ?? base.bottom,
		left: override.left ?? base.left,
	};
}

/** Map common explicit formatting requirements into paper style fields. */
export function parsePaperFormatRequirements(text: string | undefined): {
	style: Partial<PaperStyle>;
	applied: string[];
} {
	const style: Partial<PaperStyle> = {};
	const applied: string[] = [];
	if (!text?.trim()) return { style, applied };
	const lower = text.toLowerCase();
	if (/letter|美式信纸/.test(lower)) {
		style.pageSize = "Letter";
		applied.push("page size Letter");
	} else if (/a4/.test(lower)) {
		style.pageSize = "A4";
		applied.push("page size A4");
	}
	if (/双栏|两栏|two[- ]column|2[- ]column/.test(lower)) {
		style.columns = 2;
		applied.push("two columns");
	} else if (/单栏|one[- ]column|single[- ]column/.test(lower)) {
		style.columns = 1;
		applied.push("single column");
	}
	const chineseSizes: Record<string, number> = {
		小五: 9,
		五号: 10.5,
		小四: 12,
		四号: 14,
		小三: 15,
		三号: 16,
		小二: 18,
	};
	const sizeMatch = /(小五|五号|小四|四号|小三|三号|小二)|(\d+(?:\.\d+)?)\s*(?:pt|磅)/i.exec(text);
	if (sizeMatch) {
		const size = sizeMatch[1] ? chineseSizes[sizeMatch[1]] : Number.parseFloat(sizeMatch[2]!);
		if (size) {
			style.fontSize = size;
			applied.push(`font size ${size}pt`);
		}
	}
	if (/双倍|两倍|double[- ]spac(?:ed|ing)/.test(lower)) {
		style.lineSpacing = 2;
		applied.push("double spacing");
	} else if (/1\.5\s*倍|1\.5[- ]line/.test(lower)) {
		style.lineSpacing = 1.5;
		applied.push("1.5 line spacing");
	} else if (/单倍|single[- ]spaced/.test(lower)) {
		style.lineSpacing = 1;
		applied.push("single spacing");
	} else {
		const spacing = /(\d+(?:\.\d+)?)\s*倍/.exec(text);
		if (spacing) {
			style.lineSpacing = Number.parseFloat(spacing[1]!);
			applied.push(`${spacing[1]} line spacing`);
		}
	}
	const marginMatch = /(?:页边距|margin[s]?)[^0-9]*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|in|inch|英寸)/i.exec(text);
	if (marginMatch) {
		const value = Number.parseFloat(marginMatch[1]!);
		const unit = marginMatch[2]!.toLowerCase();
		const mm =
			unit === "cm" || unit === "厘米"
				? value * 10
				: unit === "in" || unit === "inch" || unit === "英寸"
					? value * 25.4
					: value;
		style.margins = { top: mm, right: mm, bottom: mm, left: mm };
		applied.push(`margins ${mm}mm`);
	}
	if (/宋体|simsun|times|serif/.test(lower)) {
		style.fontFamily = "serif";
		applied.push("serif font");
	} else if (/黑体|微软雅黑|arial|sans/.test(lower)) {
		style.fontFamily = "sans";
		applied.push("sans font");
	}
	if (/无页码|不要页码|no page numbers/.test(lower)) {
		style.pageNumbers = false;
		applied.push("no page numbers");
	} else if (/页码|page numbers/.test(lower)) {
		style.pageNumbers = true;
		applied.push("page numbers");
	}
	if (/不编号|无编号|no numbering/.test(lower)) {
		style.headingNumbering = false;
		applied.push("no heading numbering");
	} else if (/章节编号|自动编号|numbered headings/.test(lower)) {
		style.headingNumbering = true;
		applied.push("heading numbering");
	}
	if (/封面|cover page/.test(lower)) {
		style.coverPage = true;
		applied.push("cover page");
	}
	return { style, applied };
}

export function resolvePaperStyle(
	input: Static<typeof paperStyleSchema> | undefined,
	requirements: string | undefined,
): { style: PaperStyle; applied: string[] } {
	const parsed = parsePaperFormatRequirements(requirements);
	const style: PaperStyle = {
		...DEFAULTS,
		...parsed.style,
		margins: mergeMargins(DEFAULTS.margins, parsed.style.margins),
	};
	if (input) {
		style.pageSize = input.pageSize ?? style.pageSize;
		style.fontFamily = input.fontFamily ?? style.fontFamily;
		style.fontSize = input.fontSize ?? style.fontSize;
		style.lineSpacing = input.lineSpacing ?? style.lineSpacing;
		style.margins = mergeMargins(style.margins, input.margins);
		style.columns = input.columns ?? style.columns;
		style.coverPage = input.coverPage ?? style.coverPage;
		style.pageNumbers = input.pageNumbers ?? style.pageNumbers;
		style.headingNumbering = input.headingNumbering ?? style.headingNumbering;
		style.header = input.header ?? style.header;
		style.footer = input.footer ?? style.footer;
	}
	return { style, applied: parsed.applied };
}

function findPython(configured?: string): { command: string; prefixArgs: string[] } {
	const resolution = resolvePythonCommand(configured);
	if (!resolution.command) throw new Error(resolution.error);
	return resolution.command;
}

async function findRemotePython(
	workspace: ToolWorkspace,
	configured?: string,
): Promise<{ command: string; prefixArgs: string[] }> {
	const candidates = configured
		? [{ command: configured, prefixArgs: pythonPrefixArgs(configured) }]
		: [
				{ command: "python3", prefixArgs: [] },
				{ command: "python", prefixArgs: [] },
			];
	for (const candidate of candidates) {
		const result = await workspace.exec(candidate.command, [...candidate.prefixArgs, "--version"], {
			timeoutMs: 10_000,
		});
		if (result.exitCode === 0) return candidate;
	}
	throw new Error(
		configured
			? `Configured Python is not available on the remote host: ${configured}`
			: "No Python interpreter found on the remote host. Install Python 3 or run /doctor.",
	);
}

function resolveInputPath(input: string, workRoot: string, workspace?: ToolWorkspace): string {
	if (workspace?.info.kind === "ssh") return workspace.resolvePath(input);
	return isAbsolute(input) ? input : resolvePath(workRoot, input);
}

async function readTextAt(path: string, workspace?: ToolWorkspace): Promise<string> {
	return workspace ? workspace.readText(path) : readFileSync(path, "utf8");
}

async function existsAt(path: string, workspace?: ToolWorkspace): Promise<boolean> {
	return workspace ? workspace.exists(path) : existsSync(path);
}

async function writeTextAt(path: string, content: string, workspace?: ToolWorkspace): Promise<void> {
	if (workspace) {
		await workspace.mkdir(workspace.path.dirname(path));
		await workspace.writeFile(path, content);
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}

function runPython(
	command: string,
	args: string[],
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let settled = false;
		const finish = (result: { code: number | null; stdout: string; stderr: string }) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve(result);
		};
		const onAbort = () => {
			child.kill();
			finish({ code: null, stdout: "", stderr: "aborted" });
		};
		const timer = setTimeout(() => {
			child.kill();
			finish({ code: null, stdout: Buffer.concat(stdout).toString("utf8"), stderr: "timed out" });
		}, timeoutMs);
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", (error) => finish({ code: null, stdout: "", stderr: error.message }));
		child.on("close", (code) =>
			finish({
				code,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			}),
		);
	});
}

function slugify(title: string): string {
	const slug = title
		.normalize("NFKD")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return slug || `paper-${Date.now()}`;
}

function bibtexReferences(content: string): string[] {
	return parseBibtex(content).entries.map((entry) => {
		const authors = entry.fields.author ?? entry.fields.editor ?? "";
		const year = entry.fields.year ?? "";
		const title = entry.fields.title ?? "";
		const venue = entry.fields.journal ?? entry.fields.booktitle ?? entry.fields.publisher ?? "";
		const doi = entry.fields.doi ? ` doi:${entry.fields.doi}` : "";
		return [authors, `(${year}).`, `${title}.`, venue ? `${venue}.` : "", doi].filter(Boolean).join(" ");
	});
}

export function createPaperWriteToolDefinition(
	_cwd: string,
	options?: PaperWriteToolOptions,
): ToolDefinition<typeof paperWriteSchema, PaperWriteToolDetails> {
	const run = options?.run ?? runPython;
	return {
		name: "paper_write",
		label: "paper_write",
		description:
			"Typeset a Markdown manuscript into a PDF with Python and reportlab, including headings, tables, images, references, and page styles. Relative output paths resolve inside the research workspace.",
		promptSnippet: paperWriteToolSystemPromptContribution.snippet,
		promptGuidelines: [...paperWriteToolSystemPromptContribution.guidelines],
		parameters: paperWriteSchema,
		async execute(
			_toolCallId,
			params: PaperWriteToolInput,
			signal: AbortSignal | undefined,
			_onUpdate,
			ctx?: ExtensionContext,
		) {
			const settings = researchSettingsFor(options);
			const fs = researchFsFor(options, settings, ctx);
			await fs.ensureRoot();
			const toolWorkspace = ctx?.workspace;
			const remote = toolWorkspace?.info.kind === "ssh";
			const workRoot = toolWorkspace?.info.cwd ?? ctx?.cwd ?? process.cwd();
			let content = params.content ?? "";
			if (!content.trim() && params.contentFile) {
				const path = resolveInputPath(params.contentFile, workRoot, toolWorkspace);
				if (!(await existsAt(path, toolWorkspace))) throw new Error(`Markdown file not found: ${path}`);
				content = await readTextAt(path, toolWorkspace);
			}
			if (!content.trim()) throw new Error("paper_write requires content or contentFile");

			const references = [...(params.references ?? [])];
			if (params.bibtex?.trim()) references.push(...bibtexReferences(params.bibtex));
			if (params.bibtexPath?.trim()) {
				const path = resolveInputPath(params.bibtexPath, workRoot, toolWorkspace);
				if (!(await existsAt(path, toolWorkspace))) throw new Error(`BibTeX file not found: ${path}`);
				references.push(...bibtexReferences(await readTextAt(path, toolWorkspace)));
			}

			const { style, applied } = resolvePaperStyle(params.style, params.formatRequirements);
			const outputPath = params.outputPath
				? isAbsolute(params.outputPath)
					? remote
						? toolWorkspace!.resolvePath(params.outputPath)
						: params.outputPath
					: fs.resolvePath(params.outputPath)
				: fs.resolvePath(`manuscripts/${slugify(params.title)}/paper.pdf`);
			const sourcePath = `${outputPath.replace(/\.pdf$/i, "")}.md`;
			const sourceLines = [
				`# ${params.title}`,
				params.authors?.length ? params.authors.join(", ") : "",
				params.abstract ? `## Abstract\n\n${params.abstract}` : "",
				params.keywords?.length ? `**Keywords:** ${params.keywords.join(", ")}` : "",
				content.replace(/^\s+/, ""),
				references.length
					? `## References\n\n${references.map((reference, index) => `[${index + 1}] ${reference}`).join("\n\n")}`
					: "",
			].filter(Boolean);
			await writeTextAt(sourcePath, sourceLines.join("\n\n"), toolWorkspace);

			const python = remote
				? await findRemotePython(toolWorkspace!, settings.pythonPath)
				: (options?.findPython?.() ?? findPython(settings.pythonPath));
			const workDir = remote ? `${fs.root}/.tmp` : settings.workDir;
			const scriptPath = remote ? `${workDir}/paper_render.py` : join(workDir, "paper_render.py");
			const payloadPath = remote
				? `${workDir}/paper-payload-${Date.now()}.json`
				: join(workDir, `paper-payload-${Date.now()}.json`);
			if (remote) await toolWorkspace!.mkdir(workDir);
			else mkdirSync(workDir, { recursive: true });
			await writeTextAt(scriptPath, PAPER_RENDER_SCRIPT, toolWorkspace);
			await writeTextAt(
				payloadPath,
				JSON.stringify(
					{
						title: params.title,
						authors: params.authors ?? [],
						abstract: params.abstract ?? "",
						keywords: params.keywords ?? [],
						content,
						references,
						style,
						output: outputPath,
					},
					null,
					2,
				),
				toolWorkspace,
			);
			let result: { code: number | null; stdout: string; stderr: string };
			if (remote) {
				const remoteResult = await toolWorkspace!.exec(
					python.command,
					[...python.prefixArgs, scriptPath, payloadPath],
					{ cwd: fs.root, timeoutMs: 180_000, signal },
				);
				if (remoteResult.aborted) throw new Error("Operation aborted");
				result = {
					code: remoteResult.exitCode,
					stdout: remoteResult.stdout,
					stderr: remoteResult.stderr || (remoteResult.timedOut ? "timed out" : ""),
				};
			} else {
				result = await run(
					python.command,
					[...python.prefixArgs, scriptPath, payloadPath],
					fs.root,
					180_000,
					signal,
				);
			}
			if (signal?.aborted) throw new Error("Operation aborted");
			let parsed: { ok?: boolean; error?: string; pages?: number; warnings?: string[] } | undefined;
			try {
				parsed = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "") as typeof parsed;
			} catch {
				// Report stderr below.
			}
			if (result.code !== 0 || !parsed?.ok) {
				throw new Error(
					`paper_write failed: ${parsed?.error ?? result.stderr.trim() ?? `Python exited with code ${result.code ?? "unknown"}`}`,
				);
			}
			if (!(await existsAt(outputPath, toolWorkspace))) throw new Error(`PDF was not created: ${outputPath}`);
			const warnings = parsed.warnings ?? [];
			if (params.formatRequirements?.trim() && applied.length === 0) {
				warnings.push(
					"Format requirements were provided but no supported rule matched; translate them into explicit style fields.",
				);
			}
			const lines = [
				`Paper PDF: ${outputPath}`,
				`Markdown source: ${sourcePath}`,
				`Pages: ${parsed.pages ?? "?"}`,
				`Engine: Python reportlab`,
				`Style: ${style.pageSize}, ${style.fontFamily}, ${style.fontSize}pt, ${style.lineSpacing}x spacing, ${style.columns} column(s), margins ${style.margins.top}/${style.margins.right}/${style.margins.bottom}/${style.margins.left}mm`,
				applied.length ? `Applied requirements: ${applied.join(", ")}` : undefined,
				warnings.length ? `Warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : undefined,
			].filter((line): line is string => Boolean(line));
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					pdfPath: outputPath,
					sourcePath,
					pages: parsed.pages ?? 0,
					style,
					warnings,
					engine: "python-reportlab",
					appliedRequirements: applied,
				},
			};
		},
	};
}

export function createPaperWriteTool(cwd: string, options?: PaperWriteToolOptions): AgentTool<typeof paperWriteSchema> {
	return wrapToolDefinition(createPaperWriteToolDefinition(cwd, options));
}
