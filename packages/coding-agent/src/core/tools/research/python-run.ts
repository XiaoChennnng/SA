import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve as resolvePath } from "node:path";
import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchSettingsFor, researchStoreFor } from "./shared.ts";

const pythonRunSchema = Type.Object({
	code: Type.Optional(Type.String({ description: "Python code to run. Provide code or script, not both." })),
	script: Type.Optional(Type.String({ description: "Path to a Python script, relative to the working directory." })),
	args: Type.Optional(Type.Array(Type.String(), { description: "Arguments passed to the script." })),
	cwd: Type.Optional(Type.String({ description: "Working directory (default: the session directory)." })),
	timeoutMs: Type.Optional(
		Type.Integer({ minimum: 1_000, maximum: 600_000, description: "Timeout (default: 120000)." }),
	),
	env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Extra environment variables." })),
	saveExperiment: Type.Optional(
		Type.Boolean({ description: "Record this run in the research experiment log (default: false)." }),
	),
	experimentName: Type.Optional(Type.String({ description: "Name for the recorded experiment run." })),
});

export type PythonRunToolInput = Static<typeof pythonRunSchema>;

export interface PythonRunToolDetails {
	exitCode: number | null;
	durationMs: number;
	python: string;
	scriptPath?: string;
	experimentId?: string;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

export interface PythonRunToolOptions extends Partial<ResearchToolOptions> {
	/** Inject a runner for tests. */
	run?: (
		command: string,
		args: string[],
		cwd: string,
		timeoutMs: number,
		env: Record<string, string> | undefined,
		signal?: AbortSignal,
	) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;
	isAvailable?: (command: string, args: string[]) => boolean;
}

export const pythonRunToolSystemPromptContribution = {
	snippet: "Run Python code or scripts for data analysis, with output capture and optional experiment logging",
	guidelines: [
		"Use python_run (or bash) for numerical analysis, but record inputs, parameters, and outputs with experiment_log when results matter",
		"Never present Python output as a research result without checking warnings, exit code, and the data it was computed from",
	],
} as const;

const MAX_OUTPUT = 40_000;

interface PythonCommand {
	command: string;
	prefixArgs: string[];
}

function defaultIsAvailable(command: string, args: string[]): boolean {
	const result = spawnSync(command, args, { stdio: "ignore", timeout: 5000 });
	return !result.error && result.status === 0;
}

function detectPython(
	configured: string | undefined,
	isAvailable: (command: string, args: string[]) => boolean,
): PythonCommand {
	if (configured) {
		const candidate = {
			command: configured,
			prefixArgs: basename(configured).toLowerCase().startsWith("py") ? ["-3"] : [],
		};
		if (!isAvailable(candidate.command, [...candidate.prefixArgs, "--version"])) {
			throw new Error(`Configured Python is not available: ${configured}`);
		}
		return candidate;
	}
	for (const candidate of [
		{ command: "python3", prefixArgs: [] },
		{ command: "python", prefixArgs: [] },
		{ command: "py", prefixArgs: ["-3"] },
	]) {
		if (isAvailable(candidate.command, [...candidate.prefixArgs, "--version"])) return candidate;
	}
	throw new Error("No Python interpreter found. Install Python or set research.pythonPath in settings.json.");
}

function defaultRun(
	command: string,
	args: string[],
	cwd: string,
	timeoutMs: number,
	env: Record<string, string> | undefined,
	signal?: AbortSignal,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, ...(env ?? {}) },
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let settled = false;
		const finish = (result: { code: number | null; stdout: string; stderr: string; timedOut: boolean }) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve(result);
		};
		const onAbort = () => {
			child.kill();
			finish({
				code: null,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
				timedOut: false,
			});
		};
		const timer = setTimeout(() => {
			child.kill();
			finish({
				code: null,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
				timedOut: true,
			});
		}, timeoutMs);
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", (error) =>
			finish({
				code: null,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: `${Buffer.concat(stderr).toString("utf8")}\n${error.message}`,
				timedOut: false,
			}),
		);
		child.on("close", (code) =>
			finish({
				code,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
				timedOut: false,
			}),
		);
	});
}

function clipOutput(text: string): string {
	if (text.length <= MAX_OUTPUT) return text;
	return `${text.slice(0, MAX_OUTPUT / 2)}\n\n[... ${text.length - MAX_OUTPUT} characters omitted ...]\n\n${text.slice(-MAX_OUTPUT / 2)}`;
}

export function createPythonRunToolDefinition(
	cwd: string,
	options?: PythonRunToolOptions,
): ToolDefinition<typeof pythonRunSchema, PythonRunToolDetails> {
	const run = options?.run ?? defaultRun;
	const isAvailable = options?.isAvailable ?? defaultIsAvailable;
	return {
		name: "python_run",
		label: "python_run",
		description:
			"Run Python code or a script with a timeout, capturing stdout, stderr, and the exit code. Use it for data analysis and numerical checks; optionally record the run in the experiment log.",
		promptSnippet: pythonRunToolSystemPromptContribution.snippet,
		promptGuidelines: [...pythonRunToolSystemPromptContribution.guidelines],
		parameters: pythonRunSchema,
		async execute(
			_toolCallId,
			params: PythonRunToolInput,
			signal: AbortSignal | undefined,
			_onUpdate,
			ctx?: ExtensionContext,
		) {
			if (!params.code?.trim() && !params.script?.trim()) {
				throw new Error("python_run requires code or script");
			}
			if (params.code?.trim() && params.script?.trim()) {
				throw new Error("python_run accepts code or script, not both");
			}
			const settings = researchSettingsFor(options);
			const workingDir = params.cwd ? resolvePath(ctx?.cwd ?? cwd, params.cwd) : (ctx?.cwd ?? cwd);
			const python = detectPython(settings.pythonPath, isAvailable);
			let scriptPath: string;
			if (params.script?.trim()) {
				scriptPath = isAbsolute(params.script) ? params.script : resolvePath(workingDir, params.script);
			} else {
				mkdirSync(settings.workDir, { recursive: true });
				scriptPath = join(settings.workDir, `sa-python-${Date.now()}.py`);
				writeFileSync(scriptPath, params.code!, "utf8");
			}
			const started = Date.now();
			const result = await run(
				python.command,
				[...python.prefixArgs, scriptPath, ...(params.args ?? [])],
				workingDir,
				params.timeoutMs ?? 120_000,
				params.env,
				signal,
			);
			const durationMs = Date.now() - started;
			if (signal?.aborted) throw new Error("Operation aborted");
			let experimentId: string | undefined;
			if (params.saveExperiment) {
				const experiment = researchStoreFor(options, settings).saveExperiment({
					name: params.experimentName?.trim() || basename(scriptPath),
					config: {
						python: python.command,
						script: scriptPath,
						args: params.args ?? [],
					},
					metrics: {},
					artifacts: [],
					status: result.code === 0 && !result.timedOut ? "completed" : "failed",
					notes: `exit=${result.code ?? "none"}${result.timedOut ? " timed_out" : ""}\n${clipOutput(result.stdout).slice(-2000)}\n${clipOutput(result.stderr).slice(-2000)}`,
				});
				experimentId = experiment.id;
			}
			const lines = [
				result.timedOut
					? `Python run timed out after ${params.timeoutMs ?? 120_000}ms.`
					: `Python exited with code ${result.code ?? "unknown"} in ${durationMs}ms.`,
				`Python: ${python.command}${python.prefixArgs.length ? ` ${python.prefixArgs.join(" ")}` : ""}`,
				`Script: ${scriptPath}`,
				experimentId ? `Experiment: ${experimentId}` : undefined,
				result.stdout.trim() ? `\nstdout:\n${clipOutput(result.stdout.trim())}` : undefined,
				result.stderr.trim() ? `\nstderr:\n${clipOutput(result.stderr.trim())}` : undefined,
			]
				.filter((line): line is string => Boolean(line))
				.join("\n");
			return {
				content: [{ type: "text", text: lines }],
				details: {
					exitCode: result.code,
					durationMs,
					python: python.command,
					scriptPath,
					experimentId,
					stdout: clipOutput(result.stdout),
					stderr: clipOutput(result.stderr),
					timedOut: result.timedOut,
				},
			};
		},
	};
}

export function createPythonRunTool(cwd: string, options?: PythonRunToolOptions): AgentTool<typeof pythonRunSchema> {
	return wrapToolDefinition(createPythonRunToolDefinition(cwd, options));
}
