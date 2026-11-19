import mysql from "mysql2/promise";
import "dotenv/config";
import { DB_SESSION_TIME_ZONE, utcTimeTypeCast } from "../utils/dbTime.js";

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
  dateStrings: true,
  typeCast: utcTimeTypeCast,
});

// Every new connection switches to UTC before it runs anything else (the
// driver runs a connection's commands in order), so NOW() and the TIMESTAMP
// columns are read and written in UTC whatever the MySQL server's time zone is.
pool.pool.on("connection", (connection) => {
  connection.query(`SET time_zone = '${DB_SESSION_TIME_ZONE}'`, (err) => {
    if (err) {
      console.error("Could not set the database connection to UTC, dropping it.", err);
      connection.destroy();
    }
  });
});
