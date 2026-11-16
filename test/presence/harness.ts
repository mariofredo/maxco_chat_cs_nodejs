import { PresenceRegistry } from "../../src/services/presenceService.js";

/** Registry wired to a fake clock; `events` records every emitted flip in order. */
export function createHarness(graceMs = 10_000) {
  const events: string[] = [];
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let now = 0;
  let nextId = 1;
  const registry = new PresenceRegistry({
    graceMs,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    onTeamChange: (team, online) => events.push(`team:${team}:${online}`),
    onUserChange: (userId, online) => events.push(`user:${userId}:${online}`),
  });
  return {
    registry,
    events,
    pendingTimers: () => timers.length,
    advance(ms: number) {
      now += ms;
      for (const t of timers.filter((x) => x.at <= now).sort((a, b) => a.at - b.at)) {
        const i = timers.indexOf(t);
        if (i >= 0) {
          timers.splice(i, 1);
          t.fn();
        }
      }
    },
  };
}
