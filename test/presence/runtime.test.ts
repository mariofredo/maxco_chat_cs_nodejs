import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "socket.io";
import { setIO } from "../../src/sockets/io.js";
import { getPresence } from "../../src/services/presenceRuntime.js";

test("getPresence emits to the right rooms, and only when a status flips", () => {
  const recorded: { room: string; event: string; payload: unknown }[] = [];
  const fakeIo = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        recorded.push({ room, event, payload });
      },
    }),
  };
  setIO(fakeIo as unknown as Server);

  getPresence().registerAdmin("s1", "a1", ["sales"]);
  assert.deepEqual(recorded, [
    { room: "presence_sales", event: "presence_changed", payload: { team: "sales", online: true } },
  ]);

  getPresence().registerUser("s2", "u1");
  assert.deepEqual(recorded.at(-1), {
    room: "presence_admins",
    event: "presence_user_changed",
    payload: { userId: "u1", online: true },
  });

  const count = recorded.length;
  getPresence().registerAdmin("s3", "a2", ["sales"]);
  assert.equal(recorded.length, count);
});

test("getPresence returns one shared registry", () => {
  assert.equal(getPresence(), getPresence());
});
