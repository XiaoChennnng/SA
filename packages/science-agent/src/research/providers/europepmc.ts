import { researchFetchJson } from "../http.ts";
import { ensurePaperId, normalizeDoi } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";

interface EuropePmcFullTextUrl {
	availabilityCode?: string;
	documentStyle?: string;
	site?: string;
	url?: string;
}

interface EuropePmcItem {
	id?: string;
	source?: string;
	pmid?: string;
	pmcid?: string;
	doi?: string;
	title?: string;
	authorString?: string;
	journalInfo?: { journal?: { title?: string } };
	pubYear?: string;
	abstractText?: string;
	citedByCount?: number;
	isOpenAccess?: string;
	fullTextUrlList?: { fullTextUrl?: EuropePmcFullTextUrl[] };
}

interface EuropePmcResponse {
	hitCount?: number;
	errCode?: number;
	errMsg?: string;
	resultList?: { result?: EuropePmcItem[] };
}

function pdfUrlFrom(item: EuropePmcItem): string | undefined {
	const urls = item.fullTextUrlList?.fullTextUrl ?? [];
	const pdf = urls.find(
		(entry) =>
			entry.documentStyle?.toLowerCase() === "pdf" ||
			entry.url?.toLowerCase().endsWith(".pdf") ||
			entry.url?.toLowerCase().includes("/pdf"),
	);
	return pdf?.url;
}

function parseItem(item: EuropePmcItem): Paper | undefined {
	if (!item.title) return undefined;
	const doi = item.doi ? normalizeDoi(item.doi) : undefined;
	const authors = (item.authorString ?? "")
		.split(/,\s*/)
		.map((author) => author.trim())
		.filter(Boolean);
	const year = item.pubYear ? Number.parseInt(item.pubYear, 10) || undefined : undefined;
	const sourceId = item.source && item.id ? `https://europepmc.org/article/${item.source}/${item.id}` : undefined;
	const pdfUrl = pdfUrlFrom(item);
	return ensurePaperId({
		id: "",
		title: item.title.replace(/<[^>]+>/g, "").trim(),
		authors,
		year,
		venue: item.journalInfo?.journal?.title,
		abstract: item.abstractText
			?.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
		doi,
		pubmedId: item.pmid || undefined,
		arxivId: undefined,
		url: sourceId,
		pdfUrl,
		citationCount: item.citedByCount,
		openAccess: item.isOpenAccess === "Y" || Boolean(pdfUrl),
		sources: ["europepmc"],
	});
}

export function parseEuropePmcResponse(data: EuropePmcResponse): Paper[] {
	return (data.resultList?.result ?? []).map(parseItem).filter((paper): paper is Paper => Boolean(paper));
}

/** Search Europe PMC, which covers PubMed, PMC, preprints, and patents. No key required. */
export async function searchEuropePmc(query: string, context: PaperProviderContext): Promise<Paper[]> {
	const clauses = [query];
	if (context.yearFrom || context.yearTo) {
		clauses.push(`PUB_YEAR:[${context.yearFrom ?? 1800} TO ${context.yearTo ?? 2100}]`);
	}
	const params = new URLSearchParams({
		query: clauses.join(" AND "),
		format: "json",
		resultType: "core",
		pageSize: String(context.limit),
	});
	if (context.sort === "citations") params.set("sort", "CITED desc");
	else if (context.sort === "date") params.set("sort", "P_PDATE_D desc");
	const data = await researchFetchJson<EuropePmcResponse>(
		`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`,
		{ signal: context.signal, timeoutMs: context.timeoutMs },
	);
	if (data.errCode !== undefined) {
		throw new Error(`Europe PMC error ${data.errCode}: ${data.errMsg ?? "unknown error"}`);
	}
	return parseEuropePmcResponse(data).slice(0, context.limit);
}
