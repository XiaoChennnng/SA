import { InMemoryCredentialStore, type ProviderAuthInteraction } from "@sa/ai";
import { OPENAI_CUSTOM_BASE_URL_ENV, OPENAI_CUSTOM_MODELS_ENV } from "@sa/ai/providers/openai-custom";
import { describe, expect, it } from "vitest";
import { ModelRuntime } from "../src/core/model-runtime.ts";

function interaction(responses: string[]): ProviderAuthInteraction {
	return {
		signal: new AbortController().signal,
		prompt: async (_prompt) => {
			const value = responses.shift();
			if (value === undefined) throw new Error("Login cancelled");
			return value;
		},
		notify: () => {},
	};
}

async function createRuntime() {
	const credentials = new InMemoryCredentialStore();
	const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
	return { credentials, runtime };
}

describe("custom base URL providers", () => {
	it("registers both custom login options", async () => {
		const { runtime } = await createRuntime();
		const providers = runtime.getProviders();

		expect(providers.find((provider) => provider.id === "openai-custom")?.name).toBe("OpenAI (custom)");
		expect(providers.find((provider) => provider.id === "anthropic-custom")?.name).toBe("Anthropic (custom)");
	});

	it("persists the login base URL and resolves it for requests", async () => {
		const { credentials, runtime } = await createRuntime();

		const credential = await runtime.login(
			"openai-custom",
			"api_key",
			interaction(["https://proxy.example.com/v1/", "sk-test", ""]),
		);
		expect(credential).toMatchObject({
			type: "api_key",
			key: "sk-test",
			env: { [OPENAI_CUSTOM_BASE_URL_ENV]: "https://proxy.example.com/v1" },
		});
		expect(await credentials.read("openai-custom")).toMatchObject({
			env: { [OPENAI_CUSTOM_BASE_URL_ENV]: "https://proxy.example.com/v1" },
		});

		expect((await runtime.getAuth("openai-custom"))?.auth).toMatchObject({
			apiKey: "sk-test",
			baseUrl: "https://proxy.example.com/v1",
		});
		expect(runtime.hasConfiguredAuth("openai-custom")).toBe(true);
	});

	it("exposes custom models after login and removes them on logout", async () => {
		const { runtime } = await createRuntime();

		await runtime.login("anthropic-custom", "api_key", interaction(["", "sk-ant-test", ""]));
		expect(runtime.getAvailableSnapshot().some((model) => model.provider === "anthropic-custom")).toBe(true);
		expect(runtime.getModel("anthropic-custom", "claude-opus-4-8")?.baseUrl.includes("api.anthropic.com")).toBe(true);

		await runtime.logout("anthropic-custom");
		expect(runtime.hasConfiguredAuth("anthropic-custom")).toBe(false);
	});

	it("lists user-provided model IDs instead of the bundled catalog", async () => {
		const { credentials, runtime } = await createRuntime();

		const credential = await runtime.login(
			"openai-custom",
			"api_key",
			interaction(["https://proxy.example.com/v1", "sk-test", "gpt-5.5, house-model"]),
		);
		expect(credential.type === "api_key" ? credential.env?.[OPENAI_CUSTOM_MODELS_ENV] : undefined).toBe(
			"gpt-5.5,house-model",
		);
		const stored = await credentials.read("openai-custom");
		expect(stored?.type === "api_key" ? stored.env?.[OPENAI_CUSTOM_MODELS_ENV] : undefined).toBe(
			"gpt-5.5,house-model",
		);

		const models = runtime
			.getAvailableSnapshot()
			.filter((model) => model.provider === "openai-custom")
			.map((model) => model.id);
		expect(models).toEqual(["gpt-5.5", "house-model"]);
		expect(runtime.getModel("openai-custom", "house-model")?.contextWindow).toBe(128000);
		expect(runtime.hasConfiguredAuth("openai-custom")).toBe(true);

		await runtime.logout("openai-custom");
		expect(runtime.getAvailableSnapshot().some((model) => model.provider === "openai-custom")).toBe(false);
	});
});
