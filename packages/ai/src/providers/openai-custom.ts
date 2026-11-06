import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { createCustomModelProvider, customBaseUrlAuth } from "./custom-base-url.ts";
import { buildCustomModel, findBuiltinChatModel } from "./custom-models.ts";
import { OPENAI_MODELS } from "./openai.models.ts";

export const OPENAI_CUSTOM_BASE_URL_ENV = "SA_OPENAI_CUSTOM_BASE_URL";
export const OPENAI_CUSTOM_MODELS_ENV = "SA_OPENAI_CUSTOM_MODELS";
export const OPENAI_CUSTOM_DEFAULT_BASE_URL = "https://api.openai.com/v1";

type OpenAICompletionsCustomCompat = NonNullable<Model<"openai-completions">["compat"]>;

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

function customOpenAIModel(id: string): Model<"openai-completions"> {
	const source = findBuiltinChatModel(id, "openai");
	// Same-vendor request behavior still applies; other vendors' compat flags do not.
	const sourceCompat =
		source?.provider === "openai" ? (source.compat as OpenAICompletionsCustomCompat | undefined) : undefined;
	return buildCustomModel({
		id,
		source,
		provider: "openai-custom",
		api: "openai-completions",
		baseUrl: OPENAI_CUSTOM_DEFAULT_BASE_URL,
		metadataProvider: "openai",
		compat: {
			...sourceCompat,
			supportsStrictMode: false,
			supportsOpenAIGrammarTools: false,
			supportsMidConvoSystemMessages: false,
		},
	});
}

/** OpenAI models through a user-supplied OpenAI-compatible base URL. */
export function openaiCustomProvider(): Provider<"openai-completions"> {
	return createCustomModelProvider<"openai-completions">({
		id: "openai-custom",
		name: "OpenAI (custom)",
		baseUrl: OPENAI_CUSTOM_DEFAULT_BASE_URL,
		auth: {
			apiKey: customBaseUrlAuth({
				name: "OpenAI custom API key",
				envKey: OPENAI_CUSTOM_BASE_URL_ENV,
				defaultBaseUrl: OPENAI_CUSTOM_DEFAULT_BASE_URL,
				prompt: "Enter the OpenAI-compatible base URL",
				models: {
					envKey: OPENAI_CUSTOM_MODELS_ENV,
					prompt: "Model IDs (comma-separated; empty uses the bundled OpenAI models)",
					placeholder: "gpt-5.5, my-model",
				},
			}),
		},
		models: customOpenAIModels(),
		modelsEnvKey: OPENAI_CUSTOM_MODELS_ENV,
		buildModels: (ids) => ids.map(customOpenAIModel),
		api: openAICompletionsApi(),
	});
}
