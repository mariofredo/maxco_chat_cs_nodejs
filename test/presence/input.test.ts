import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTeams, parseUserIds, MAX_USER_IDS } from "../../src/utils/presenceInput.js";

test("parseTeams keeps valid unique teams in TEAMS order", () => {
  assert.deepEqual(parseTeams(["sales", "customer_support", "sales"]), [
    "customer_support",
    "sales",
  ]);
  assert.deepEqual(parseTeams(["x", 5, null]), []);
  for (const bad of [undefined, null, "sales", {}, 7]) {
    assert.deepEqual(parseTeams(bad), []);
  }
});

test("parseUserIds accepts a comma string, an array, or both", () => {
  assert.deepEqual(parseUserIds("a, b,,a"), ["a", "b"]);
  assert.deepEqual(parseUserIds(["a", "b,c", "a"]), ["a", "b", "c"]);
  assert.deepEqual(parseUserIds(["a", 5, {}]), ["a"]);
  for (const bad of [undefined, null, "", "  ,, ", {}, 7]) {
    assert.deepEqual(parseUserIds(bad), []);
  }
});

test("MAX_USER_IDS is 100", () => {
  assert.equal(MAX_USER_IDS, 100);
});
