/**
 * Optional chat category filter from a query string or a request body:
 * "1", "1,2", [1, 2], ["1"] or 2. Keeps whole numbers > 0, without
 * duplicates. Anything else gives [], which means "no filter" (every
 * category). Unlike normalizeCategoryIds (CRM lists), there is no default.
 */
/** Real category ids are 1-3; the cap keeps a huge request cheap. */
export const MAX_CATEGORY_IDS = 20;

export function parseCategoryIds(input: unknown): number[] {
  let raw: unknown[];
  if (Array.isArray(input)) {
    raw = input;
  } else if (typeof input === "string") {
    raw = input.split(",");
  } else if (typeof input === "number") {
    raw = [input];
  } else {
    return [];
  }

  const ids = new Set<number>();
  for (const value of raw) {
    if (ids.size >= MAX_CATEGORY_IDS) break;
    const text = typeof value === "string" ? value.trim() : value;
    if (text === "" || text === null || text === undefined) continue;
    const id = Number(text);
    if (Number.isInteger(id) && id > 0) {
      ids.add(id);
    }
  }
  return [...ids];
}
