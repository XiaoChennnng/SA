import { VERSION } from "../config.ts";
import { getSaUserAgent } from "../utils/sa-user-agent.ts";

export interface ResearchHttpOptions {
	signal?: AbortSignal;
	headers?: Record<string, string>;
	timeoutMs?: number;
	retries?: number;
	accept?: string;
	method?: "GET" | "POST";
	body?: string;
}

export class ResearchHttpError extends Error {
	readonly status: number;
	readonly body: string;

	constructor(url: string, status: number, body: string) {
		super(`Request to ${url} failed with HTTP ${status}${body ? `: ${body.slice(0, 300)}` : ""}`);
		this.name = "ResearchHttpError";
		this.status = status;
		this.body = body;
	}
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Operation aborted"));
			return;
		}
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error("Operation aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export function researchRequestHeaders(options: ResearchHttpOptions = {}): Record<string, string> {
	return {
		"User-Agent": getSaUserAgent(VERSION),
		Accept: options.accept ?? "application/json",
		...(options.headers ?? {}),
	};
}

interface PendingResponse {
	response: Response;
	url: string;
	cleanup: () => void;
}

async function researchRequest(url: string, options: ResearchHttpOptions): Promise<PendingResponse> {
	const retries = options.retries ?? DEFAULT_RETRIES;
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt += 1) {
		const timeoutController = new AbortController();
		const timeout = setTimeout(() => timeoutController.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		const cleanup = () => clearTimeout(timeout);
		const signal = options.signal
			? AbortSignal.any([options.signal, timeoutController.signal])
			: timeoutController.signal;
		try {
			const response = await fetch(url, {
				method: options.method ?? "GET",
				body: options.body,
				headers: researchRequestHeaders(options),
				signal,
				redirect: "follow",
			});
			if (!response.ok) {
				const text = await response.text().catch(() => "");
				cleanup();
				if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
					const retryAfter = Number(response.headers.get("retry-after"));
					const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
					await sleep(delay, options.signal);
					continue;
				}
				throw new ResearchHttpError(url, response.status, text);
			}
			return { response, url: response.url || url, cleanup };
		} catch (error) {
			cleanup();
			lastError = error;
			if (options.signal?.aborted || error instanceof ResearchHttpError) throw error;
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error(`Request to ${url} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
			}
			if (attempt >= retries) throw error;
			await sleep(500 * 2 ** attempt, options.signal);
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`Request to ${url} failed`);
}

/** Fetch a URL with SA's user agent, a timeout, and retries for transient failures. */
export async function researchFetch(
	url: string,
	options: ResearchHttpOptions = {},
): Promise<{ response: Response; text: string; url: string }> {
	const pending = await researchRequest(url, options);
	try {
		const text = await pending.response.text();
		return { response: pending.response, text, url: pending.url };
	} finally {
		pending.cleanup();
	}
}

export async function researchFetchJson<T>(url: string, options: ResearchHttpOptions = {}): Promise<T> {
	const { text, url: finalUrl } = await researchFetch(url, {
		...options,
		accept: options.accept ?? "application/json",
	});
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`Invalid JSON from ${finalUrl}: ${text.slice(0, 200)}`);
	}
}

/** Download a binary response, enforcing a maximum size. */
export async function researchFetchBytes(
	url: string,
	options: ResearchHttpOptions & { maxBytes?: number } = {},
): Promise<{ bytes: Uint8Array; contentType: string | null; finalUrl: string }> {
	const pending = await researchRequest(url, {
		...options,
		accept: options.accept ?? "application/pdf,text/html;q=0.9,*/*;q=0.8",
	});
	try {
		const { response } = pending;
		const length = Number(response.headers.get("content-length"));
		const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
		if (Number.isFinite(length) && length > maxBytes) {
			throw new Error(`Response is too large: ${length} bytes (limit ${maxBytes})`);
		}
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > maxBytes) {
			throw new Error(`Response is too large: ${buffer.byteLength} bytes (limit ${maxBytes})`);
		}
		return {
			bytes: new Uint8Array(buffer),
			contentType: response.headers.get("content-type"),
			finalUrl: pending.url,
		};
	} finally {
		pending.cleanup();
	}
}
