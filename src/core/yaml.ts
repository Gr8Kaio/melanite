import { parse, stringify } from 'yaml';

/** YAML para frontmatter y plugins (misma firma que en Obsidian). */
export function parseYaml(text: string): any {
  return parse(text) ?? {};
}

export function stringifyYaml(obj: unknown): string {
  return stringify(obj, { lineWidth: 0 });
}
