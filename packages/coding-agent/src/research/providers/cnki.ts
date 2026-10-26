import { spawn } from "node:child_process";
import { ensurePaperId } from "../identifiers.ts";
import type { Paper, PaperProviderContext, PaperSource } from "../types.ts";

type UnknownRecord = Record<string, unknown>;

const CNKI_HINT =
	"CNKI has no public search API. Configure research.cnkiCommand (for example a local cnki-search CLI) with /research. The command must print JSON and may use {query} and {limit} placeholders.";

/** Split a command template into argv, honoring single and double quotes and Windows paths. */
export function splitCommandLine(commandLine: string): string[] {
	const args: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	for (let index = 0; index < commandLine.length; index += 1) {
		const char = commandLine[index]!;
		if (quote === '"' && char === "\\" && commandLine[index + 1] === '"') {
			current += '"';
			index += 1;
			continue;
		}
		if (quote) {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current) args.push(current);
	return args;
}

function buildCommand(template: string, query: string, limit: number): { command: string; args: string[] } {
	const tokens = splitCommandLine(template);
	if (tokens.length === 0) throw new Error(CNKI_HINT);
	const [command, ...args] = tokens;
	let usedQuery = false;
	let usedLimit = false;
	const replaced = args.map((arg) => {
		let next = arg;
		if (next.includes("{query}")) {
			usedQuery = true;
			next = next.replaceAll("{query}", query);
		}
		if (next.includes("{limit}")) {
			usedLimit = true;
			next = next.replaceAll("{limit}", String(limit));
		}
		return next;
	});
	if (!usedQuery) replaced.push(query);
	if (!usedLimit) replaced.push(String(limit));
	return { command: command!, args: replaced };
}

function firstString(record: UnknownRecord, names: string[]): string | undefined {
	for (const name of names) {
		const value = record[name];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number") return String(value);
	}
	return undefined;
}

function stringList(record: UnknownRecord, names: string[]): string[] {
	for (const name of names) {
		const value = record[name];
		if (Array.isArray(value)) {
			return value
				.map((item) => (typeof item === "string" ? item.trim() : typeof item === "number" ? String(item) : ""))
				.filter(Boolean);
		}
		if (typeof value === "string" && value.trim()) {
			return value
				.split(/[;；,，、]/)
				.map((item) => item.trim())
				.filter(Boolean);
		}
	}
	return [];
}

function extractItems(value: unknown): UnknownRecord[] {
	if (Array.isArray(value))
		return value.filter((item): item is UnknownRecord => typeof item === "object" && item !== null);
	if (typeof value !== "object" || value === null) return [];
	const record = value as UnknownRecord;
	for (const key of ["results", "papers", "items", "documents"]) {
		const candidate = record[key];
		if (Array.isArray(candidate)) {
			return candidate.filter((item): item is UnknownRecord => typeof item === "object" && item !== null);
		}
	}
	for (const key of ["data", "result"]) {
		const nested = extractItems(record[key]);
		if (nested.length > 0) return nested;
	}
	return [];
}

/** Normalize the JSON printed by a configured command source. */
export function normalizeCommandOutput(value: unknown, limit: number, source: PaperSource = "cnki"): Paper[] {
	return extractItems(value)
		.slice(0, limit)
		.map((item, index): Paper | undefined => {
			const title = firstString(item, ["title", "Title", "篇名", "题名"]);
			if (!title) return undefined;
			const authors = stringList(item, ["authors", "author", "creator", "Creator", "作者"]);
			const yearValue = firstString(item, ["year", "publishYear", "PublishYear", "date", "年份"]);
			const year = yearValue ? Number.parseInt(yearValue.slice(0, 4), 10) || undefined : undefined;
			const doi = firstString(item, ["doi", "DOI"]);
			const url = firstString(item, ["url", "Url", "URL", "link", "detailUrl"]);
			const pdfUrl = firstString(item, ["pdfUrl", "pdf_url", "PDFPath", "pdf"]);
			const citationValue = firstString(item, ["citationCount", "citedCount", "CitedCount", "cited"]);
			const citationCount = citationValue ? Number.parseInt(citationValue, 10) || undefined : undefined;
			return ensurePaperId({
				id: doi ? "" : `${source}:${firstString(item, ["id", "Id", "key"]) ?? url ?? `result-${index}`}`,
				title,
				authors,
				year,
				venue: firstString(item, ["venue", "journal", "Journal", "source", "periodical", "刊名", "来源"]),
				abstract: firstString(item, ["abstract", "summary", "Abstract", "摘要"]),
				doi,
				url,
				pdfUrl,
				citationCount,
				openAccess: Boolean(pdfUrl),
				sources: [source],
			});
		})
		.filter((paper): paper is Paper => Boolean(paper));
}

function parseJsonOutput(stdout: string): unknown {
	const text = stdout.trim();
	if (!text) throw new Error("CNKI command printed no output");
	try {
		return JSON.parse(text) as unknown;
	} catch {
		// Fall back to the outermost JSON value when the command logs before it.
		for (const [startChar, endChar] of [
			["[", "]"],
			["{", "}"],
		] as const) {
			const start = text.indexOf(startChar);
			const end = text.lastIndexOf(endChar);
			if (start !== -1 && end > start) {
				try {
					return JSON.parse(text.slice(start, end + 1)) as unknown;
				} catch {
					// Try the next shape.
				}
			}
		}
	}
	throw new Error("CNKI command did not print valid JSON");
}

function runCommand(
	command: string,
	args: string[],
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			fn();
		};
		const onAbort = () => {
			child.kill();
			finish(() => reject(new Error("Operation aborted")));
		};
		const timer = setTimeout(() => {
			child.kill();
			finish(() => reject(new Error(`CNKI command timed out after ${timeoutMs}ms`)));
		}, timeoutMs);
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", (code) => {
			finish(() =>
				resolve({
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
					code,
				}),
			);
		});
	});
}

/** Normalize the JSON printed by a configured CNKI command. */
export function normalizeCnkiOutput(value: unknown, limit: number): Paper[] {
	return normalizeCommandOutput(value, limit, "cnki");
}

/** Run a configured command that prints normalized JSON for a source. */
export async function searchCommandSource(
	template: string | undefined,
	source: PaperSource,
	hint: string,
	query: string,
	context: PaperProviderContext,
): Promise<Paper[]> {
	if (!template) throw new Error(hint);
	const { command, args } = buildCommand(template, query, context.limit);
	const result = await runCommand(command, args, context.timeoutMs, context.signal);
	if (result.code !== 0) {
		throw new Error(
			`${source} command exited with code ${result.code}: ${result.stderr.trim().slice(0, 500) || result.stdout.trim().slice(0, 500)}`,
		);
	}
	return normalizeCommandOutput(parseJsonOutput(result.stdout), context.limit, source);
}

/** Run the configured CNKI command and normalize its JSON output. */
export async function searchCnki(query: string, context: PaperProviderContext): Promise<Paper[]> {
	return searchCommandSource(context.cnkiCommand, "cnki", CNKI_HINT, query, context);
}
