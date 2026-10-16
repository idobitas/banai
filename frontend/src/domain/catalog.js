// Catalog helpers. The catalog data itself is owned by the backend (served via the API);
// the client still validates it before use (defence in depth).
import { z } from 'zod';
import { DomainError, SCHEMA_INVALID } from './errors.js';
import { SAFE_TEXT_PATTERN, isVisibleText } from './schema.js';

export const SECTIONS = Object.freeze({ material: 'materials', color: 'colors', finish: 'finishes' });

const HEX = /^#[0-9a-fA-F]{6}$/;
const entry = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  name: z.string().min(1).max(80).regex(SAFE_TEXT_PATTERN).refine(isVisibleText),
});
const catalogSchema = z.object({
  materials: z.array(entry).max(100),
  // `grain` is a display hint only (the renderer adds a wood texture); the domain ignores it.
  colors: z.array(entry.extend({ hex: z.string().regex(HEX), grain: z.enum(['wood']).optional() })).max(100),
  finishes: z.array(entry).max(100),
});

/** Validate a catalog received from the server; throws DomainError when malformed. */
export function parseCatalog(data) {
  const result = catalogSchema.safeParse(data);
  if (!result.success) throw new DomainError(SCHEMA_INVALID, 'catalog', 'invalid catalog');
  return result.data;
}

export const catalogIds = (catalog) =>
  Object.fromEntries(
    Object.entries(SECTIONS).map(([field, section]) => [field, new Set(catalog[section].map((e) => e.id))]),
  );
