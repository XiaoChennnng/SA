import { InMemoryCredentialStore, type ProviderAuthInteraction } from "@sa/ai";
import { OPENAI_CUSTOM_BASE_URL_ENV } from "@sa/ai/providers/openai-custom";
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
			interaction(["https://proxy.example.com/v1/", "sk-test"]),
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

		await runtime.login("anthropic-custom", "api_key", interaction(["", "sk-ant-test"]));
		expect(runtime.getAvailableSnapshot().some((model) => model.provider === "anthropic-custom")).toBe(true);
		expect(runtime.getModel("anthropic-custom", "claude-opus-4-8")?.baseUrl.includes("api.anthropic.com")).toBe(true);

		await runtime.logout("anthropic-custom");
		expect(runtime.hasConfiguredAuth("anthropic-custom")).toBe(false);
	});
});
