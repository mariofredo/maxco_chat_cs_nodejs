/**
 * Settings and text of the automatic close of idle Customer Support chats.
 * Pure helpers: no database, no socket (see services/autoCloseService.ts).
 */

/** Same text as the `auto_close_message` row seeded by dbchanges_202611181400. */
export const DEFAULT_AUTO_CLOSE_MESSAGE =
  "Hi {name}, since we haven't received a reply from you in the last {minutes} minutes, this chat will now be closed. Please contact us again if you have any further questions.";

/**
 * A chat is only closed while its last admin message is at most
 * `auto_close_minutes + AUTO_CLOSE_WINDOW_MINUTES` old. Older chats (the
 * backlog present when the feature is turned on, or chats left over after a
 * long downtime) are left for CS instead of all receiving a "no reply in the
 * last N minutes" message that is not true for them.
 */
export const AUTO_CLOSE_WINDOW_MINUTES = 60;

export const SYSTEM_SENDER_ID = "system";
export const SYSTEM_SENDER_NAME = "Maxco Customer Support";

/** `auto_close_minutes` config value -> whole minutes; anything not > 0 is 0 (off). */
export function parseAutoCloseMinutes(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** Fills every `{name}` (or "there" without a name) and `{minutes}`. */
export function renderAutoCloseMessage(
  template: string,
  values: { name: string | null | undefined; minutes: number },
): string {
  const name = values.name?.trim() || "there";
  return template.replaceAll("{name}", name).replaceAll("{minutes}", String(values.minutes));
}
