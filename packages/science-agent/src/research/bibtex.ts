import type { Paper } from "./types.ts";

export interface BibEntry {
	type: string;
	key: string;
	fields: Record<string, string>;
}

export interface BibParseResult {
	entries: BibEntry[];
	errors: Array<{ key?: string; message: string }>;
}

function readBracedValue(text: string, start: number): { value: string; end: number } | undefined {
	let depth = 0;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
		if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) return { value: text.slice(start + 1, index), end: index + 1 };
		}
	}
	return undefined;
}

function parseBody(body: string, entry: BibEntry, errors: BibParseResult["errors"]): void {
	let index = 0;
	while (index < body.length) {
		while (index < body.length && /[\s,]/.test(body[index]!)) index += 1;
		if (index >= body.length) break;
		const nameMatch = /^([\w-]+)\s*=\s*/.exec(body.slice(index));
		if (!nameMatch) {
			errors.push({ key: entry.key, message: `Could not parse field near "${body.slice(index, index + 40)}"` });
			return;
		}
		const name = nameMatch[1]!.toLowerCase();
		index += nameMatch[0].length;
		let value: string | undefined;
		const char = body[index];
		if (char === "{") {
			const braced = readBracedValue(body, index);
			if (!braced) {
				errors.push({ key: entry.key, message: `Unbalanced braces in field "${name}"` });
				return;
			}
			value = braced.value;
			index = braced.end;
		} else if (char === '"') {
			const end = body.indexOf('"', index + 1);
			if (end === -1) {
				errors.push({ key: entry.key, message: `Unterminated quoted field "${name}"` });
				return;
			}
			value = body.slice(index + 1, end);
			index = end + 1;
		} else {
			const end = body.indexOf(",", index);
			const stop = end === -1 ? body.length : end;
			value = body.slice(index, stop).trim();
			index = stop;
		}
		entry.fields[name] = value.replace(/\s+/g, " ").trim();
	}
}

/** Parse the BibTeX subset that researchers and reference managers produce in practice. */
export function parseBibtex(text: string): BibParseResult {
	const entries: BibEntry[] = [];
	const errors: BibParseResult["errors"] = [];
	const headerRe = /@(\w+)\s*\{/g;
	for (;;) {
		const match = headerRe.exec(text);
		if (!match) break;
		const type = match[1]!.toLowerCase();
		if (type === "comment" || type === "string" || type === "preamble") continue;
		const braced = readBracedValue(text, match.index + match[0].length - 1);
		if (!braced) {
			errors.push({ message: `Unbalanced entry starting at ${match.index}` });
			break;
		}
		const content = braced.value;
		const comma = content.indexOf(",");
		if (comma === -1) {
			errors.push({ message: `Entry @${type} has no key or fields` });
			headerRe.lastIndex = braced.end;
			continue;
		}
		const key = content.slice(0, comma).trim();
		const entry: BibEntry = { type, key, fields: {} };
		parseBody(content.slice(comma + 1), entry, errors);
		entries.push(entry);
		headerRe.lastIndex = braced.end;
	}
	return { entries, errors };
}

const FIELD_ORDER = [
	"author",
	"title",
	"journal",
	"booktitle",
	"year",
	"volume",
	"number",
	"pages",
	"publisher",
	"doi",
	"url",
	"eprint",
	"archiveprefix",
	"primaryclass",
	"note",
];

export function formatBibtexEntry(entry: BibEntry): string {
	const names = Object.keys(entry.fields).sort((a, b) => {
		const ai = FIELD_ORDER.indexOf(a);
		const bi = FIELD_ORDER.indexOf(b);
		if (ai === -1 && bi === -1) return a.localeCompare(b);
		if (ai === -1) return 1;
		if (bi === -1) return -1;
		return ai - bi;
	});
	const lines = names.map((name) => `\t${name} = {${entry.fields[name] ?? ""}}`);
	return `@${entry.type}{${entry.key},\n${lines.join(",\n")}\n}`;
}

export function formatBibtex(entries: BibEntry[]): string {
	return `${entries.map(formatBibtexEntry).join("\n\n")}\n`;
}

function asciiWord(value: string | undefined): string {
	return (value ?? "")
		.normalize("NFKD")
		.replace(/[^\x00-\x7F]/g, "")
		.replace(/[^a-zA-Z0-9]/g, "")
		.toLowerCase();
}

/** Generate a stable BibTeX key such as `vaswani2017attention`. */
export function makeCitationKey(paper: Paper): string {
	const firstAuthor = paper.authors[0] ?? "anon";
	const family = firstAuthor.split(/\s+/).at(-1) ?? firstAuthor;
	const titleWord =
		paper.title
			.split(/\s+/)
			.map(asciiWord)
			.find((word) => word.length >= 3 && !["the", "and", "for", "with", "from", "into", "using"].includes(word)) ??
		"paper";
	const year = paper.year ? String(paper.year) : "nd";
	const base = `${asciiWord(family) || "anon"}${year}${titleWord}`;
	return base.replace(/^(\d)/, "x$1");
}

export function paperToBibEntry(paper: Paper, key = makeCitationKey(paper)): BibEntry {
	const fields: Record<string, string> = {
		title: paper.title,
		author: paper.authors.join(" and "),
	};
	if (paper.venue) {
		const venueField = /journal|transactions|proceedings|conference/i.test(paper.venue) ? "journal" : "booktitle";
		fields[venueField] = paper.venue;
	}
	if (paper.year) fields.year = String(paper.year);
	if (paper.doi) fields.doi = paper.doi;
	if (paper.url) fields.url = paper.url;
	if (paper.arxivId) {
		fields.eprint = paper.arxivId;
		fields.archiveprefix = "arXiv";
	}
	const type = paper.arxivId && !paper.doi ? "misc" : paper.doi ? "article" : "misc";
	return { type, key, fields };
}

export function validateBibtex(result: BibParseResult): string[] {
	const problems = result.errors.map((error) =>
		error.key ? `${error.key}: ${error.message}` : (error.message ?? "Invalid entry"),
	);
	const seen = new Map<string, number>();
	for (const entry of result.entries) {
		seen.set(entry.key, (seen.get(entry.key) ?? 0) + 1);
		if (!entry.fields.title) problems.push(`${entry.key}: missing required field "title"`);
		if (!entry.fields.author && !entry.fields.editor) {
			problems.push(`${entry.key}: missing required field "author"`);
		}
		if (!entry.fields.year && !entry.fields.date) problems.push(`${entry.key}: missing "year"`);
	}
	for (const [key, count] of seen) {
		if (count > 1) problems.push(`${key}: duplicate citation key (${count} entries)`);
	}
	return problems;
}
