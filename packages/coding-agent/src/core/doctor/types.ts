import type { CommandProbe } from "../../research/runtime.ts";

export type DoctorStatus = "ok" | "warn" | "missing" | "info";

export interface DoctorItem {
	id: string;
	label: string;
	status: DoctorStatus;
	detail?: string;
	required?: boolean;
	affects?: string[];
	install?: string;
}

export interface DoctorGroup {
	title: string;
	items: DoctorItem[];
}

export interface DoctorReport {
	kind: "local" | "ssh";
	label: string;
	groups: DoctorGroup[];
	missing: DoctorItem[];
	warnings: DoctorItem[];
	generatedAt: number;
}

export interface DoctorEnvironment {
	kind: "local" | "ssh";
	label: string;
	platform: string;
	home?: string;
	/** SSH workspace paths, present only for remote environments. */
	remotePaths?: { workspacePath: string; researchDir: string };
	/** Node.js version when SA itself runs here; remote environments leave it undefined. */
	nodeVersion?: string;
	probe(
		command: string,
		args?: string[],
		options?: { acceptStatus?: (status: number | null) => boolean },
	): Promise<CommandProbe>;
	which(command: string): Promise<string | undefined>;
	pathExists(path: string): Promise<boolean>;
	pathWritable(path: string): Promise<boolean>;
	readText(path: string): Promise<string | undefined>;
	/** Runs one batched remote diagnostic script; local environments may omit it. */
	diagnostics?(): Promise<Record<string, string>>;
}
