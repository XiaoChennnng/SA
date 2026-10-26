import { researchFetchJson } from "../http.ts";
import { ensurePaperId, normalizeDoi, parseArxivId } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";

interface SemanticScholarPaper {
	paperId?: string;
	title?: string;
	abstract?: string | null;
	year?: number | null;
	venue?: string | null;
	authors?: Array<{ name?: string }>;
	externalIds?: { DOI?: string; ArXiv?: string; PubMed?: string } | null;
	url?: string;
	openAccessPdf?: { url?: string } | null;
	citationCount?: number | null;
}

interface SemanticScholarResponse {
	data?: SemanticScholarPaper[];
}

const FIELDS = "title,abstract,year,venue,authors,externalIds,url,openAccessPdf,citationCount";

function parsePaper(paper: SemanticScholarPaper): Paper | undefined {
	if (!paper.title) return undefined;
	const doi = paper.externalIds?.DOI ? normalizeDoi(paper.externalIds.DOI) : undefined;
	const arxivId = paper.externalIds?.ArXiv ? parseArxivId(paper.externalIds.ArXiv) : undefined;
	const authors = (paper.authors ?? []).map((author) => author.name).filter((name): name is string => Boolean(name));
	return ensurePaperId({
		id: "",
		title: paper.title,
		authors,
		year: paper.year ?? undefined,
		venue: paper.venue ?? undefined,
		abstract: paper.abstract ?? undefined,
		doi,
		arxivId,
		pubmedId: paper.externalIds?.PubMed || undefined,
		url: paper.url ?? (paper.paperId ? `https://www.semanticscholar.org/paper/${paper.paperId}` : undefined),
		pdfUrl: paper.openAccessPdf?.url ?? undefined,
		citationCount: paper.citationCount ?? undefined,
		openAccess: Boolean(paper.openAccessPdf?.url),
		sources: ["semanticscholar"],
	});
}

export async function searchSemanticScholar(query: string, context: PaperProviderContext): Promise<Paper[]> {
	const params = new URLSearchParams({
		query,
		limit: String(context.limit),
		fields: FIELDS,
	});
	if (context.yearFrom || context.yearTo) {
		params.set("year", `${context.yearFrom ?? ""}-${context.yearTo ?? ""}`);
	}
	const headers: Record<string, string> = {};
	if (context.semanticScholarApiKey) headers["x-api-key"] = context.semanticScholarApiKey;
	const data = await researchFetchJson<SemanticScholarResponse>(
		`https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
		{ signal: context.signal, timeoutMs: context.timeoutMs, headers },
	);
	return (data.data ?? []).map(parsePaper).filter((paper): paper is Paper => Boolean(paper));
}

export function parseSemanticScholarResponse(data: SemanticScholarResponse): Paper[] {
	return (data.data ?? []).map(parsePaper).filter((paper): paper is Paper => Boolean(paper));
}
