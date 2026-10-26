import { describe, expect, it, vi } from "vitest";
import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { createAskUserToolDefinition } from "../src/core/tools/ask-user.ts";

function context(overrides: Partial<ExtensionToolContext["ui"]> = {}, mode: "tui" | "print" = "tui") {
	return {
		mode,
		ui: {
			select: vi.fn(),
			confirm: vi.fn(),
			input: vi.fn(),
			notify: vi.fn(),
			...overrides,
		},
	} as unknown as ExtensionToolContext;
}

describe("ask_user", () => {
	it("asks free-text questions", async () => {
		const input = vi.fn(async () => "癌症影像");
		const ctx = context({ input });
		const definition = createAskUserToolDefinition(process.cwd());
		const result = await definition.execute(
			"call",
			{ questions: [{ question: "研究主题是什么？" }] },
			undefined,
			undefined,
			ctx,
		);
		expect(input).toHaveBeenCalledWith("研究主题是什么？", "Type your answer");
		expect(result.details?.answers[0]?.answer).toBe("癌症影像");
		expect(result.details?.cancelled).toBe(false);
	});

	it("offers options and falls back to free text", async () => {
		const select = vi.fn(async () => "Other (type an answer)");
		const input = vi.fn(async () => "自定义答案");
		const ctx = context({ select, input });
		const definition = createAskUserToolDefinition(process.cwd());
		const result = await definition.execute(
			"call",
			{
				questions: [
					{
						question: "使用哪种数据集？",
						header: "Data",
						options: [{ label: "公开数据集", description: "可复现" }, { label: "自建数据集" }],
					},
				],
			},
			undefined,
			undefined,
			ctx,
		);
		expect(select).toHaveBeenCalledWith("Data: 使用哪种数据集？", [
			"公开数据集",
			"自建数据集",
			"Other (type an answer)",
		]);
		expect(result.details?.answers[0]?.answer).toBe("自定义答案");
	});

	it("supports multi-select through confirmations", async () => {
		const confirm = vi.fn(async () => true);
		const input = vi.fn(async () => undefined);
		const ctx = context({ confirm, input });
		const definition = createAskUserToolDefinition(process.cwd());
		const result = await definition.execute(
			"call",
			{
				questions: [
					{
						question: "需要哪些输出？",
						options: [{ label: "PDF" }, { label: "BibTeX" }, { label: "数据" }],
						multiSelect: true,
					},
				],
			},
			undefined,
			undefined,
			ctx,
		);
		expect(confirm).toHaveBeenCalledTimes(3);
		expect(result.details?.answers[0]?.answer).toBe("PDF; BibTeX; 数据");
	});

	it("reports cancellation and skips remaining questions", async () => {
		const input = vi.fn(async () => undefined);
		const ctx = context({ input });
		const definition = createAskUserToolDefinition(process.cwd());
		const result = await definition.execute(
			"call",
			{
				questions: [{ question: "第一个问题？" }, { question: "第二个问题？" }],
			},
			undefined,
			undefined,
			ctx,
		);
		expect(input).toHaveBeenCalledTimes(1);
		expect(result.details?.cancelled).toBe(true);
		expect(result.details?.answers.map((answer) => answer.skipped)).toEqual([true]);
	});

	it("explains that questions are unavailable outside the TUI", async () => {
		const ctx = context({}, "print");
		const definition = createAskUserToolDefinition(process.cwd());
		const result = await definition.execute(
			"call",
			{ questions: [{ question: "继续吗？" }] },
			undefined,
			undefined,
			ctx,
		);
		expect(result.details?.cancelled).toBe(true);
		expect(result.content[0]).toMatchObject({ type: "text" });
	});
});
