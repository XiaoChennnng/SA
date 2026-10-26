import { backgroundAnsi, foregroundAnsi, isAppleTerminalSession, rgbColor } from "@sa/tui";
import { theme } from "../theme/theme.ts";

const CORAL = rgbColor(228, 138, 122);
const YELLOW = rgbColor(234, 182, 93);
const RESET = "\x1b[0m";

// Pixel art for "SA": 8 pixels wide and 4 pixels tall, packed into 4 cells x 2 lines.
// 0 = empty, 1 = coral (S), 2 = yellow (A).
const PIXELS: readonly (readonly number[])[] = [
	[0, 1, 1, 0, 0, 2, 2, 0],
	[1, 0, 0, 0, 2, 0, 0, 2],
	[0, 1, 1, 0, 2, 2, 2, 2],
	[1, 1, 1, 0, 2, 0, 0, 2],
];

function colorFor(pixel: number) {
	return pixel === 1 ? CORAL : YELLOW;
}

/**
 * The SA logo: 4 cells wide and 2 lines tall. Each cell shows two square pixels with half blocks,
 * so the wordmark reads "SA" in coral and yellow.
 */
export function saLogoLines(): [string, string] {
	const mode = theme.getColorMode();

	const cell = (top: number, bottom: number): string => {
		if (top === 0 && bottom === 0) return " ";
		if (top !== 0 && bottom === 0) return `${foregroundAnsi(colorFor(top), mode)}▀${RESET}`;
		if (top === 0 && bottom !== 0) return `${foregroundAnsi(colorFor(bottom), mode)}▄${RESET}`;
		if (top === bottom) return `${foregroundAnsi(colorFor(top), mode)}█${RESET}`;
		return `${foregroundAnsi(colorFor(top), mode)}${backgroundAnsi(colorFor(bottom), mode)}▀${RESET}`;
	};

	const renderLine = (topRow: readonly number[], bottomRow: readonly number[]): string =>
		Array.from({ length: 4 }, (_, index) => cell(topRow[index] ?? 0, bottomRow[index] ?? 0)).join("");

	return [renderLine(PIXELS[0], PIXELS[1]), renderLine(PIXELS[2], PIXELS[3])];
}

/**
 * Whether the terminal renders the half-block logo correctly. Apple Terminal draws gaps between rows and
 * misaligns the half blocks, so it gets the text wordmark instead.
 */
export function supportsSaLogo(): boolean {
	return !isAppleTerminalSession();
}

/** Text fallback for the logo: "SA" with the logo's coral and yellow. */
export function saWordmark(): string {
	const mode = theme.getColorMode();
	return `${foregroundAnsi(CORAL, mode)}S${RESET}${foregroundAnsi(YELLOW, mode)}A${RESET}`;
}
