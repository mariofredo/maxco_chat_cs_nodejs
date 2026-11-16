import { getIO } from "../sockets/io.js";
import {
  ADMINS_ROOM,
  PresenceRegistry,
  getGraceMs,
  teamRoom,
} from "./presenceService.js";

let registry: PresenceRegistry | null = null;

/**
 * The shared registry of this process, wired to real timers and Socket.IO.
 * `getIO()` is called when a change is emitted, not when the registry is built,
 * so it may be created before `setIO()` runs.
 */
export function getPresence(): PresenceRegistry {
  registry ??= new PresenceRegistry({
    graceMs: getGraceMs(),
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref();
      return timer;
    },
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    onTeamChange: (team, online) => {
      getIO().to(teamRoom(team)).emit("presence_changed", { team, online });
    },
    onUserChange: (userId, online) => {
      getIO().to(ADMINS_ROOM).emit("presence_user_changed", { userId, online });
    },
  });
  return registry;
}
