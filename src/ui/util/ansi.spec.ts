import { describe, expect, it } from 'vitest';
import { parseAnsi } from './ansi';

const ESC = '\u001b';

describe('parseAnsi', () => {
	it('treats a line with no escapes as a single unstyled segment', () => {
		const line = parseAnsi('starting server on :3000');

		expect(line.styled).toBe(false);
		expect(line.text).toBe('starting server on :3000');
		expect(line.segments).toHaveLength(1);
		expect(line.segments[0]?.color).toBeNull();
	});

	it('splits on colour changes and resolves the 16 colours to theme tokens', () => {
		const line = parseAnsi(`${ESC}[32m✔${ESC}[39m built`);

		expect(line.styled).toBe(true);
		expect(line.text).toBe('✔ built');
		expect(line.segments.map((s) => [s.text, s.color])).toEqual([
			['✔', 'var(--ev-ansi-green)'],
			[' built', null]
		]);
	});

	it('carries attributes and bright colours', () => {
		const line = parseAnsi(`${ESC}[1;4;91mFATAL${ESC}[0m done`);

		expect(line.segments[0]).toMatchObject({ text: 'FATAL', color: 'var(--ev-ansi-bright-red)', bold: true, underline: true });
		expect(line.segments[1]).toMatchObject({ text: ' done', color: null, bold: false, underline: false });
	});

	it('resolves 256-colour and 24-bit codes to literal rgb()', () => {
		// 196 sits in the 6x6x6 cube (pure red); 38;2 is straight truecolour.
		expect(parseAnsi(`${ESC}[38;5;196mred`).segments[0]?.color).toBe('rgb(255 0 0)');
		expect(parseAnsi(`${ESC}[38;2;12;34;56mrgb`).segments[0]?.color).toBe('rgb(12 34 56)');
		// Low indices fall back to the named palette so they stay theme-aware.
		expect(parseAnsi(`${ESC}[38;5;2mgreen`).segments[0]?.color).toBe('var(--ev-ansi-green)');
		// Backgrounds use the same table.
		expect(parseAnsi(`${ESC}[48;5;21mbg`).segments[0]?.background).toBe('rgb(0 0 255)');
	});

	it('strips non-SGR sequences instead of rendering them', () => {
		// Cursor move, erase-line, a private-mode toggle and an OSC window title.
		const line = parseAnsi(`${ESC}[2K${ESC}[1G${ESC}[?25lplain${ESC}]0;title${ESC}\\ text`);

		expect(line.text).toBe('plain text');
		expect(line.styled).toBe(false);
	});

	it('keeps only the last redraw when a carriage return rewinds the line', () => {
		// How progress bars overwrite themselves in place.
		expect(parseAnsi('30%\r60%\r100% done').text).toBe('100% done');
		// A trailing CR (CRLF output) has nothing after it and just disappears.
		expect(parseAnsi('finished\r').text).toBe('finished');
	});

	it('does not count a bare reset as styling', () => {
		// Otherwise the pane would drop its own stderr/keyword colouring for a
		// line that never actually asked for a colour.
		expect(parseAnsi(`${ESC}[0mnothing to see`).styled).toBe(false);
	});

	it('survives a sequence truncated by the end of the line', () => {
		expect(parseAnsi(`ok ${ESC}[3`).text).toBe('ok ');
	});
});
