import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import { type AnySearchDomain, anySearchDomains } from "../../../research/anysearch.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchSettingsFor } from "./shared.ts";

const webDomainsSchema = Type.Object({
	domains: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		maxItems: 10,
		description: "AnySearch domains to inspect, such as code, finance, or news.",
	}),
});

export type WebSearchDomainsToolInput = Static<typeof webDomainsSchema>;

export interface WebSearchDomainsToolDetails {
	domains: AnySearchDomain[];
}

export interface WebSearchDomainsToolOptions extends Partial<ResearchToolOptions> {
	domains?: typeof anySearchDomains;
}

export const webSearchDomainsToolSystemPromptContribution = {
	snippet: "List AnySearch domains, sub-domains, and parameters for web_search tags",
	guidelines: [
		"Use web_search_domains when a web_search tag or domain parameter is unclear; it does not consume search quota",
	],
} as const;

export function createWebSearchDomainsToolDefinition(
	_cwd: string,
	options?: WebSearchDomainsToolOptions,
): ToolDefinition<typeof webDomainsSchema, WebSearchDomainsToolDetails> {
	const loadDomains = options?.domains ?? anySearchDomains;
	return {
		name: "web_search_domains",
		label: "web_search_domains",
		description:
			"List AnySearch search domains and their sub-domains and parameters. Use the returned names as web_search tags and to discover domain-specific parameters.",
		promptSnippet: webSearchDomainsToolSystemPromptContribution.snippet,
		promptGuidelines: [...webSearchDomainsToolSystemPromptContribution.guidelines],
		parameters: webDomainsSchema,
		async execute(
			_toolCallId,
			params: WebSearchDomainsToolInput,
			signal: AbortSignal | undefined,
			_onUpdate,
			_ctx?: ExtensionContext,
		) {
			const settings = researchSettingsFor(options);
			const domains = await loadDomains(params.domains, {
				apiKey: settings.anySearchApiKey,
				signal,
				timeoutMs: settings.requestTimeoutMs,
			});
			const lines: string[] = [];
			for (const domain of domains) {
				lines.push(`${domain.domain}: ${domain.description}`);
				for (const subDomain of domain.subDomains) {
					lines.push(`  ${subDomain.subDomain}: ${subDomain.description}`);
					for (const [name, param] of Object.entries(subDomain.params)) {
						lines.push(`    - ${name}${param.required ? " (required)" : ""}: ${param.description}`);
					}
				}
			}
			return {
				content: [
					{
						type: "text",
						text:
							domains.length > 0
								? lines.join("\n")
								: `No AnySearch domains found for: ${params.domains.join(", ")}`,
					},
				],
				details: { domains },
			};
		},
	};
}

export function createWebSearchDomainsTool(
	cwd: string,
	options?: WebSearchDomainsToolOptions,
): AgentTool<typeof webDomainsSchema> {
	return wrapToolDefinition(createWebSearchDomainsToolDefinition(cwd, options));
}
