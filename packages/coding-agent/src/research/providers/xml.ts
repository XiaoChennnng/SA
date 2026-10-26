// Minimal XML helpers for the small, stable feeds used by research providers.

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

export function decodeXmlEntities(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
		.replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

export function stripXmlTags(value: string): string {
	return decodeXmlEntities(value.replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

export function firstTag(xml: string, name: string): string | undefined {
	const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
	return match ? decodeXmlEntities(match[1]!).trim() : undefined;
}

export function allTags(xml: string, name: string): string[] {
	const values: string[] = [];
	const regex = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi");
	for (const match of xml.matchAll(regex)) values.push(decodeXmlEntities(match[1]!).trim());
	return values;
}

/** Strip JATS/HTML markup that Crossref and PubMed put inside abstracts and titles. */
export function stripMarkup(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const text = decodeXmlEntities(value.replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
	return text || undefined;
}
