import * as fs from "fs";

/** Largest file accepted in a chat, measured on the decoded file. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Image, video, PDF (transfer receipts) and Word documents, lowercase,
 * without the dot. Only `docx`: legacy `doc` and macro-enabled `docm` stay out.
 */
export const ALLOWED_UPLOAD_EXTENSIONS: readonly string[] = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "mp4",
  "mov",
  "pdf",
  "docx",
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
 * Checks a base64 chat file: allowed extension, then size. A payload far
 * above the limit is refused from its length alone, before it is decoded;
 * the guard has slack because line breaks in wrapped base64 are not data.
 * The exact limit is checked on the decoded bytes. Throws FileUploadError.
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
  // Base64 of maxBytes is ceil(maxBytes / 3) * 4 characters; 5% + 16 covers
  // line breaks (76-character lines with CRLF add about 2.6%).
  const maxBase64Length = Math.ceil(maxBytes / 3) * 4 * 1.05 + 16;
  if (base64.length > maxBase64Length) {
    throw new FileUploadError("file_too_large", maxBytes);
  }

  const data = Buffer.from(base64, "base64");
  if (data.length > maxBytes) {
    throw new FileUploadError("file_too_large", maxBytes);
  }
  return { safeName, data };
}

/** Validates, then stores a chat file (REST upload). */
export async function saveChatFile(fileName: string, fileDataBase64: string) {
  const { safeName, data } = validateUpload(fileName, fileDataBase64);
  return writeChatFile(safeName, data, fileName);
}

/**
 * Stores a file that validateUpload already accepted, as
 * uploads/chat/<timestamp>_<safeName>. `originalName` goes to the metadata.
 */
export async function writeChatFile(safeName: string, data: Buffer, originalName: string) {
  const fileName = originalName;
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
