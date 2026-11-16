import { pool } from "../config/db.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

export type DeviceRow = RowDataPacket & {
  id: number;
  user_id: string;
  fcm_token: string;
  platform: string;
};

/**
 * Simpan FCM token device milik user client.
 * Token yang sama selalu dipindahkan ke user terakhir yang login, sehingga
 * satu device tidak pernah menerima notifikasi milik user lain.
 */
export async function registerDevice(
  userId: string,
  token: string,
  platform: string
) {
  await pool.query("DELETE FROM list_user_devices WHERE fcm_token = ?", [
    token,
  ]);
  await pool.query(
    `INSERT INTO list_user_devices (user_id, fcm_token, platform, created_at, updated_at)
     VALUES (?, ?, ?, NOW(), NOW())`,
    [userId, token, platform]
  );
}

export async function unregisterDevice(userId: string, token: string) {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM list_user_devices WHERE fcm_token = ? AND user_id = ?",
    [token, userId]
  );
  return result.affectedRows > 0;
}

export async function getUserDevices(userId: string): Promise<DeviceRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM list_user_devices WHERE user_id = ? ORDER BY updated_at DESC",
    [userId]
  );
  return rows as DeviceRow[];
}

/** Buang token yang sudah ditolak FCM (device uninstall / ganti proyek). */
export async function removeDeviceToken(token: string) {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM list_user_devices WHERE fcm_token = ?",
    [token]
  );
  return result.affectedRows > 0;
}
