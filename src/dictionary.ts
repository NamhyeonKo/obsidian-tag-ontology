// Changes to the raw dictionary JSON, kept free of Obsidian so they can be tested on their own.

export type RawEntry = { description: string; aliases?: string[]; broader?: string[]; related?: string[]; [key: string]: unknown };
export type RawDictionary = Record<string, RawEntry>;

const inline = (value: unknown): string => Array.isArray(value) ? `[${value.map(inline).join(', ')}]`
  : value !== null && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(', ')}}`
  : JSON.stringify(value);

// One entry per line in key order, like the dictionaries users keep in git: a save only changes the lines it touches.
export function serialize(dict: RawDictionary): string {
  const lines = Object.keys(dict).sort().map(key => `${JSON.stringify(key)}: ${inline(dict[key])}`);
  return lines.length ? `{\n${lines.join(',\n')}\n}\n` : '{\n}\n';
}
