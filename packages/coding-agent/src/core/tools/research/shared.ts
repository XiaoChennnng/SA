import { resolveResearchSettings } from "../../../research/settings.ts";
import { getResearchStore, type ResearchStore } from "../../../research/store.ts";
import type { Paper, ResearchSettings } from "../../../research/types.ts";

export interface ResearchToolOptions {
	settings?: ResearchSettings;
	/** Resolve settings at execution time so /research changes apply without a reload. */
	getSettings?: () => ResearchSettings;
	store?: ResearchStore;
}

export function researchSettingsFor(options?: Partial<ResearchToolOptions>): ResearchSettings {
	return options?.getSettings?.() ?? options?.settings ?? resolveResearchSettings();
}

export function researchStoreFor(options?: Partial<ResearchToolOptions>, settings?: ResearchSettings): ResearchStore {
	return options?.store ?? getResearchStore((settings ?? researchSettingsFor(options)).databasePath);
}

export function formatAuthors(authors: string[], max = 4): string {
	if (authors.length === 0) return "unknown authors";
	if (authors.length <= max) return authors.join(", ");
	return `${authors.slice(0, max).join(", ")} et al.`;
}

export function truncateText(text: string | undefined, max: number): string | undefined {
	if (!text) return undefined;
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= max) return collapsed;
	return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/** Compact, model-readable rendering of one paper. */
export function formatPaper(paper: Paper, index: number, abstractChars = 700): string {
	const lines = [`${index + 1}. ${paper.title}`, `   Authors: ${formatAuthors(paper.authors)}`];
	const meta = [paper.year ? String(paper.year) : undefined, paper.venue].filter(Boolean).join(" · ");
	if (meta) lines.push(`   ${meta}${paper.citationCount !== undefined ? ` · ${paper.citationCount} citations` : ""}`);
	const ids = [
		paper.doi ? `DOI: ${paper.doi}` : undefined,
		paper.arxivId ? `arXiv: ${paper.arxivId}` : undefined,
		paper.pubmedId ? `PMID: ${paper.pubmedId}` : undefined,
	].filter(Boolean);
	if (ids.length > 0) lines.push(`   ${ids.join(" · ")}`);
	if (paper.pdfUrl) lines.push(`   Open access PDF: ${paper.pdfUrl}`);
	else if (paper.url) lines.push(`   URL: ${paper.url}`);
	const abstract = truncateText(paper.abstract, abstractChars);
	if (abstract) lines.push(`   Abstract: ${abstract}`);
	lines.push(`   ID: ${paper.id}`);
	return lines.join("\n");
}

export function formatPaperDetail(paper: Paper, abstractChars = 2000): string {
	const lines = [
		`Title: ${paper.title}`,
		`Authors: ${paper.authors.join(", ") || "unknown"}`,
		`Year: ${paper.year ?? "unknown"}`,
		`Venue: ${paper.venue ?? "unknown"}`,
		`DOI: ${paper.doi ?? "-"}`,
		`arXiv: ${paper.arxivId ?? "-"}`,
		`PMID: ${paper.pubmedId ?? "-"}`,
		`Citations: ${paper.citationCount ?? "-"}`,
		`Open access: ${paper.openAccess ? "yes" : "no"}`,
		`URL: ${paper.url ?? "-"}`,
		`PDF: ${paper.pdfUrl ?? "-"}`,
		`Sources: ${paper.sources.join(", ") || "-"}`,
		`ID: ${paper.id}`,
	];
	const abstract = truncateText(paper.abstract, abstractChars);
	if (abstract) lines.push(`\nAbstract:\n${abstract}`);
	return lines.join("\n");
}
