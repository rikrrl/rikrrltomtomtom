/**
 * Serialisiert JavaScript-Werte in gültigen Luau-Code.
 * Wird genutzt, um Blueprint-Daten als ModuleScript in Roblox Studio abzulegen.
 */

function quoteString(value) {
  return `"${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`;
}

export function toLuau(value, indent = 0) {
  const pad = '\t'.repeat(indent);
  const padIn = '\t'.repeat(indent + 1);

  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return quoteString(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '{}';
    const items = value.map((item) => `${padIn}${toLuau(item, indent + 1)},`);
    return `{\n${items.join('\n')}\n${pad}}`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined);
    if (keys.length === 0) return '{}';
    const items = keys.map((key) => `${padIn}["${key}"] = ${toLuau(value[key], indent + 1)},`);
    return `{\n${items.join('\n')}\n${pad}}`;
  }

  return 'nil';
}

/** Luau-Datei mit Header-Kommentar (Herkunft/Zeitstempel) für generierte Skripte. */
export function scriptHeader(title, note = '') {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines = [
    '--!nocheck',
    `-- ${title}`,
    `-- Generiert von Roblox Studio AI am ${stamp}`,
  ];
  if (note) lines.push(`-- ${note}`);
  lines.push('-- Änderungen hier werden bei einer Neugenerierung überschrieben.', '');
  return lines.join('\n');
}
