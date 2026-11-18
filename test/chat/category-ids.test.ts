import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CATEGORY_IDS, parseCategoryIds } from "../../src/utils/categoryIds.js";

test("parseCategoryIds reads strings, arrays and numbers", () => {
  assert.deepEqual(parseCategoryIds("1"), [1]);
  assert.deepEqual(parseCategoryIds("1, 2,2"), [1, 2]);
  assert.deepEqual(parseCategoryIds(["3", 1]), [3, 1]);
  assert.deepEqual(parseCategoryIds(2), [2]);
});

test("parseCategoryIds keeps at most MAX_CATEGORY_IDS ids, fast", () => {
  const many = Array.from({ length: 100_000 }, (_, i) => i + 1);
  const started = Date.now();
  const ids = parseCategoryIds(many);
  assert.equal(ids.length, MAX_CATEGORY_IDS);
  assert.deepEqual(ids.slice(0, 3), [1, 2, 3]);
  assert.ok(Date.now() - started < 200, "no quadratic dedup");
});

test("parseCategoryIds means no filter for empty or invalid input", () => {
  for (const raw of [undefined, null, "", "abc", "0", "-1", "1.5", {}, []]) {
    assert.deepEqual(parseCategoryIds(raw), [], String(raw));
  }
});
