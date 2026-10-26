import { createHash } from "node:crypto";
import type { Paper } from "./types.ts";

/** Strip a DOI URL prefix or `doi:` label and return a normalized DOI. */
export function normalizeDoi(value: string): string | undefined {
	const trimmed = value.trim();
	const match = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+)$/i.exec(trimmed);
	if (!match) return undefined;
	return decodeURIComponent(match[1]!)
		.replace(/[.,;]+$/, "")
		.toLowerCase();
}

/** Parse an arXiv id from `2401.12345`, `arXiv:2401.12345v2`, or an abs/pdf URL. */
export function parseArxivId(value: string): string | undefined {
	const trimmed = value.trim();
	const match =
		/^(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)?((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(?:v\d+)?(?:\.pdf)?$/i.exec(
			trimmed,
		);
	return match ? match[1]! : undefined;
}

/** Parse a PubMed id from `PMID: 12345` or a PubMed URL. */
export function parsePubmedId(value: string): string | undefined {
	const trimmed = value.trim();
	const match = /^(?:pmid:\s*|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)?(\d{1,9})\/?$/i.exec(trimmed);
	return match ? match[1]! : undefined;
}

export function paperIdFromParts(parts: { doi?: string; arxivId?: string; pubmedId?: string; title?: string }): string {
	if (parts.doi) return `doi:${parts.doi.toLowerCase()}`;
	if (parts.arxivId) return `arxiv:${parts.arxivId.replace(/v\d+$/, "")}`;
	if (parts.pubmedId) return `pmid:${parts.pubmedId}`;
	const title = parts.title?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
	return `title:${createHash("sha1").update(title).digest("hex").slice(0, 16)}`;
}

export function ensurePaperId(paper: Paper): Paper {
	if (paper.id) return paper;
	return {
		...paper,
		id: paperIdFromParts({
			doi: paper.doi,
			arxivId: paper.arxivId,
			pubmedId: paper.pubmedId,
			title: paper.title,
		}),
	};
}

/** Identify a free-form paper reference: DOI, arXiv id, PMID, URL, or local path. */
export function detectPaperReference(value: string): {
	kind: "doi" | "arxiv" | "pubmed" | "url" | "path";
	value: string;
} {
	const doi = normalizeDoi(value);
	if (doi) return { kind: "doi", value: doi };
	const arxiv = parseArxivId(value);
	if (arxiv) return { kind: "arxiv", value: arxiv };
	const pubmed = parsePubmedId(value);
	if (pubmed) return { kind: "pubmed", value: pubmed };
	if (/^https?:\/\//i.test(value.trim())) return { kind: "url", value: value.trim() };
	return { kind: "path", value: value.trim() };
}

/** Extract a DOI from arbitrary text, such as a Crossref URL or PDF metadata line. */
export function findDoi(text: string): string | undefined {
	const match = /10\.\d{4,9}\/[^\s"'<>]+/i.exec(text);
	return match ? normalizeDoi(match[0]) : undefined;
}

/** Extract an arXiv id from arbitrary text. */
export function findArxivId(text: string): string | undefined {
	const match = /(?:arxiv:\s*)((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(?:v\d+)?/i.exec(text);
	return match ? match[1]! : undefined;
}
