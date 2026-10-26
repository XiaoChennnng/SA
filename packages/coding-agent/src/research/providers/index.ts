import { researchFetch, researchFetchJson } from "../http.ts";
import { ensurePaperId, normalizeDoi, parseArxivId, parsePubmedId } from "../identifiers.ts";
import {
	DEFAULT_PAPER_SOURCES,
	type Paper,
	type PaperProviderContext,
	type PaperSearchQuery,
	type PaperSearchResult,
	type PaperSource,
} from "../types.ts";
import { parseArxivFeed, searchArxiv } from "./arxiv.ts";
import { normalizeCnkiOutput, searchCnki } from "./cnki.ts";
import { parseCoreResponse, searchCore } from "./core.ts";
import { parseCrossrefResponse, searchCrossref } from "./crossref.ts";
import { parseDoajResponse, searchDoaj } from "./doaj.ts";
import { parseEuropePmcResponse, searchEuropePmc } from "./europepmc.ts";
import { parseHalResponse, searchHal } from "./hal.ts";
import { searchNstl } from "./nstl.ts";
import { parseOpenaireResponse, searchOpenaire } from "./openaire.ts";
import { parseOpenAlexResponse, searchOpenAlex } from "./openalex.ts";
import { parsePubmedResponse, searchPubmed } from "./pubmed.ts";
import { parseSemanticScholarResponse, searchSemanticScholar } from "./semanticscholar.ts";
import { parseWanfangResponse, searchWanfang } from "./wanfang.ts";

type SearchFunction = (query: string, context: PaperProviderContext) => Promise<Paper[]>;

const SEARCHERS: Record<PaperSource, SearchFunction> = {
	arxiv: searchArxiv,
	openalex: searchOpenAlex,
	semanticscholar: searchSemanticScholar,
	crossref: searchCrossref,
	pubmed: searchPubmed,
	europepmc: searchEuropePmc,
	openaire: searchOpenaire,
	doaj: searchDoaj,
	core: searchCore,
	hal: searchHal,
	wanfang: searchWanfang,
	cnki: searchCnki,
	nstl: searchNstl,
};

function mergeKey(paper: Paper): string {
	return (
		(paper.doi && `doi:${paper.doi.toLowerCase()}`) ||
		(paper.arxivId && `arxiv:${paper.arxivId.replace(/v\d+$/, "")}`) ||
		(paper.pubmedId && `pmid:${paper.pubmedId}`) ||
		`title:${paper.title
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, " ")
			.trim()}`
	);
}

function mergePapers(papers: Paper[]): Paper[] {
	const merged = new Map<string, Paper>();
	for (const paper of papers) {
		const key = mergeKey(paper);
		const existing = merged.get(key);
		if (!existing) {
			merged.set(key, { ...paper, sources: [...new Set(paper.sources)] });
			continue;
		}
		existing.title ||= paper.title;
		existing.authors = existing.authors.length >= paper.authors.length ? existing.authors : paper.authors;
		existing.year ??= paper.year;
		existing.venue ??= paper.venue;
		if (!existing.abstract || (paper.abstract?.length ?? 0) > existing.abstract.length) {
			existing.abstract = paper.abstract ?? existing.abstract;
		}
		existing.doi ??= paper.doi;
		existing.arxivId ??= paper.arxivId;
		existing.pubmedId ??= paper.pubmedId;
		existing.url ??= paper.url;
		existing.pdfUrl ??= paper.pdfUrl;
		existing.citationCount = Math.max(existing.citationCount ?? 0, paper.citationCount ?? 0) || undefined;
		existing.openAccess = Boolean(existing.openAccess || paper.openAccess);
		existing.sources = [...new Set([...existing.sources, ...paper.sources])];
	}
	return [...merged.values()];
}

function sortPapers(papers: Paper[], sort: PaperSearchQuery["sort"]): Paper[] {
	if (sort === "citations") {
		return [...papers].sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0));
	}
	if (sort === "date") {
		return [...papers].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
	}
	return papers;
}

/** Search every requested source in parallel, tolerate per-source failures, and deduplicate. */
export async function searchPapers(
	query: PaperSearchQuery,
	context: Omit<PaperProviderContext, "limit"> & { limit?: number },
): Promise<PaperSearchResult> {
	const limit = query.limit ?? context.limit ?? 10;
	const configuredSources: PaperSource[] = [
		...DEFAULT_PAPER_SOURCES,
		...(context.coreApiKey ? (["core"] as const) : []),
		...(context.wanfangAppKey ? (["wanfang"] as const) : []),
		...(context.cnkiCommand ? (["cnki"] as const) : []),
		...(context.nstlCommand ? (["nstl"] as const) : []),
	];
	const sources = query.sources?.length ? query.sources : configuredSources;
	const providerContext: PaperProviderContext = {
		...context,
		limit,
		yearFrom: query.yearFrom,
		yearTo: query.yearTo,
		sort: query.sort,
	};
	const settled = await Promise.all(
		sources.map(async (source) => {
			try {
				const papers = await SEARCHERS[source](query.query, providerContext);
				return { source, papers, error: undefined };
			} catch (error) {
				return {
					source,
					papers: [] as Paper[],
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}),
	);
	const papers = sortPapers(mergePapers(settled.flatMap((result) => result.papers)), query.sort).slice(0, limit);
	return {
		papers,
		errors: settled
			.filter((result): result is typeof result & { error: string } => result.error !== undefined)
			.map(({ source, error }) => ({ source, message: error })),
	};
}

/** Look up one paper by DOI, arXiv id, or PubMed id. */
export async function lookupPaper(
	reference: { doi?: string; arxivId?: string; pubmedId?: string },
	context: PaperProviderContext,
): Promise<Paper | undefined> {
	if (reference.doi) {
		const doi = normalizeDoi(reference.doi) ?? reference.doi;
		try {
			const data = await researchFetchJson<{ message?: unknown }>(
				`https://api.crossref.org/works/${encodeURIComponent(doi)}${context.mailto ? `?mailto=${encodeURIComponent(context.mailto)}` : ""}`,
				{
					signal: context.signal,
					timeoutMs: context.timeoutMs,
				},
			);
			const [paper] = parseCrossrefResponse({ message: { items: [data.message as never] } });
			if (paper) return paper;
		} catch {
			// Fall through to Semantic Scholar.
		}
		try {
			const data = await researchFetchJson<unknown>(
				`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=title,abstract,year,venue,authors,externalIds,url,openAccessPdf,citationCount`,
				{
					signal: context.signal,
					timeoutMs: context.timeoutMs,
					headers: context.semanticScholarApiKey ? { "x-api-key": context.semanticScholarApiKey } : {},
				},
			);
			const [paper] = parseSemanticScholarResponse({ data: [data as never] });
			if (paper) return paper;
		} catch {
			return undefined;
		}
		return undefined;
	}
	if (reference.arxivId) {
		const id = parseArxivId(reference.arxivId) ?? reference.arxivId;
		const { text } = await researchFetch(
			`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`,
			{ signal: context.signal, timeoutMs: context.timeoutMs, accept: "application/atom+xml" },
		);
		return parseArxivFeed(text, 1)[0];
	}
	if (reference.pubmedId) {
		const id = parsePubmedId(reference.pubmedId) ?? reference.pubmedId;
		const params = new URLSearchParams({ db: "pubmed", id, retmode: "xml", rettype: "abstract", tool: "sa" });
		if (context.mailto) params.set("email", context.mailto);
		if (context.ncbiApiKey) params.set("api_key", context.ncbiApiKey);
		const { text } = await researchFetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params}`, {
			signal: context.signal,
			timeoutMs: context.timeoutMs,
			accept: "application/xml",
		});
		return parsePubmedResponse(text)[0];
	}
	return undefined;
}

export {
	parseArxivFeed,
	normalizeCnkiOutput,
	parseCoreResponse,
	parseCrossrefResponse,
	parseDoajResponse,
	parseHalResponse,
	parseOpenaireResponse,
	parseEuropePmcResponse,
	parseOpenAlexResponse,
	parsePubmedResponse,
	parseSemanticScholarResponse,
	parseWanfangResponse,
};

/** Normalize a paper returned by an ad-hoc source (used by tests and extensions). */
export function normalizePaper(paper: Omit<Paper, "id" | "sources"> & Partial<Pick<Paper, "id" | "sources">>): Paper {
	return ensurePaperId({ sources: ["crossref"], ...paper, id: paper.id ?? "" });
}
