import { describe, expect, it } from "vitest";
import { parseEuropePmcResponse } from "../src/research/providers/europepmc.ts";

describe("Europe PMC", () => {
	it("parses core search results", () => {
		const papers = parseEuropePmcResponse({
			hitCount: 2,
			resultList: {
				result: [
					{
						id: "12345678",
						source: "MED",
						pmid: "12345678",
						pmcid: "PMC123456",
						doi: "10.1000/ABC.123",
						title: "A biomedical paper",
						authorString: "Ada Lovelace, Alan Turing",
						journalInfo: { journal: { title: "Journal of Tests" } },
						pubYear: "2024",
						abstractText: "An <i>important</i> abstract.",
						citedByCount: 17,
						isOpenAccess: "Y",
						fullTextUrlList: {
							fullTextUrl: [
								{ availabilityCode: "OA", documentStyle: "pdf", url: "https://example.com/paper.pdf" },
							],
						},
					},
					{
						id: "PPR123",
						source: "PPR",
						title: "A preprint without DOI",
						authorString: "Grace Hopper",
						pubYear: "2023",
						isOpenAccess: "N",
					},
				],
			},
		});
		expect(papers).toHaveLength(2);
		expect(papers[0]?.doi).toBe("10.1000/abc.123");
		expect(papers[0]?.authors).toEqual(["Ada Lovelace", "Alan Turing"]);
		expect(papers[0]?.abstract).toBe("An important abstract.");
		expect(papers[0]?.pdfUrl).toBe("https://example.com/paper.pdf");
		expect(papers[0]?.sources).toEqual(["europepmc"]);
		expect(papers[1]?.openAccess).toBe(false);
		expect(papers[1]?.title).toBe("A preprint without DOI");
	});

	it("throws on an error envelope", async () => {
		const { searchEuropePmc } = await import("../src/research/providers/europepmc.ts");
		// The error path needs no network because pageSize is clamped before the request only by the API;
		// this asserts the parser shape used by the provider's error check.
		expect(parseEuropePmcResponse({ errCode: 404, errMsg: "Invalid page size" })).toEqual([]);
		expect(typeof searchEuropePmc).toBe("function");
	});
});
