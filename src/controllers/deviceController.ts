import type { Request, Response } from "express";
import * as deviceService from "../services/deviceService.js";

/**
 * Simpan FCM token device client.
 * Body: { userId, token, platform: "android" | "ios" }
 */
export async function registerDevice(req: Request, res: Response) {
  const userId = req.body?.userId;
  const token = req.body?.token;
  const platform = req.body?.platform ?? "android";

  if (!userId || !token) {
    return res
      .status(400)
      .json({ success: false, message: "userId and token are required" });
  }

  try {
    await deviceService.registerDevice(String(userId), String(token), String(platform));
    res.json({ success: true, message: "Device registered" });
  } catch (err) {
    console.error("Error registering device:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Hapus FCM token saat user logout.
 * Body: { userId, token }
 */
export async function unregisterDevice(req: Request, res: Response) {
  const userId = req.body?.userId;
  const token = req.body?.token;

  if (!userId || !token) {
    return res
      .status(400)
      .json({ success: false, message: "userId and token are required" });
  }

  try {
    const removed = await deviceService.unregisterDevice(
      String(userId),
      String(token)
    );
    res.json({ success: true, removed });
  } catch (err) {
    console.error("Error unregistering device:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}
