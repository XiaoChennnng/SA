import { researchFetchJson } from "../http.ts";
import { ensurePaperId, normalizeDoi } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";

interface DoajAuthor {
	name?: string;
}

interface DoajLink {
	url?: string;
	content_type?: string;
	type?: string;
}

interface DoajBibjson {
	title?: string;
	author?: DoajAuthor[];
	abstract?: string;
	journal?: { title?: string; publisher?: string };
	year?: string;
	identifier?: Array<{ id?: string; type?: string }>;
	link?: DoajLink[];
	keywords?: string[];
}

interface DoajResponse {
	total?: number;
	results?: Array<{ bibjson?: DoajBibjson }>;
}

function parseItem(item: DoajBibjson): Paper | undefined {
	const title = item.title?.replace(/<[^>]+>/g, "").trim();
	if (!title) return undefined;
	const doi = item.identifier?.find((identifier) => identifier.type?.toLowerCase() === "doi")?.id;
	const links = item.link ?? [];
	const fullText = links.find((link) => link.type?.toLowerCase() === "fulltext")?.url;
	const pdfUrl = links.find(
		(link) =>
			link.content_type?.toLowerCase() === "pdf" ||
			link.url?.toLowerCase().endsWith(".pdf") ||
			link.url?.toLowerCase().includes("/pdf"),
	)?.url;
	const authors = (item.author ?? [])
		.map((author) => author.name?.trim())
		.filter((name): name is string => Boolean(name));
	return ensurePaperId({
		id: "",
		title,
		authors,
		year: item.year ? Number.parseInt(item.year, 10) || undefined : undefined,
		venue: item.journal?.title ?? item.journal?.publisher,
		abstract: item.abstract
			?.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
		doi: doi ? normalizeDoi(doi) : undefined,
		url: fullText ?? (doi ? `https://doi.org/${normalizeDoi(doi)}` : undefined),
		pdfUrl,
		openAccess: true,
		sources: ["doaj"],
	});
}

export function parseDoajResponse(data: DoajResponse): Paper[] {
	return (data.results ?? [])
		.map((result) => (result.bibjson ? parseItem(result.bibjson) : undefined))
		.filter((paper): paper is Paper => Boolean(paper));
}

/** Search DOAJ, the directory of open-access journals. No key required. */
export async function searchDoaj(query: string, context: PaperProviderContext): Promise<Paper[]> {
	const params = new URLSearchParams({ pageSize: String(context.limit), page: "1" });
	const data = await researchFetchJson<DoajResponse>(
		`https://doaj.org/api/v2/search/articles/${encodeURIComponent(query)}?${params}`,
		{ signal: context.signal, timeoutMs: context.timeoutMs },
	);
	return parseDoajResponse(data).slice(0, context.limit);
}
