import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

const HEADER = `# Research Knowledge Base

Maintained by SA and its research tools. Entries are ordinary \`##\` Markdown sections; edit them freely.
`;

export interface KnowledgeSection {
	/** Section heading without the leading "## ". */
	heading: string;
	/** Section body, trimmed. */
	body: string;
}

export interface KnowledgeSearchOptions {
	/** Only return sections whose heading starts with "<prefix>:". */
	prefix?: string;
	limit?: number;
}

function normalizeHeading(value: string): string {
	return value.replace(/\s+/g, " ").trim() || "Untitled";
}

function tokenize(query: string): string[] {
	return (
		query
			.toLowerCase()
			.match(/[\p{L}\p{N}]+/gu)
			?.slice(0, 20) ?? []
	);
}

/** Split a Markdown document into level-2 sections, ignoring "##" inside code fences. */
export function splitSections(markdown: string): KnowledgeSection[] {
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	const sections: KnowledgeSection[] = [];
	let heading: string | undefined;
	let body: string[] = [];
	let inFence = false;
	const flush = () => {
		if (heading !== undefined) sections.push({ heading, body: body.join("\n").trim() });
		heading = undefined;
		body = [];
	};
	for (const line of lines) {
		if (line.startsWith("```")) inFence = !inFence;
		if (!inFence && line.startsWith("## ")) {
			flush();
			heading = line.slice(3).trim();
			continue;
		}
		if (heading !== undefined) body.push(line);
	}
	flush();
	return sections;
}

/** Case-insensitive section search: every query token must appear in the heading or body. */
export function searchSections(
	sections: KnowledgeSection[],
	query: string,
	options: { limit?: number } = {},
): KnowledgeSection[] {
	const tokens = tokenize(query);
	if (tokens.length === 0) return [];
	return sections
		.filter((section) => {
			const text = `${section.heading}\n${section.body}`.toLowerCase();
			return tokens.every((token) => text.includes(token));
		})
		.slice(0, options.limit ?? 10);
}

/** Free-form Markdown research knowledge base. Reads never create the file. */
export class ResearchKnowledge {
	readonly path: string;

	constructor(path: string) {
		this.path = resolvePath(path);
	}

	read(): string {
		try {
			return readFileSync(this.path, "utf8");
		} catch {
			return "";
		}
	}

	exists(): boolean {
		return existsSync(this.path);
	}

	/** Append a Markdown section, creating the file and header on first write. */
	append(heading: string, body: string): void {
		const section = `\n## ${normalizeHeading(heading)}\n\n${body.trim()}\n`;
		mkdirSync(dirname(this.path), { recursive: true });
		if (!existsSync(this.path) || this.read().trim() === "") {
			writeFileSync(this.path, `${HEADER}${section}`, "utf8");
			return;
		}
		appendFileSync(this.path, section, "utf8");
	}

	/** Remove the first level-2 section with an exact heading match. */
	removeSection(heading: string): boolean {
		const text = this.read().replace(/\r\n/g, "\n");
		if (!text) return false;
		const lines = text.split("\n");
		let start = -1;
		let end = lines.length;
		let inFence = false;
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]!;
			if (line.startsWith("```")) inFence = !inFence;
			if (inFence || !line.startsWith("## ")) continue;
			if (start === -1) {
				if (line.slice(3).trim() === heading) start = index;
				continue;
			}
			end = index;
			break;
		}
		if (start === -1) return false;
		const next = `${lines.slice(0, start).join("\n").replace(/\s*$/, "")}\n\n${lines.slice(end).join("\n").replace(/^\s*/, "")}`;
		this.replaceFile(next);
		return true;
	}

	sections(prefix?: string): KnowledgeSection[] {
		const sections = splitSections(this.read());
		if (!prefix) return sections;
		const marker = prefix.toLowerCase();
		return sections.filter((section) => {
			const heading = section.heading.toLowerCase();
			return heading === marker || heading.startsWith(`${marker}:`) || heading.startsWith(`${marker} [`);
		});
	}

	search(query: string, options: KnowledgeSearchOptions = {}): KnowledgeSection[] {
		return searchSections(this.sections(options.prefix), query, { limit: options.limit });
	}

	close(): void {}

	private replaceFile(content: string): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const temp = `${this.path}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temp, content.endsWith("\n") ? content : `${content}\n`, "utf8");
			renameSync(temp, this.path);
		} catch (error) {
			try {
				rmSync(temp, { force: true });
			} catch {
				// Ignore cleanup errors and rethrow the original failure.
			}
			throw error;
		}
	}
}

const knowledgeBases = new Map<string, ResearchKnowledge>();

/** Open (or reuse) the knowledge base for a Markdown path. */
export function getResearchKnowledge(path: string): ResearchKnowledge {
	const key = resolvePath(path);
	const existing = knowledgeBases.get(key);
	if (existing) return existing;
	const knowledge = new ResearchKnowledge(key);
	knowledgeBases.set(key, knowledge);
	return knowledge;
}
