import { parseArgs } from 'node:util';

export class UsageError extends Error {}

const COMMANDS = ['check', 'scan', 'usage', 'show', 'suggest', 'subset', 'plan', 'apply'] as const;
export type Command = typeof COMMANDS[number];

export const HELP = `Usage: tag-ontology <command> [arguments] [options]

Commands:
  check                 Validate the dictionary
  scan [paths…]         Read notes, tags and headings
  usage [paths…]        Compare note tags with the dictionary
  show <tag>            Show a tag, its hierarchy, notes and editable draft
  suggest <term>        Suggest matching tags
  subset <tag…>         Print the tags with their broader ancestors as a dictionary
  plan <changes.json>   Preview dictionary changes without writing
  apply <changes.json> --base <hash>
                        Write changes if the dictionary still matches

Options:
  --root <dir>          Vault folder (default: current directory)
  --dictionary <file>   Dictionary relative to root (default: tow/tag-dictionary.json, .tow/tag-dictionary.json, then Tag-Dictionary.json, the first that exists)
  --exclude <glob>      Skip notes; repeatable (scan, usage, show)
  --tags-file <file>    Tags for files without them; repeatable (scan, usage, show)
  --names <rule>        obsidian (default) or kebab (all but scan)
  --strict              Fail on warnings/findings (check, usage, plan, apply)
  --notes               List note paths (show)
  --exact               List only direct notes (show --notes)
  --limit <n>           Maximum suggestions (suggest; default: 10)
  --base <hash>         SHA-256 from plan (apply)
  --json                Print one JSON document
  --help, --version     Print help or the version
`;

export function argumentsOf(args: string[]) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: {
      root: { type: 'string' }, dictionary: { type: 'string' }, exclude: { type: 'string', multiple: true },
      'tags-file': { type: 'string', multiple: true }, names: { type: 'string' }, strict: { type: 'boolean' }, json: { type: 'boolean' },
      notes: { type: 'boolean' }, exact: { type: 'boolean' }, limit: { type: 'string' }, base: { type: 'string' },
      help: { type: 'boolean' }, version: { type: 'boolean' },
    } });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help || values.version) return { info: values.help ? 'help' : 'version' } as const;
  const command = COMMANDS.find(item => item === positionals[0]);
  if (!command) throw new UsageError('Expected a command: check, scan, usage, show, suggest, subset, plan or apply.');
  const allowed = new Set(['root', 'json']);
  if (command !== 'scan') { allowed.add('dictionary'); allowed.add('names'); }
  if (['scan', 'usage', 'show'].includes(command)) { allowed.add('exclude'); allowed.add('tags-file'); }
  if (['check', 'usage', 'plan', 'apply'].includes(command)) allowed.add('strict');
  if (command === 'show') { allowed.add('notes'); allowed.add('exact'); }
  if (command === 'suggest') allowed.add('limit');
  if (command === 'apply') allowed.add('base');
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw new UsageError(`--${key} is not an option for ${command}.`);
  const rest = positionals.slice(1);
  if (command === 'check' && rest.length || ['show', 'suggest', 'plan', 'apply'].includes(command) && rest.length !== 1
    || command === 'subset' && rest.length < 1) {
    throw new UsageError(`Wrong number of arguments for ${command}. See --help.`);
  }
  const names = values.names ?? 'obsidian';
  if (names !== 'obsidian' && names !== 'kebab') throw new UsageError('--names must be obsidian or kebab.');
  if (command === 'apply' && !/^sha256:[0-9a-f]{64}$/.test(values.base ?? '')) {
    throw new UsageError('apply needs --base sha256:<64 lowercase hex digits> from plan.');
  }
  const limit = values.limit === undefined ? 10 : Number(values.limit);
  if (command === 'suggest' && (!/^\d+$/.test(values.limit ?? String(limit)) || !Number.isSafeInteger(limit) || limit < 1)) {
    throw new UsageError('--limit must be a positive integer.');
  }
  return { command, rest, values, names, limit } as const;
}
