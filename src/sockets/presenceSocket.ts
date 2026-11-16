import type { Socket } from "socket.io";
import {
  ADMINS_ROOM,
  TEAMS,
  teamRoom,
  type PresenceRegistry,
} from "../services/presenceService.js";
import { getPresence } from "../services/presenceRuntime.js";
import { parseTeams } from "../utils/presenceInput.js";

export type PresenceSocket = Pick<Socket, "id" | "on" | "emit" | "join" | "leave">;

/** Reads a field of an untrusted payload without ever throwing. */
function field(payload: unknown, key: string): unknown {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

/** The trimmed string, or null when the value is not a non-blank string. */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Teams of a subscribe/unsubscribe payload; all teams when none are valid. */
function subscribeTeams(payload: unknown) {
  const teams = parseTeams(field(payload, "teams"));
  return teams.length > 0 ? teams : [...TEAMS];
}

/**
 * Presence events of one socket. Malformed payloads are ignored silently.
 *
 * CRM (admin):  presence_register / presence_leave
 * App (user):   presence_user_register / presence_user_leave,
 *               presence_subscribe / presence_unsubscribe (listen to team status)
 */
export function registerPresenceSocket(
  socket: PresenceSocket,
  registry: PresenceRegistry = getPresence(),
): void {
  socket.on("presence_register", (payload: unknown) => {
    const adminId = nonEmptyString(field(payload, "adminId"));
    const teams = parseTeams(field(payload, "teams"));
    if (!adminId || teams.length === 0) return;
    registry.registerAdmin(socket.id, adminId, teams);
    void socket.join(ADMINS_ROOM);
  });

  socket.on("presence_leave", () => {
    registry.leaveAdmin(socket.id);
    void socket.leave(ADMINS_ROOM);
  });

  socket.on("presence_subscribe", (payload: unknown) => {
    // Join first, then tell this socket (only) the current status of each team:
    // the app needs no particular order between subscribing and the REST call,
    // and a flip that happens in between can no longer be missed.
    for (const team of subscribeTeams(payload)) {
      void socket.join(teamRoom(team));
      socket.emit("presence_changed", { team, online: registry.isTeamOnline(team) });
    }
  });

  socket.on("presence_unsubscribe", (payload: unknown) => {
    for (const team of subscribeTeams(payload)) void socket.leave(teamRoom(team));
  });

  socket.on("presence_user_register", (payload: unknown) => {
    const userId = nonEmptyString(field(payload, "userId"));
    if (!userId) return;
    registry.registerUser(socket.id, userId);
  });

  socket.on("presence_user_leave", () => {
    registry.leaveUser(socket.id);
  });

  socket.on("disconnect", () => {
    registry.disconnect(socket.id);
  });
}
