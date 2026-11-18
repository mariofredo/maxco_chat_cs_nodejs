import type { NextFunction, Request, Response } from "express";
import { FileUploadError, MAX_UPLOAD_BYTES } from "../utils/chatFileStorage.js";

/**
 * A request body over the body-parser limit (a base64 file far above 50 MB)
 * answers JSON like the other upload errors instead of the default HTML page.
 */
export function jsonBodyErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (typeof err === "object" && err !== null && (err as { type?: string }).type === "entity.too.large") {
    const error = new FileUploadError("file_too_large", MAX_UPLOAD_BYTES);
    res.status(413).json({
      success: false,
      reason: error.reason,
      message: error.message,
      maxBytes: error.maxBytes,
    });
    return;
  }
  next(err);
}
