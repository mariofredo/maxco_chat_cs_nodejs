import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./harness.js";
import { getGraceMs, teamRoom, ADMINS_ROOM } from "../../src/services/presenceService.js";

const BOTH = ["customer_support", "sales"] as const;

test("registerAdmin turns the listed teams online, one event per flip", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", BOTH);
  assert.deepEqual(h.events, ["team:customer_support:true", "team:sales:true"]);
  assert.deepEqual(h.registry.teamsStatus(), { customer_support: true, sales: true });
  assert.equal(h.registry.isTeamOnline("sales"), true);
});

test("a second admin on an online team emits nothing", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", BOTH);
  h.registry.registerAdmin("s2", "a2", BOTH);
  assert.equal(h.events.length, 2);
});

test("re-registering the same socket is idempotent; last teams win", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", BOTH);
  h.registry.registerAdmin("s1", "a1", BOTH);
  assert.equal(h.events.length, 2);
  h.registry.registerAdmin("s1", "a1", ["sales"]);
  assert.deepEqual(h.events, [
    "team:customer_support:true",
    "team:sales:true",
    "team:customer_support:false",
  ]);
  assert.deepEqual(h.registry.teamsStatus(), { customer_support: false, sales: true });
});

test("leaveAdmin releases immediately when it is the last socket", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", BOTH);
  h.registry.leaveAdmin("s1");
  assert.deepEqual(h.events.slice(2), ["team:customer_support:false", "team:sales:false"]);
  assert.equal(h.pendingTimers(), 0);
  assert.deepEqual(h.registry.teamsStatus(), { customer_support: false, sales: false });
});

test("leaveAdmin keeps the team online while another socket is registered", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", BOTH);
  h.registry.registerAdmin("s2", "a2", BOTH);
  h.registry.leaveAdmin("s1");
  assert.equal(h.events.length, 2);
  assert.equal(h.registry.isTeamOnline("customer_support"), true);
});

test("disconnect keeps the team online until the grace period ends", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", BOTH);
  h.registry.disconnect("s1");
  h.advance(9_999);
  assert.equal(h.events.length, 2);
  assert.equal(h.registry.isTeamOnline("customer_support"), true);
  h.advance(1);
  assert.deepEqual(h.events.slice(2), ["team:customer_support:false", "team:sales:false"]);
});

test("reconnect inside the grace period never emits offline", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", BOTH);
  h.registry.disconnect("s1");
  h.advance(3_000);
  h.registry.registerAdmin("s2", "a1", BOTH);
  h.advance(60_000);
  assert.deepEqual(h.events, ["team:customer_support:true", "team:sales:true"]);
  assert.deepEqual(h.registry.teamsStatus(), { customer_support: true, sales: true });
});

test("leaveAdmin cancels a pending grace timer", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", ["sales"]);
  h.registry.disconnect("s1");
  assert.equal(h.pendingTimers(), 1);
  h.registry.leaveAdmin("s1");
  assert.deepEqual(h.events, ["team:sales:true", "team:sales:false"]);
  assert.equal(h.pendingTimers(), 0);
  h.advance(60_000);
  assert.deepEqual(h.events, ["team:sales:true", "team:sales:false"]);
});

test("disconnect of a socket that never registered schedules nothing", () => {
  const h = createHarness();
  h.registry.disconnect("ghost");
  assert.equal(h.pendingTimers(), 0);
});

test("disconnect twice does not restart the timer", () => {
  const h = createHarness();
  h.registry.registerAdmin("s1", "a1", ["sales"]);
  h.registry.disconnect("s1");
  h.advance(6_000);
  h.registry.disconnect("s1");
  h.advance(4_000);
  assert.deepEqual(h.events, ["team:sales:true", "team:sales:false"]);
});

test("getGraceMs reads PRESENCE_GRACE_SECONDS", () => {
  assert.equal(getGraceMs({}), 10_000);
  assert.equal(getGraceMs({ PRESENCE_GRACE_SECONDS: "5" }), 5_000);
  assert.equal(getGraceMs({ PRESENCE_GRACE_SECONDS: "0" }), 0);
  for (const bad of ["abc", "-3", ""]) {
    assert.equal(getGraceMs({ PRESENCE_GRACE_SECONDS: bad }), 10_000);
  }
});

test("room names", () => {
  assert.equal(teamRoom("sales"), "presence_sales");
  assert.equal(ADMINS_ROOM, "presence_admins");
});
