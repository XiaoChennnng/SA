import * as crypto from "node:crypto";
import type { AgentSession } from "./agent-session.ts";
import { exportSessionToJsonl } from "./session-export.ts";

/** Trailing `sa.export` entry carrying the system prompt and tool schemas for exported sessions. */
export function createExportTrailingEntries(
	session: AgentSession,
	parentId: string | null,
	timestamp: string,
): object[] {
	return [
		{
			type: "custom",
			customType: "sa.export",
			id: crypto.randomUUID().slice(0, 8),
			parentId,
			timestamp,
			data: {
				systemPrompt: session.state.systemPrompt,
				tools: session.state.tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				})),
			},
		},
	];
}

/** Export the current branch with presentation metadata (system prompt and tool schemas). */
export function exportSessionWithPresentation(filePath: string, session: AgentSession): void {
	exportSessionToJsonl(session.sessionManager, filePath, (parentId, timestamp) =>
		createExportTrailingEntries(session, parentId, timestamp),
	);
}
