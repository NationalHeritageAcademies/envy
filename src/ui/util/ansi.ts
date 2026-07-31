/**
 * Minimal ANSI escape-sequence parser for the log pane.
 *
 * Container logs arrive as raw bytes off `docker logs`, so anything that
 * colours its output (ng, vite, npm, most language runtimes) sends SGR escape
 * sequences inline. Rendered as text those show up as literal `[32m` noise, so
 * we split each line into styled segments instead and let the template paint
 * them.
 *
 * Colours resolve to `--ev-ansi-*` custom properties rather than literal hex,
 * so the palette follows the light/dark theme like everything else. 256-colour
 * and 24-bit codes have no token to map onto and resolve to a literal rgb().
 *
 * This is deliberately not a terminal emulator: cursor movement, erases and
 * scroll regions are parsed only so they can be discarded. The one exception is
 * a carriage return, which is common enough in progress-bar output that
 * ignoring it would leave every redraw concatenated onto one line.
 */

const ESC = '\u001b';
const BEL = '\u0007';

export interface AnsiSegment {
	text: string;
	/** CSS colour, or null to inherit the line's own colour. */
	color: string | null;
	background: string | null;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
}

export interface AnsiLine {
	segments: AnsiSegment[];
	/** The line with every escape sequence removed. */
	text: string;
	/** True when the line asked for any colour or attribute of its own. */
	styled: boolean;
}

type Style = Omit<AnsiSegment, 'text'>;

const RESET: Style = { color: null, background: null, bold: false, dim: false, italic: false, underline: false };

const NAMED = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

function namedColor(index: number, bright: boolean): string {
	return `var(--ev-ansi-${bright ? 'bright-' : ''}${NAMED[index] ?? 'white'})`;
}

/** xterm's 256-colour table: 0–15 named, 16–231 a 6×6×6 cube, 232–255 greys. */
function xterm256(n: number): string {
	if (n < 8) return namedColor(n, false);
	if (n < 16) return namedColor(n - 8, true);
	if (n < 232) {
		const i = n - 16;
		const level = (v: number): number => (v === 0 ? 0 : 55 + v * 40);
		return `rgb(${level(Math.floor(i / 36) % 6)} ${level(Math.floor(i / 6) % 6)} ${level(i % 6)})`;
	}
	const grey = 8 + (n - 232) * 10;
	return `rgb(${grey} ${grey} ${grey})`;
}

function applySgr(current: Style, params: number[]): Style {
	const style: Style = { ...current };

	for (let i = 0; i < params.length; i++) {
		const code = params[i]!;

		if (code === 38 || code === 48) {
			// Extended colour: `38;5;n` indexes the 256-colour table, `38;2;r;g;b`
			// is 24-bit. 48 is the same for the background. Both consume the
			// parameters they read, so the loop skips past them.
			const target = code === 38 ? 'color' : 'background';
			const mode = params[i + 1];
			if (mode === 5) {
				style[target] = xterm256(params[i + 2] ?? 0);
				i += 2;
			} else if (mode === 2) {
				style[target] = `rgb(${params[i + 2] ?? 0} ${params[i + 3] ?? 0} ${params[i + 4] ?? 0})`;
				i += 4;
			}
			continue;
		}

		switch (code) {
			case 0:
				Object.assign(style, RESET);
				break;
			case 1:
				style.bold = true;
				break;
			case 2:
				style.dim = true;
				break;
			case 3:
				style.italic = true;
				break;
			case 4:
				style.underline = true;
				break;
			case 22:
				style.bold = false;
				style.dim = false;
				break;
			case 23:
				style.italic = false;
				break;
			case 24:
				style.underline = false;
				break;
			case 39:
				style.color = null;
				break;
			case 49:
				style.background = null;
				break;
			default:
				if (code >= 30 && code <= 37) style.color = namedColor(code - 30, false);
				else if (code >= 40 && code <= 47) style.background = namedColor(code - 40, false);
				else if (code >= 90 && code <= 97) style.color = namedColor(code - 90, true);
				else if (code >= 100 && code <= 107) style.background = namedColor(code - 100, true);
				break;
		}
	}

	return style;
}

/** CSI final bytes are 0x40–0x7E; everything before them is params/intermediates. */
function isFinalByte(ch: string): boolean {
	return ch >= '@' && ch <= '~';
}

function parseParams(raw: string): number[] {
	if (raw === '') return [0];
	return raw.split(';').map((part) => (part === '' ? 0 : Number.parseInt(part, 10) || 0));
}

export function parseAnsi(input: string): AnsiLine {
	let segments: AnsiSegment[] = [];
	let style: Style = { ...RESET };
	let pending = '';
	let rewind = false;
	let i = 0;

	const flush = (): void => {
		if (pending === '') return;
		segments.push({ text: pending, ...style });
		pending = '';
	};

	while (i < input.length) {
		const ch = input[i]!;

		if (ch === ESC) {
			flush();
			const next = input[i + 1];

			if (next === '[') {
				// CSI — only SGR ('m') carries presentation. Cursor moves and
				// erases mean nothing in a scrollback pane, so they're dropped.
				let end = i + 2;
				while (end < input.length && !isFinalByte(input[end]!)) end++;
				if (end >= input.length) break; // truncated sequence at end of line
				if (input[end] === 'm') style = applySgr(style, parseParams(input.slice(i + 2, end)));
				i = end + 1;
			} else if (next === ']') {
				// OSC (window title, hyperlinks) — runs to BEL or ST (ESC \).
				let end = i + 2;
				while (end < input.length && input[end] !== BEL && !(input[end] === ESC && input[end + 1] === '\\')) end++;
				i = input[end] === ESC ? end + 2 : end + 1;
			} else {
				// Two-byte escape: charset selection, ESC =, and friends.
				i += 2;
			}
			continue;
		}

		if (ch === '\r') {
			// CR returns the cursor to column 0, so whatever the line printed so
			// far is about to be overwritten — that is how progress bars redraw in
			// place. The discard is deferred to the next printable character, so a
			// trailing CR (from CRLF output), which has nothing after it to
			// overwrite with, leaves the line alone.
			rewind = true;
			i++;
			continue;
		}

		// Drop the remaining C0 controls (BEL, backspace, form feed…); tabs stay.
		if (ch < ' ' && ch !== '\t') {
			i++;
			continue;
		}

		if (rewind) {
			pending = '';
			segments = [];
			rewind = false;
		}
		pending += ch;
		i++;
	}
	flush();

	return {
		segments,
		text: segments.map((segment) => segment.text).join(''),
		// A bare reset (`ESC[0m`) is not "styled" — only a segment that actually
		// asks for a colour or attribute counts, so an otherwise plain line keeps
		// the pane's own stderr/keyword colouring.
		styled: segments.some((s) => s.color !== null || s.background !== null || s.bold || s.dim || s.italic || s.underline)
	};
}
