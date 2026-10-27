import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSearchDomainsToolDefinition } from "../src/core/tools/research/web-domains.ts";
import { createWebExtractToolDefinition } from "../src/core/tools/research/web-extract.ts";
import { createWebSearchToolDefinition } from "../src/core/tools/research/web-search.ts";
import { resolveResearchSettings } from "../src/research/settings.ts";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function settings() {
	const dir = mkdtempSync(join(tmpdir(), "sa-web-tools-"));
	tempDirs.push(dir);
	return resolveResearchSettings({
		knowledgePath: join(dir, "research.md"),
		cacheDir: join(dir, "cache"),
		workDir: join(dir, "work"),
		anySearchApiKey: "test-key",
	});
}

describe("AnySearch web tools", () => {
	it("searches the web and formats results", async () => {
		const search = vi.fn(async () => ({
			results: [
				{
					title: "Example result",
					url: "https://example.com/page",
					snippet: "A snippet",
					content: "# Heading\n\nBody text",
				},
			],
			totalResults: 1,
			searchTimeMs: 12,
		}));
		const definition = createWebSearchToolDefinition(process.cwd(), { settings: settings(), search });
		const result = await definition.execute(
			"call",
			{ query: "example", maxResults: 3 },
			undefined,
			undefined,
			{} as never,
		);
		const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
		expect(text).toContain("Example result");
		expect(text).toContain("https://example.com/page");
		expect(result.details?.count).toBe(1);
		expect(search).toHaveBeenCalledWith(
			expect.objectContaining({ query: "example", maxResults: 3, format: "markdown" }),
			expect.objectContaining({ apiKey: "test-key" }),
		);
	});

	it("extracts a page and truncates to the character budget", async () => {
		const extract = vi.fn(async () => ({
			url: "https://example.com/page",
			title: "Page",
			content: "x".repeat(1000),
		}));
		const definition = createWebExtractToolDefinition(process.cwd(), { settings: settings(), extract });
		const result = await definition.execute(
			"call",
			{ url: "https://example.com/page", maxChars: 500 },
			undefined,
			undefined,
			{} as never,
		);
		expect(result.details?.truncated).toBe(true);
		expect(result.details?.returnedChars).toBe(500);
		const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
		expect(text).toContain("[Truncated: 500 more characters.]");
	});

	it("lists AnySearch domains and parameters", async () => {
		const loadDomains = vi.fn(async () => [
			{
				domain: "code",
				description: "Code search",
				subDomains: [
					{
						subDomain: "doc",
						description: "Documentation",
						params: { library: { description: "Library name", required: false } },
					},
				],
			},
		]);
		const definition = createWebSearchDomainsToolDefinition(process.cwd(), {
			settings: settings(),
			domains: loadDomains,
		});
		const result = await definition.execute("call", { domains: ["code"] }, undefined, undefined, {} as never);
		const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
		expect(text).toContain("code: Code search");
		expect(text).toContain("doc: Documentation");
		expect(text).toContain("- library");
		expect(result.details?.domains).toHaveLength(1);
	});
});
