import { MODELS } from "../models.generated.ts";
import type { Api, Model } from "../types.ts";

type ChatCatalogs = Record<string, Record<string, Model<Api>>>;

function matchCatalogModel(
	catalog: Record<string, Model<Api>> | undefined,
	normalized: string,
): Model<Api> | undefined {
	if (!catalog) return undefined;
	const models = Object.values(catalog);
	return (
		models.find((model) => model.id.toLowerCase() === normalized) ??
		models.find((model) => model.name.trim().toLowerCase() === normalized)
	);
}

/**
 * Find a bundled chat model by exact ID or display name. The preferred provider wins so an ID
 * shared by several providers reuses its own vendor's metadata.
 */
export function findBuiltinChatModel(modelId: string, preferredProvider?: string): Model<Api> | undefined {
	const normalized = modelId.trim().toLowerCase();
	if (!normalized) return undefined;
	const catalogs = MODELS as unknown as ChatCatalogs;
	if (preferredProvider) {
		const match = matchCatalogModel(catalogs[preferredProvider], normalized);
		if (match) return match;
	}
	for (const [providerId, catalog] of Object.entries(catalogs)) {
		if (providerId === preferredProvider) continue;
		const match = matchCatalogModel(catalog, normalized);
		if (match) return match;
	}
	return undefined;
}

export interface BuildCustomModelOptions<TApi extends Api> {
	id: string;
	/** Catalog model whose metadata is reused when the ID matches an existing model. */
	source?: Model<Api>;
	provider: string;
	api: TApi;
	baseUrl: string;
	/** Provider whose thinking and prompt-cache metadata applies to the custom endpoint. */
	metadataProvider: string;
	compat?: Model<TApi>["compat"];
}

/**
 * Clone safe metadata for an arbitrary endpoint model. Provider-specific request, thinking, and
 * cache metadata only carries over for the same vendor; unknown IDs use conservative defaults.
 */
export function buildCustomModel<TApi extends Api>(options: BuildCustomModelOptions<TApi>): Model<TApi> {
	const { source } = options;
	const sameProvider = source?.provider === options.metadataProvider;
	return {
		id: options.id,
		name: source?.name ?? options.id,
		provider: options.provider,
		api: options.api,
		baseUrl: options.baseUrl,
		reasoning: source?.reasoning ?? false,
		thinkingLevelMap: sameProvider ? source.thinkingLevelMap : undefined,
		input: source?.input ?? ["text"],
		inputLimits: source?.inputLimits,
		cost: source?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		promptCache: sameProvider ? source.promptCache : undefined,
		contextWindow: source?.contextWindow ?? 128000,
		maxTokens: source?.maxTokens ?? 16384,
		compat: options.compat,
	};
}
