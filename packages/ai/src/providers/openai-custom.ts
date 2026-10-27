import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { customBaseUrlAuth } from "./custom-base-url.ts";
import { OPENAI_MODELS } from "./openai.models.ts";

export const OPENAI_CUSTOM_BASE_URL_ENV = "SA_OPENAI_CUSTOM_BASE_URL";
export const OPENAI_CUSTOM_DEFAULT_BASE_URL = "https://api.openai.com/v1";

function customOpenAIModels(): Model<"openai-completions">[] {
	return Object.values(OPENAI_MODELS).map((model) => ({
		...model,
		provider: "openai-custom",
		// Custom endpoints are usually OpenAI-compatible servers, not the Responses API.
		api: "openai-completions",
		// Responses-specific endpoint capabilities do not carry over to an arbitrary
		// compatible endpoint; let the Chat Completions API auto-detect them.
		compat: {
			...model.compat,
			supportsStrictMode: false,
			supportsOpenAIGrammarTools: false,
			supportsMidConvoSystemMessages: false,
		},
	}));
}

/** OpenAI models through a user-supplied OpenAI-compatible base URL. */
export function openaiCustomProvider(): Provider<"openai-completions"> {
	return createProvider<"openai-completions">({
		id: "openai-custom",
		name: "OpenAI (custom)",
		baseUrl: OPENAI_CUSTOM_DEFAULT_BASE_URL,
		auth: {
			apiKey: customBaseUrlAuth({
				name: "OpenAI custom API key",
				envKey: OPENAI_CUSTOM_BASE_URL_ENV,
				defaultBaseUrl: OPENAI_CUSTOM_DEFAULT_BASE_URL,
				prompt: "Enter the OpenAI-compatible base URL",
			}),
		},
		models: customOpenAIModels(),
		api: openAICompletionsApi(),
	});
}
