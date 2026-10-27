import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalPiExperimental = process.env.SA_EXPERIMENTAL;

	afterEach(() => {
		if (originalPiExperimental === undefined) {
			delete process.env.SA_EXPERIMENTAL;
		} else {
			process.env.SA_EXPERIMENTAL = originalPiExperimental;
		}
	});

	it("returns false when SA_EXPERIMENTAL is unset", () => {
		delete process.env.SA_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when SA_EXPERIMENTAL is empty", () => {
		process.env.SA_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when SA_EXPERIMENTAL is set to 1", () => {
		process.env.SA_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when SA_EXPERIMENTAL is set to 0", () => {
		process.env.SA_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when SA_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.SA_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
