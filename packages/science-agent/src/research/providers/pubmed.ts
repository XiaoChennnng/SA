import { researchFetch, researchFetchJson } from "../http.ts";
import { ensurePaperId, normalizeDoi } from "../identifiers.ts";
import type { Paper, PaperProviderContext } from "../types.ts";
import { firstTag, stripXmlTags } from "./xml.ts";

interface ESearchResponse {
	esearchresult?: { idlist?: string[] };
}

function _getArticleBody(xml: string, start: number): string {
	const end = xml.indexOf("</PubmedArticle>", start);
	return end === -1 ? xml.slice(start) : xml.slice(start, end);
}

function parseArticle(article: string): Paper | undefined {
	const title = stripXmlTags(firstTag(article, "ArticleTitle") ?? "");
	if (!title) return undefined;
	const authorBlock = firstTag(article, "AuthorList") ?? "";
	const authors: string[] = [];
	for (const author of authorBlock.matchAll(/<Author(?:\s[^>]*)?>([\s\S]*?)<\/Author>/gi)) {
		const body = author[1]!;
		const collective = stripXmlTags(firstTag(body, "CollectiveName") ?? "");
		const last = stripXmlTags(firstTag(body, "LastName") ?? "");
		const first = stripXmlTags(firstTag(body, "ForeName") ?? "");
		const name = collective || [first, last].filter(Boolean).join(" ");
		if (name) authors.push(name);
	}
	const abstractParts: string[] = [];
	for (const match of article.matchAll(/<AbstractText(?:\s[^>]*)?>([\s\S]*?)<\/AbstractText>/gi)) {
		const text = stripXmlTags(match[1]!);
		if (text) abstractParts.push(text);
	}
	const journal = stripXmlTags(firstTag(article, "Title") ?? "");
	const year = Number.parseInt(firstTag(article, "Year") ?? "", 10) || undefined;
	const articleIds = firstTag(article, "ArticleIdList") ?? "";
	let doi: string | undefined;
	let pmid: string | undefined;
	for (const match of articleIds.matchAll(/<ArticleId\s+IdType="([^"]+)"[^>]*>([^<]+)<\/ArticleId>/gi)) {
		if (match[1]?.toLowerCase() === "doi") doi = normalizeDoi(stripXmlTags(match[2]!));
		if (match[1]?.toLowerCase() === "pubmed") pmid = stripXmlTags(match[2]!);
	}
	pmid ??= stripXmlTags(firstTag(article, "PMID") ?? "") || undefined;
	return ensurePaperId({
		id: "",
		title,
		authors,
		year,
		venue: journal || "PubMed",
		abstract: abstractParts.join(" ") || undefined,
		doi,
		pubmedId: pmid,
		url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined,
		sources: ["pubmed"],
	});
}

export async function searchPubmed(query: string, context: PaperProviderContext): Promise<Paper[]> {
	const searchParams = new URLSearchParams({
		db: "pubmed",
		term: query,
		retmode: "json",
		retmax: String(context.limit),
		sort: context.sort === "date" ? "pub_date" : "relevance",
		tool: "sa",
	});
	if (context.yearFrom) {
		searchParams.set("mindate", String(context.yearFrom));
		searchParams.set("maxdate", String(context.yearTo ?? new Date().getUTCFullYear()));
		searchParams.set("datetype", "pdat");
	}
	if (context.mailto) searchParams.set("email", context.mailto);
	if (context.ncbiApiKey) searchParams.set("api_key", context.ncbiApiKey);
	const searchData = await researchFetchJson<ESearchResponse>(
		`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams}`,
		{ signal: context.signal, timeoutMs: context.timeoutMs },
	);
	const ids = searchData.esearchresult?.idlist ?? [];
	if (ids.length === 0) return [];
	const fetchParams = new URLSearchParams({
		db: "pubmed",
		id: ids.join(","),
		retmode: "xml",
		rettype: "abstract",
		tool: "sa",
	});
	if (context.mailto) fetchParams.set("email", context.mailto);
	if (context.ncbiApiKey) fetchParams.set("api_key", context.ncbiApiKey);
	const { text } = await researchFetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${fetchParams}`, {
		signal: context.signal,
		timeoutMs: context.timeoutMs,
		accept: "application/xml",
	});
	const papers: Paper[] = [];
	for (const match of text.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi)) {
		const paper = parseArticle(match[1]!);
		if (paper) papers.push(paper);
	}
	const byId = new Map(papers.map((paper) => [paper.pubmedId, paper]));
	return ids
		.map((id) => byId.get(id))
		.filter((paper): paper is Paper => Boolean(paper))
		.slice(0, context.limit);
}

export function parsePubmedResponse(xml: string): Paper[] {
	const papers: Paper[] = [];
	for (const match of xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi)) {
		const paper = parseArticle(match[1]!);
		if (paper) papers.push(paper);
	}
	return papers;
}
