import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { isAbsolute, resolve as resolvePath } from "node:path";
import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import { probeCommandSync } from "../../../research/runtime.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchSettingsFor } from "./shared.ts";

const latexBuildSchema = Type.Object({
	path: Type.String({ minLength: 1, description: "Path to the main .tex file, relative to the working directory." }),
	engine: Type.Optional(
		Type.Union(
			[Type.Literal("latexmk"), Type.Literal("pdflatex"), Type.Literal("xelatex"), Type.Literal("lualatex")],
			{ description: "LaTeX engine (default: latexmk, falling back to pdflatex)." },
		),
	),
	outputDir: Type.Optional(Type.String({ description: "Output directory for auxiliary files and the PDF." })),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 5_000, maximum: 600_000 })),
});

export type LatexBuildToolInput = Static<typeof latexBuildSchema>;

export interface LatexBuildToolDetails {
	success: boolean;
	engine: string;
	pdfPath?: string;
	errors: string[];
	warnings: string[];
	logTail?: string;
}

export interface LatexBuildToolOptions extends Partial<ResearchToolOptions> {
	/** Inject a command runner for tests. */
	run?: (
		command: string,
		args: string[],
		cwd: string,
		timeoutMs: number,
		signal?: AbortSignal,
	) => Promise<CommandResult>;
	/** Inject availability detection for tests. */
	isAvailable?: (command: string) => boolean;
}

export interface CommandResult {
	code: number | null;
	output: string;
	timedOut: boolean;
}

export const latexBuildToolSystemPromptContribution = {
	snippet: "Compile a LaTeX document and report errors and warnings",
	guidelines: ["After editing .tex or .bib, compile and fix every reported error before claiming success"],
} as const;

function defaultIsAvailable(command: string): boolean {
	return probeCommandSync(command, ["--version"]).ok;
}

function runCommand(
	command: string,
	args: string[],
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<CommandResult> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		const chunks: Buffer[] = [];
		let settled = false;
		const finish = (result: CommandResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve(result);
		};
		const onAbort = () => {
			child.kill();
			finish({ code: null, output: Buffer.concat(chunks).toString("utf8"), timedOut: false });
		};
		const timer = setTimeout(() => {
			child.kill();
			finish({ code: null, output: Buffer.concat(chunks).toString("utf8"), timedOut: true });
		}, timeoutMs);
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
		child.on("error", (error) => finish({ code: null, output: error.message, timedOut: false }));
		child.on("close", (code) => finish({ code, output: Buffer.concat(chunks).toString("utf8"), timedOut: false }));
	});
}

function parseDiagnostics(output: string): { errors: string[]; warnings: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		if (line.startsWith("!") || (/:\d+: /.test(line) && /error/i.test(line)) || /^! LaTeX Error/.test(line)) {
			errors.push(line.slice(0, 500));
			continue;
		}
		if (/^(LaTeX|Package|Class) .*Warning:/.test(line) || /^Overfull \\[hv]box/.test(line)) {
			warnings.push(line.slice(0, 500));
		}
	}
	return { errors: [...new Set(errors)].slice(0, 30), warnings: [...new Set(warnings)].slice(0, 30) };
}

export function createLatexBuildToolDefinition(
	cwd: string,
	options?: LatexBuildToolOptions,
): ToolDefinition<typeof latexBuildSchema, LatexBuildToolDetails> {
	const run = options?.run ?? runCommand;
	const isAvailable = options?.isAvailable ?? defaultIsAvailable;
	return {
		name: "latex_build",
		label: "latex_build",
		description: "Compile a LaTeX document and return errors, warnings, and the PDF path on success.",
		promptSnippet: latexBuildToolSystemPromptContribution.snippet,
		promptGuidelines: [...latexBuildToolSystemPromptContribution.guidelines],
		parameters: latexBuildSchema,
		async execute(
			_toolCallId,
			params: LatexBuildToolInput,
			signal: AbortSignal | undefined,
			_onUpdate,
			ctx?: ExtensionContext,
		) {
			const settings = researchSettingsFor(options);
			const toolWorkspace = ctx?.workspace;
			const remote = toolWorkspace?.info.kind === "ssh";
			const pathModule = remote ? toolWorkspace!.path : path;
			const workDir = toolWorkspace?.info.cwd ?? ctx?.cwd ?? cwd;
			const texPath =
				remote && toolWorkspace
					? toolWorkspace.resolvePath(params.path)
					: isAbsolute(params.path)
						? params.path
						: resolvePath(workDir, params.path);
			const texExists = remote ? await toolWorkspace!.exists(texPath) : existsSync(texPath);
			if (!texExists) throw new Error(`LaTeX file not found: ${texPath}`);
			if (pathModule.extname(texPath).toLowerCase() !== ".tex") throw new Error(`Not a .tex file: ${texPath}`);
			const texDir = pathModule.dirname(texPath);
			const basenameNoExt = pathModule.basename(texPath, pathModule.extname(texPath));
			const outputDir = params.outputDir
				? remote
					? toolWorkspace!.resolvePath(params.outputDir)
					: resolvePath(workDir, params.outputDir)
				: texDir;
			const requested =
				params.engine ??
				(["latexmk", "pdflatex", "xelatex", "lualatex"].includes(settings.latexCommand ?? "")
					? settings.latexCommand!
					: "latexmk");
			const available = async (command: string): Promise<boolean> =>
				remote
					? (await toolWorkspace!.exec(command, ["--version"], { timeoutMs: 15_000 })).exitCode === 0
					: isAvailable(command);
			let engine = requested;
			if (requested === "latexmk" && !(await available("latexmk"))) {
				if (await available("pdflatex")) engine = "pdflatex";
				else {
					throw new Error(
						"No LaTeX engine is available. Install TeX Live/MiKTeX (latexmk, pdflatex, xelatex, or lualatex), set research.latexCommand, or run /doctor.",
					);
				}
			}
			const command =
				settings.latexCommand && !["latexmk", "pdflatex", "xelatex", "lualatex"].includes(settings.latexCommand)
					? settings.latexCommand
					: engine;
			if (!(await available(command))) throw new Error(`LaTeX command is not available: ${command}`);
			const outputArgs = outputDir === texDir ? [] : [`-output-directory=${outputDir}`];
			const args =
				engine === "latexmk"
					? [
							...outputArgs,
							"-interaction=nonstopmode",
							"-halt-on-error",
							"-file-line-error",
							"-pdf",
							pathModule.basename(texPath),
						]
					: [
							...outputArgs,
							"-interaction=nonstopmode",
							"-halt-on-error",
							"-file-line-error",
							pathModule.basename(texPath),
						];
			const timeoutMs = params.timeoutMs ?? 180_000;
			const execute = async (cmd: string, cmdArgs: string[]): Promise<CommandResult> => {
				if (!remote) return run(cmd, cmdArgs, texDir, timeoutMs, signal);
				const result = await toolWorkspace!.exec(cmd, cmdArgs, { cwd: texDir, timeoutMs, signal });
				if (result.aborted) throw new Error("Operation aborted");
				return {
					code: result.exitCode,
					output: `${result.stdout}${result.stderr}`,
					timedOut: result.timedOut,
				};
			};
			const first = await execute(command, args);
			let output = first.output;
			if (signal?.aborted) throw new Error("Operation aborted");
			if (first.timedOut) {
				return {
					content: [
						{ type: "text", text: `LaTeX build timed out after ${timeoutMs}ms.\n\n${output.slice(-4000)}` },
					],
					details: {
						success: false,
						engine,
						errors: ["Build timed out"],
						warnings: [],
						logTail: output.slice(-4000),
					},
				};
			}
			if (first.code === 0 && /Rerun to get|There were undefined references/i.test(output)) {
				const second = await execute(command, args);
				output = `${output}\n${second.output}`;
			}
			const diagnostics = parseDiagnostics(output);
			const pdfPath = pathModule.join(outputDir, `${basenameNoExt}.pdf`);
			const pdfExists = remote ? await toolWorkspace!.exists(pdfPath) : existsSync(pdfPath);
			const success = first.code === 0 && pdfExists;
			const logTail = output.split(/\r?\n/).slice(-80).join("\n");
			const lines = [
				success ? `LaTeX build succeeded with ${engine}.` : `LaTeX build failed with ${engine}.`,
				`Source: ${texPath}`,
				success ? `PDF: ${pdfPath}` : undefined,
				diagnostics.errors.length > 0
					? `Errors:\n${diagnostics.errors.map((error) => `- ${error}`).join("\n")}`
					: undefined,
				diagnostics.warnings.length > 0
					? `Warnings:\n${diagnostics.warnings.map((warning) => `- ${warning}`).join("\n")}`
					: undefined,
				success ? undefined : `Log tail:\n${logTail}`,
			]
				.filter((line): line is string => Boolean(line))
				.join("\n\n");
			return {
				content: [{ type: "text", text: lines }],
				details: {
					success,
					engine,
					pdfPath: success ? pdfPath : undefined,
					errors: diagnostics.errors,
					warnings: diagnostics.warnings,
					logTail: success ? undefined : logTail,
				},
			};
		},
	};
}

export function createLatexBuildTool(cwd: string, options?: LatexBuildToolOptions): AgentTool<typeof latexBuildSchema> {
	return wrapToolDefinition(createLatexBuildToolDefinition(cwd, options));
}
