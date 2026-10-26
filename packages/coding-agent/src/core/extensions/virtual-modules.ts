import * as bundledSaAgentCore from "@sa/agent-core";
import * as bundledSaAiCompat from "@sa/ai/compat";
import * as bundledSaAiModels from "@sa/ai/models";
import * as bundledSaAiOauth from "@sa/ai/oauth";
import * as bundledSaAiProviders from "@sa/ai/providers/all";
import * as bundledSaTui from "@sa/tui";
import * as bundledTypebox from "typebox";
import * as bundledTypeboxCompile from "typebox/compile";
import * as bundledTypeboxValue from "typebox/value";
// This import is safe because loader.ts exports are not re-exported from index.ts.
// Extensions can therefore import from @sa/coding-agent.
import * as bundledSaCodingAgent from "../../index.ts";

/** Modules available to extensions in source and compiled binary runtimes. */
export const VIRTUAL_MODULES: Record<string, unknown> = {
	typebox: bundledTypebox,
	"typebox/compile": bundledTypeboxCompile,
	"typebox/value": bundledTypeboxValue,
	"@sinclair/typebox": bundledTypebox,
	"@sinclair/typebox/compile": bundledTypeboxCompile,
	"@sinclair/typebox/value": bundledTypeboxValue,
	"@sa/agent-core": bundledSaAgentCore,
	"@sa/tui": bundledSaTui,
	// Extensions resolve the sa-ai root to the compat entrypoint (a strict
	// superset of the core entrypoint): existing extensions using the old
	// global API keep working at runtime until compat is removed.
	"@sa/ai": bundledSaAiCompat,
	"@sa/ai/compat": bundledSaAiCompat,
	"@sa/ai/models": bundledSaAiModels,
	"@sa/ai/oauth": bundledSaAiOauth,
	"@sa/ai/providers/all": bundledSaAiProviders,
	"@sa/coding-agent": bundledSaCodingAgent,
};
