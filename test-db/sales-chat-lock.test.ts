// The per-user lock of the sales chat. It runs no query, so it needs no
// database, but it lives here because salesChatService imports the DB pool and
// test/ must never reach DB code.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { withSalesChatLock } from "../src/services/salesChatService.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("withSalesChatLock", () => {
  test("a task that rejects does not block the next task of the same user", async () => {
    const failing = withSalesChatLock("test-awc-lock-reject", async () => {
      throw new Error("boom");
    });
    const next = withSalesChatLock("test-awc-lock-reject", async () => "ran");
    await assert.rejects(failing, /boom/);
    assert.equal(await next, "ran");
  });

  test("tasks of one user never overlap; another user's task is not held back", async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = (name: string, wait?: Promise<void>) => async () => {
      log.push(`start ${name}`);
      await wait;
      log.push(`end ${name}`);
    };

    const first = withSalesChatLock("test-awc-lock-a", task("1", gate));
    const second = withSalesChatLock("test-awc-lock-a", task("2"));
    const other = withSalesChatLock("test-awc-lock-b", task("other"));

    await other;
    await tick();
    // The first task still holds user a: the second one has not started, but
    // user b's task has run to the end.
    assert.deepEqual(log, ["start 1", "start other", "end other"]);

    release();
    await Promise.all([first, second]);
    assert.deepEqual(log.filter((entry) => !entry.endsWith("other")), ["start 1", "end 1", "start 2", "end 2"]);
  });
});
