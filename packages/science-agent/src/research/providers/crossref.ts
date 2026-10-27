import { researchFetchJson } from "../http.ts";
import { ensurePaperId, normalizeDoi } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";
import { stripMarkup } from "./xml.ts";

interface CrossrefAuthor {
	given?: string;
	family?: string;
	name?: string;
}

interface CrossrefItem {
	DOI?: string;
	title?: string[];
	author?: CrossrefAuthor[];
	issued?: { "date-parts"?: number[][] };
	"container-title"?: string[];
	abstract?: string;
	URL?: string;
	link?: Array<{ URL?: string; "content-type"?: string }>;
	"is-referenced-by-count"?: number;
	type?: string;
}

interface CrossrefResponse {
	message?: { items?: CrossrefItem[] };
}

function parseItem(item: CrossrefItem): Paper | undefined {
	const title = stripMarkup(item.title?.[0]);
	if (!title) return undefined;
	const doi = item.DOI ? normalizeDoi(item.DOI) : undefined;
	const authors = (item.author ?? [])
		.map((author) => author.name ?? [author.given, author.family].filter(Boolean).join(" "))
		.filter(Boolean);
	const pdfUrl = item.link?.find((link) => link["content-type"] === "application/pdf")?.URL;
	const year = item.issued?.["date-parts"]?.[0]?.[0];
	return ensurePaperId({
		id: "",
		title,
		authors,
		year,
		venue: item["container-title"]?.[0],
		abstract: stripMarkup(item.abstract),
		doi,
		url: item.URL ?? (doi ? `https://doi.org/${doi}` : undefined),
		pdfUrl,
		citationCount: item["is-referenced-by-count"],
		openAccess: Boolean(pdfUrl),
		sources: ["crossref"],
	});
}

export async function searchCrossref(query: string, context: PaperProviderContext): Promise<Paper[]> {
	const params = new URLSearchParams({
		"query.bibliographic": query,
		rows: String(context.limit),
	});
	const filters = ["type:journal-article"];
	if (context.yearFrom) filters.push(`from-pub-date:${context.yearFrom}-01-01`);
	if (context.yearTo) filters.push(`until-pub-date:${context.yearTo}-12-31`);
	params.set("filter", filters.join(","));
	if (context.sort === "citations") params.set("sort", "is-referenced-by-count");
	else if (context.sort === "date") params.set("sort", "published");
	if (context.mailto) params.set("mailto", context.mailto);
	const data = await researchFetchJson<CrossrefResponse>(`https://api.crossref.org/works?${params}`, {
		signal: context.signal,
		timeoutMs: context.timeoutMs,
	});
	return (data.message?.items ?? []).map(parseItem).filter((paper): paper is Paper => Boolean(paper));
}

export function parseCrossrefResponse(data: CrossrefResponse): Paper[] {
	return (data.message?.items ?? []).map(parseItem).filter((paper): paper is Paper => Boolean(paper));
}
