import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CitationRecord, ExperimentRun, Paper, ResearchNote } from "./types.ts";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS papers (
	id TEXT PRIMARY KEY,
	doi TEXT,
	arxiv_id TEXT,
	pubmed_id TEXT,
	title TEXT NOT NULL,
	authors TEXT NOT NULL DEFAULT '[]',
	year INTEGER,
	venue TEXT,
	abstract TEXT,
	url TEXT,
	pdf_url TEXT,
	sources TEXT NOT NULL DEFAULT '[]',
	citation_count INTEGER,
	open_access INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS papers_arxiv ON papers(arxiv_id);
CREATE INDEX IF NOT EXISTS papers_pubmed ON papers(pubmed_id);

CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(id UNINDEXED, title, abstract, authors, tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS papers_ai AFTER INSERT ON papers BEGIN
	INSERT INTO papers_fts(rowid, id, title, abstract, authors)
	VALUES (new.rowid, new.id, new.title, coalesce(new.abstract, ''), new.authors);
END;
CREATE TRIGGER IF NOT EXISTS papers_ad AFTER DELETE ON papers BEGIN
	DELETE FROM papers_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS papers_au AFTER UPDATE ON papers BEGIN
	DELETE FROM papers_fts WHERE rowid = old.rowid;
	INSERT INTO papers_fts(rowid, id, title, abstract, authors)
	VALUES (new.rowid, new.id, new.title, coalesce(new.abstract, ''), new.authors);
END;

CREATE TABLE IF NOT EXISTS notes (
	id TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	paper_id TEXT,
	title TEXT NOT NULL,
	content TEXT NOT NULL,
	tags TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_paper ON notes(paper_id);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED, title, content, tags, tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
	INSERT INTO notes_fts(rowid, id, title, content, tags)
	VALUES (new.rowid, new.id, new.title, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
	DELETE FROM notes_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
	DELETE FROM notes_fts WHERE rowid = old.rowid;
	INSERT INTO notes_fts(rowid, id, title, content, tags)
	VALUES (new.rowid, new.id, new.title, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS experiments (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	hypothesis TEXT,
	config TEXT NOT NULL DEFAULT '{}',
	metrics TEXT NOT NULL DEFAULT '{}',
	artifacts TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL,
	notes TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS experiments_fts USING fts5(id UNINDEXED, name, hypothesis, notes, config, tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS experiments_ai AFTER INSERT ON experiments BEGIN
	INSERT INTO experiments_fts(rowid, id, name, hypothesis, notes, config)
	VALUES (new.rowid, new.id, new.name, coalesce(new.hypothesis, ''), coalesce(new.notes, ''), new.config);
END;
CREATE TRIGGER IF NOT EXISTS experiments_ad AFTER DELETE ON experiments BEGIN
	DELETE FROM experiments_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS experiments_au AFTER UPDATE ON experiments BEGIN
	DELETE FROM experiments_fts WHERE rowid = old.rowid;
	INSERT INTO experiments_fts(rowid, id, name, hypothesis, notes, config)
	VALUES (new.rowid, new.id, new.name, coalesce(new.hypothesis, ''), coalesce(new.notes, ''), new.config);
END;

CREATE TABLE IF NOT EXISTS citations (
	key TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	paper_id TEXT,
	fields TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
`;

type Row = Record<string, string | number | null>;

function parseJson<T>(value: string | number | null | undefined, fallback: T): T {
	if (typeof value !== "string" || !value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function ftsMatchExpression(query: string): string | undefined {
	const tokens = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 20);
	if (!tokens || tokens.length === 0) return undefined;
	return tokens.map((token) => `${token}*`).join(" AND ");
}

function rowToPaper(row: Row): Paper {
	return {
		id: String(row.id),
		title: String(row.title),
		authors: parseJson<string[]>(row.authors, []),
		year: row.year === null ? undefined : Number(row.year),
		venue: row.venue === null ? undefined : String(row.venue),
		abstract: row.abstract === null ? undefined : String(row.abstract),
		doi: row.doi === null ? undefined : String(row.doi),
		arxivId: row.arxiv_id === null ? undefined : String(row.arxiv_id),
		pubmedId: row.pubmed_id === null ? undefined : String(row.pubmed_id),
		url: row.url === null ? undefined : String(row.url),
		pdfUrl: row.pdf_url === null ? undefined : String(row.pdf_url),
		citationCount: row.citation_count === null ? undefined : Number(row.citation_count),
		openAccess: Number(row.open_access) === 1,
		sources: parseJson<Paper["sources"]>(row.sources, []),
	};
}

function rowToNote(row: Row): ResearchNote {
	return {
		id: String(row.id),
		kind: String(row.kind) as ResearchNote["kind"],
		paperId: row.paper_id === null ? undefined : String(row.paper_id),
		title: String(row.title),
		content: String(row.content),
		tags: parseJson<string[]>(row.tags, []),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

function rowToExperiment(row: Row): ExperimentRun {
	return {
		id: String(row.id),
		name: String(row.name),
		hypothesis: row.hypothesis === null ? undefined : String(row.hypothesis),
		config: parseJson<Record<string, unknown>>(row.config, {}),
		metrics: parseJson<Record<string, unknown>>(row.metrics, {}),
		artifacts: parseJson<string[]>(row.artifacts, []),
		status: String(row.status) as ExperimentRun["status"],
		notes: row.notes === null ? undefined : String(row.notes),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

function rowToCitation(row: Row): CitationRecord {
	return {
		key: String(row.key),
		type: String(row.type),
		paperId: row.paper_id === null ? undefined : String(row.paper_id),
		fields: parseJson<Record<string, string>>(row.fields, {}),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

/** Local research knowledge base backed by SQLite and FTS5. */
export class ResearchStore {
	private readonly db: DatabaseSync;

	constructor(path: string) {
		mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path);
		this.db.exec(SCHEMA);
	}

	close(): void {
		this.db.close();
	}

	upsertPaper(paper: Paper): void {
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO papers (id, doi, arxiv_id, pubmed_id, title, authors, year, venue, abstract, url, pdf_url, sources, citation_count, open_access, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				 	doi = coalesce(excluded.doi, papers.doi),
				 	arxiv_id = coalesce(excluded.arxiv_id, papers.arxiv_id),
				 	pubmed_id = coalesce(excluded.pubmed_id, papers.pubmed_id),
				 	title = excluded.title,
				 	authors = excluded.authors,
				 	year = coalesce(excluded.year, papers.year),
				 	venue = coalesce(excluded.venue, papers.venue),
				 	abstract = coalesce(excluded.abstract, papers.abstract),
				 	url = coalesce(excluded.url, papers.url),
				 	pdf_url = coalesce(excluded.pdf_url, papers.pdf_url),
				 	sources = excluded.sources,
				 	citation_count = max(coalesce(excluded.citation_count, 0), coalesce(papers.citation_count, 0)),
				 	open_access = max(excluded.open_access, papers.open_access),
				 	updated_at = excluded.updated_at`,
			)
			.run(
				paper.id,
				paper.doi ?? null,
				paper.arxivId ?? null,
				paper.pubmedId ?? null,
				paper.title,
				JSON.stringify(paper.authors),
				paper.year ?? null,
				paper.venue ?? null,
				paper.abstract ?? null,
				paper.url ?? null,
				paper.pdfUrl ?? null,
				JSON.stringify([...new Set(paper.sources)]),
				paper.citationCount ?? null,
				paper.openAccess ? 1 : 0,
				now,
				now,
			);
	}

	getPaper(id: string): Paper | undefined {
		const row = this.db.prepare("SELECT * FROM papers WHERE id = ?").get(id) as Row | undefined;
		return row ? rowToPaper(row) : undefined;
	}

	findPaper(parts: { doi?: string; arxivId?: string; pubmedId?: string }): Paper | undefined {
		const column = parts.doi ? "doi" : parts.arxivId ? "arxiv_id" : parts.pubmedId ? "pubmed_id" : undefined;
		const value = parts.doi ?? parts.arxivId ?? parts.pubmedId;
		if (!column || !value) return undefined;
		const row = this.db.prepare(`SELECT * FROM papers WHERE ${column} = ? ORDER BY updated_at DESC`).get(value) as
			| Row
			| undefined;
		return row ? rowToPaper(row) : undefined;
	}

	searchPapers(query: string, limit = 10): Paper[] {
		const match = ftsMatchExpression(query);
		if (match) {
			try {
				const rows = this.db
					.prepare(
						`SELECT p.* FROM papers_fts f JOIN papers p ON p.rowid = f.rowid
						 WHERE papers_fts MATCH ? ORDER BY rank LIMIT ?`,
					)
					.all(match, limit) as Row[];
				return rows.map(rowToPaper);
			} catch {
				// Fall back to LIKE for malformed FTS expressions.
			}
		}
		const like = `%${query}%`;
		const rows = this.db
			.prepare("SELECT * FROM papers WHERE title LIKE ? OR abstract LIKE ? ORDER BY updated_at DESC LIMIT ?")
			.all(like, like, limit) as Row[];
		return rows.map(rowToPaper);
	}

	saveNote(input: {
		id?: string;
		kind?: ResearchNote["kind"];
		paperId?: string;
		title?: string;
		content: string;
		tags?: string[];
	}): ResearchNote {
		const now = new Date().toISOString();
		const id = input.id ?? randomUUID();
		const existing = input.id ? this.getNote(input.id) : undefined;
		const title = input.title?.trim() || input.content.split("\n")[0]!.slice(0, 80) || "Untitled note";
		const note: ResearchNote = {
			id,
			kind: input.kind ?? existing?.kind ?? "note",
			paperId: input.paperId ?? existing?.paperId,
			title,
			content: input.content,
			tags: input.tags ?? existing?.tags ?? [],
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		this.db
			.prepare(
				`INSERT INTO notes (id, kind, paper_id, title, content, tags, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, paper_id = excluded.paper_id, title = excluded.title,
				 content = excluded.content, tags = excluded.tags, updated_at = excluded.updated_at`,
			)
			.run(
				note.id,
				note.kind,
				note.paperId ?? null,
				note.title,
				note.content,
				JSON.stringify(note.tags),
				note.createdAt,
				note.updatedAt,
			);
		return note;
	}

	getNote(id: string): ResearchNote | undefined {
		const row = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as Row | undefined;
		return row ? rowToNote(row) : undefined;
	}

	searchNotes(query: string, limit = 10): ResearchNote[] {
		const match = ftsMatchExpression(query);
		if (match) {
			try {
				const rows = this.db
					.prepare(
						`SELECT n.* FROM notes_fts f JOIN notes n ON n.rowid = f.rowid
						 WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`,
					)
					.all(match, limit) as Row[];
				return rows.map(rowToNote);
			} catch {
				// Fall back to LIKE.
			}
		}
		const like = `%${query}%`;
		const rows = this.db
			.prepare("SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT ?")
			.all(like, like, limit) as Row[];
		return rows.map(rowToNote);
	}

	listNotes(limit = 20): ResearchNote[] {
		const rows = this.db.prepare("SELECT * FROM notes ORDER BY updated_at DESC LIMIT ?").all(limit) as Row[];
		return rows.map(rowToNote);
	}

	deleteNote(id: string): boolean {
		const result = this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
		return Number(result.changes) > 0;
	}

	saveExperiment(input: {
		id?: string;
		name: string;
		hypothesis?: string;
		config?: Record<string, unknown>;
		metrics?: Record<string, unknown>;
		artifacts?: string[];
		status?: ExperimentRun["status"];
		notes?: string;
	}): ExperimentRun {
		const now = new Date().toISOString();
		const id = input.id ?? randomUUID();
		const existing = input.id ? this.getExperiment(input.id) : undefined;
		const run: ExperimentRun = {
			id,
			name: input.name,
			hypothesis: input.hypothesis ?? existing?.hypothesis,
			config: input.config ?? existing?.config ?? {},
			metrics: input.metrics ?? existing?.metrics ?? {},
			artifacts: input.artifacts ?? existing?.artifacts ?? [],
			status: input.status ?? existing?.status ?? "completed",
			notes: input.notes ?? existing?.notes,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		this.db
			.prepare(
				`INSERT INTO experiments (id, name, hypothesis, config, metrics, artifacts, status, notes, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET name = excluded.name, hypothesis = excluded.hypothesis,
				 config = excluded.config, metrics = excluded.metrics, artifacts = excluded.artifacts,
				 status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at`,
			)
			.run(
				run.id,
				run.name,
				run.hypothesis ?? null,
				JSON.stringify(run.config),
				JSON.stringify(run.metrics),
				JSON.stringify(run.artifacts),
				run.status,
				run.notes ?? null,
				run.createdAt,
				run.updatedAt,
			);
		return run;
	}

	getExperiment(id: string): ExperimentRun | undefined {
		const row = this.db.prepare("SELECT * FROM experiments WHERE id = ?").get(id) as Row | undefined;
		return row ? rowToExperiment(row) : undefined;
	}

	listExperiments(limit = 20): ExperimentRun[] {
		const rows = this.db.prepare("SELECT * FROM experiments ORDER BY updated_at DESC LIMIT ?").all(limit) as Row[];
		return rows.map(rowToExperiment);
	}

	searchExperiments(query: string, limit = 10): ExperimentRun[] {
		const match = ftsMatchExpression(query);
		if (match) {
			try {
				const rows = this.db
					.prepare(
						`SELECT e.* FROM experiments_fts f JOIN experiments e ON e.rowid = f.rowid
						 WHERE experiments_fts MATCH ? ORDER BY rank LIMIT ?`,
					)
					.all(match, limit) as Row[];
				return rows.map(rowToExperiment);
			} catch {
				// Fall back to LIKE.
			}
		}
		const like = `%${query}%`;
		const rows = this.db
			.prepare("SELECT * FROM experiments WHERE name LIKE ? OR notes LIKE ? ORDER BY updated_at DESC LIMIT ?")
			.all(like, like, limit) as Row[];
		return rows.map(rowToExperiment);
	}

	saveCitation(citation: CitationRecord): CitationRecord {
		this.db
			.prepare(
				`INSERT INTO citations (key, type, paper_id, fields, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(key) DO UPDATE SET type = excluded.type, paper_id = excluded.paper_id,
				 fields = excluded.fields, updated_at = excluded.updated_at`,
			)
			.run(
				citation.key,
				citation.type,
				citation.paperId ?? null,
				JSON.stringify(citation.fields),
				citation.createdAt,
				citation.updatedAt,
			);
		return citation;
	}

	listCitations(): CitationRecord[] {
		const rows = this.db.prepare("SELECT * FROM citations ORDER BY key").all() as Row[];
		return rows.map(rowToCitation);
	}

	getCitation(key: string): CitationRecord | undefined {
		const row = this.db.prepare("SELECT * FROM citations WHERE key = ?").get(key) as Row | undefined;
		return row ? rowToCitation(row) : undefined;
	}

	deleteCitation(key: string): boolean {
		const result = this.db.prepare("DELETE FROM citations WHERE key = ?").run(key);
		return Number(result.changes) > 0;
	}
}

const stores = new Map<string, ResearchStore>();

/** Open (or reuse) the store for a database path. */
export function getResearchStore(path: string): ResearchStore {
	const existing = stores.get(path);
	if (existing) return existing;
	const store = new ResearchStore(path);
	stores.set(path, store);
	return store;
}

export function closeResearchStores(): void {
	for (const store of stores.values()) store.close();
	stores.clear();
}
