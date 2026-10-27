import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { ANTHROPIC_MODELS } from "./anthropic.models.ts";
import { customBaseUrlAuth } from "./custom-base-url.ts";

export const ANTHROPIC_CUSTOM_BASE_URL_ENV = "SA_ANTHROPIC_CUSTOM_BASE_URL";
export const ANTHROPIC_CUSTOM_DEFAULT_BASE_URL = "https://api.anthropic.com";

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

/** Anthropic models through a user-supplied Anthropic Messages base URL. */
export function anthropicCustomProvider(): Provider<"anthropic-messages"> {
	return createProvider<"anthropic-messages">({
		id: "anthropic-custom",
		name: "Anthropic (custom)",
		baseUrl: ANTHROPIC_CUSTOM_DEFAULT_BASE_URL,
		auth: {
			apiKey: customBaseUrlAuth({
				name: "Anthropic custom API key",
				envKey: ANTHROPIC_CUSTOM_BASE_URL_ENV,
				defaultBaseUrl: ANTHROPIC_CUSTOM_DEFAULT_BASE_URL,
				prompt: "Enter the Anthropic-compatible base URL",
			}),
		},
		models: customAnthropicModels(),
		api: anthropicMessagesApi(),
	});
}
