/**
 * Optional chat category filter from a query string or a request body:
 * "1", "1,2", [1, 2], ["1"] or 2. Keeps whole numbers > 0, without
 * duplicates. Anything else gives [], which means "no filter" (every
 * category). Unlike normalizeCategoryIds (CRM lists), there is no default.
 */
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

  const ids: number[] = [];
  for (const value of raw) {
    const text = typeof value === "string" ? value.trim() : value;
    if (text === "" || text === null || text === undefined) continue;
    const id = Number(text);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}
