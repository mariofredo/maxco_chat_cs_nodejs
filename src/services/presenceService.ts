/**
 * Online presence registry (in memory, single process).
 *
 * Tracks which sockets are registered as admins (per team) and as users, and
 * emits a change only when an online status flips. A socket that disconnects
 * is kept for a grace period so a short reconnect never shows as offline.
 *
 * No Socket.IO import here: the emit callbacks are injected, see
 * presenceRuntime.ts for the real wiring.
 */

export const TEAMS = ['customer_support', 'sales'] as const;
export type Team = (typeof TEAMS)[number];

/** Room every registered admin socket joins; receives `presence_user_changed`. */
export const ADMINS_ROOM = 'presence_admins';

/** Room that receives `presence_changed` for one team. */
export function teamRoom(team: Team): string {
  return `presence_${team}`;
}

const DEFAULT_GRACE_SECONDS = 10;

/** `PRESENCE_GRACE_SECONDS` in milliseconds; unset, blank or invalid gives 10 s. */
export function getGraceMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.PRESENCE_GRACE_SECONDS?.trim();
  if (!raw) return DEFAULT_GRACE_SECONDS * 1000;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0)
    return DEFAULT_GRACE_SECONDS * 1000;
  return Math.round(seconds * 1000);
}

export type PresenceDeps = {
  graceMs: number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onTeamChange: (team: Team, online: boolean) => void;
  onUserChange: (userId: string, online: boolean) => void;
};

type AdminEntry = {adminId: string; teams: Set<Team>};
type Snapshot = {teams: Record<Team, boolean>; users: Set<string>};

export class PresenceRegistry {
  private readonly deps: PresenceDeps;
  private readonly admins = new Map<string, AdminEntry>();
  private readonly users = new Map<string, string>();
  private readonly graceTimers = new Map<string, unknown>();

  constructor(deps: PresenceDeps) {
    this.deps = deps;
  }

  /** Registers (or overwrites) the admin entry of a socket; last call wins. */
  registerAdmin(
    socketId: string,
    adminId: string,
    teams: readonly Team[],
  ): void {
    this.mutate(() => {
      this.admins.set(socketId, {adminId, teams: new Set(teams)});
    });
  }

  /** Releases the admin entry of a socket immediately (no grace period). */
  leaveAdmin(socketId: string): void {
    this.mutate(() => {
      this.admins.delete(socketId);
    });
    if (!this.users.has(socketId)) this.clearGrace(socketId);
  }

  /** Registers (or overwrites) the user entry of a socket; last call wins. */
  registerUser(socketId: string, userId: string): void {
    this.mutate(() => {
      this.users.set(socketId, userId);
    });
  }

  /** Releases the user entry of a socket immediately (no grace period). */
  leaveUser(socketId: string): void {
    this.mutate(() => {
      this.users.delete(socketId);
    });
    if (!this.admins.has(socketId)) this.clearGrace(socketId);
  }

  /** Socket connection dropped: release its entries after the grace period. */
  disconnect(socketId: string): void {
    const registered = this.admins.has(socketId) || this.users.has(socketId);
    if (!registered || this.graceTimers.has(socketId)) return;
    const release = () => {
      this.graceTimers.delete(socketId);
      this.mutate(() => {
        this.admins.delete(socketId);
        this.users.delete(socketId);
      });
    };
    if (this.deps.graceMs <= 0) {
      release();
      return;
    }
    this.graceTimers.set(
      socketId,
      this.deps.setTimer(release, this.deps.graceMs),
    );
  }

  isTeamOnline(team: Team): boolean {
    return this.teamsStatus()[team];
  }

  teamsStatus(): Record<Team, boolean> {
    const status: Record<Team, boolean> = {
      customer_support: false,
      sales: false,
    };
    for (const entry of this.admins.values()) {
      for (const team of entry.teams) status[team] = true;
    }
    return status;
  }

  isUserOnline(userId: string): boolean {
    for (const id of this.users.values()) {
      if (id === userId) return true;
    }
    return false;
  }

  /** One boolean per requested id (ids nobody registered are false). */
  usersStatus(userIds: readonly string[]): Record<string, boolean> {
    const online = new Set(this.users.values());
    return Object.fromEntries(userIds.map((id) => [id, online.has(id)]));
  }

  private snapshot(): Snapshot {
    return {teams: this.teamsStatus(), users: new Set(this.users.values())};
  }

  /**
   * Runs a mutation and emits one change per status that flipped: teams first
   * (in TEAMS order), then users.
   */
  private mutate(change: () => void): void {
    const before = this.snapshot();
    change();
    const after = this.snapshot();
    for (const team of TEAMS) {
      if (before.teams[team] !== after.teams[team]) {
        this.deps.onTeamChange(team, after.teams[team]);
      }
    }
    for (const userId of new Set([...before.users, ...after.users])) {
      const was = before.users.has(userId);
      const now = after.users.has(userId);
      if (was !== now) this.deps.onUserChange(userId, now);
    }
  }

  private clearGrace(socketId: string): void {
    if (!this.graceTimers.has(socketId)) return;
    this.deps.clearTimer(this.graceTimers.get(socketId));
    this.graceTimers.delete(socketId);
  }
}
