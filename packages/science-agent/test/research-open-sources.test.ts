import { describe, expect, it } from "vitest";
import { parseCoreResponse } from "../src/research/providers/core.ts";
import { parseDoajResponse } from "../src/research/providers/doaj.ts";
import { parseHalResponse } from "../src/research/providers/hal.ts";
import { parseOpenaireResponse } from "../src/research/providers/openaire.ts";

describe("open scholarly sources", () => {
	it("parses OpenAIRE research products", () => {
		const [paper] = parseOpenaireResponse({
			results: [
				{
					id: "doi_dedup___::abc",
					mainTitle: "Open Science Paper",
					publicationDate: "2024-03-01",
					publisher: "Example Press",
					authors: [{ fullName: "Ada Lovelace" }, { fullName: "Alan Turing" }],
					descriptions: ["An open abstract."],
					pids: [
						{ scheme: "doi", value: "10.1234/OS.1" },
						{ scheme: "pmid", value: "12345" },
					],
					container: { name: "Journal of Open Tests" },
					instances: [{ urls: ["https://example.com/paper.pdf"] }],
					bestAccessRight: { label: "OPEN" },
					indicators: { citationImpact: { citationCount: 7 } },
				},
			],
		});
		expect(paper?.title).toBe("Open Science Paper");
		expect(paper?.doi).toBe("10.1234/os.1");
		expect(paper?.pubmedId).toBe("12345");
		expect(paper?.authors).toEqual(["Ada Lovelace", "Alan Turing"]);
		expect(paper?.venue).toBe("Journal of Open Tests");
		expect(paper?.pdfUrl).toBe("https://example.com/paper.pdf");
		expect(paper?.citationCount).toBe(7);
		expect(paper?.sources).toEqual(["openaire"]);
	});

	it("parses DOAJ articles", () => {
		const [paper] = parseDoajResponse({
			results: [
				{
					bibjson: {
						title: "DOAJ Paper",
						author: [{ name: "Grace Hopper" }],
						abstract: "An OA abstract.",
						journal: { title: "Open Journal", publisher: "Publisher" },
						year: "2023",
						identifier: [{ id: "10.1234/DOAJ.1", type: "doi" }],
						link: [
							{ url: "https://example.com/article", type: "fulltext", content_type: "HTML" },
							{ url: "https://example.com/article.pdf", type: "fulltext", content_type: "PDF" },
						],
					},
				},
			],
		});
		expect(paper?.doi).toBe("10.1234/doaj.1");
		expect(paper?.venue).toBe("Open Journal");
		expect(paper?.url).toBe("https://example.com/article");
		expect(paper?.pdfUrl).toBe("https://example.com/article.pdf");
		expect(paper?.openAccess).toBe(true);
		expect(paper?.sources).toEqual(["doaj"]);
	});

	it("parses CORE works", () => {
		const [paper] = parseCoreResponse({
			results: [
				{
					id: 42,
					title: "CORE Paper",
					abstract: "A repository abstract.",
					authors: [{ name: "Katherine Johnson" }],
					yearPublished: 2022,
					doi: "10.1234/CORE.1",
					downloadUrl: "https://example.com/core.pdf",
					publisher: "Repository",
					citationCount: 3,
				},
			],
		});
		expect(paper?.doi).toBe("10.1234/core.1");
		expect(paper?.url).toBe("https://core.ac.uk/works/42");
		expect(paper?.pdfUrl).toBe("https://example.com/core.pdf");
		expect(paper?.authors).toEqual(["Katherine Johnson"]);
		expect(paper?.sources).toEqual(["core"]);
	});

	it("parses HAL Solr documents", () => {
		const [paper] = parseHalResponse({
			response: {
				docs: [
					{
						title_s: ["HAL Paper"],
						authFullName_s: ["Marie Curie"],
						abstract_s: ["A HAL abstract."],
						doiId_s: "10.1234/HAL.1",
						uri_s: "https://hal.example/paper",
						producedDateY_i: 2021,
						publisher_s: "HAL",
						fileMain_s: "https://hal.example/paper.pdf",
					},
				],
			},
		});
		expect(paper?.doi).toBe("10.1234/hal.1");
		expect(paper?.year).toBe(2021);
		expect(paper?.pdfUrl).toBe("https://hal.example/paper.pdf");
		expect(paper?.sources).toEqual(["hal"]);
	});
});
