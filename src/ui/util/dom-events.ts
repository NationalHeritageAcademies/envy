/**
 * Read the current text out of a native input/textarea `input` event.
 *
 * `Event.target` is typed as `EventTarget | null`, so every one of the app's
 * signal-backed fields would otherwise need its own `$any($event.target).value`
 * cast in the template. Narrowing once here keeps the templates readable and
 * the cast in exactly one place.
 */
export function inputValue(event: Event): string {
	return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}
