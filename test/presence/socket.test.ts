import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./harness.js";
import {
  registerPresenceSocket,
  type PresenceSocket,
} from "../../src/sockets/presenceSocket.js";

type Handler = (payload?: unknown) => void;

function setup() {
  const h = createHarness();
  const handlers: Record<string, Handler> = {};
  const joined = new Set<string>();
  const emitted: { event: string; payload: unknown }[] = [];
  const socket = {
    id: "sock1",
    emit(event: string, payload: unknown) {
      emitted.push({ event, payload });
      return true;
    },
    on(event: string, fn: Handler) {
      handlers[event] = fn;
      return socket;
    },
    join(room: string) {
      joined.add(room);
    },
    leave(room: string) {
      joined.delete(room);
    },
  };
  registerPresenceSocket(socket as unknown as PresenceSocket, h.registry);
  return { h, handlers, joined, emitted };
}

const BOTH_ROOMS = ["presence_customer_support", "presence_sales"];

test("registers exactly the seven presence listeners", () => {
  const { handlers } = setup();
  assert.deepEqual(Object.keys(handlers).sort(), [
    "disconnect",
    "presence_leave",
    "presence_register",
    "presence_subscribe",
    "presence_unsubscribe",
    "presence_user_leave",
    "presence_user_register",
  ]);
});

test("presence_register with a valid payload registers the admin and joins presence_admins", () => {
  const { h, handlers, joined } = setup();
  handlers.presence_register!({ adminId: "a1", teams: ["customer_support", "sales"] });
  assert.deepEqual(h.registry.teamsStatus(), { customer_support: true, sales: true });
  assert.ok(joined.has("presence_admins"));
});

test("presence_register ignores malformed payloads without throwing", () => {
  const { h, handlers, joined } = setup();
  const bad: unknown[] = [
    undefined,
    {},
    { adminId: 1, teams: ["sales"] },
    { adminId: "a", teams: "sales" },
    { adminId: "a", teams: ["x"] },
    { adminId: "  ", teams: ["sales"] },
  ];
  for (const payload of bad) {
    assert.doesNotThrow(() => handlers.presence_register!(payload));
  }
  assert.deepEqual(h.registry.teamsStatus(), { customer_support: false, sales: false });
  assert.equal(joined.size, 0);
  assert.deepEqual(h.events, []);
});

test("presence_leave releases the admin immediately and leaves presence_admins", () => {
  const { h, handlers, joined } = setup();
  handlers.presence_register!({ adminId: "a1", teams: ["sales"] });
  handlers.presence_leave!();
  assert.equal(h.registry.isTeamOnline("sales"), false);
  assert.equal(joined.has("presence_admins"), false);
});

test("presence_subscribe joins both team rooms by default, or only the listed valid ones", () => {
  for (const payload of [undefined, {}, { teams: ["x"] }]) {
    const { handlers, joined } = setup();
    handlers.presence_subscribe!(payload);
    assert.deepEqual([...joined].sort(), BOTH_ROOMS);
  }
  const { handlers, joined } = setup();
  handlers.presence_subscribe!({ teams: ["sales"] });
  assert.deepEqual([...joined], ["presence_sales"]);
});

test("presence_subscribe sends the current status of each subscribed team to that socket only", () => {
  const { h, handlers, emitted } = setup();
  h.registry.registerAdmin("other-socket", "a1", ["sales"]);
  handlers.presence_subscribe!({ teams: ["customer_support", "sales"] });
  assert.deepEqual(emitted, [
    { event: "presence_changed", payload: { team: "customer_support", online: false } },
    { event: "presence_changed", payload: { team: "sales", online: true } },
  ]);
});

test("presence_unsubscribe leaves the same rooms presence_subscribe would join", () => {
  const { handlers, joined } = setup();
  handlers.presence_subscribe!();
  handlers.presence_unsubscribe!({ teams: ["sales"] });
  assert.deepEqual([...joined], ["presence_customer_support"]);
  handlers.presence_unsubscribe!();
  assert.equal(joined.size, 0);
});

test("presence_user_register registers a trimmed non-empty string userId; others are ignored", () => {
  const { h, handlers } = setup();
  const bad: unknown[] = [undefined, {}, { userId: 5 }, { userId: "" }, { userId: "  " }];
  for (const payload of bad) {
    assert.doesNotThrow(() => handlers.presence_user_register!(payload));
  }
  assert.deepEqual(h.events, []);
  handlers.presence_user_register!({ userId: " u1 " });
  assert.equal(h.registry.isUserOnline("u1"), true);
});

test("presence_user_leave releases the user immediately", () => {
  const { h, handlers } = setup();
  handlers.presence_user_register!({ userId: "u1" });
  handlers.presence_user_leave!();
  assert.equal(h.registry.isUserOnline("u1"), false);
});

test("disconnect starts the grace period for admin and user entries", () => {
  const { h, handlers } = setup();
  handlers.presence_register!({ adminId: "a1", teams: ["sales"] });
  handlers.presence_user_register!({ userId: "u1" });
  handlers.disconnect!();
  assert.equal(h.registry.isTeamOnline("sales"), true);
  assert.equal(h.registry.isUserOnline("u1"), true);
  h.advance(10_000);
  assert.equal(h.registry.isTeamOnline("sales"), false);
  assert.equal(h.registry.isUserOnline("u1"), false);
});
