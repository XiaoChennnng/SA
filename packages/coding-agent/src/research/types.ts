// Shared types for SA's research tools.

export type PaperSource =
	| "arxiv"
	| "openalex"
	| "semanticscholar"
	| "crossref"
	| "pubmed"
	| "europepmc"
	| "openaire"
	| "doaj"
	| "core"
	| "hal"
	| "wanfang"
	| "cnki"
	| "nstl";

export const ALL_PAPER_SOURCES: readonly PaperSource[] = [
	"openalex",
	"semanticscholar",
	"crossref",
	"arxiv",
	"pubmed",
	"europepmc",
	"openaire",
	"doaj",
	"core",
	"hal",
	"wanfang",
	"cnki",
	"nstl",
];

/** Sources queried when the caller does not name any and the source is configured. */
export const DEFAULT_PAPER_SOURCES: readonly PaperSource[] = [
	"openalex",
	"semanticscholar",
	"crossref",
	"arxiv",
	"pubmed",
	"europepmc",
	"openaire",
	"doaj",
	"hal",
];

export interface Paper {
	/** Stable internal id: `doi:<doi>`, `arxiv:<id>`, `pmid:<id>`, or a title hash. */
	id: string;
	title: string;
	authors: string[];
	year?: number;
	venue?: string;
	abstract?: string;
	doi?: string;
	arxivId?: string;
	pubmedId?: string;
	url?: string;
	pdfUrl?: string;
	citationCount?: number;
	openAccess?: boolean;
	/** Sources that returned or were merged into this paper. */
	sources: PaperSource[];
}

export interface PaperSearchQuery {
	query: string;
	sources?: PaperSource[];
	limit?: number;
	yearFrom?: number;
	yearTo?: number;
	sort?: "relevance" | "citations" | "date";
}

export interface PaperSearchResult {
	papers: Paper[];
	errors: Array<{ source: PaperSource; message: string }>;
}

export interface PaperProviderContext {
	signal?: AbortSignal;
	limit: number;
	timeoutMs: number;
	mailto?: string;
	semanticScholarApiKey?: string;
	ncbiApiKey?: string;
	coreApiKey?: string;
	wanfangAppKey?: string;
	cnkiCommand?: string;
	nstlCommand?: string;
	yearFrom?: number;
	yearTo?: number;
	sort?: PaperSearchQuery["sort"];
}

export interface PaperText {
	paper: Paper;
	text: string;
	pages: string[];
	pdfPath?: string;
	extractedWith?: string;
	cached: boolean;
}

export interface ResearchNote {
	id: string;
	kind: "note" | "summary" | "quote" | "idea" | "todo";
	paperId?: string;
	title: string;
	content: string;
	tags: string[];
	createdAt: string;
	updatedAt: string;
}

export interface ExperimentRun {
	id: string;
	name: string;
	hypothesis?: string;
	config: Record<string, unknown>;
	metrics: Record<string, unknown>;
	artifacts: string[];
	status: "planned" | "running" | "completed" | "failed";
	notes?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CitationRecord {
	key: string;
	type: string;
	paperId?: string;
	fields: Record<string, string>;
	createdAt: string;
	updatedAt: string;
}

export interface ResearchSettings {
	/** Contact address sent to OpenAlex and PubMed; recommended by both APIs. */
	mailto?: string;
	semanticScholarApiKey?: string;
	ncbiApiKey?: string;
	/** CORE API key (https://core.ac.uk/services/api). */
	coreApiKey?: string;
	/** AnySearch API key for web_search/web_extract. Anonymous access is rate-limited. */
	anySearchApiKey?: string;
	/** Wanfang open-platform APP_KEY (https://ai.wfdata.com). */
	wanfangAppKey?: string;
	/** Command that searches CNKI and prints JSON. Placeholders: {query}, {limit}. */
	cnkiCommand?: string;
	/** Command that searches NSTL through an institutional gateway and prints JSON. */
	nstlCommand?: string;
	/** Absolute or `~` path of the SQLite database. */
	databasePath: string;
	/** Directory for downloaded PDFs and extracted text. */
	cacheDir: string;
	/** Executable or mode used to extract PDF text. */
	pdfCommand?: string;
	/** Python executable for `python_run`. */
	pythonPath?: string;
	/** LaTeX engine or executable for `latex_build`. */
	latexCommand?: string;
	maxResults: number;
	requestTimeoutMs: number;
	/** Directory for temporary scripts and build output. */
	workDir: string;
}
