import { researchFetch } from "../http.ts";
import { ensurePaperId } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";
import { allTags, firstTag, stripXmlTags } from "./xml.ts";

interface ArxivEntry {
	title?: string;
	summary?: string;
	published?: string;
	doi?: string;
	journalRef?: string;
}

function entryValue(entry: string, name: string): string | undefined {
	const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(entry);
	return match ? match[1]! : undefined;
}

function parseEntries(xml: string, limit: number): Paper[] {
	const papers: Paper[] = [];
	for (const entry of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
		if (papers.length >= limit) break;
		const body = entry[1]!;
		const idUrl = entryValue(body, "id")?.trim() ?? "";
		const arxivId = /arxiv\.org\/abs\/([^<\s]+?)(?:v\d+)?$/i.exec(idUrl)?.[1];
		const title = stripXmlTags(entryValue(body, "title") ?? "");
		if (!title) continue;
		const summary = stripXmlTags(entryValue(body, "summary") ?? "");
		const authors = allTags(body, "name")
			.map((name) => stripXmlTags(name))
			.filter(Boolean);
		const published = entryValue(body, "published")?.trim();
		const year = published ? Number.parseInt(published.slice(0, 4), 10) : undefined;
		const doi = firstTag(body, "arxiv:doi") ?? undefined;
		const journalRef = stripXmlTags(entryValue(body, "arxiv:journal_ref") ?? "") || undefined;
		const pdfHref = /<link[^>]*title="pdf"[^>]*href="([^"]+)"/i.exec(body)?.[1];
		const paper: Paper = {
			id: "",
			title,
			authors,
			year,
			venue: journalRef ?? "arXiv",
			abstract: summary || undefined,
			doi,
			arxivId,
			url: idUrl || undefined,
			pdfUrl: pdfHref || (arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : undefined),
			openAccess: true,
			sources: ["arxiv"],
		};
		papers.push(ensurePaperId(paper));
	}
	return papers;
}

export async function searchArxiv(query: string, context: PaperProviderContext): Promise<Paper[]> {
	const terms = query
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 8)
		.map((term) => `all:${term.replace(/[^\p{L}\p{N}.-]/gu, "")}`)
		.filter((term) => term !== "all:");
	const search = terms.length > 0 ? terms.join("+AND+") : encodeURIComponent(query);
	const sortBy = context.sort === "date" ? "submittedDate" : "relevance";
	const url = `https://export.arxiv.org/api/query?search_query=${search}&start=0&max_results=${context.limit}&sortBy=${sortBy}&sortOrder=descending`;
	const { text } = await researchFetch(url, {
		signal: context.signal,
		timeoutMs: context.timeoutMs,
		accept: "application/atom+xml",
	});
	return parseEntries(text, context.limit);
}

export function parseArxivFeed(xml: string, limit: number): Paper[] {
	return parseEntries(xml, limit);
}

export type { ArxivEntry };
