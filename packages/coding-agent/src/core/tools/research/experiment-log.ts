import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import type { ExperimentRun } from "../../../research/types.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchStoreFor } from "./shared.ts";

const AnyRecord = Type.Record(Type.String(), Type.Unknown());

const experimentLogSchema = Type.Object({
	action: Type.Union([
		Type.Literal("save"),
		Type.Literal("list"),
		Type.Literal("get"),
		Type.Literal("search"),
		Type.Literal("compare"),
	]),
	name: Type.Optional(Type.String({ description: "Experiment or run name for action=save." })),
	hypothesis: Type.Optional(Type.String({ description: "Hypothesis being tested." })),
	config: Type.Optional(AnyRecord),
	metrics: Type.Optional(AnyRecord),
	artifacts: Type.Optional(Type.Array(Type.String(), { description: "Paths or URLs of outputs, logs, or figures." })),
	status: Type.Optional(
		Type.Union([Type.Literal("planned"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed")]),
	),
	notes: Type.Optional(Type.String()),
	id: Type.Optional(Type.String({ description: "Experiment ID for get or update." })),
	ids: Type.Optional(Type.Array(Type.String(), { description: "Experiment IDs to compare." })),
	query: Type.Optional(Type.String({ description: "Search query for action=search." })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

export type ExperimentLogToolInput = Static<typeof experimentLogSchema>;

export interface ExperimentLogToolDetails {
	action: ExperimentLogToolInput["action"];
	experiment?: ExperimentRun;
	experiments?: ExperimentRun[];
}

export interface ExperimentLogToolOptions extends Partial<ResearchToolOptions> {}

export const experimentLogToolSystemPromptContribution = {
	snippet: "Record, search, and compare experiment runs with configurations, metrics, and artifacts",
	guidelines: [
		"Use experiment_log to record every meaningful run, including failed ones, with its configuration and metrics",
		"Compare runs by ID before claiming an improvement; report the exact metric names and values",
	],
} as const;

function formatMetric(value: unknown): string {
	if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}

function formatExperiment(run: ExperimentRun, index?: number): string {
	const prefix = index === undefined ? "" : `${index + 1}. `;
	const lines = [`${prefix}${run.name} [${run.status}]`, `ID: ${run.id}`];
	if (run.hypothesis) lines.push(`Hypothesis: ${run.hypothesis}`);
	const metrics = Object.entries(run.metrics);
	if (metrics.length > 0)
		lines.push(`Metrics: ${metrics.map(([key, value]) => `${key}=${formatMetric(value)}`).join(", ")}`);
	const config = Object.entries(run.config);
	if (config.length > 0)
		lines.push(`Config: ${config.map(([key, value]) => `${key}=${formatMetric(value)}`).join(", ")}`);
	if (run.artifacts.length > 0) lines.push(`Artifacts: ${run.artifacts.join(", ")}`);
	if (run.notes) lines.push(`Notes: ${run.notes}`);
	lines.push(`Updated: ${run.updatedAt}`);
	return lines.join("\n");
}

function compareExperiments(runs: ExperimentRun[]): string {
	if (runs.length < 2) throw new Error("experiment_log compare requires at least two IDs");
	const metricNames = [...new Set(runs.flatMap((run) => Object.keys(run.metrics)))].sort();
	const lines = [
		`Compared ${runs.length} runs:`,
		"",
		...runs.map((run, index) => `${index + 1}. ${run.name} (${run.id}) [${run.status}]`),
	];
	if (metricNames.length === 0) {
		lines.push("", "No metrics were recorded on these runs.");
		return lines.join("\n");
	}
	lines.push("", `Metric | ${runs.map((_run, index) => `#${index + 1}`).join(" | ")}`);
	lines.push(`--- | ${runs.map(() => "---").join(" | ")}`);
	for (const metric of metricNames) {
		const values = runs.map((run) => {
			const value = run.metrics[metric];
			return value === undefined ? "-" : formatMetric(value);
		});
		lines.push(`${metric} | ${values.join(" | ")}`);
	}
	const numericMetrics = metricNames.filter((name) => runs.every((run) => typeof run.metrics[name] === "number"));
	if (numericMetrics.length > 0) {
		lines.push("", "Changes vs #1:");
		for (const metric of numericMetrics) {
			const baseline = runs[0]!.metrics[metric] as number;
			const deltas = runs.slice(1).map((run, index) => {
				const value = run.metrics[metric] as number;
				const delta = value - baseline;
				const pct = baseline !== 0 ? ` (${((delta / baseline) * 100).toFixed(1)}%)` : "";
				return `#${index + 2}: ${delta >= 0 ? "+" : ""}${formatMetric(delta)}${pct}`;
			});
			lines.push(`- ${metric}: ${deltas.join(", ")}`);
		}
	}
	return lines.join("\n");
}

export function createExperimentLogToolDefinition(
	_cwd: string,
	options?: ExperimentLogToolOptions,
): ToolDefinition<typeof experimentLogSchema, ExperimentLogToolDetails> {
	const store = () => researchStoreFor(options);
	return {
		name: "experiment_log",
		label: "experiment_log",
		description:
			"Record and query experiment runs in the local research database. Store hypotheses, configuration, metrics, artifact paths, status, and notes; then list, search, or compare runs.",
		promptSnippet: experimentLogToolSystemPromptContribution.snippet,
		promptGuidelines: [...experimentLogToolSystemPromptContribution.guidelines],
		parameters: experimentLogSchema,
		async execute(
			_toolCallId,
			params: ExperimentLogToolInput,
			_signal: AbortSignal | undefined,
			_onUpdate,
			_ctx?: ExtensionContext,
		) {
			if (params.action === "save") {
				if (!params.name?.trim()) throw new Error("experiment_log save requires name");
				const experiment = store().saveExperiment({
					id: params.id,
					name: params.name,
					hypothesis: params.hypothesis,
					config: params.config as Record<string, unknown> | undefined,
					metrics: params.metrics as Record<string, unknown> | undefined,
					artifacts: params.artifacts,
					status: params.status,
					notes: params.notes,
				});
				return {
					content: [{ type: "text", text: `Saved experiment run.\n\n${formatExperiment(experiment)}` }],
					details: { action: "save", experiment },
				};
			}
			if (params.action === "get") {
				if (!params.id?.trim()) throw new Error("experiment_log get requires id");
				const experiment = store().getExperiment(params.id);
				if (!experiment) throw new Error(`No experiment with id ${params.id}`);
				return {
					content: [{ type: "text", text: formatExperiment(experiment) }],
					details: { action: "get", experiment },
				};
			}
			if (params.action === "search") {
				if (!params.query?.trim()) throw new Error("experiment_log search requires query");
				const experiments = store().searchExperiments(params.query, params.limit ?? 10);
				const text =
					experiments.length === 0
						? `No experiments matched "${params.query}".`
						: experiments.map((experiment, index) => formatExperiment(experiment, index)).join("\n\n");
				return {
					content: [{ type: "text", text }],
					details: { action: "search", experiments },
				};
			}
			if (params.action === "compare") {
				const ids = params.ids ?? [];
				const runs = ids.map((id) => store().getExperiment(id)).filter((run): run is ExperimentRun => Boolean(run));
				if (runs.length !== ids.length) {
					const missing = ids.filter((id) => !runs.some((run) => run.id === id));
					throw new Error(`Unknown experiment IDs: ${missing.join(", ")}`);
				}
				return {
					content: [{ type: "text", text: compareExperiments(runs) }],
					details: { action: "compare", experiments: runs },
				};
			}
			const experiments = store().listExperiments(params.limit ?? 20);
			const text =
				experiments.length === 0
					? "No experiments recorded yet."
					: experiments.map((experiment, index) => formatExperiment(experiment, index)).join("\n\n");
			return {
				content: [{ type: "text", text }],
				details: { action: "list", experiments },
			};
		},
	};
}

export function createExperimentLogTool(
	cwd: string,
	options?: ExperimentLogToolOptions,
): AgentTool<typeof experimentLogSchema> {
	return wrapToolDefinition(createExperimentLogToolDefinition(cwd, options));
}
