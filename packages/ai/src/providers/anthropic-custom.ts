import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import type { Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { ANTHROPIC_MODELS } from "./anthropic.models.ts";
import { createCustomModelProvider, customBaseUrlAuth } from "./custom-base-url.ts";
import { buildCustomModel, findBuiltinChatModel } from "./custom-models.ts";

export const ANTHROPIC_CUSTOM_BASE_URL_ENV = "SA_ANTHROPIC_CUSTOM_BASE_URL";
export const ANTHROPIC_CUSTOM_MODELS_ENV = "SA_ANTHROPIC_CUSTOM_MODELS";
export const ANTHROPIC_CUSTOM_DEFAULT_BASE_URL = "https://api.anthropic.com";

type AnthropicMessagesCustomCompat = NonNullable<Model<"anthropic-messages">["compat"]>;

function customAnthropicModels(): Model<"anthropic-messages">[] {
	return Object.values(ANTHROPIC_MODELS).map((model) => ({
		...model,
		provider: "anthropic-custom",
		// Fallback cost lookup matches the fallback provider against the model provider.
		compat: model.compat?.allowedFallbackModels
			? {
					...model.compat,
					allowedFallbackModels: model.compat.allowedFallbackModels.map((fallback) => ({
						...fallback,
						provider: "anthropic-custom",
					})),
				}
			: model.compat,
	}));
}

function customAnthropicModel(id: string): Model<"anthropic-messages"> {
	const source = findBuiltinChatModel(id, "anthropic");
	// Other vendors' compatibility flags describe their own request format, not this endpoint.
	const sourceCompat =
		source?.provider === "anthropic" ? (source.compat as AnthropicMessagesCustomCompat | undefined) : undefined;
	return buildCustomModel({
		id,
		source,
		provider: "anthropic-custom",
		api: "anthropic-messages",
		baseUrl: ANTHROPIC_CUSTOM_DEFAULT_BASE_URL,
		metadataProvider: "anthropic",
		compat: sourceCompat?.allowedFallbackModels
			? {
					...sourceCompat,
					allowedFallbackModels: sourceCompat.allowedFallbackModels.map((fallback) => ({
						...fallback,
						provider: "anthropic-custom",
					})),
				}
			: sourceCompat,
	});
}

/** Anthropic models through a user-supplied Anthropic Messages base URL. */
export function anthropicCustomProvider(): Provider<"anthropic-messages"> {
	return createCustomModelProvider<"anthropic-messages">({
		id: "anthropic-custom",
		name: "Anthropic (custom)",
		baseUrl: ANTHROPIC_CUSTOM_DEFAULT_BASE_URL,
		auth: {
			apiKey: customBaseUrlAuth({
				name: "Anthropic custom API key",
				envKey: ANTHROPIC_CUSTOM_BASE_URL_ENV,
				defaultBaseUrl: ANTHROPIC_CUSTOM_DEFAULT_BASE_URL,
				prompt: "Enter the Anthropic-compatible base URL",
				models: {
					envKey: ANTHROPIC_CUSTOM_MODELS_ENV,
					prompt: "Model IDs (comma-separated; empty uses the bundled Anthropic models)",
					placeholder: "claude-opus-4-8, my-model",
				},
			}),
		},
		models: customAnthropicModels(),
		modelsEnvKey: ANTHROPIC_CUSTOM_MODELS_ENV,
		buildModels: (ids) => ids.map(customAnthropicModel),
		api: anthropicMessagesApi(),
	});
}
