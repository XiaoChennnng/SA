export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.SA_EXPERIMENTAL === "1";
}
