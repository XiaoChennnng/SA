import { researchFetchJson } from "../http.ts";
import { ensurePaperId, normalizeDoi } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";

interface CoreWork {
	id?: string | number;
	title?: string;
	abstract?: string;
	authors?: Array<{ name?: string }>;
	yearPublished?: number;
	doi?: string;
	downloadUrl?: string;
	publisher?: string;
	citationCount?: number;
	fullText?: string;
}

interface CoreResponse {
	totalHits?: number;
	results?: CoreWork[];
}

function parseWork(work: CoreWork): Paper | undefined {
	const title = work.title?.replace(/<[^>]+>/g, "").trim();
	if (!title) return undefined;
	const doi = work.doi ? normalizeDoi(work.doi) : undefined;
	const authors = (work.authors ?? [])
		.map((author) => author.name?.trim())
		.filter((name): name is string => Boolean(name));
	const pdfUrl = work.downloadUrl;
	return ensurePaperId({
		id: "",
		title,
		authors,
		year: work.yearPublished,
		venue: work.publisher,
		abstract: work.abstract
			?.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
		doi,
		url: work.id !== undefined ? `https://core.ac.uk/works/${work.id}` : pdfUrl,
		pdfUrl,
		citationCount: work.citationCount,
		openAccess: true,
		sources: ["core"],
	});
}

export function parseCoreResponse(data: CoreResponse): Paper[] {
	return (data.results ?? []).map(parseWork).filter((paper): paper is Paper => Boolean(paper));
}

/** Search CORE, an aggregator of open-access repositories. A free API key raises limits. */
export async function searchCore(query: string, context: PaperProviderContext): Promise<Paper[]> {
	const clauses = [query];
	if (context.yearFrom || context.yearTo) {
		clauses.push(`yearPublished:[${context.yearFrom ?? 1800} TO ${context.yearTo ?? 2100}]`);
	}
	const params = new URLSearchParams({ q: clauses.join(" AND "), limit: String(context.limit), offset: "0" });
	const headers: Record<string, string> = {};
	if (context.coreApiKey) headers.Authorization = `Bearer ${context.coreApiKey}`;
	const data = await researchFetchJson<CoreResponse>(`https://api.core.ac.uk/v3/search/works/?${params}`, {
		signal: context.signal,
		timeoutMs: context.timeoutMs,
		headers,
	});
	return parseCoreResponse(data).slice(0, context.limit);
}
