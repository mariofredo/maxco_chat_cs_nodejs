import mysql from "mysql2/promise";
import "dotenv/config";

export const pool = mysql.createPool({
  host: process.env.MYSQLHOST!,
  port: Number(process.env.MYSQLPORT) || 3306,
  user: process.env.MYSQLUSER!,
  password: process.env.MYSQLPASSWORD!,
  database: process.env.MYSQLDATABASE!,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "Z",
  dateStrings: true
});

// Every new connection switches to UTC before it runs anything else (the
// driver runs a connection's commands in order). TIMESTAMP columns are stored
// in UTC and MySQL converts them to the connection's zone, so NOW() and every
// time read ("2026-11-19 06:33:39") are UTC whatever the MySQL server's own
// time zone is.
pool.pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+00:00'", (err) => {
    if (err) {
      console.error("Could not set the database connection to UTC, dropping it.", err);
      connection.destroy();
    }
  });
});
