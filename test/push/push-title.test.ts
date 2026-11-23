import { test } from "node:test";
import assert from "node:assert/strict";
import { CS_PUSH_TITLE, pushTitle } from "../../src/utils/pushTitle.js";

test("Customer Support chat always gets the fixed title", () => {
  assert.equal(CS_PUSH_TITLE, "Customer Support");
  assert.equal(pushTitle(1, "Budi"), "Customer Support");
  assert.equal(pushTitle("1", "Budi"), "Customer Support");
  assert.equal(pushTitle(1, null), "Customer Support");
});

test("Promotion and Sales keep the agent's name", () => {
  assert.equal(pushTitle(2, "Budi"), "Budi");
  assert.equal(pushTitle(3, "Sari"), "Sari");
  assert.equal(pushTitle("3", "Sari"), "Sari");
});

test("empty or missing name falls back to Customer Support", () => {
  assert.equal(pushTitle(3, null), "Customer Support");
  assert.equal(pushTitle(3, undefined), "Customer Support");
  assert.equal(pushTitle(3, ""), "Customer Support");
  assert.equal(pushTitle(3, "   "), "Customer Support");
});

test("unknown category is treated as not Customer Support", () => {
  assert.equal(pushTitle(undefined, "Budi"), "Budi");
  assert.equal(pushTitle(null, "Budi"), "Budi");
});
