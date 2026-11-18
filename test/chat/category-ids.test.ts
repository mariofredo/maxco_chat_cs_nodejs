import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCategoryIds } from "../../src/utils/categoryIds.js";

test("parseCategoryIds reads strings, arrays and numbers", () => {
  assert.deepEqual(parseCategoryIds("1"), [1]);
  assert.deepEqual(parseCategoryIds("1, 2,2"), [1, 2]);
  assert.deepEqual(parseCategoryIds(["3", 1]), [3, 1]);
  assert.deepEqual(parseCategoryIds(2), [2]);
});

test("parseCategoryIds means no filter for empty or invalid input", () => {
  for (const raw of [undefined, null, "", "abc", "0", "-1", "1.5", {}, []]) {
    assert.deepEqual(parseCategoryIds(raw), [], String(raw));
  }
});
