import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./harness.js";

test("registerUser emits online once and usersStatus reflects it", () => {
  const h = createHarness();
  h.registry.registerUser("s1", "u1");
  h.registry.registerUser("s1", "u1");
  assert.deepEqual(h.events, ["user:u1:true"]);
  assert.deepEqual(h.registry.usersStatus(["u1", "u2"]), { u1: true, u2: false });
  assert.equal(h.registry.isUserOnline("u1"), true);
});

test("a second device keeps the user online when the first leaves", () => {
  const h = createHarness();
  h.registry.registerUser("s1", "u1");
  h.registry.registerUser("s2", "u1");
  h.registry.leaveUser("s1");
  assert.deepEqual(h.events, ["user:u1:true"]);
  h.registry.leaveUser("s2");
  assert.deepEqual(h.events, ["user:u1:true", "user:u1:false"]);
});

test("leaveUser on the last socket goes offline immediately", () => {
  const h = createHarness();
  h.registry.registerUser("s1", "u1");
  h.registry.leaveUser("s1");
  assert.deepEqual(h.events, ["user:u1:true", "user:u1:false"]);
  assert.equal(h.pendingTimers(), 0);
});

test("disconnect applies the grace period to a user socket", () => {
  const h = createHarness();
  h.registry.registerUser("s1", "u1");
  h.registry.disconnect("s1");
  h.advance(9_999);
  assert.equal(h.registry.isUserOnline("u1"), true);
  h.advance(1);
  assert.deepEqual(h.events, ["user:u1:true", "user:u1:false"]);
});

test("a user who reconnects inside the grace period never goes offline", () => {
  const h = createHarness();
  h.registry.registerUser("s1", "u1");
  h.registry.disconnect("s1");
  h.advance(3_000);
  h.registry.registerUser("s2", "u1");
  h.advance(60_000);
  assert.deepEqual(h.events, ["user:u1:true"]);
  assert.equal(h.registry.isUserOnline("u1"), true);
});

test("user ids and admin ids are separate key spaces", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "u1", ["sales"]);
  assert.equal(h.registry.isUserOnline("u1"), false);
});

test("one disconnect releases both the admin and the user entry of a socket", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", ["sales"]);
  h.registry.registerUser("s1", "u1");
  h.registry.disconnect("s1");
  assert.equal(h.pendingTimers(), 1);
  h.advance(10_000);
  assert.deepEqual(h.events, [
    "team:sales:true",
    "user:u1:true",
    "team:sales:false",
    "user:u1:false",
  ]);
});

test("leaveUser does not cancel the grace timer of the socket's admin entry", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", ["sales"]);
  h.registry.registerUser("s1", "u1");
  h.registry.disconnect("s1");
  h.registry.leaveUser("s1");
  assert.equal(h.pendingTimers(), 1);
  h.advance(10_000);
  assert.deepEqual(h.events, [
    "team:sales:true",
    "user:u1:true",
    "user:u1:false",
    "team:sales:false",
  ]);
});

test("leaveAdmin does not cancel the grace timer of the socket's user entry", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", ["sales"]);
  h.registry.registerUser("s1", "u1");
  h.registry.disconnect("s1");
  h.registry.leaveAdmin("s1");
  assert.equal(h.pendingTimers(), 1);
  h.advance(10_000);
  assert.equal(h.registry.isUserOnline("u1"), false);
});
