import type { Paper, PaperProviderContext } from "../types.ts";
import { searchCommandSource } from "./cnki.ts";

const NSTL_HINT =
	"NSTL exposes metadata and document delivery only through institutional Web Services that require an application, credentials, and the NSTL interface documentation. Configure research.nstlCommand with your institution's authorized NSTL gateway; it must print the same JSON contract as the CNKI command ({query} and {limit} placeholders are supported).";

/** Search NSTL through a configured institutional gateway. */
export async function searchNstl(query: string, context: PaperProviderContext): Promise<Paper[]> {
	return searchCommandSource(context.nstlCommand, "nstl", NSTL_HINT, query, context);
}
