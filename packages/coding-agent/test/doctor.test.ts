import { describe, expect, it } from "vitest";
import { collectDoctorReport } from "../src/core/doctor/checks.ts";
import {
	buildDoctorInstallPrompt,
	formatDoctorInstallCommands,
	formatDoctorReport,
} from "../src/core/doctor/format.ts";
import type { DoctorEnvironment, DoctorReport } from "../src/core/doctor/types.ts";
import { resolveResearchSettings } from "../src/research/settings.ts";

function env(overrides: Partial<DoctorEnvironment> = {}): DoctorEnvironment {
	return {
		kind: "ssh",
		label: "tester@host:/work",
		platform: "linux",
		home: "/home/tester",
		remotePaths: { workspacePath: "/work", researchDir: "/work/research" },
		async probe(command, args = []) {
			const line = `${command} ${args.join(" ")}`.trim();
			if (line === "npm --version") return { ok: true, status: 0, stdout: "10.0.0\n", stderr: "" };
			if (line === "git --version") return { ok: true, status: 0, stdout: "git version 2.45.0\n", stderr: "" };
			if (line === "bash --version") return { ok: true, status: 0, stdout: "GNU bash 5.2\n", stderr: "" };
			if (line === "/usr/bin/rg --version") return { ok: true, status: 0, stdout: "ripgrep 15\n", stderr: "" };
			if (line === "/usr/bin/fd --version") return { ok: true, status: 0, stdout: "fd 10\n", stderr: "" };
			if (line === "python3 --version") return { ok: true, status: 0, stdout: "Python 3.12.0\n", stderr: "" };
			if (line === "python3 -c import reportlab") return { ok: true, status: 0, stdout: "", stderr: "" };
			if (line === "python3 -c import pypdf") return { ok: false, status: 1, stdout: "", stderr: "" };
			if (line === "python3 -c import fitz") return { ok: false, status: 1, stdout: "", stderr: "" };
			if (command === "pdftotext") return { ok: false, status: 127, stdout: "", stderr: "" };
			if (command === "mutool") return { ok: false, status: 127, stdout: "", stderr: "" };
			if (["latexmk", "pdflatex", "xelatex", "lualatex"].includes(command)) {
				return { ok: false, status: 127, stdout: "", stderr: "" };
			}
			if (command === "fc-list") return { ok: true, status: 0, stdout: "Noto Sans CJK\n", stderr: "" };
			if (command === "nvidia-smi") return { ok: true, status: 0, stdout: "GPU 0: RTX 4090\n", stderr: "" };
			if (command === "df") {
				return {
					ok: true,
					status: 0,
					stdout:
						"Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/sda 100000 50000 45000 52% /work\n",
					stderr: "",
				};
			}
			if (command === "ssh") return { ok: true, status: 0, stdout: "", stderr: "OpenSSH_9.0" };
			return { ok: false, status: 127, stdout: "", stderr: "" };
		},
		async which(command) {
			if (command === "rg") return "/usr/bin/rg";
			if (command === "fd") return "/usr/bin/fd";
			if (command === "apt-get") return "/usr/bin/apt-get";
			if (command === "ssh-keygen") return "/usr/bin/ssh-keygen";
			return undefined;
		},
		async pathExists() {
			return true;
		},
		async pathWritable() {
			return true;
		},
		async readText() {
			return undefined;
		},
		...overrides,
	};
}

describe("doctor checks", () => {
	it("reports remote research dependencies and informational items", async () => {
		const report = await collectDoctorReport({ env: env(), settings: resolveResearchSettings({}) });
		const items = report.groups.flatMap((group) => group.items);
		expect(items.find((item) => item.id === "python")?.status).toBe("ok");
		expect(items.find((item) => item.id === "python-reportlab")?.status).toBe("ok");
		expect(items.find((item) => item.id === "python-pypdf")?.status).toBe("warn");
		expect(items.find((item) => item.id === "latex")?.status).toBe("warn");
		expect(items.find((item) => item.id === "cjk-fonts")?.status).toBe("ok");
		expect(items.find((item) => item.id === "gpu")?.detail).toContain("RTX 4090");
		expect(items.find((item) => item.id === "package-manager")?.detail).toBe("apt-get");
		expect(report.groups.some((group) => group.title.startsWith("Local auxiliary"))).toBe(true);
	});

	it("marks a missing remote Python as a required failure", async () => {
		const report = await collectDoctorReport({
			env: env({
				async probe(command, args = []) {
					if (command === "python3" || command === "python") {
						return { ok: false, status: 127, stdout: "", stderr: "not found" };
					}
					return env().probe(command, args);
				},
			}),
			settings: resolveResearchSettings({}),
		});
		const python = report.missing.find((item) => item.id === "python");
		expect(python?.required).toBe(true);
		expect(python?.install).toBeTruthy();
	});
});

describe("doctor formatting", () => {
	const report: DoctorReport = {
		kind: "local",
		label: "D:/work",
		groups: [
			{
				title: "Runtime",
				items: [
					{ id: "node", label: "Node.js", status: "ok", detail: "v22.23.4", required: true },
					{
						id: "latex",
						label: "LaTeX",
						status: "warn",
						detail: "not found",
						required: false,
						affects: ["latex_build"],
						install: "install TeX Live",
					},
				],
			},
			{
				title: "Research tools",
				items: [
					{
						id: "python",
						label: "Python 3",
						status: "missing",
						detail: "not found",
						required: true,
						affects: ["python_run", "paper_write"],
						install: "install Python",
					},
				],
			},
		],
		missing: [],
		warnings: [],
		generatedAt: 0,
	};
	report.missing = [report.groups[1]!.items[0]!];
	report.warnings = [report.groups[0]!.items[1]!];

	it("renders status, effects, and installation hints", () => {
		const text = formatDoctorReport(report);
		expect(text).toContain("✓ Node.js");
		expect(text).toContain("✗ Python 3");
		expect(text).toContain("affects: python_run, paper_write");
		expect(text).toContain("install: install Python");
		expect(text).toContain("1 required missing");
	});

	it("builds install commands and an AI handoff prompt", () => {
		expect(formatDoctorInstallCommands(report)).toContain("Python 3: install Python");
		const prompt = buildDoctorInstallPrompt(report);
		expect(prompt).toContain("本地工作区 D:/work");
		expect(prompt).toContain("Python 3");
		expect(prompt).toContain("请帮我安装并验证");
	});
});
