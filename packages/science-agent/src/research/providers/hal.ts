import { researchFetchJson } from "../http.ts";
import { ensurePaperId, normalizeDoi } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";

interface HalDoc {
	title_s?: string[];
	authFullName_s?: string[];
	abstract_s?: string[];
	doiId_s?: string;
	uri_s?: string;
	producedDateY_i?: number;
	docType_s?: string;
	publisher_s?: string;
	fileMain_s?: string;
}

interface HalResponse {
	response?: { numFound?: number; docs?: HalDoc[] };
}

function parseDoc(doc: HalDoc): Paper | undefined {
	const title = doc.title_s?.[0]?.replace(/<[^>]+>/g, "").trim();
	if (!title) return undefined;
	const doi = doc.doiId_s ? normalizeDoi(doc.doiId_s) : undefined;
	const pdfUrl = doc.fileMain_s;
	return ensurePaperId({
		id: "",
		title,
		authors: (doc.authFullName_s ?? []).map((author) => author.trim()).filter(Boolean),
		year: doc.producedDateY_i,
		venue: doc.publisher_s ?? "HAL",
		abstract: doc.abstract_s?.[0]
			?.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
		doi,
		url: doc.uri_s ?? (doi ? `https://doi.org/${doi}` : undefined),
		pdfUrl,
		openAccess: true,
		sources: ["hal"],
	});
}

export function parseHalResponse(data: HalResponse): Paper[] {
	return (data.response?.docs ?? []).map(parseDoc).filter((paper): paper is Paper => Boolean(paper));
}

/** Search HAL, the French national open archive. No key required. */
export async function searchHal(query: string, context: PaperProviderContext): Promise<Paper[]> {
	const params = new URLSearchParams({
		q: query,
		rows: String(context.limit),
		wt: "json",
		fl: "title_s,authFullName_s,abstract_s,doiId_s,uri_s,producedDateY_i,docType_s,publisher_s,fileMain_s",
	});
	if (context.yearFrom || context.yearTo) {
		params.set("fq", `producedDateY_i:[${context.yearFrom ?? 1800} TO ${context.yearTo ?? 2100}]`);
	}
	if (context.sort === "date") params.set("sort", "producedDateY_i desc");
	const data = await researchFetchJson<HalResponse>(`https://api.archives-ouvertes.fr/search/?${params}`, {
		signal: context.signal,
		// HAL is often unreachable from mainland China; fail fast instead of stalling every search.
		timeoutMs: Math.min(context.timeoutMs, 12_000),
	});
	return parseHalResponse(data).slice(0, context.limit);
}
