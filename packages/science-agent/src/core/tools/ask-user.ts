import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import type { ExtensionToolContext, ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const optionSchema = Type.Object({
	label: Type.String({ minLength: 1, description: "Short option label." }),
	description: Type.Optional(Type.String({ description: "Optional explanation shown with the option." })),
});

const askUserSchema = Type.Object({
	questions: Type.Array(
		Type.Object({
			question: Type.String({ minLength: 1, description: "The question to ask." }),
			header: Type.Optional(
				Type.String({ description: "Short label for the dialog title, such as Scope or Format." }),
			),
			options: Type.Optional(
				Type.Array(optionSchema, {
					description: "Suggested answers. Omit for a free-text question.",
				}),
			),
			allowOther: Type.Optional(
				Type.Boolean({ description: "Offer a free-text answer in addition to the options (default: true)." }),
			),
			multiSelect: Type.Optional(
				Type.Boolean({ description: "Let the user select more than one option (default: false)." }),
			),
		}),
		{ minItems: 1, maxItems: 5, description: "Questions to ask, in order." },
	),
});

export type AskUserToolInput = Static<typeof askUserSchema>;

export interface AskUserAnswer {
	question: string;
	answer?: string;
	skipped?: boolean;
}

export interface AskUserToolDetails {
	answers: AskUserAnswer[];
	cancelled: boolean;
}

export const askUserToolSystemPromptContribution = {
	snippet: "Ask the user clarifying questions when requirements are ambiguous",
	guidelines: [
		"When a request is ambiguous, use ask_user to clarify goals, scope, constraints, and acceptance criteria before making large assumptions",
		"Ask one focused set of questions at a time, offer concrete options when possible, and keep asking until the task is clear",
		"Do not use ask_user for questions you can answer from the repository, the web, or reasonable conventions",
	],
} as const;

const OTHER_LABEL = "Other (type an answer)";

async function askOne(
	question: AskUserToolInput["questions"][number],
	ctx: ExtensionToolContext,
): Promise<string | undefined> {
	const title = question.header ? `${question.header}: ${question.question}` : question.question;
	const options = question.options ?? [];
	if (options.length === 0) {
		return ctx.ui.input(title, "Type your answer");
	}
	if (question.multiSelect) {
		const selected: string[] = [];
		for (const option of options) {
			const label = option.description ? `${option.label}\n\n${option.description}` : option.label;
			if (await ctx.ui.confirm(title, label)) selected.push(option.label);
		}
		if (question.allowOther !== false) {
			const extra = await ctx.ui.input(`${title} — additional answer (optional)`);
			if (extra?.trim()) selected.push(extra.trim());
		}
		return selected.length > 0 ? selected.join("; ") : "none";
	}
	const labels = options.map((option) => option.label);
	const allowOther = question.allowOther !== false;
	const choice = await ctx.ui.select(title, allowOther ? [...labels, OTHER_LABEL] : labels);
	if (choice === undefined) return undefined;
	if (choice === OTHER_LABEL) return ctx.ui.input(title, "Type your answer");
	return choice;
}

export function createAskUserToolDefinition(
	_cwd: string,
	_options?: Record<string, never>,
): ToolDefinition<typeof askUserSchema, AskUserToolDetails> {
	return {
		name: "ask_user",
		label: "ask_user",
		description:
			"Ask the user clarifying questions when requirements are ambiguous. Supports free-text answers, single-choice options, and multi-select options. Ask one focused set, then continue asking until goals, scope, constraints, and acceptance criteria are clear.",
		promptSnippet: askUserToolSystemPromptContribution.snippet,
		promptGuidelines: [...askUserToolSystemPromptContribution.guidelines],
		parameters: askUserSchema,
		executionMode: "sequential",
		async execute(
			_toolCallId,
			params: AskUserToolInput,
			_signal: AbortSignal | undefined,
			_onUpdate,
			ctx: ExtensionToolContext,
		) {
			if (ctx.mode !== "tui") {
				return {
					content: [
						{
							type: "text",
							text: "Questions cannot be shown in this mode. Ask the user directly in your response and wait for their answer.",
						},
					],
					details: {
						answers: params.questions.map((question) => ({ question: question.question, skipped: true })),
						cancelled: true,
					},
				};
			}
			const answers: AskUserAnswer[] = [];
			for (const question of params.questions) {
				const answer = await askOne(question, ctx);
				if (answer === undefined) {
					answers.push({ question: question.question, skipped: true });
					return {
						content: [
							{
								type: "text",
								text: `${answers
									.map((item) =>
										item.skipped
											? `Q: ${item.question}\nA: (skipped)`
											: `Q: ${item.question}\nA: ${item.answer}`,
									)
									.join("\n\n")}\n\nThe user cancelled. Ask again if the answer is required.`,
							},
						],
						details: { answers, cancelled: true },
					};
				}
				answers.push({ question: question.question, answer });
			}
			return {
				content: [
					{
						type: "text",
						text: answers.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n"),
					},
				],
				details: { answers, cancelled: false },
			};
		},
	};
}

export function createAskUserTool(cwd: string): AgentTool<typeof askUserSchema> {
	return wrapToolDefinition(createAskUserToolDefinition(cwd));
}
