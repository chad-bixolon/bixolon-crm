import { createHash } from 'node:crypto';

// Lexical normalization, not schema validation: ignore layout outside strings
// and comments, retaining every token and its boundary. No Prisma/config/env I/O.
export function schemaFingerprint(schema) {
  const text = String(schema);
  const tokens = [];
  let at = 0;
  while (at < text.length) {
    if (/\s/.test(text[at])) { at++; continue; }
    const start = at;
    if (text[at] === '"') {
      at++;
      while (at < text.length && text[at] !== '"') {
        if (text[at] === '\\') at++;
        at++;
      }
      if (at >= text.length) throw new Error('Unterminated Prisma schema string');
      at++;
      const literal = text.slice(start, at);
      JSON.parse(literal); // Reject malformed strings rather than dropping evidence.
      tokens.push(literal);
    } else if (text.startsWith('//', at)) {
      while (at < text.length && !/[\r\n]/.test(text[at])) at++;
      tokens.push(text.slice(start, at).trimEnd());
    } else if (text.startsWith('/*', at)) {
      const end = text.indexOf('*/', at + 2);
      if (end < 0) throw new Error('Unterminated Prisma schema comment');
      at = end + 2;
      tokens.push(text.slice(start, at).replace(/\r\n?/g, '\n'));
    } else {
      const word = /^(?:[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
      at += word ? word[0].length : 1;
      tokens.push(text.slice(start, at));
    }
  }
  // Encoding the token array preserves distinctions such as `a b` versus `ab`.
  return createHash('sha256').update(JSON.stringify(['prisma-tokens-v1', ...tokens])).digest('hex');
}
