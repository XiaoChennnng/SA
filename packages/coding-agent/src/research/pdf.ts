import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { researchFetchBytes } from "./http.ts";
import { probeCommandSync, pythonPrefixArgs } from "./runtime.ts";

export type PdfToolKind = "pdftotext" | "mutool" | "python";

export interface PdfCommand {
	command: string;
	prefixArgs: string[];
	kind: PdfToolKind;
}

export interface PdfExtraction {
	text: string;
	pages: string[];
	tool: string;
}

const PYTHON_SCRIPT = [
	"import sys",
	"import fitz",
	'sys.stdout.reconfigure(encoding="utf-8")',
	"doc = fitz.open(sys.argv[1])",
	"for page in doc:",
	'    print(page.get_text("text"), end="")',
	'    print("\\f", end="")',
].join("\n");

// pdftotext -v reports its version but exits with status 99, so that probe is special.
function canProbe(candidate: PdfCommand): boolean {
	return probeCommandSync(candidate.command, probeArgs(candidate), {
		acceptStatus:
			candidate.kind === "pdftotext" ? (status) => status === 0 || status === 99 : (status) => status === 0,
	}).ok;
}

function kindFromName(name: string): PdfToolKind | undefined {
	const lower = basename(name).toLowerCase();
	if (lower.includes("pdftotext")) return "pdftotext";
	if (lower.includes("mutool")) return "mutool";
	if (lower.includes("python") || lower === "py" || lower === "py.exe") return "python";
	return undefined;
}

function makeCommand(name: string, kind: PdfToolKind): PdfCommand {
	return {
		command: name,
		prefixArgs: kind === "python" ? pythonPrefixArgs(name) : [],
		kind,
	};
}

let detected: PdfCommand | null | undefined;

// Settings can change during a session; /doctor and /research need to re-probe.
export function resetPdfCommandDetection(): void {
	detected = undefined;
}

export function inspectPdfCommand(configured?: string): { command?: PdfCommand; error?: string } {
	try {
		const command = detectPdfCommand(configured);
		return command ? { command } : { error: pdfCommandHint() };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function probeArgs(candidate: PdfCommand): string[] {
	if (candidate.kind === "python") return [...candidate.prefixArgs, "-c", "import fitz"];
	return [...candidate.prefixArgs, "-v"];
}

/** Detect a PDF text extractor: the configured command, pdftotext, mutool, or Python with PyMuPDF. */
export function detectPdfCommand(configured?: string): PdfCommand | undefined {
	if (configured) {
		const kind = kindFromName(configured);
		if (!kind) {
			throw new Error(
				`Unsupported research.pdfCommand "${configured}". Use pdftotext, mutool, or a Python executable with PyMuPDF installed.`,
			);
		}
		const candidate = makeCommand(configured, kind);
		if (!canProbe(candidate)) {
			throw new Error(`Configured PDF command is not available: ${configured}`);
		}
		return candidate;
	}
	if (detected !== undefined) return detected ?? undefined;
	const candidates: PdfCommand[] = [
		makeCommand("pdftotext", "pdftotext"),
		makeCommand("mutool", "mutool"),
		makeCommand("python3", "python"),
		makeCommand("python", "python"),
		makeCommand("py", "python"),
	];
	for (const candidate of candidates) {
		if (canProbe(candidate)) {
			detected = candidate;
			return candidate;
		}
	}
	detected = null;
	return undefined;
}

export function pdfCommandHint(): string {
	return [
		"No PDF text extractor is available.",
		"Install one of:",
		"- poppler (`pdftotext`)",
		"- MuPDF (`mutool`, e.g. `mutool draw -F txt`)",
		"- Python with PyMuPDF (`pip install pymupdf`)",
		"Or set `research.pdfCommand` in settings.json.",
	].join("\n");
}

function splitPages(text: string): string[] {
	const pages = text
		.split("\f")
		.map((page) => page.replace(/\r\n/g, "\n").trim())
		.filter((page) => page.length > 0);
	if (pages.length <= 1 && (pages[0]?.length ?? 0) > 8000) {
		const chunks: string[] = [];
		const paragraphs = pages[0]!.split(/\n{2,}/);
		let chunk = "";
		for (const paragraph of paragraphs) {
			if (chunk.length + paragraph.length > 4000 && chunk) {
				chunks.push(chunk.trim());
				chunk = "";
			}
			chunk += `${paragraph}\n\n`;
		}
		if (chunk.trim()) chunks.push(chunk.trim());
		return chunks;
	}
	return pages;
}

export async function extractPdfText(
	pdfPath: string,
	options: { signal?: AbortSignal; timeoutMs?: number; command?: string } = {},
): Promise<PdfExtraction> {
	const command = detectPdfCommand(options.command);
	if (!command) throw new Error(pdfCommandHint());
	const args =
		command.kind === "pdftotext"
			? [...command.prefixArgs, "-layout", "-enc", "UTF-8", pdfPath, "-"]
			: command.kind === "mutool"
				? [...command.prefixArgs, "draw", "-F", "txt", "-o", "-", pdfPath]
				: [...command.prefixArgs, "-c", PYTHON_SCRIPT, pdfPath];
	const timeoutMs = options.timeoutMs ?? 120_000;

	return new Promise((resolve, reject) => {
		const child = spawn(command.command, args, { stdio: ["ignore", "pipe", "pipe"] });
		const chunks: Buffer[] = [];
		const errors: Buffer[] = [];
		let bytes = 0;
		const limitBytes = 96 * 1024 * 1024;
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			fn();
		};
		const onAbort = () => {
			child.kill();
			finish(() => reject(new Error("Operation aborted")));
		};
		const timer = setTimeout(() => {
			child.kill();
			finish(() => reject(new Error(`PDF extraction timed out after ${timeoutMs}ms`)));
		}, timeoutMs);
		options.signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > limitBytes) {
				child.kill();
				finish(() => reject(new Error("Extracted PDF text is too large")));
				return;
			}
			chunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", (code) => {
			finish(() => {
				if (code !== 0) {
					reject(
						new Error(
							`${command.command} exited with code ${code}: ${Buffer.concat(errors).toString("utf8").trim().slice(0, 500)}`,
						),
					);
					return;
				}
				const text = Buffer.concat(chunks).toString("utf8").trim();
				if (!text) {
					reject(new Error("No text was extracted; the PDF may be scanned. OCR is not included."));
					return;
				}
				resolve({
					text,
					pages: splitPages(text),
					tool: `${command.command}${command.prefixArgs.length ? ` ${command.prefixArgs.join(" ")}` : ""}`,
				});
			});
		});
	});
}

/** Strip scripts, styles, and tags from an HTML page for readable fallback text. */
export function stripHtmlToText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

/** Download a PDF into the research cache and verify its header. */
export async function downloadPdf(
	url: string,
	destination: string,
	options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
	const { bytes, contentType } = await researchFetchBytes(url, {
		signal: options.signal,
		timeoutMs: options.timeoutMs,
		maxBytes: 64 * 1024 * 1024,
	});
	const header = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
	if (header !== "%PDF-" && !contentType?.toLowerCase().includes("pdf")) {
		throw new Error(`The response is not a PDF (content-type: ${contentType ?? "unknown"})`);
	}
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, bytes);
	return destination;
}

export function pdfCachePath(cacheDir: string, paperId: string): string {
	const safe = paperId.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
	return join(cacheDir, "papers", `${safe}.pdf`);
}
