// Hotkeys as strings like "F2", "Escape", "Ctrl+N", "Ctrl+Shift+Space".
type KeyLike = { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean };

const keyName = (k: string) => (k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k);

export function formatHotkey(e: KeyLike): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', keyName(e.key)].filter(Boolean).join('+');
}

export function matchHotkey(e: KeyLike, combo: string): boolean {
  return formatHotkey(e) === combo;
}

/** Hold-to-talk ends when the combo's main key is released, whatever happened to the modifiers. */
export const releasesHotkey = (e: { key: string }, combo: string) => keyName(e.key) === combo.split('+').at(-1);

/** Hotkeys that are plain printable keys would fire while typing; only allow them outside text fields. */
export const isPlainKey = (combo: string) => !combo.includes('+') && combo.length === 1;
