import type { ApiKeyAuth } from "../auth/types.ts";

export interface CustomBaseUrlAuthOptions {
	/** Display name for the API key prompt, e.g. "OpenAI custom API key". */
	name: string;
	/** Credential env key that stores the resolved base URL. */
	envKey: string;
	/** Base URL used when the user leaves the prompt empty. */
	defaultBaseUrl: string;
	/** Text shown above the base URL prompt. */
	prompt: string;
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
			return { type: "api_key", key, env: { [options.envKey]: baseUrl } };
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
