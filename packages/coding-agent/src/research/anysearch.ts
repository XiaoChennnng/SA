import { researchFetchJson } from "./http.ts";

export interface AnySearchOptions {
	apiKey?: string;
	signal?: AbortSignal;
	timeoutMs: number;
}

export interface AnySearchResult {
	title: string;
	url: string;
	snippet?: string;
	content?: string;
}

export interface AnySearchSearchResponse {
	results: AnySearchResult[];
	totalResults?: number;
	searchTimeMs?: number;
	requestId?: string;
}

export interface AnySearchExtractResponse {
	url: string;
	title: string;
	content: string;
	requestId?: string;
}

export interface AnySearchDomain {
	domain: string;
	description: string;
	subDomains: Array<{
		subDomain: string;
		description: string;
		params: Record<string, { description: string; required: boolean; sortOrder?: number }>;
	}>;
}

interface Envelope<T> {
	code?: number;
	message?: string;
	request_id?: string;
	data?: T;
	error_code?: string;
}

function headers(options: AnySearchOptions): Record<string, string> {
	return {
		"Content-Type": "application/json",
		...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
	};
}

function ensureSuccess<T>(data: Envelope<T>, operation: string): T {
	if (data.code !== undefined && data.code !== 0) {
		throw new Error(
			`AnySearch ${operation} failed${data.request_id ? ` (request ${data.request_id})` : ""}: ${data.message ?? `code ${data.code}`}`,
		);
	}
	if (data.data === undefined) throw new Error(`AnySearch ${operation} returned no data`);
	return data.data;
}

export interface AnySearchSearchInput {
	query: string;
	maxResults?: number;
	zone?: "cn" | "intl";
	language?: string;
	tag?: string;
	format?: "json" | "markdown";
}

/** Search the web through AnySearch's v1 search API. The API key is optional but raises limits. */
export async function anySearchSearch(
	input: AnySearchSearchInput,
	options: AnySearchOptions,
): Promise<AnySearchSearchResponse> {
	const body = JSON.stringify({
		query: input.query,
		max_results: Math.min(10, Math.max(1, input.maxResults ?? 8)),
		...(input.zone ? { zone: input.zone } : {}),
		...(input.language ? { language: input.language } : {}),
		...(input.tag ? { tag: input.tag } : {}),
		...(input.format ? { format: input.format } : {}),
	});
	const data = await researchFetchJson<
		Envelope<{
			results?: AnySearchResult[];
			metadata?: { total_results?: number; search_time_ms?: number };
		}>
	>("https://api.anysearch.com/v1/search", {
		method: "POST",
		body,
		signal: options.signal,
		timeoutMs: options.timeoutMs,
		headers: headers(options),
	});
	const payload = ensureSuccess(data, "search");
	return {
		results: payload.results ?? [],
		totalResults: payload.metadata?.total_results,
		searchTimeMs: payload.metadata?.search_time_ms,
		requestId: data.request_id,
	};
}

/** Extract readable content from a public URL through AnySearch's v1 extract API. */
export async function anySearchExtract(url: string, options: AnySearchOptions): Promise<AnySearchExtractResponse> {
	const data = await researchFetchJson<Envelope<{ url?: string; title?: string; content?: string }>>(
		"https://api.anysearch.com/v1/extract",
		{
			method: "POST",
			body: JSON.stringify({ url }),
			signal: options.signal,
			timeoutMs: options.timeoutMs,
			headers: headers(options),
		},
	);
	const payload = ensureSuccess(data, "extract");
	return {
		url: payload.url ?? url,
		title: payload.title ?? "",
		content: payload.content ?? "",
		requestId: data.request_id,
	};
}

/** List AnySearch domains and their sub-domain parameters. Does not consume search quota. */
export async function anySearchDomains(domains: string[], options: AnySearchOptions): Promise<AnySearchDomain[]> {
	const params = new URLSearchParams();
	for (const domain of domains) params.append("domain", domain);
	const data = await researchFetchJson<
		Envelope<{
			domains?: Array<{
				domain?: string;
				description?: string;
				sub_domains?: Array<{
					sub_domain?: string;
					description?: string;
					params?: Record<string, { description?: string; required?: boolean; sort_order?: number }>;
				}>;
			}>;
		}>
	>(`https://api.anysearch.com/v1/sub-domains?${params}`, {
		signal: options.signal,
		timeoutMs: options.timeoutMs,
		headers: headers(options),
	});
	const payload = ensureSuccess(data, "sub-domains");
	return (payload.domains ?? []).map((domain) => ({
		domain: domain.domain ?? "",
		description: domain.description ?? "",
		subDomains: (domain.sub_domains ?? []).map((subDomain) => ({
			subDomain: subDomain.sub_domain ?? "",
			description: subDomain.description ?? "",
			params: Object.fromEntries(
				Object.entries(subDomain.params ?? {}).map(([name, param]) => [
					name,
					{
						description: param.description ?? "",
						required: Boolean(param.required),
						sortOrder: param.sort_order,
					},
				]),
			),
		})),
	}));
}
