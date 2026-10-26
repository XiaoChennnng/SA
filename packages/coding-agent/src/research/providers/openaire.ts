import { researchFetchJson } from "../http.ts";
import { ensurePaperId, normalizeDoi } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";

interface OpenairePid {
	scheme?: string;
	value?: string;
}

interface OpenaireInstance {
	urls?: string[];
	accessRight?: { label?: string };
}

interface OpenaireRecord {
	id?: string;
	mainTitle?: string;
	publicationDate?: string;
	publisher?: string;
	authors?: Array<{ fullName?: string }>;
	descriptions?: unknown;
	pids?: OpenairePid[];
	container?: { name?: string };
	instances?: OpenaireInstance[];
	bestAccessRight?: { label?: string };
	isGreen?: boolean;
	indicators?: { citationImpact?: { citationCount?: number } };
}

interface OpenaireResponse {
	header?: { numFound?: number };
	results?: OpenaireRecord[];
}

function descriptionsText(value: unknown): string | undefined {
	if (!value) return undefined;
	const values = Array.isArray(value) ? value : [value];
	const texts = values
		.map((entry) => {
			if (typeof entry === "string") return entry;
			if (typeof entry === "object" && entry !== null && "value" in entry) {
				const inner = (entry as { value?: unknown }).value;
				return typeof inner === "string" ? inner : undefined;
			}
			return undefined;
		})
		.filter((text): text is string => Boolean(text));
	return texts.join(" ").replace(/\s+/g, " ").trim() || undefined;
}

function parseRecord(record: OpenaireRecord): Paper | undefined {
	const title = record.mainTitle?.replace(/<[^>]+>/g, "").trim();
	if (!title) return undefined;
	const doi = record.pids?.find((pid) => pid.scheme?.toLowerCase() === "doi")?.value;
	const pmid = record.pids?.find((pid) => pid.scheme?.toLowerCase() === "pmid")?.value;
	const authors = (record.authors ?? [])
		.map((author) => author.fullName?.trim())
		.filter((name): name is string => Boolean(name));
	const urls = (record.instances ?? []).flatMap((instance) => instance.urls ?? []);
	const pdfUrl = urls.find((url) => /\.pdf($|\?)/i.test(url));
	const openAccess =
		record.bestAccessRight?.label?.toLowerCase() === "open" ||
		(record.instances ?? []).some((instance) => instance.accessRight?.label?.toLowerCase() === "open") ||
		record.isGreen === true;
	return ensurePaperId({
		id: "",
		title,
		authors,
		year: record.publicationDate ? Number.parseInt(record.publicationDate.slice(0, 4), 10) || undefined : undefined,
		venue: record.container?.name ?? record.publisher,
		abstract: descriptionsText(record.descriptions),
		doi: doi ? normalizeDoi(doi) : undefined,
		pubmedId: pmid || undefined,
		url: doi ? `https://doi.org/${normalizeDoi(doi)}` : urls[0],
		pdfUrl,
		citationCount: record.indicators?.citationImpact?.citationCount,
		openAccess,
		sources: ["openaire"],
	});
}

export function parseOpenaireResponse(data: OpenaireResponse): Paper[] {
	return (data.results ?? []).map(parseRecord).filter((paper): paper is Paper => Boolean(paper));
}

/** Search the OpenAIRE Graph, which aggregates European open-science repositories. */
export async function searchOpenaire(query: string, context: PaperProviderContext): Promise<Paper[]> {
	const params = new URLSearchParams({
		search: query,
		type: "publication",
		pageSize: String(context.limit),
		page: "1",
	});
	if (context.sort === "citations") params.set("sortBy", "citationCount DESC");
	else if (context.sort === "date") params.set("sortBy", "publicationDate DESC");
	else params.set("sortBy", "relevance DESC");
	const data = await researchFetchJson<OpenaireResponse>(
		`https://api.openaire.eu/graph/v3/research-products?${params}`,
		{ signal: context.signal, timeoutMs: context.timeoutMs },
	);
	return parseOpenaireResponse(data).slice(0, context.limit);
}
