import type { TypeCast } from "mysql2";

/**
 * Time zone of every database connection (see src/config/db.ts). TIMESTAMP
 * columns are stored in UTC and MySQL converts them to this zone when they are
 * read, so the API never depends on the MySQL server's own time zone.
 */
export const DB_SESSION_TIME_ZONE = "+00:00";

/** A MySQL time read in UTC ("2026-11-19 06:33:39") as ISO 8601 ("2026-11-19T06:33:39Z"). */
export function toUtcIso(value: string | null): string | null {
  return value === null ? null : `${value.replace(" ", "T")}Z`;
}

/**
 * Pool typeCast: TIMESTAMP and DATETIME values (columns and expressions such
 * as NOW()) come out as ISO 8601 UTC strings, so clients can convert them to
 * the device's time zone. Every other type is left to the driver.
 */
export const utcTimeTypeCast: TypeCast = (field, next) => {
  if (field.type === "TIMESTAMP" || field.type === "DATETIME") {
    return toUtcIso(field.string());
  }
  return next();
};
