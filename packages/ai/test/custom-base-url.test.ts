import { describe, expect, it } from "vitest";
import type { AuthEvent, AuthPrompt, ProviderAuthInteraction } from "../src/auth/types.ts";
import {
	ANTHROPIC_CUSTOM_BASE_URL_ENV,
	ANTHROPIC_CUSTOM_DEFAULT_BASE_URL,
	ANTHROPIC_CUSTOM_MODELS_ENV,
	anthropicCustomProvider,
} from "../src/providers/anthropic-custom.ts";
import { parseCustomModelIds } from "../src/providers/custom-base-url.ts";
import {
	OPENAI_CUSTOM_BASE_URL_ENV,
	OPENAI_CUSTOM_DEFAULT_BASE_URL,
	OPENAI_CUSTOM_MODELS_ENV,
	openaiCustomProvider,
} from "../src/providers/openai-custom.ts";

function fakeInteraction(responses: string[]) {
	const prompts: AuthPrompt[] = [];
	const interaction: ProviderAuthInteraction = {
		signal: new AbortController().signal,
		prompt: async (prompt) => {
			prompts.push(prompt);
			const value = responses.shift();
			if (value === undefined) throw new Error("Login cancelled");
			return value;
		},
		notify: (_event: AuthEvent) => {},
	};
	return { interaction, prompts };
}

describe("openai-custom provider", () => {
	it("reuses the OpenAI catalog through the Chat Completions API", () => {
		const provider = openaiCustomProvider();
		const models = provider.getModels();

		expect(provider.id).toBe("openai-custom");
		expect(models.length).toBeGreaterThan(0);
		expect(models.every((model) => model.provider === "openai-custom")).toBe(true);
		expect(models.every((model) => model.api === "openai-completions")).toBe(true);
		expect(models.find((model) => model.id === "gpt-5.5")?.compat?.supportsOpenAIGrammarTools).toBe(false);
	});

	it("stores the normalized base URL on the credential and resolves it per request", async () => {
		const provider = openaiCustomProvider();
		const login = provider.auth.apiKey?.login;
		const resolve = provider.auth.apiKey?.resolve;
		if (!login || !resolve) throw new Error("Expected OpenAI custom API-key auth");

		const { interaction, prompts } = fakeInteraction(["https://proxy.example.com/v1///", "sk-test", ""]);
		const credential = await login(interaction);
		expect(prompts).toHaveLength(3);
		expect(credential).toMatchObject({
			type: "api_key",
			key: "sk-test",
			env: { [OPENAI_CUSTOM_BASE_URL_ENV]: "https://proxy.example.com/v1" },
		});

		const resolved = await resolve({
			ctx: { env: async () => undefined, fileExists: async () => false },
			credential,
			signal: new AbortController().signal,
		});
		expect(resolved).toMatchObject({
			auth: { apiKey: "sk-test", baseUrl: "https://proxy.example.com/v1" },
			source: "stored credential",
		});
	});

	it("falls back to the default base URL when left empty", async () => {
		const login = openaiCustomProvider().auth.apiKey?.login;
		if (!login) throw new Error("Expected OpenAI custom API-key login");
		const { interaction } = fakeInteraction(["   ", "sk-test", ""]);
		const credential = await login(interaction);
		expect(credential.env).toEqual({ [OPENAI_CUSTOM_BASE_URL_ENV]: OPENAI_CUSTOM_DEFAULT_BASE_URL });
	});

	it("re-prompts for an invalid URL or an empty API key", async () => {
		const login = openaiCustomProvider().auth.apiKey?.login;
		if (!login) throw new Error("Expected OpenAI custom API-key login");
		const { interaction, prompts } = fakeInteraction(["not-a-url", "https://proxy.example.com", "", "sk-test", ""]);
		const credential = await login(interaction);

		expect(prompts).toHaveLength(5);
		expect(prompts[1]?.message).toContain("must start with");
		expect(prompts[3]?.message).toContain("required");
		expect(credential.key).toBe("sk-test");
	});

	it("stores user-provided model IDs and rebuilds the catalog on refresh", async () => {
		const provider = openaiCustomProvider();
		const login = provider.auth.apiKey?.login;
		const refresh = provider.refreshModels;
		if (!login || !refresh) throw new Error("Expected OpenAI custom login and refresh");

		const { interaction } = fakeInteraction([
			"https://proxy.example.com/v1",
			"sk-test",
			"gpt-5.5, house-model, deepseek-v4-pro",
		]);
		const credential = await login(interaction);
		expect(credential.env?.[OPENAI_CUSTOM_MODELS_ENV]).toBe("gpt-5.5,house-model,deepseek-v4-pro");

		await refresh({
			credential,
			publish: async (publication) => {
				publication.update?.();
				return true;
			},
			allowNetwork: false,
			signal: new AbortController().signal,
			baseUrl: OPENAI_CUSTOM_DEFAULT_BASE_URL,
		});

		const models = provider.getModels();
		expect(models.map((model) => model.id)).toEqual(["gpt-5.5", "house-model", "deepseek-v4-pro"]);
		expect(models[0]).toMatchObject({ id: "gpt-5.5", contextWindow: 272000, api: "openai-completions" });
		expect(models[1]).toMatchObject({
			id: "house-model",
			name: "house-model",
			api: "openai-completions",
			reasoning: false,
			contextWindow: 128000,
			maxTokens: 16384,
		});
		expect(models[1]?.compat?.supportsStrictMode).toBe(false);
		// Cross-vendor metadata keeps generic limits but drops provider-specific thinking maps.
		expect(models[2]).toMatchObject({ id: "deepseek-v4-pro", contextWindow: 1000000 });
		expect(models[2]?.thinkingLevelMap).toBeUndefined();

		await refresh({
			credential: undefined,
			publish: async (publication) => {
				publication.update?.();
				return true;
			},
			allowNetwork: false,
			signal: new AbortController().signal,
			baseUrl: OPENAI_CUSTOM_DEFAULT_BASE_URL,
		});
		expect(provider.getModels().length).toBeGreaterThan(3);
		expect(provider.getModels().some((model) => model.id === "house-model")).toBe(false);
	});

	it("is not configured without a stored credential", async () => {
		const resolve = openaiCustomProvider().auth.apiKey?.resolve;
		if (!resolve) throw new Error("Expected OpenAI custom API-key auth");
		await expect(
			resolve({
				ctx: { env: async () => undefined, fileExists: async () => false },
				signal: new AbortController().signal,
			}),
		).resolves.toBeUndefined();
	});
});

describe("anthropic-custom provider", () => {
	it("reuses the Anthropic catalog through the Messages API", () => {
		const provider = anthropicCustomProvider();
		const models = provider.getModels();

		expect(provider.id).toBe("anthropic-custom");
		expect(models.length).toBeGreaterThan(0);
		expect(models.every((model) => model.provider === "anthropic-custom")).toBe(true);
		expect(models.every((model) => model.api === "anthropic-messages")).toBe(true);
	});

	it("keeps fallback models pointing at the custom provider", () => {
		const fallbackOwner = anthropicCustomProvider()
			.getModels()
			.find((model) => model.compat?.allowedFallbackModels?.length);
		expect(fallbackOwner).toBeDefined();
		expect(
			fallbackOwner?.compat?.allowedFallbackModels?.every((model) => model.provider === "anthropic-custom"),
		).toBe(true);
	});

	it("accepts arbitrary model IDs alongside existing Anthropic models", async () => {
		const provider = anthropicCustomProvider();
		const login = provider.auth.apiKey?.login;
		const refresh = provider.refreshModels;
		if (!login || !refresh) throw new Error("Expected Anthropic custom login and refresh");

		const { interaction } = fakeInteraction(["", "sk-ant-test", "claude-fable-5\nmy-claude-proxy"]);
		const credential = await login(interaction);
		expect(credential.env?.[ANTHROPIC_CUSTOM_MODELS_ENV]).toBe("claude-fable-5,my-claude-proxy");

		await refresh({
			credential,
			publish: async (publication) => {
				publication.update?.();
				return true;
			},
			allowNetwork: false,
			signal: new AbortController().signal,
			baseUrl: ANTHROPIC_CUSTOM_DEFAULT_BASE_URL,
		});

		const models = provider.getModels();
		expect(models.map((model) => model.id)).toEqual(["claude-fable-5", "my-claude-proxy"]);
		expect(models[0]).toMatchObject({ contextWindow: 1000000, api: "anthropic-messages" });
		expect(models[0]?.compat?.allowedFallbackModels?.every((model) => model.provider === "anthropic-custom")).toBe(
			true,
		);
		expect(models[1]).toMatchObject({
			id: "my-claude-proxy",
			name: "my-claude-proxy",
			reasoning: false,
			contextWindow: 128000,
			maxTokens: 16384,
		});
	});

	it("resolves the stored base URL", async () => {
		const resolve = anthropicCustomProvider().auth.apiKey?.resolve;
		if (!resolve) throw new Error("Expected Anthropic custom API-key auth");
		const resolved = await resolve({
			ctx: { env: async () => undefined, fileExists: async () => false },
			credential: {
				type: "api_key",
				key: "sk-ant-test",
				env: { [ANTHROPIC_CUSTOM_BASE_URL_ENV]: "https://anthropic-proxy.example.com" },
			},
			signal: new AbortController().signal,
		});
		expect(resolved).toMatchObject({
			auth: { apiKey: "sk-ant-test", baseUrl: "https://anthropic-proxy.example.com" },
		});
	});

	it("leaves the base URL to the catalog default when the credential stores none", async () => {
		const resolve = anthropicCustomProvider().auth.apiKey?.resolve;
		if (!resolve) throw new Error("Expected Anthropic custom API-key auth");
		const resolved = await resolve({
			ctx: { env: async () => undefined, fileExists: async () => false },
			credential: { type: "api_key", key: "sk-ant-test" },
			signal: new AbortController().signal,
		});
		expect(resolved?.auth.apiKey).toBe("sk-ant-test");
		expect(resolved?.auth.baseUrl).toBeUndefined();
		expect(ANTHROPIC_CUSTOM_DEFAULT_BASE_URL).toBe("https://api.anthropic.com");
	});
});

describe("custom model IDs", () => {
	it("splits, trims, and deduplicates comma, semicolon, and newline separated IDs", () => {
		expect(parseCustomModelIds(" a, b;\n c ,, a ")).toEqual(["a", "b", "c"]);
		expect(parseCustomModelIds(undefined)).toEqual([]);
		expect(parseCustomModelIds("  , \n ; ")).toEqual([]);
	});
});
