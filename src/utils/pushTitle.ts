/** Push title for Customer Support chats, and the fallback when no name is known. */
export const CS_PUSH_TITLE = "Customer Support";

const SUPPORT_CATEGORY_ID = 1;

/**
 * Title of a chat push notification. A Customer Support chat (category 1)
 * never shows the agent's name; Promotion and Sales chats show it.
 * `categoryId` may be a number or a string (MySQL row).
 */
export function pushTitle(categoryId: unknown, senderName: string | null | undefined): string {
  if (Number(categoryId) === SUPPORT_CATEGORY_ID) return CS_PUSH_TITLE;
  return senderName && senderName.trim() !== "" ? senderName : CS_PUSH_TITLE;
}
