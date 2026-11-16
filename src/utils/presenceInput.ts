import { TEAMS, type Team } from "../services/presenceService.js";

/** Most user ids one `GET /api/chats/crm/presence` request may ask about. */
export const MAX_USER_IDS = 100;

/** Valid, unique teams from an untrusted payload, in TEAMS order; [] if none. */
export function parseTeams(input: unknown): Team[] {
  if (!Array.isArray(input)) return [];
  const wanted = new Set<unknown>(input);
  return TEAMS.filter((team) => wanted.has(team));
}

/**
 * Trimmed, unique, non-empty ids from a comma separated string or an array of
 * such strings (a repeated query key). Anything else is ignored.
 */
export function parseUserIds(input: unknown): string[] {
  const parts: unknown[] = Array.isArray(input) ? input : [input];
  const ids = new Set<string>();
  for (const part of parts) {
    if (typeof part !== "string") continue;
    for (const piece of part.split(",")) {
      const id = piece.trim();
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
