/**
 * Remark plugin: auto-link aviation entities in assistant answers.
 *
 * Scans plain-text nodes (never inside existing links or code) and turns bare
 * ICAO hex codes, ICAO callsigns, and US tail numbers into deep-links to the
 * app's detail screen, matching the hash scheme `#airframe?icao=|call=|tail=`.
 *
 * Dependency-free: walks the mdast tree directly instead of unist-util-visit so
 * it can't drift from react-markdown's transitive deps.
 *
 *   A9A397   -> [A9A397](#airframe?icao=A9A397)     (6-char hex, must contain A–F)
 *   ASA1348  -> [ASA1348](#airframe?call=ASA1348)   (3 letters + digits)
 *   N842UA   -> [N842UA](#airframe?tail=N842UA)      (US registration)
 */

// Order matters: registration and callsign are checked before bare hex so an
// N-number isn't mis-read as hex. Each alternative captures into its own group.
const ENTITY_RE = /\b(N[0-9][0-9A-Z]{1,4})\b|\b([A-Z]{3}[0-9]{1,4}[A-Z]?)\b|\b([0-9A-F]{6})\b/g;

const hasLetter = (s) => /[A-F]/.test(s);

/** Return an array of mdast nodes (text + link) for a raw string, or null if no match. */
function linkifyString(value) {
  ENTITY_RE.lastIndex = 0;
  let match;
  let last = 0;
  const nodes = [];
  while ((match = ENTITY_RE.exec(value)) !== null) {
    const [full, reg, call, hex] = match;
    // Bare 6-hex made entirely of digits is almost always a squawk/number, not
    // an ICAO address — skip it to avoid false links.
    if (hex && !hasLetter(hex)) continue;
    const start = match.index;
    if (start > last) nodes.push({ type: 'text', value: value.slice(last, start) });

    let url;
    if (reg) url = `#airframe?tail=${reg}`;
    else if (call) url = `#airframe?call=${call}`;
    else url = `#airframe?icao=${hex}`;

    nodes.push({ type: 'link', url, children: [{ type: 'text', value: full }] });
    last = start + full.length;
  }
  if (!nodes.length) return null;
  if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) });
  return nodes;
}

const SKIP_PARENTS = new Set(['link', 'linkReference', 'inlineCode', 'code']);

function walk(node) {
  if (!node || !Array.isArray(node.children)) return;
  const next = [];
  for (const child of node.children) {
    if (child.type === 'text') {
      const replaced = linkifyString(child.value);
      if (replaced) next.push(...replaced);
      else next.push(child);
    } else {
      if (!SKIP_PARENTS.has(child.type)) walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkLinkifyEntities() {
  return (tree) => walk(tree);
}

export default remarkLinkifyEntities;
