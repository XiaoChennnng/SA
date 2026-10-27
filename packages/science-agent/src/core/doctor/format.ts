import type { DoctorItem, DoctorReport, DoctorStatus } from "./types.ts";

function symbol(status: DoctorStatus): string {
	if (status === "ok") return "✓";
	if (status === "missing") return "✗";
	if (status === "warn") return "!";
	return "·";
}

function line(item: DoctorItem): string {
	const detail = item.detail ? ` — ${item.detail}` : "";
	return `  ${symbol(item.status)} ${item.label}${detail}`;
}

export function formatDoctorReport(report: DoctorReport): string {
	const lines: string[] = [
		`SA Doctor — ${report.kind === "ssh" ? "SSH remote workspace" : "local workspace"}: ${report.label}`,
	];
	for (const group of report.groups) {
		lines.push("", group.title);
		for (const item of group.items) {
			lines.push(line(item));
			if (item.status !== "ok" && item.status !== "info") {
				if (item.affects?.length) lines.push(`      affects: ${item.affects.join(", ")}`);
				if (item.install) lines.push(`      install: ${item.install}`);
			}
		}
	}
	const requiredMissing = report.missing.filter((item) => item.required).length;
	const optionalMissing = report.missing.length - requiredMissing;
	lines.push(
		"",
		`Summary: ${requiredMissing} required missing, ${optionalMissing} optional missing, ${report.warnings.length} warning(s).`,
	);
	if (report.missing.length === 0 && report.warnings.length === 0) {
		lines.push("Everything needed by the current workspace is available.");
	} else {
		lines.push("Use the menu below to have SA install missing dependencies in the conversation.");
	}
	return lines.join("\n");
}

export function formatDoctorInstallCommands(report: DoctorReport): string {
	const items = [...report.missing, ...report.warnings].filter((item) => item.install);
	if (items.length === 0) return "No missing dependencies with install suggestions.";
	const lines = [`Install suggestions for ${report.label}:`];
	for (const item of items) {
		lines.push(`- ${item.label}: ${item.install}`);
	}
	return lines.join("\n");
}

export function buildDoctorInstallPrompt(report: DoctorReport): string {
	const items = [...report.missing, ...report.warnings];
	const target = report.kind === "ssh" ? `SSH 远端工作区 ${report.label}` : `本地工作区 ${report.label}`;
	const lines = [`我在 ${target} 运行了 /doctor，请帮我安装并验证以下缺失或需要注意的依赖：`];
	for (const item of items) {
		lines.push(`- ${item.label}${item.detail ? `（${item.detail}）` : ""}`);
		if (item.affects?.length) lines.push(`  影响: ${item.affects.join(", ")}`);
		if (item.install) lines.push(`  建议: ${item.install}`);
	}
	lines.push(
		"",
		"要求：",
		"- 先确认当前工作区与可用的包管理器、Python/pip；安装命令要在当前工作区对应的机器上执行。",
		"- 优先用户级安装，避免不必要的 sudo 或系统级修改。",
		"- 如果必须输入密码或 sudo 需要交互，请停下来给我可手动执行的命令，不要猜测或伪造安装结果。",
		"- 安装后运行相应命令验证，并提示我再次执行 /doctor 复检。",
	);
	return lines.join("\n");
}
