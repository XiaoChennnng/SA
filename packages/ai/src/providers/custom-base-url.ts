import type { ApiKeyAuth, ProviderAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Api, Model, ProviderStreams } from "../types.ts";

export interface CustomBaseUrlAuthOptions {
	/** Display name for the API key prompt, e.g. "OpenAI custom API key". */
	name: string;
	/** Credential env key that stores the resolved base URL. */
	envKey: string;
	/** Base URL used when the user leaves the prompt empty. */
	defaultBaseUrl: string;
	/** Text shown above the base URL prompt. */
	prompt: string;
	/** Optional model-ID prompt. The entered IDs are stored in the credential's env. */
	models?: {
		/** Credential env key that stores the comma-separated model IDs. */
		envKey: string;
		/** Text shown above the model-ID prompt. */
		prompt: string;
		placeholder?: string;
	};
}

function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

function isHttpBaseUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/** API-key auth that also asks for a base URL and stores it on the credential. */
export function customBaseUrlAuth(options: CustomBaseUrlAuthOptions): ApiKeyAuth {
	return {
		name: options.name,
		login: async (interaction) => {
			interaction.signal.throwIfAborted();
			let message = `${options.prompt} (leave empty for ${options.defaultBaseUrl})`;
			let baseUrl = options.defaultBaseUrl;
			while (true) {
				const value = (
					await interaction.prompt({ type: "text", message, placeholder: options.defaultBaseUrl })
				).trim();
				interaction.signal.throwIfAborted();
				if (!value) break;
				if (isHttpBaseUrl(value)) {
					baseUrl = normalizeBaseUrl(value);
					break;
				}
				message = `${options.prompt} (must start with http:// or https://)`;
			}
			let key = "";
			let retrying = false;
			while (!key) {
				key = (
					await interaction.prompt({
						type: "secret",
						message: retrying ? `Enter ${options.name} (required)` : `Enter ${options.name}`,
					})
				).trim();
				interaction.signal.throwIfAborted();
				retrying = true;
			}
			let modelIds: string[] = [];
			if (options.models) {
				const value = (
					await interaction.prompt({
						type: "text",
						message: options.models.prompt,
						placeholder: options.models.placeholder,
					})
				).trim();
				interaction.signal.throwIfAborted();
				modelIds = parseCustomModelIds(value);
			}
			const env: Record<string, string> = { [options.envKey]: baseUrl };
			if (options.models && modelIds.length > 0) {
				env[options.models.envKey] = modelIds.join(",");
			}
			return { type: "api_key", key, env };
		},
		resolve: async ({ credential, signal }) => {
			signal.throwIfAborted();
			if (!credential) return undefined;
			const baseUrl = credential.env?.[options.envKey];
			if (!credential.key && !baseUrl) return undefined;
			return {
				auth: {
					...(credential.key ? { apiKey: credential.key } : {}),
					...(baseUrl ? { baseUrl } : {}),
				},
				env: credential.env,
				source: "stored credential",
			};
		},
	};
}

/** Split comma-, semicolon-, or newline-separated model IDs, preserving order. */
export function parseCustomModelIds(value: string | undefined): string[] {
	if (!value) return [];
	const ids = value
		.split(/[,\n;]+/u)
		.map((id) => id.trim())
		.filter((id) => id.length > 0);
	return [...new Set(ids)];
}

export const CUSTOM_MODEL_PROVIDER_IDS = ["openai-custom", "anthropic-custom"] as const;

/** Providers whose model list is defined by the user when logging in. */
export function isCustomModelProvider(providerId: string): boolean {
	return CUSTOM_MODEL_PROVIDER_IDS.some((id) => id === providerId);
}

export interface CustomModelProviderOptions<TApi extends Api> {
	id: string;
	name: string;
	baseUrl: string;
	auth: ProviderAuth;
	/** Models listed when the credential stores no model IDs. */
	models: readonly Model<TApi>[];
	/** Credential env key that stores comma-separated model IDs. */
	modelsEnvKey: string;
	/** Build the model list for user-provided IDs, in the entered order. */
	buildModels: (ids: readonly string[]) => readonly Model<TApi>[];
	api: ProviderStreams;
}

/**
 * A custom endpoint provider whose model list comes from the credential's model IDs.
 * Without stored IDs it falls back to the bundled catalog.
 */
export function createCustomModelProvider<TApi extends Api>(options: CustomModelProviderOptions<TApi>): Provider<TApi> {
	const base = createProvider<TApi>({
		id: options.id,
		name: options.name,
		baseUrl: options.baseUrl,
		auth: options.auth,
		models: options.models,
		api: options.api,
	});
	let selectedModels: readonly Model<TApi>[] | undefined;
	return {
		...base,
		getModels: () => selectedModels ?? base.getModels(),
		getAllModels: () => selectedModels ?? base.getAllModels?.() ?? [],
		refreshModels: async (context) => {
			const env = context.credential?.type === "api_key" ? context.credential.env : undefined;
			const ids = parseCustomModelIds(env?.[options.modelsEnvKey]);
			const next = ids.length > 0 ? options.buildModels(ids) : undefined;
			await context.publish({
				update: () => {
					selectedModels = next;
				},
			});
		},
	};
}
