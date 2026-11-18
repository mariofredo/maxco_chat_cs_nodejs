import * as fs from "fs";

/** Largest file accepted in a chat, measured on the decoded file. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Image, video and PDF (transfer receipts), lowercase, without the dot. */
export const ALLOWED_UPLOAD_EXTENSIONS: readonly string[] = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "mp4",
  "mov",
  "pdf",
];

export type FileUploadReason = "file_too_large" | "file_type_not_allowed";

const UPLOAD_MESSAGES: Record<FileUploadReason, string> = {
  file_too_large: "File is larger than 50 MB",
  file_type_not_allowed: `File type not allowed (allowed: ${ALLOWED_UPLOAD_EXTENSIONS.join(", ")})`,
};

/** A chat file that is refused; `message` is shown to the user as is. */
export class FileUploadError extends Error {
  readonly reason: FileUploadReason;
  readonly maxBytes: number;

  constructor(reason: FileUploadReason, maxBytes: number = MAX_UPLOAD_BYTES) {
    super(UPLOAD_MESSAGES[reason]);
    this.name = "FileUploadError";
    this.reason = reason;
    this.maxBytes = maxBytes;
  }
}

/**
 * The file name without any path, limited to [A-Za-z0-9._-], so a name like
 * "../x" cannot write outside the upload folder.
 */
export function safeFileName(fileName: string): string {
  const base = String(fileName ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned || "file";
}

/**
 * Checks a base64 chat file: allowed extension, then size. The size is first
 * estimated from the base64 length, so an oversized upload is refused before
 * it is decoded. Throws FileUploadError.
 */
export function validateUpload(
  fileName: string,
  fileDataBase64: string,
  maxBytes: number = MAX_UPLOAD_BYTES,
): { safeName: string; data: Buffer } {
  const safeName = safeFileName(fileName);
  const dot = safeName.lastIndexOf(".");
  const extension = dot >= 0 ? safeName.slice(dot + 1).toLowerCase() : "";
  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(extension)) {
    throw new FileUploadError("file_type_not_allowed", maxBytes);
  }

  const base64 = String(fileDataBase64 ?? "");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const estimatedBytes = Math.floor((base64.length * 3) / 4) - padding;
  if (estimatedBytes > maxBytes) {
    throw new FileUploadError("file_too_large", maxBytes);
  }

  const data = Buffer.from(base64, "base64");
  if (data.length > maxBytes) {
    throw new FileUploadError("file_too_large", maxBytes);
  }
  return { safeName, data };
}

export async function saveChatFile(fileName: string, fileDataBase64: string) {
  const { safeName, data } = validateUpload(fileName, fileDataBase64);
  const uploadDir = "uploads/chat";
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const filePath = `${uploadDir}/${Date.now()}_${safeName}`;
  await fs.promises.writeFile(filePath, data);

  return {
    contentUrl: filePath,
    metadata: {
      fileName,
      size: data.length
    }
  };
}
