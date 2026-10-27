import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { findResearchConfigField, maskSecret } from "../src/modes/interactive/research-config.ts";
import { formatBibtex, makeCitationKey, paperToBibEntry, parseBibtex, validateBibtex } from "../src/research/bibtex.ts";
import {
	detectPaperReference,
	normalizeDoi,
	paperIdFromParts,
	parseArxivId,
	parsePubmedId,
} from "../src/research/identifiers.ts";
import { ResearchKnowledge } from "../src/research/knowledge.ts";
import { parseArxivFeed } from "../src/research/providers/arxiv.ts";
import { normalizeCnkiOutput, splitCommandLine } from "../src/research/providers/cnki.ts";
import { parseCrossrefResponse } from "../src/research/providers/crossref.ts";
import { parseOpenAlexResponse } from "../src/research/providers/openalex.ts";
import { parsePubmedResponse } from "../src/research/providers/pubmed.ts";
import { parseSemanticScholarResponse } from "../src/research/providers/semanticscholar.ts";
import { parseWanfangResponse } from "../src/research/providers/wanfang.ts";
import type { Paper } from "../src/research/types.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sa-research-"));
	tempDirs.push(dir);
	return dir;
}

const PAPER: Paper = {
	id: "doi:10.1234/example",
	title: "Attention Is All You Need",
	authors: ["Ashish Vaswani", "Noam Shazeer"],
	year: 2017,
	venue: "NeurIPS",
	abstract: "The dominant sequence transduction models are based on recurrent networks.",
	doi: "10.1234/example",
	url: "https://doi.org/10.1234/example",
	openAccess: true,
	sources: ["crossref"],
};

describe("identifiers", () => {
	it("normalizes DOI, arXiv, and PubMed references", () => {
		expect(normalizeDoi("https://doi.org/10.1000/ABC.123")).toBe("10.1000/abc.123");
		expect(normalizeDoi("doi: 10.1000/xyz.")).toBe("10.1000/xyz");
		expect(parseArxivId("arXiv:2401.12345v2")).toBe("2401.12345");
		expect(parseArxivId("https://arxiv.org/pdf/math/0301234.pdf")).toBe("math/0301234");
		expect(parsePubmedId("PMID: 12345678")).toBe("12345678");
	});

	it("detects reference kinds and builds stable IDs", () => {
		expect(detectPaperReference("10.1000/xyz")).toEqual({ kind: "doi", value: "10.1000/xyz" });
		expect(detectPaperReference("2401.12345")).toEqual({ kind: "arxiv", value: "2401.12345" });
		expect(detectPaperReference("https://example.com/paper.pdf")).toEqual({
			kind: "url",
			value: "https://example.com/paper.pdf",
		});
		expect(paperIdFromParts({ doi: "10.1000/XYZ" })).toBe("doi:10.1000/xyz");
		expect(paperIdFromParts({ title: "Same Title" })).toBe(paperIdFromParts({ title: " same  title " }));
	});
});

describe("BibTeX", () => {
	it("generates, parses, and validates entries", () => {
		const entry = paperToBibEntry(PAPER, makeCitationKey(PAPER));
		const text = formatBibtex([entry]);
		const parsed = parseBibtex(text);
		expect(parsed.errors).toEqual([]);
		expect(parsed.entries).toHaveLength(1);
		expect(parsed.entries[0]!.fields.title).toBe("Attention Is All You Need");
		expect(parsed.entries[0]!.fields.doi).toBe("10.1234/example");
		expect(makeCitationKey(PAPER)).toMatch(/^vaswani2017/);
		expect(validateBibtex(parsed)).toEqual([]);
	});

	it("reports missing fields, unbalanced braces, and duplicate keys", () => {
		const text = `@article{dup, title={One}}\n@article{dup, title={Two}}`;
		const parsed = parseBibtex(text);
		const problems = validateBibtex(parsed);
		expect(problems.some((problem) => problem.includes("duplicate citation key"))).toBe(true);
		expect(problems.some((problem) => problem.includes('missing required field "author"'))).toBe(true);
		expect(validateBibtex(parseBibtex("@article{x, title={unclosed}")).length).toBeGreaterThan(0);
	});
});

describe("research knowledge", () => {
	it("does not create the file on read", () => {
		const path = join(tempDir(), "research.md");
		const knowledge = new ResearchKnowledge(path);
		try {
			expect(knowledge.read()).toBe("");
			expect(knowledge.search("anything")).toEqual([]);
			expect(knowledge.sections()).toEqual([]);
			expect(existsSync(path)).toBe(false);
		} finally {
			knowledge.close();
		}
	});

	it("appends readable sections and searches them", () => {
		const path = join(tempDir(), "research.md");
		const knowledge = new ResearchKnowledge(path);
		try {
			knowledge.append(
				"Paper: Attention",
				"- DOI: 10.1234/example\nThe dominant sequence transduction models use recurrent networks.",
			);
			knowledge.append("Note [summary]: Checkpointing", "- Tags: memory\nGradient checkpointing reduces memory.");
			knowledge.append("Experiment [completed]: tuned", '### Metrics\n\n```json\n{"accuracy": 0.85}\n```');
			const document = readFileSync(path, "utf8");
			expect(document).toContain("# Research Knowledge Base");
			expect(document).toContain("## Paper: Attention");
			expect(knowledge.search("recurrent")[0]?.heading).toBe("Paper: Attention");
			expect(knowledge.search("checkpointing")[0]?.heading).toBe("Note [summary]: Checkpointing");
			expect(knowledge.search("tuned", { prefix: "Experiment" })[0]?.heading).toBe("Experiment [completed]: tuned");
			expect(knowledge.search("tuned", { prefix: "Note" })).toEqual([]);
		} finally {
			knowledge.close();
		}
	});

	it("removes sections and tolerates CRLF files", () => {
		const path = join(tempDir(), "research.md");
		const knowledge = new ResearchKnowledge(path);
		try {
			writeFileSync(path, "# KB\r\n\r\n## Note: one\r\n\r\nfirst\r\n\r\n## Note: two\r\n\r\nsecond\r\n");
			expect(knowledge.sections()).toHaveLength(2);
			expect(knowledge.removeSection("Note: one")).toBe(true);
			const document = knowledge.read();
			expect(document).toContain("## Note: two");
			expect(document).not.toContain("## Note: one");
			expect(knowledge.removeSection("Note: missing")).toBe(false);
		} finally {
			knowledge.close();
		}
	});

	it("ignores headings inside fenced code blocks", () => {
		const path = join(tempDir(), "research.md");
		writeFileSync(path, "## Experiment: one\n\n```text\n## not a section\n```\n");
		const knowledge = new ResearchKnowledge(path);
		try {
			expect(knowledge.sections()).toHaveLength(1);
			expect(knowledge.sections()[0]?.body).toContain("## not a section");
		} finally {
			knowledge.close();
		}
	});
});

describe("provider parsing", () => {
	it("parses arXiv Atom entries", () => {
		const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
			<entry>
				<id>http://arxiv.org/abs/2401.12345v1</id>
				<title> A Great Paper </title>
				<summary> We study things. </summary>
				<published>2024-01-22T00:00:00Z</published>
				<author><name>Ada Lovelace</name></author>
				<link title="pdf" href="http://arxiv.org/pdf/2401.12345v1"/>
			</entry>
		</feed>`;
		const [paper] = parseArxivFeed(xml, 5);
		expect(paper?.arxivId).toBe("2401.12345");
		expect(paper?.title).toBe("A Great Paper");
		expect(paper?.authors).toEqual(["Ada Lovelace"]);
		expect(paper?.pdfUrl).toContain("2401.12345");
	});

	it("parses OpenAlex, Semantic Scholar, Crossref, and PubMed responses", () => {
		const openalex = parseOpenAlexResponse({
			results: [
				{
					id: "https://openalex.org/W1",
					doi: "https://doi.org/10.1234/ABC",
					title: "OpenAlex Paper",
					publication_year: 2023,
					authorships: [{ author: { display_name: "Grace Hopper" } }],
					abstract_inverted_index: { hello: [0], world: [1] },
					cited_by_count: 4,
					open_access: { is_oa: true },
				},
			],
		});
		expect(openalex[0]?.doi).toBe("10.1234/abc");
		expect(openalex[0]?.abstract).toBe("hello world");
		expect(openalex[0]?.citationCount).toBe(4);

		const s2 = parseSemanticScholarResponse({
			data: [
				{
					paperId: "abc",
					title: "S2 Paper",
					year: 2022,
					authors: [{ name: "Alan Turing" }],
					externalIds: { DOI: "10.1234/DEF", ArXiv: "2201.00001" },
					openAccessPdf: { url: "https://example.com/a.pdf" },
				},
			],
		});
		expect(s2[0]?.doi).toBe("10.1234/def");
		expect(s2[0]?.arxivId).toBe("2201.00001");
		expect(s2[0]?.pdfUrl).toBe("https://example.com/a.pdf");

		const crossref = parseCrossrefResponse({
			message: {
				items: [
					{
						DOI: "10.1234/GHI",
						title: ["Crossref Paper"],
						author: [{ given: "Marie", family: "Curie" }],
						issued: { "date-parts": [[2021]] },
						"container-title": ["Nature"],
						abstract: "<jats:p>An abstract.</jats:p>",
						"is-referenced-by-count": 9,
					},
				],
			},
		});
		expect(crossref[0]?.doi).toBe("10.1234/ghi");
		expect(crossref[0]?.authors).toEqual(["Marie Curie"]);
		expect(crossref[0]?.abstract).toBe("An abstract.");

		const pubmed = parsePubmedResponse(`<PubmedArticleSet><PubmedArticle>
			<MedlineCitation><PMID>123</PMID><Article>
				<Journal><Title>Journal of Tests</Title></Journal>
				<ArticleTitle>A PubMed Paper</ArticleTitle>
				<Abstract><AbstractText>PubMed abstract.</AbstractText></Abstract>
				<AuthorList><Author><LastName>Doe</LastName><ForeName>Jane</ForeName></Author></AuthorList>
			</Article></MedlineCitation>
			<PubmedData><ArticleIdList>
				<ArticleId IdType="doi">10.1234/JKL</ArticleId>
				<ArticleId IdType="pubmed">123</ArticleId>
			</ArticleIdList></PubmedData>
		</PubmedArticle></PubmedArticleSet>`);
		expect(pubmed[0]?.title).toBe("A PubMed Paper");
		expect(pubmed[0]?.authors).toEqual(["Jane Doe"]);
		expect(pubmed[0]?.doi).toBe("10.1234/jkl");
		expect(pubmed[0]?.pubmedId).toBe("123");
	});
});

describe("Chinese sources", () => {
	it("parses Wanfang official API documents", () => {
		const papers = parseWanfangResponse({
			success: true,
			data: {
				documents: [
					{
						id: "periodical_example",
						resource_type: "OpenPeriodical",
						fields: {
							Title: ["人工智能在医学中的应用"],
							Creator: ["张三", "李四"],
							Abstract: ["本文综述了人工智能在医学影像中的应用。"],
							PublishYear: [2024],
							PeriodicalTitle: ["中国医学物理学杂志"],
							DOI: "10.1234/wf.2024.001",
							CitedCount: [12],
							URLPath: "https://d.wanfangdata.com.cn/periodical/example",
						},
					},
				],
				numFound: 1,
			},
		});
		expect(papers).toHaveLength(1);
		expect(papers[0]?.title).toBe("人工智能在医学中的应用");
		expect(papers[0]?.authors).toEqual(["张三", "李四"]);
		expect(papers[0]?.year).toBe(2024);
		expect(papers[0]?.venue).toBe("中国医学物理学杂志");
		expect(papers[0]?.doi).toBe("10.1234/wf.2024.001");
		expect(papers[0]?.citationCount).toBe(12);
		expect(papers[0]?.sources).toEqual(["wanfang"]);
	});

	it("normalizes CNKI command output and splits command lines", () => {
		expect(splitCommandLine(`cnki-search search "{query}" --size {limit} --format json`)).toEqual([
			"cnki-search",
			"search",
			"{query}",
			"--size",
			"{limit}",
			"--format",
			"json",
		]);
		const papers = normalizeCnkiOutput(
			{
				results: [
					{
						title: "深度学习综述",
						authors: "王五;赵六",
						journal: "计算机学报",
						year: 2023,
						doi: "10.1234/cnki.2023.1",
						abstract: "综述深度学习进展。",
						url: "https://kns.cnki.net/kcms2/article/abstract?v=example",
					},
				],
			},
			5,
		);
		expect(papers).toHaveLength(1);
		expect(papers[0]?.title).toBe("深度学习综述");
		expect(papers[0]?.authors).toEqual(["王五", "赵六"]);
		expect(papers[0]?.venue).toBe("计算机学报");
		expect(papers[0]?.doi).toBe("10.1234/cnki.2023.1");
		expect(papers[0]?.sources).toEqual(["cnki"]);
	});
});

describe("research slash-command helpers", () => {
	it("finds fields by id or alias and masks secrets", () => {
		expect(findResearchConfigField("wanfang")?.id).toBe("wanfang-key");
		expect(findResearchConfigField("s2")?.settingKey).toBe("semanticScholarApiKey");
		expect(findResearchConfigField("unknown")).toBeUndefined();
		expect(findResearchConfigField("anysearch")?.applyUrl).toContain("anysearch.com");
		expect(findResearchConfigField("core")?.applyUrl).toContain("core.ac.uk");
		expect(maskSecret("abcdefghijklmnop")).toBe("abcd…mnop");
		expect(maskSecret("short")).toBe("set");
		expect(maskSecret(undefined)).toBe("not set");
	});

	it("stores and clears research settings", () => {
		const manager = SettingsManager.inMemory();
		manager.setResearchSetting("wanfangAppKey", "wf-secret");
		manager.setResearchSetting("maxResults", 25);
		expect(manager.getResearchSettings()).toMatchObject({ wanfangAppKey: "wf-secret", maxResults: 25 });
		manager.setResearchSetting("wanfangAppKey", undefined);
		expect(manager.getResearchSettings()).not.toHaveProperty("wanfangAppKey");
	});
});
