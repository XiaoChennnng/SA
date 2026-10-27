import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import type { AgentTool } from "@sa/agent-core";
import type { Static } from "typebox";
import { Type } from "typebox";
import {
	type BibEntry,
	formatBibtex,
	formatBibtexEntry,
	makeCitationKey,
	paperToBibEntry,
	parseBibtex,
	validateBibtex,
} from "../../../research/bibtex.ts";
import { detectPaperReference } from "../../../research/identifiers.ts";
import type { ResearchKnowledge } from "../../../research/knowledge.ts";
import { lookupPaper } from "../../../research/providers/index.ts";
import type { Paper, PaperProviderContext } from "../../../research/types.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchKnowledgeFor, researchSettingsFor } from "./shared.ts";

const citationSchema = Type.Object({
	action: Type.Union([
		Type.Literal("add"),
		Type.Literal("list"),
		Type.Literal("get"),
		Type.Literal("export"),
		Type.Literal("remove"),
		Type.Literal("validate"),
	]),
	identifier: Type.Optional(Type.String({ description: "DOI, arXiv ID, or PubMed ID for action=add." })),
	key: Type.Optional(Type.String({ description: "Citation key for get/remove, or a custom key for add." })),
	file: Type.Optional(
		Type.String({ description: "BibTeX file path for export (default: references.bib) or validate." }),
	),
	query: Type.Optional(Type.String({ description: "Filter list results by key, title, or author." })),
});

export type CitationToolInput = Static<typeof citationSchema>;

export interface CitationToolDetails {
	action: CitationToolInput["action"];
	citation?: BibEntry;
	citations?: BibEntry[];
	path?: string;
	problems?: string[];
}

export interface CitationToolOptions extends Partial<ResearchToolOptions> {
	lookup?: (
		reference: { doi?: string; arxivId?: string; pubmedId?: string },
		context: PaperProviderContext,
	) => Promise<Paper | undefined>;
}

export const citationToolSystemPromptContribution = {
	snippet:
		"Manage BibTeX citations in the Markdown knowledge base: import by DOI/arXiv/PMID, list, validate, and export a .bib file",
	guidelines: [
		"Use citation after reading a paper you will reference, and export BibTeX before writing related work",
		"Do not invent bibliographic entries; every citation should resolve to a DOI, arXiv ID, or PMID",
	],
} as const;

function providerContext(options: CitationToolOptions | undefined, signal?: AbortSignal): PaperProviderContext {
	const settings = researchSettingsFor(options);
	return {
		limit: settings.maxResults,
		timeoutMs: settings.requestTimeoutMs,
		mailto: settings.mailto,
		semanticScholarApiKey: settings.semanticScholarApiKey,
		ncbiApiKey: settings.ncbiApiKey,
		signal,
	};
}

function citationsFrom(knowledge: ResearchKnowledge): BibEntry[] {
	const entries: BibEntry[] = [];
	for (const section of knowledge.sections("Citation")) {
		const block = /```bibtex[^\n]*\n([\s\S]*?)\n```/.exec(section.body);
		if (!block) continue;
		entries.push(...parseBibtex(block[1]!).entries);
	}
	return entries;
}

function findCitation(knowledge: ResearchKnowledge, key: string): BibEntry | undefined {
	return citationsFrom(knowledge).find((entry) => entry.key === key);
}

function uniqueKey(base: string, knowledge: ResearchKnowledge): string {
	let key = base;
	let suffix = 0;
	while (findCitation(knowledge, key)) {
		suffix += 1;
		key = `${base}${String.fromCharCode(96 + suffix)}`;
	}
	return key;
}

function formatCitation(entry: BibEntry): string {
	return formatBibtexEntry(entry).trim();
}

export function createCitationToolDefinition(
	cwd: string,
	options?: CitationToolOptions,
): ToolDefinition<typeof citationSchema, CitationToolDetails> {
	const lookup = options?.lookup ?? lookupPaper;
	return {
		name: "citation",
		label: "citation",
		description:
			"Manage BibTeX citations stored as `## Citation:` sections in the local Markdown knowledge base. Import a citation by DOI, arXiv ID, or PubMed ID, list and filter entries, validate a .bib file, remove an entry, or export all citations to a .bib file.",
		promptSnippet: citationToolSystemPromptContribution.snippet,
		promptGuidelines: [...citationToolSystemPromptContribution.guidelines],
		parameters: citationSchema,
		async execute(
			_toolCallId,
			params: CitationToolInput,
			signal: AbortSignal | undefined,
			_onUpdate,
			ctx?: ExtensionContext,
		) {
			const knowledge = researchKnowledgeFor(options);
			const toolWorkspace = ctx?.workspace;
			const remote = toolWorkspace?.info.kind === "ssh";
			const workDir = toolWorkspace?.info.cwd ?? ctx?.cwd ?? cwd;
			if (params.action === "add") {
				if (!params.identifier?.trim()) throw new Error("citation add requires identifier");
				const detected = detectPaperReference(params.identifier);
				const reference =
					detected.kind === "doi"
						? { doi: detected.value }
						: detected.kind === "arxiv"
							? { arxivId: detected.value }
							: detected.kind === "pubmed"
								? { pubmedId: detected.value }
								: undefined;
				if (!reference) {
					throw new Error("citation add accepts a DOI, arXiv ID, or PubMed ID");
				}
				const paper = await lookup(reference, providerContext(options, signal));
				if (!paper) throw new Error(`Could not resolve metadata for ${params.identifier}`);
				const baseKey = params.key?.trim() || makeCitationKey(paper);
				const key = uniqueKey(baseKey, knowledge);
				const entry = paperToBibEntry(paper, key);
				knowledge.append(`Citation: ${key}`, `\`\`\`bibtex\n${formatCitation(entry)}\n\`\`\``);
				return {
					content: [{ type: "text", text: `Added citation to ${knowledge.path}.\n\n${formatCitation(entry)}` }],
					details: { action: "add", citation: entry, path: knowledge.path },
				};
			}
			if (params.action === "get") {
				if (!params.key?.trim()) throw new Error("citation get requires key");
				const citation = findCitation(knowledge, params.key);
				if (!citation) throw new Error(`No citation with key ${params.key}`);
				return {
					content: [{ type: "text", text: formatCitation(citation) }],
					details: { action: "get", citation },
				};
			}
			if (params.action === "remove") {
				if (!params.key?.trim()) throw new Error("citation remove requires key");
				const removed = knowledge.removeSection(`Citation: ${params.key}`);
				return {
					content: [
						{
							type: "text",
							text: removed ? `Removed citation ${params.key}.` : `No citation with key ${params.key}.`,
						},
					],
					details: { action: "remove" },
				};
			}
			if (params.action === "export") {
				const citations = citationsFrom(knowledge);
				const file = params.file ?? "references.bib";
				const path = remote ? toolWorkspace!.resolvePath(file) : resolvePath(workDir, file);
				const content = formatBibtex(citations);
				if (remote) {
					await toolWorkspace!.mkdir(toolWorkspace!.path.dirname(path));
					await toolWorkspace!.writeFile(path, content);
				} else {
					mkdirSync(dirname(path), { recursive: true });
					writeFileSync(path, content, "utf8");
				}
				return {
					content: [
						{
							type: "text",
							text: `Exported ${citations.length} citation(s) to ${path}.`,
						},
					],
					details: { action: "export", citations, path },
				};
			}
			if (params.action === "validate") {
				if (!params.file?.trim()) throw new Error("citation validate requires file");
				const path = remote ? toolWorkspace!.resolvePath(params.file) : resolvePath(workDir, params.file);
				const fileExists = remote ? await toolWorkspace!.exists(path) : existsSync(path);
				if (!fileExists) throw new Error(`File not found: ${path}`);
				const parsed = parseBibtex(remote ? await toolWorkspace!.readText(path) : readFileSync(path, "utf8"));
				const problems = validateBibtex(parsed);
				const summary =
					problems.length === 0
						? `Validated ${parsed.entries.length} BibTeX entries in ${path}: no problems found.`
						: `Validated ${parsed.entries.length} BibTeX entries in ${path}; ${problems.length} problem(s):\n${problems.map((problem) => `- ${problem}`).join("\n")}`;
				return {
					content: [{ type: "text", text: summary }],
					details: { action: "validate", path, problems },
				};
			}
			const query = params.query?.trim().toLowerCase();
			let citations = citationsFrom(knowledge);
			if (query) {
				citations = citations.filter((citation) => {
					const haystack = `${citation.key} ${Object.values(citation.fields).join(" ")}`.toLowerCase();
					return haystack.includes(query);
				});
			}
			const text =
				citations.length === 0
					? query
						? `No citations matched "${params.query}".`
						: "No citations stored yet."
					: citations.map(formatCitation).join("\n\n");
			return {
				content: [{ type: "text", text }],
				details: { action: "list", citations },
			};
		},
	};
}

export function createCitationTool(cwd: string, options?: CitationToolOptions): AgentTool<typeof citationSchema> {
	return wrapToolDefinition(createCitationToolDefinition(cwd, options));
}
