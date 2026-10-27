import { researchFetchJson } from "../http.ts";
import { ensurePaperId } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";

interface WanfangDocument {
	id?: string;
	resource_type?: string;
	fields?: Record<string, unknown>;
}

interface WanfangResponse {
	success?: boolean;
	message?: string;
	data?: {
		documents?: WanfangDocument[];
		rows?: WanfangDocument[];
		numFound?: number;
		num_found?: number;
	};
	documents?: WanfangDocument[];
	num_found?: number;
}

const COLLECTIONS = ["OpenPeriodical", "OpenThesis", "OpenConference"];

function fieldValue(fields: Record<string, unknown>, ...names: string[]): string | undefined {
	for (const name of names) {
		const value = fields[name];
		if (Array.isArray(value)) {
			const first = value.find((item) => typeof item === "string" || typeof item === "number");
			if (first !== undefined) return String(first).trim() || undefined;
			continue;
		}
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number") return String(value);
	}
	return undefined;
}

function fieldValues(fields: Record<string, unknown>, ...names: string[]): string[] {
	for (const name of names) {
		const value = fields[name];
		if (Array.isArray(value)) {
			return value
				.map((item) => (typeof item === "string" || typeof item === "number" ? String(item).trim() : ""))
				.filter(Boolean);
		}
		if (typeof value === "string" && value.trim()) {
			return value
				.split(/[;；]/)
				.map((item) => item.trim())
				.filter(Boolean);
		}
	}
	return [];
}

function detailPath(resourceType: string | undefined): string {
	const type = (resourceType ?? "").toLowerCase();
	if (type.includes("thesis")) return "thesis";
	if (type.includes("conference")) return "conference";
	if (type.includes("patent")) return "patent";
	if (type.includes("standard")) return "standard";
	return "periodical";
}

function buildQuery(query: string): string {
	const trimmed = query.trim();
	if (!trimmed) return trimmed;
	if (/\b(?:AND|OR|NOT)\b/i.test(trimmed)) return trimmed;
	const terms = trimmed.split(/\s+/).filter(Boolean);
	if (terms.length <= 1) return trimmed;
	return `(${terms.map((term) => `"${term.replace(/"/g, "")}"`).join(" AND ")})`;
}

function parseDocument(document: WanfangDocument, index: number): Paper | undefined {
	const fields = document.fields ?? {};
	const title = fieldValue(fields, "Title", "title");
	if (!title) return undefined;
	const authors = fieldValues(fields, "Creator", "creator", "CreatorForSearch");
	const yearValue = fieldValue(fields, "PublishYear", "PublishDate");
	const year = yearValue ? Number.parseInt(yearValue.slice(0, 4), 10) || undefined : undefined;
	const doi = fieldValue(fields, "DOI", "Doi");
	const venue = fieldValue(fields, "PeriodicalTitle", "SourceTitle", "Publisher");
	const abstract = fieldValue(fields, "Abstract", "Summary");
	const citedValue = fieldValue(fields, "CitedCount");
	const citationCount = citedValue ? Number.parseInt(citedValue, 10) || undefined : undefined;
	const id = document.id ?? fieldValue(fields, "Id", "id") ?? `result-${index}`;
	const explicitUrl = fieldValue(fields, "URLPath", "ThirdpartyUrl");
	const url = explicitUrl?.startsWith("http")
		? explicitUrl
		: `https://d.wanfangdata.com.cn/${detailPath(document.resource_type)}/${encodeURIComponent(id)}`;
	const pdfUrl = fieldValue(fields, "PDFPath");
	return ensurePaperId({
		id: "",
		title,
		authors,
		year,
		venue,
		abstract,
		doi,
		url,
		pdfUrl: pdfUrl?.startsWith("http") ? pdfUrl : undefined,
		citationCount,
		openAccess: Boolean(pdfUrl?.startsWith("http")),
		sources: ["wanfang"],
	});
}

export function parseWanfangResponse(data: WanfangResponse): Paper[] {
	const documents = data.data?.documents ?? data.data?.rows ?? data.documents ?? [];
	return documents.map(parseDocument).filter((paper): paper is Paper => Boolean(paper));
}

/** Search the official Wanfang open platform. Requires an APP_KEY from ai.wfdata.com. */
export async function searchWanfang(query: string, context: PaperProviderContext): Promise<Paper[]> {
	if (!context.wanfangAppKey) {
		throw new Error(
			"Wanfang needs an APP_KEY. Configure it with /research or research.wanfangAppKey in settings.json.",
		);
	}
	const sort =
		context.sort === "citations"
			? { sorts: [{ by: "CitedCount", order: "DESC" }] }
			: context.sort === "date"
				? { sorts: [{ by: "PublishYear", order: "DESC" }] }
				: { sort_name: "OfflineScore" };
	const body = JSON.stringify({
		collections: COLLECTIONS,
		query: buildQuery(query),
		rows: context.limit,
		start: 0,
		returned_fields: [
			"Id",
			"Title",
			"Creator",
			"Abstract",
			"PublishYear",
			"PublishDate",
			"PeriodicalTitle",
			"DOI",
			"CitedCount",
			"URLPath",
			"PDFPath",
		],
		sort,
	});
	const data = await researchFetchJson<WanfangResponse>("https://api.wfdata.com/openwanfang/getQuery", {
		method: "POST",
		body,
		signal: context.signal,
		timeoutMs: context.timeoutMs,
		headers: {
			"Content-Type": "application/json",
			"X-App-Key": context.wanfangAppKey,
		},
	});
	if (data.success === false) {
		throw new Error(data.message ?? "Wanfang API returned an error");
	}
	return parseWanfangResponse(data);
}
