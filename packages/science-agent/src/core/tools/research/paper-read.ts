import { createHash } from "node:crypto";
import { extname, join, resolve as resolvePath } from "node:path";
import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import { detectPaperReference } from "../../../research/identifiers.ts";
import { type LoadPaperOptions, loadPaperText, type PaperReadMode } from "../../../research/paper-loader.ts";
import type { PaperText } from "../../../research/types.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { formatAuthors, type ResearchToolOptions, researchSettingsFor } from "./shared.ts";

const paperReadSchema = Type.Object({
	paper: Type.String({
		minLength: 1,
		description: "DOI, arXiv ID, PubMed ID, paper URL, or path to a local PDF/text file.",
	}),
	mode: Type.Optional(
		Type.Union([Type.Literal("auto"), Type.Literal("pdf"), Type.Literal("abstract"), Type.Literal("html")], {
			description: "auto (default) uses a PDF when available and falls back to abstract or HTML.",
		}),
	),
	pageStart: Type.Optional(Type.Integer({ minimum: 1, description: "First page to return (default: 1)." })),
	pageEnd: Type.Optional(Type.Integer({ minimum: 1, description: "Last page to return." })),
	maxChars: Type.Optional(
		Type.Integer({ minimum: 500, maximum: 50_000, description: "Approximate character budget (default: 12000)." }),
	),
	force: Type.Optional(Type.Boolean({ description: "Ignore the extracted-text cache and re-read the paper." })),
});

export type PaperReadToolInput = Static<typeof paperReadSchema>;

export interface PaperReadToolDetails {
	paperId: string;
	title: string;
	totalPages: number;
	returnedPages: number[];
	totalChars: number;
	returnedChars: number;
	cached: boolean;
	pdfPath?: string;
	extractedWith?: string;
}

export interface PaperReadToolOptions extends Partial<ResearchToolOptions> {
	load?: (reference: string, options: LoadPaperOptions) => Promise<PaperText>;
}

export const paperReadToolSystemPromptContribution = {
	snippet: "Read a paper's full text or abstract by DOI, arXiv ID, URL, or local file",
	guidelines: [
		"Read before summarizing or critiquing; cite the pages you read",
		"Use pageStart/pageEnd for long papers",
	],
} as const;

const DEFAULT_MAX_CHARS = 12_000;

export function createPaperReadToolDefinition(
	_cwd: string,
	options?: PaperReadToolOptions,
): ToolDefinition<typeof paperReadSchema, PaperReadToolDetails> {
	const load = options?.load ?? loadPaperText;
	return {
		name: "paper_read",
		label: "paper_read",
		description:
			"Read a paper by DOI, arXiv ID, PMID, URL, or local file. Returns page-ranged full text, falling back to abstract or HTML when no PDF is available.",
		promptSnippet: paperReadToolSystemPromptContribution.snippet,
		promptGuidelines: [...paperReadToolSystemPromptContribution.guidelines],
		parameters: paperReadSchema,
		async execute(
			_toolCallId,
			params: PaperReadToolInput,
			signal: AbortSignal | undefined,
			_onUpdate,
			_ctx?: ExtensionContext,
		) {
			if (params.pageStart && params.pageEnd && params.pageEnd < params.pageStart) {
				throw new Error("pageEnd must be greater than or equal to pageStart");
			}
			const settings = researchSettingsFor(options);
			const detected = detectPaperReference(params.paper);
			let reference = detected.value;
			if (detected.kind === "path") {
				const workspace = _ctx?.workspace;
				if (workspace?.info.kind === "ssh") {
					const remotePath = workspace.resolvePath(detected.value);
					const stat = await workspace.stat(remotePath);
					if (stat.isDirectory()) throw new Error(`Path is a directory: ${remotePath}`);
					const extension = extname(remotePath) || ".pdf";
					const key = createHash("sha256")
						.update(`${workspace.info.display}\0${remotePath}\0${stat.size}\0${stat.mtimeMs}`)
						.digest("hex");
					const localPath = join(settings.cacheDir, "remote", `${key.slice(0, 32)}${extension}`);
					await workspace.downloadToLocal(remotePath, localPath, signal);
					reference = localPath;
				} else {
					reference = resolvePath(_ctx?.cwd ?? _cwd, detected.value);
				}
			}
			const result = await load(reference, {
				settings,
				mode: (params.mode ?? "auto") as PaperReadMode,
				force: params.force,
				signal,
			});
			const totalPages = result.pages.length;
			const startPage = Math.min(params.pageStart ?? 1, Math.max(1, totalPages));
			const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;
			const requestedEnd = params.pageEnd ? Math.min(params.pageEnd, totalPages) : totalPages;
			const included: number[] = [];
			const chunks: string[] = [];
			let chars = 0;
			for (let page = startPage; page <= requestedEnd; page += 1) {
				const pageText = result.pages[page - 1] ?? "";
				if (chars > 0 && chars + pageText.length > maxChars) break;
				included.push(page);
				chunks.push(`--- Page ${page} ---\n${pageText}`);
				chars += pageText.length;
				if (chars >= maxChars) break;
			}
			const returnedPages = included.length > 0 ? included : [startPage];
			const lastPage = returnedPages.at(-1) ?? startPage;
			const header = [
				`Title: ${result.paper.title}`,
				`Authors: ${formatAuthors(result.paper.authors)}`,
				`DOI: ${result.paper.doi ?? "-"} · arXiv: ${result.paper.arxivId ?? "-"} · PMID: ${result.paper.pubmedId ?? "-"}`,
				`Pages: ${totalPages} · characters: ${result.text.length}${result.cached ? " · cached" : ""}${result.extractedWith ? ` · extracted with ${result.extractedWith}` : ""}`,
				result.pdfPath ? `PDF: ${result.pdfPath}` : undefined,
				`Returned pages ${returnedPages[0]}-${lastPage}.`,
			]
				.filter((line): line is string => Boolean(line))
				.join("\n");
			const footer =
				lastPage < totalPages
					? `\n\n[Truncated: ${totalPages - lastPage} more page(s). Continue with pageStart=${lastPage + 1}.]`
					: "";
			return {
				content: [{ type: "text", text: `${header}\n\n${chunks.join("\n\n")}${footer}` }],
				details: {
					paperId: result.paper.id,
					title: result.paper.title,
					totalPages,
					returnedPages,
					totalChars: result.text.length,
					returnedChars: chars,
					cached: result.cached,
					pdfPath: result.pdfPath,
					extractedWith: result.extractedWith,
				},
			};
		},
	};
}

export function createPaperReadTool(cwd: string, options?: PaperReadToolOptions): AgentTool<typeof paperReadSchema> {
	return wrapToolDefinition(createPaperReadToolDefinition(cwd, options));
}
