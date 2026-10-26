import type { ResearchSettings } from "../../research/types.ts";

export interface ResearchConfigField {
	id: string;
	label: string;
	description: string;
	settingKey: keyof ResearchSettings;
	aliases: readonly string[];
	/** Page where users can obtain or manage the API key. */
	applyUrl?: string;
	secret?: boolean;
	kind?: "text" | "number";
}

export const RESEARCH_CONFIG_FIELDS: readonly ResearchConfigField[] = [
	{
		id: "mailto",
		label: "Contact email",
		description: "Sent to OpenAlex and PubMed as their APIs request; also a polite identifier for providers.",
		settingKey: "mailto",
		aliases: ["email", "contact"],
	},
	{
		id: "s2-key",
		label: "Semantic Scholar API key",
		description: "Raises Semantic Scholar rate limits.",
		settingKey: "semanticScholarApiKey",
		aliases: ["s2", "semanticscholar", "semantic-scholar"],
		applyUrl: "https://www.semanticscholar.org/product/api#api-key-form",
		secret: true,
	},
	{
		id: "ncbi-key",
		label: "NCBI API key",
		description: "Raises PubMed rate limits.",
		settingKey: "ncbiApiKey",
		aliases: ["ncbi", "pubmed"],
		applyUrl: "https://www.ncbi.nlm.nih.gov/account/settings/",
		secret: true,
	},
	{
		id: "core-key",
		label: "CORE API key",
		description: "Free API key for CORE, an open-access repository aggregator.",
		settingKey: "coreApiKey",
		aliases: ["core"],
		applyUrl: "https://core.ac.uk/services/api",
		secret: true,
	},
	{
		id: "anysearch-key",
		label: "AnySearch API key",
		description: "Optional key for web_search and web_extract; anonymous access is rate-limited.",
		settingKey: "anySearchApiKey",
		aliases: ["anysearch", "web"],
		applyUrl: "https://www.anysearch.com/",
		secret: true,
	},
	{
		id: "wanfang-key",
		label: "Wanfang APP_KEY",
		description:
			"Wanfang open-platform APP_KEY from ai.wfdata.com; enables Chinese journal, thesis, and conference search.",
		settingKey: "wanfangAppKey",
		aliases: ["wanfang", "wf", "wfdata"],
		applyUrl: "https://ai.wfdata.com/",
		secret: true,
	},
	{
		id: "cnki-command",
		label: "CNKI command",
		description:
			"Command that searches CNKI and prints JSON. Use {query} and {limit} placeholders. CNKI has no public API, so bring your own authorized tool.",
		settingKey: "cnkiCommand",
		aliases: ["cnki", "知网"],
	},
	{
		id: "nstl-command",
		label: "NSTL command",
		description:
			"Command that queries your institution's authorized NSTL gateway and prints JSON. NSTL APIs require institutional approval.",
		settingKey: "nstlCommand",
		aliases: ["nstl"],
		applyUrl: "https://www.nstl.gov.cn/",
	},
	{
		id: "pdf-command",
		label: "PDF extractor",
		description: "pdftotext, mutool, or a Python executable with PyMuPDF. Empty means auto-detect.",
		settingKey: "pdfCommand",
		aliases: ["pdf", "pdftotext"],
	},
	{
		id: "python-path",
		label: "Python executable",
		description: "Interpreter used by python_run. Empty means auto-detect.",
		settingKey: "pythonPath",
		aliases: ["python", "py"],
	},
	{
		id: "latex-command",
		label: "LaTeX engine",
		description: "latexmk, pdflatex, xelatex, or lualatex. Empty means auto-detect.",
		settingKey: "latexCommand",
		aliases: ["latex", "tex"],
	},
	{
		id: "workspace-dir",
		label: "Research workspace",
		description: "Root for manuscripts, data, figures, and other files that research tools manage.",
		settingKey: "workspaceDir",
		aliases: ["workspace", "files"],
	},
	{
		id: "database-path",
		label: "Knowledge base path",
		description: "SQLite file for papers, notes, experiments, and citations.",
		settingKey: "databasePath",
		aliases: ["db", "database"],
	},
	{
		id: "cache-dir",
		label: "Paper cache directory",
		description: "Downloaded PDFs and extracted text.",
		settingKey: "cacheDir",
		aliases: ["cache"],
	},
	{
		id: "max-results",
		label: "Default result count",
		description: "Default number of papers per search (1-50).",
		settingKey: "maxResults",
		aliases: ["limit", "results"],
		kind: "number",
	},
];

export function findResearchConfigField(name: string): ResearchConfigField | undefined {
	const normalized = name.trim().toLowerCase();
	return RESEARCH_CONFIG_FIELDS.find(
		(field) =>
			field.id === normalized ||
			field.settingKey.toLowerCase() === normalized ||
			field.aliases.some((alias) => alias.toLowerCase() === normalized),
	);
}

export function maskSecret(value: string | undefined): string {
	if (!value) return "not set";
	if (value.length <= 8) return "set";
	return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function researchFieldValue(
	settings: ResearchSettings,
	field: ResearchConfigField,
): string | number | undefined {
	return settings[field.settingKey] as string | number | undefined;
}

export function formatResearchFieldValue(settings: ResearchSettings, field: ResearchConfigField): string {
	const value = researchFieldValue(settings, field);
	if (value === undefined || value === "") return "not set";
	if (field.secret) return maskSecret(String(value));
	return String(value);
}

export function formatResearchConfigStatus(settings: ResearchSettings): string {
	const lines = ["Research configuration", ""];
	for (const field of RESEARCH_CONFIG_FIELDS) {
		lines.push(`${field.label}: ${formatResearchFieldValue(settings, field)}`);
	}
	lines.push(
		"",
		`Enabled Chinese sources: Wanfang ${settings.wanfangAppKey ? "on" : "needs APP_KEY"}; CNKI ${
			settings.cnkiCommand ? "on" : "needs command"
		}; NSTL ${settings.nstlCommand ? "on" : "needs institutional command"}`,
		"",
		"Get API keys:",
		...RESEARCH_CONFIG_FIELDS.filter((field) => field.applyUrl).map((field) => `- ${field.label}: ${field.applyUrl}`),
		"Secrets are stored in settings.json in plain text.",
		"Set a value: /research set <field> <value>",
		"Clear a value: /research clear <field>",
	);
	return lines.join("\n");
}
