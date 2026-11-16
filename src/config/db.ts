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
  timezone: 'local',
  dateStrings: true
});
