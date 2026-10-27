import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { researchFetch, researchFetchJson } from "./http.ts";
import {
	detectPaperReference,
	ensurePaperId,
	findArxivId,
	findDoi,
	normalizeDoi,
	parseArxivId,
	parsePubmedId,
} from "./identifiers.ts";
import { downloadPdf, extractPdfText, pdfCachePath, stripHtmlToText } from "./pdf.ts";
import { lookupPaper } from "./providers/index.ts";
import type { Paper, PaperProviderContext, PaperText, ResearchSettings } from "./types.ts";

export type PaperReadMode = "auto" | "pdf" | "abstract" | "html";

interface CachedPaperText {
	paper: Paper;
	text: string;
	pages: string[];
	pdfPath?: string;
	extractedWith?: string;
	fetchedAt: string;
}

export interface LoadPaperOptions {
	settings: ResearchSettings;
	mode?: PaperReadMode;
	force?: boolean;
	signal?: AbortSignal;
}

function providerContext(settings: ResearchSettings, signal?: AbortSignal): PaperProviderContext {
	return {
		limit: settings.maxResults,
		timeoutMs: settings.requestTimeoutMs,
		mailto: settings.mailto,
		semanticScholarApiKey: settings.semanticScholarApiKey,
		ncbiApiKey: settings.ncbiApiKey,
		signal,
	};
}

function cacheFile(settings: ResearchSettings, paper: Paper): string {
	const safe = paper.id.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
	return `${settings.cacheDir}/papers/${safe}.json`;
}

function readCachedText(settings: ResearchSettings, paper: Paper): PaperText | undefined {
	const path = cacheFile(settings, paper);
	if (!existsSync(path)) return undefined;
	try {
		const cached = JSON.parse(readFileSync(path, "utf8")) as CachedPaperText;
		if (!cached.text || !Array.isArray(cached.pages)) return undefined;
		return {
			paper: cached.paper ?? paper,
			text: cached.text,
			pages: cached.pages,
			pdfPath: cached.pdfPath,
			extractedWith: cached.extractedWith,
			cached: true,
		};
	} catch {
		return undefined;
	}
}

function writeCachedText(settings: ResearchSettings, text: PaperText): void {
	const path = cacheFile(settings, text.paper);
	mkdirSync(`${settings.cacheDir}/papers`, { recursive: true });
	const cached: CachedPaperText = {
		paper: text.paper,
		text: text.text,
		pages: text.pages,
		pdfPath: text.pdfPath,
		extractedWith: text.extractedWith,
		fetchedAt: new Date().toISOString(),
	};
	writeFileSync(path, JSON.stringify(cached), "utf8");
}

function localPdf(paper: Paper, settings: ResearchSettings): string {
	const path = pdfCachePath(settings.cacheDir, paper.id);
	if (existsSync(path) && statSync(path).size > 0) return path;
	return path;
}

async function findUnpaywallPdf(doi: string, options: LoadPaperOptions): Promise<string | undefined> {
	if (!options.settings.mailto) return undefined;
	try {
		const params = new URLSearchParams({ email: options.settings.mailto });
		const data = await researchFetchJson<{
			is_oa?: boolean;
			best_oa_location?: { url_for_pdf?: string | null };
			oa_locations?: Array<{ url_for_pdf?: string | null }>;
		}>(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?${params}`, {
			signal: options.signal,
			timeoutMs: options.settings.requestTimeoutMs,
		});
		if (!data.is_oa) return undefined;
		return (
			data.best_oa_location?.url_for_pdf ??
			data.oa_locations?.find((location) => location.url_for_pdf)?.url_for_pdf ??
			undefined
		);
	} catch {
		return undefined;
	}
}

async function findOpenAccessPdf(doi: string, options: LoadPaperOptions): Promise<string | undefined> {
	const unpaywall = await findUnpaywallPdf(doi, options);
	if (unpaywall) return unpaywall;
	const params = new URLSearchParams({ select: "best_oa_location,primary_location,open_access" });
	if (options.settings.mailto) params.set("mailto", options.settings.mailto);
	try {
		const data = await researchFetchJson<{
			best_oa_location?: { pdf_url?: string };
			primary_location?: { pdf_url?: string };
		}>(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}?${params}`, {
			signal: options.signal,
			timeoutMs: options.settings.requestTimeoutMs,
		});
		return data.best_oa_location?.pdf_url ?? data.primary_location?.pdf_url;
	} catch {
		return undefined;
	}
}

async function resolvePaper(
	reference: string,
	options: LoadPaperOptions,
): Promise<{ paper?: Paper; localPath?: string; htmlUrl?: string }> {
	const detected = detectPaperReference(reference);
	if (detected.kind === "path") return { localPath: detected.value };
	if (detected.kind === "doi") {
		const doi = detected.value;
		const paper = await lookupPaper({ doi }, providerContext(options.settings, options.signal));
		return { paper };
	}
	if (detected.kind === "arxiv") {
		const arxivId = parseArxivId(detected.value) ?? detected.value;
		const paper = await lookupPaper({ arxivId }, providerContext(options.settings, options.signal));
		return { paper };
	}
	if (detected.kind === "pubmed") {
		const pubmedId = parsePubmedId(detected.value) ?? detected.value;
		const paper = await lookupPaper({ pubmedId }, providerContext(options.settings, options.signal));
		return { paper };
	}
	const url = detected.value;
	const doi = findDoi(url);
	if (doi) return resolvePaper(doi, options);
	const arxivId = findArxivId(url);
	if (arxivId) return resolvePaper(`arxiv:${arxivId}`, options);
	return { htmlUrl: url };
}

async function loadRemoteText(
	paper: Paper,
	pdfUrl: string | undefined,
	options: LoadPaperOptions,
	mode: PaperReadMode,
): Promise<PaperText> {
	const settings = options.settings;
	if (mode === "abstract") {
		if (!paper.abstract) throw new Error(`No abstract is available for ${paper.title}`);
		const text = paper.abstract;
		return { paper, text, pages: [text], cached: false };
	}
	if (mode === "html" || (!pdfUrl && mode === "pdf")) {
		const url = paper.url;
		if (!url) throw new Error(`No full-text URL is available for ${paper.title}`);
		const { text: html } = await researchFetch(url, {
			signal: options.signal,
			timeoutMs: settings.requestTimeoutMs,
			accept: "text/html,application/xhtml+xml",
		});
		const text = stripHtmlToText(html);
		if (!text) throw new Error(`No readable text was found at ${url}`);
		return {
			paper,
			text,
			pages: [text],
			extractedWith: "html",
			cached: false,
		};
	}
	if (!pdfUrl) {
		if (paper.abstract) {
			return { paper, text: paper.abstract, pages: [paper.abstract], cached: false };
		}
		throw new Error(
			`No open-access PDF was found for ${paper.title}. Add the PDF path or URL, or use mode "abstract" after reading the abstract.`,
		);
	}
	const destination = localPdf(paper, settings);
	if (!existsSync(destination) || statSync(destination).size === 0) {
		await downloadPdf(pdfUrl, destination, {
			signal: options.signal,
			timeoutMs: settings.requestTimeoutMs,
		});
	}
	const extracted = await extractPdfText(destination, {
		signal: options.signal,
		command: settings.pdfCommand,
	});
	return {
		paper,
		text: extracted.text,
		pages: extracted.pages,
		pdfPath: destination,
		extractedWith: extracted.tool,
		cached: false,
	};
}

/** Resolve a paper reference and return its full text, abstract, or HTML fallback. */
export async function loadPaperText(reference: string, options: LoadPaperOptions): Promise<PaperText> {
	const mode = options.mode ?? "auto";
	const resolved = await resolvePaper(reference, options);
	if (resolved.localPath) {
		const path = resolved.localPath;
		if (!existsSync(path)) throw new Error(`File not found: ${path}`);
		if (extname(path).toLowerCase() === ".pdf") {
			const extracted = await extractPdfText(path, {
				signal: options.signal,
				command: options.settings.pdfCommand,
			});
			const paper: Paper = ensurePaperId({
				id: "",
				title: basename(path),
				authors: [],
				sources: [],
			});
			return {
				paper,
				text: extracted.text,
				pages: extracted.pages,
				pdfPath: path,
				extractedWith: extracted.tool,
				cached: false,
			};
		}
		const text = readFileSync(path, "utf8");
		return {
			paper: ensurePaperId({ id: "", title: basename(path), authors: [], sources: [] }),
			text,
			pages: text.split(/\n{3,}/),
			cached: false,
		};
	}
	if (resolved.htmlUrl && !resolved.paper) {
		const url = resolved.htmlUrl;
		const { text: html, response } = await researchFetch(url, {
			signal: options.signal,
			timeoutMs: options.settings.requestTimeoutMs,
			accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
		});
		const contentType = response.headers.get("content-type") ?? "";
		const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? basename(new URL(url).pathname);
		const paper: Paper = ensurePaperId({
			id: "",
			title,
			authors: [],
			url,
			sources: [],
			openAccess: true,
		});
		if (contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
			return loadRemoteText(paper, url, options, "pdf");
		}
		const text = stripHtmlToText(html);
		return { paper, text, pages: [text], extractedWith: "html", cached: false };
	}
	const paper = resolved.paper;
	if (!paper) throw new Error(`Could not find a paper for: ${reference}`);
	if (!options.force) {
		const cached = readCachedText(options.settings, paper);
		if (cached) return cached;
	}
	let pdfUrl = paper.pdfUrl;
	if (!pdfUrl && paper.arxivId) pdfUrl = `https://arxiv.org/pdf/${paper.arxivId}.pdf`;
	if (!pdfUrl && paper.doi) pdfUrl = await findOpenAccessPdf(paper.doi, options);
	if (!pdfUrl && paper.url?.toLowerCase().endsWith(".pdf")) pdfUrl = paper.url;
	const result = await loadRemoteText(paper, pdfUrl, options, mode);
	if (result.extractedWith === "html" && paper.abstract && mode === "auto") {
		// Prefer a real abstract over a navigation-heavy HTML page.
		if (result.text.length < paper.abstract.length * 2) {
			return { ...result, text: paper.abstract, pages: [paper.abstract], extractedWith: "abstract" };
		}
	}
	writeCachedText(options.settings, result);
	return result;
}

/** Normalize a DOI for a lookup. */
export function doiForLookup(value: string): string | undefined {
	return normalizeDoi(value);
}
