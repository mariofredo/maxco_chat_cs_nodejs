import { cert, getApps, initializeApp, type App, type AppOptions } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { getUserDevices, removeDeviceToken } from "./deviceService.js";

/** Channel yang sama dengan default_notification_channel_id di AndroidManifest. */
const ANDROID_CHANNEL_ID = "maxco_live_chat";

export type ChatPushPayload = {
  userId: string;
  chatId: string;
  title: string;
  body: string;
};

let firebaseApp: App | null = null;
let initSkipped = false;

function isPushEnabled(): boolean {
  return process.env.FCM_PUSH_ENABLED === "true";
}

function hasCredential(): boolean {
  return Boolean(
    (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "").trim() ||
      (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 ?? "").trim() ||
      (process.env.FIREBASE_SERVICE_ACCOUNT_FILE ?? "").trim()
  );
}

/**
 * Init firebase-admin sekali saja. Belum dikonfigurasi / gagal init -> null,
 * dan push dilewati (bukan error yang menghentikan chat).
 */
function getFirebaseApp(): App | null {
  if (firebaseApp) return firebaseApp;
  if (initSkipped) return null;

  try {
    const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "").trim();
    const rawBase64 = (
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 ?? ""
    ).trim();
    const keyFile = (process.env.FIREBASE_SERVICE_ACCOUNT_FILE ?? "").trim();

    const options: AppOptions = {};
    if (rawJson) {
      options.credential = cert(JSON.parse(rawJson) as object);
    } else if (rawBase64) {
      const json = Buffer.from(rawBase64, "base64").toString("utf8");
      options.credential = cert(JSON.parse(json) as object);
    } else if (keyFile) {
      options.credential = cert(keyFile);
    } else {
      console.log(
        "FCM: not configured (FIREBASE_SERVICE_ACCOUNT_JSON / _JSON_BASE64 / _FILE empty) — push skipped"
      );
      initSkipped = true;
      return null;
    }

    const projectId = (process.env.FIREBASE_PROJECT_ID ?? "").trim();
    if (projectId) options.projectId = projectId;

    const existing = getApps()[0];
    firebaseApp = existing ?? initializeApp(options);
    console.log("FCM: firebase-admin initialised");
    return firebaseApp;
  } catch (err) {
    console.error("FCM: firebase-admin init failed — push skipped:", err);
    initSkipped = true;
    return null;
  }
}

/**
 * Kirim push notification ke semua device milik `userId`.
 * Selalu fire-and-forget dari sisi chat: tidak boleh memperlambat
 * broadcast `new_message`, dan kegagalan push bukan kegagalan chat.
 */
export async function sendChatPush(payload: ChatPushPayload): Promise<void> {
  if (!isPushEnabled() || !hasCredential()) return;

  const app = getFirebaseApp();
  if (!app) return;

  try {
    const devices = await getUserDevices(payload.userId);
    if (devices.length === 0) {
      console.log(`FCM: no registered device for user ${payload.userId}`);
      return;
    }

    const tokens = devices.map((device) => device.fcm_token);
    const result = await getMessaging(app).sendEachForMulticast({
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: {
        type: "chat",
        chat_id: payload.chatId,
      },
      android: {
        notification: {
          channelId: ANDROID_CHANNEL_ID,
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });

    // Bersihkan token yang sudah tidak valid supaya tidak dikirim lagi.
    const staleTokens: string[] = [];
    result.responses.forEach((response, index) => {
      if (response.success) return;
      const code = response.error?.code ?? "";
      const token = tokens[index];
      if (!token) return;
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token") ||
        code.includes("invalid-argument")
      ) {
        staleTokens.push(token);
      }
    });

    for (const token of staleTokens) {
      try {
        await removeDeviceToken(token);
        console.log(`FCM: removed stale token (${token.slice(0, 12)}...)`);
      } catch (err) {
        console.error("FCM: failed removing stale token:", err);
      }
    }

    console.log(
      `FCM: chat ${payload.chatId} -> ${result.successCount}/${tokens.length} delivered` +
        (staleTokens.length ? `, ${staleTokens.length} stale removed` : "")
    );
  } catch (err) {
    console.error("FCM: sendChatPush failed:", err);
  }
}
