import { afterEach, describe, expect, it } from "vitest";
import {
	clearBuiltinChatModelOverrides,
	getBuiltinModels,
	setBuiltinChatModelOverrides,
} from "../src/providers/all.ts";

afterEach(() => clearBuiltinChatModelOverrides());

const runtimeModel = {
	id: "runtime-test-model",
	name: "Runtime Test",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
	type: "chat",
};

function downloadedAnthropic() {
	return { "anthropic-messages": { "chat:runtime-test-model": runtimeModel } };
}

describe("built-in chat model overrides", () => {
	it("replaces the provider catalog with downloaded data", () => {
		setBuiltinChatModelOverrides({ "anthropic.json": downloadedAnthropic() });
		expect(getBuiltinModels("anthropic").map((model) => model.id)).toEqual(["runtime-test-model"]);
	});

	it("restores the bundled catalog when overrides are cleared", () => {
		setBuiltinChatModelOverrides({ "anthropic.json": downloadedAnthropic() });
		clearBuiltinChatModelOverrides();
		expect(getBuiltinModels("anthropic").some((model) => model.id === "runtime-test-model")).toBe(false);
	});

	it("ignores file names that could escape the cache directory", () => {
		setBuiltinChatModelOverrides({ "../anthropic.json": downloadedAnthropic() });
		expect(getBuiltinModels("anthropic").some((model) => model.id === "runtime-test-model")).toBe(false);
	});
});
