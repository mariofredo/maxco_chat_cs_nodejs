import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AUTO_CLOSE_MESSAGE,
  parseAutoCloseMinutes,
  renderAutoCloseMessage,
} from "../../src/utils/autoClose.js";
import { createNonOverlappingRunner } from "../../src/utils/interval.js";

test("parseAutoCloseMinutes keeps positive values, floored", () => {
  assert.equal(parseAutoCloseMinutes("10"), 10);
  assert.equal(parseAutoCloseMinutes("10.7"), 10);
});

test("parseAutoCloseMinutes turns anything else into 0 (off)", () => {
  for (const raw of ["0", "", "abc", "-5", undefined, null, "0.5"]) {
    assert.equal(parseAutoCloseMinutes(raw), 0, `raw ${String(raw)}`);
  }
});

test("renderAutoCloseMessage fills every placeholder", () => {
  assert.equal(
    renderAutoCloseMessage("Hi {name}, {minutes} min. Bye {name}", { name: " Priya ", minutes: 10 }),
    "Hi Priya, 10 min. Bye Priya",
  );
});

test("renderAutoCloseMessage falls back to 'there' without a name", () => {
  assert.equal(renderAutoCloseMessage("Hi {name}", { name: null, minutes: 10 }), "Hi there");
  assert.equal(renderAutoCloseMessage("Hi {name}", { name: "  ", minutes: 10 }), "Hi there");
  assert.equal(renderAutoCloseMessage("Hi {name}", { name: undefined, minutes: 10 }), "Hi there");
});

test("default message fits the config column", () => {
  assert.ok(DEFAULT_AUTO_CLOSE_MESSAGE.length <= 255);
  assert.match(DEFAULT_AUTO_CLOSE_MESSAGE, /\{name\}/);
  assert.match(DEFAULT_AUTO_CLOSE_MESSAGE, /\{minutes\}/);
});

test("runner skips a tick while the previous run is pending", async () => {
  let calls = 0;
  let release!: () => void;
  const tick = createNonOverlappingRunner(() => {
    calls++;
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const first = tick();
  await tick();
  assert.equal(calls, 1);
  release();
  await first;
  const second = tick();
  release();
  await second;
  assert.equal(calls, 2);
});

test("runner reports a failed run and keeps going", async () => {
  const errors: unknown[] = [];
  let calls = 0;
  const tick = createNonOverlappingRunner(
    async () => {
      calls++;
      throw new Error("boom");
    },
    (err) => errors.push(err),
  );
  await tick();
  await tick();
  assert.equal(calls, 2);
  assert.equal(errors.length, 2);
});
