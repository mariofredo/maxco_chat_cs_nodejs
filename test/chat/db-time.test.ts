import { test } from "node:test";
import assert from "node:assert/strict";
import { toUtcIso, utcTimeTypeCast } from "../../src/utils/dbTime.js";

test("toUtcIso turns a MySQL UTC time into ISO 8601 with Z", () => {
  assert.equal(toUtcIso("2026-11-19 06:33:39"), "2026-11-19T06:33:39Z");
  assert.equal(toUtcIso("2026-11-19 06:33:39.123"), "2026-11-19T06:33:39.123Z");
  assert.equal(toUtcIso(null), null);
});

test("toUtcIso output is the same instant for any device time zone", () => {
  assert.equal(new Date(toUtcIso("2026-11-19 06:33:39")!).getTime(), Date.UTC(2026, 10, 19, 6, 33, 39));
});

function field(type: string, value: string | null) {
  return { type, string: () => value } as unknown as Parameters<typeof utcTimeTypeCast>[0];
}

test("utcTimeTypeCast converts TIMESTAMP and DATETIME values", () => {
  const next = () => "next";
  assert.equal(utcTimeTypeCast(field("TIMESTAMP", "2026-11-19 06:33:39"), next), "2026-11-19T06:33:39Z");
  assert.equal(utcTimeTypeCast(field("DATETIME", "2026-11-19 06:33:39"), next), "2026-11-19T06:33:39Z");
  assert.equal(utcTimeTypeCast(field("TIMESTAMP", null), next), null);
});

test("utcTimeTypeCast leaves every other type to the driver", () => {
  const next = () => "next";
  for (const type of ["LONG", "VAR_STRING", "JSON", "DATE", "TIME", "BLOB"]) {
    assert.equal(utcTimeTypeCast(field(type, "x"), next), "next", type);
  }
});
