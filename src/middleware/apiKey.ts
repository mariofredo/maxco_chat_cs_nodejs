import type { Request, Response, NextFunction } from "express";
import type { Socket } from "socket.io";

/**
 * API key statis dari env CHAT_API_KEY.
 *
 * Semua endpoint REST wajib mengirim key lewat header `X-API-Key`
 * (atau `Authorization: Bearer <key>`). Jika CHAT_API_KEY tidak
 * diset, middleware tidak memproteksi apa pun (mode terbuka, seperti
 * perilaku lama) dan mencetak peringatan sekali saat boot.
 */

const HEADER_API_KEY = "x-api-key";

let warnedOpenMode = false;

function configuredKey(): string | null {
  const key = process.env.CHAT_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = configuredKey();

  if (!expected) {
    if (!warnedOpenMode) {
      warnedOpenMode = true;
      console.warn(
        "[apikey] CHAT_API_KEY tidak diset — semua endpoint terbuka (mode development)."
      );
    }
    next();
    return;
  }

  const supplied =
    req.get(HEADER_API_KEY) ??
    bearerToken(req.get("authorization")) ??
    req.query.api_key;

  if (typeof supplied === "string" && timingSafeEqual(supplied, expected)) {
    next();
    return;
  }

  res.status(401).json({
    error: "Unauthorized",
    message: "API key tidak valid. Kirim lewat header X-API-Key.",
  });
}

/**
 * Guard socket.io: API key dikirim saat handshake lewat salah satu:
 *   - auth   : io(url, { auth: { api_key: "..." } })
 *   - query  : io(url, "?api_key=...")  /  ?api_key=...
 *   - header : X-API-Key (hanya client native, browser tidak bisa)
 * Key tidak valid → koneksi langsung ditolak (connect_error di client).
 */
export function requireSocketApiKey(
  socket: Socket,
  next: (err?: Error) => void
): void {
  const expected = configuredKey();

  if (!expected) {
    if (!warnedOpenMode) {
      warnedOpenMode = true;
      console.warn(
        "[apikey] CHAT_API_KEY tidak diset — koneksi socket terbuka (mode development)."
      );
    }
    next();
    return;
  }

  const auth = socket.handshake.auth as Record<string, unknown> | undefined;
  const supplied =
    asString(auth?.api_key) ??
    asString(auth?.apiKey) ??
    asString(socket.handshake.query.api_key) ??
    asString(socket.handshake.query.apiKey) ??
    socket.handshake.headers["x-api-key"];

  if (typeof supplied === "string" && timingSafeEqual(supplied, expected)) {
    next();
    return;
  }

  next(new Error("Invalid API key"));
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Ambil token dari header "Authorization: Bearer <token>". */
function bearerToken(auth: string | undefined): string | undefined {
  if (!auth) return undefined;
  const [scheme, ...rest] = auth.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || rest.length === 0) return undefined;
  return rest.join(" ");
}

/**
 * Perbandingan konstan-waktu supaya tidak bocor timing info.
 * Panjang disamakan dulu dengan hash pendek agar tidak early-return
 * berdasarkan panjang string.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
