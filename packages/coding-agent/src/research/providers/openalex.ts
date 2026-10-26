import { researchFetchJson } from "../http.ts";
import { ensurePaperId, normalizeDoi } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";
import { stripMarkup } from "./xml.ts";

interface OpenAlexWork {
	id?: string;
	doi?: string;
	title?: string;
	display_name?: string;
	publication_year?: number;
	authorships?: Array<{ author?: { display_name?: string } }>;
	primary_location?: {
		source?: { display_name?: string };
		pdf_url?: string;
		landing_page_url?: string;
	};
	best_oa_location?: { pdf_url?: string; landing_page_url?: string };
	locations?: Array<{ pdf_url?: string }>;
	abstract_inverted_index?: Record<string, number[]>;
	cited_by_count?: number;
	open_access?: { is_oa?: boolean };
	ids?: { pmid?: string };
}

interface OpenAlexResponse {
	results?: OpenAlexWork[];
}

function reconstructAbstract(index: Record<string, number[]> | undefined): string | undefined {
	if (!index) return undefined;
	const words: Array<[number, string]> = [];
	for (const [word, positions] of Object.entries(index)) {
		for (const position of positions) words.push([position, word]);
	}
	words.sort((a, b) => a[0] - b[0]);
	const text = words.map(([, word]) => word).join(" ");
	return text || undefined;
}

function parseWork(work: OpenAlexWork): Paper | undefined {
	const title = stripMarkup(work.title ?? work.display_name);
	if (!title) return undefined;
	const doi = work.doi ? normalizeDoi(work.doi) : undefined;
	const pmid = work.ids?.pmid?.replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, "");
	const authors = (work.authorships ?? [])
		.map((authorship) => authorship.author?.display_name)
		.filter((name): name is string => Boolean(name));
	const pdfUrl =
		work.best_oa_location?.pdf_url ??
		work.primary_location?.pdf_url ??
		work.locations?.find((location) => location.pdf_url)?.pdf_url ??
		undefined;
	return ensurePaperId({
		id: "",
		title,
		authors,
		year: work.publication_year,
		venue: work.primary_location?.source?.display_name,
		abstract: reconstructAbstract(work.abstract_inverted_index),
		doi,
		pubmedId: pmid || undefined,
		url: work.id ?? work.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : undefined),
		pdfUrl,
		citationCount: work.cited_by_count,
		openAccess: work.open_access?.is_oa ?? Boolean(pdfUrl),
		sources: ["openalex"],
	});
}

export async function searchOpenAlex(query: string, context: PaperProviderContext): Promise<Paper[]> {
	const params = new URLSearchParams({
		search: query,
		"per-page": String(context.limit),
		page: "1",
		select:
			"id,doi,title,display_name,publication_year,authorships,primary_location,best_oa_location,locations,abstract_inverted_index,cited_by_count,open_access,ids",
	});
	const filters: string[] = ["type:article"];
	if (context.yearFrom) filters.push(`from_publication_date:${context.yearFrom}-01-01`);
	if (context.yearTo) filters.push(`to_publication_date:${context.yearTo}-12-31`);
	params.set("filter", filters.join(","));
	if (context.sort === "citations") params.set("sort", "cited_by_count:desc");
	else if (context.sort === "date") params.set("sort", "publication_date:desc");
	else params.set("sort", "relevance_score:desc");
	if (context.mailto) params.set("mailto", context.mailto);
	const data = await researchFetchJson<OpenAlexResponse>(`https://api.openalex.org/works?${params}`, {
		signal: context.signal,
		timeoutMs: context.timeoutMs,
	});
	return (data.results ?? []).map(parseWork).filter((paper): paper is Paper => Boolean(paper));
}

export function parseOpenAlexResponse(data: OpenAlexResponse): Paper[] {
	return (data.results ?? []).map(parseWork).filter((paper): paper is Paper => Boolean(paper));
}
