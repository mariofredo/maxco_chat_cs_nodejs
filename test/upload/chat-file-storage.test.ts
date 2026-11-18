import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FileUploadError,
  MAX_UPLOAD_BYTES,
  safeFileName,
  validateUpload,
} from "../../src/utils/chatFileStorage.js";

const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");

test("limit is 50 MiB", () => {
  assert.equal(MAX_UPLOAD_BYTES, 52428800);
});

test("accepts allowed types in any case", () => {
  for (const name of ["a.jpg", "b.JPEG", "PHOTO.JPG", "c.png", "d.webp", "e.mp4", "f.MOV", "receipt.pdf"]) {
    assert.equal(validateUpload(name, b64(3)).data.length, 3, name);
  }
});

test("rejects other types", () => {
  for (const name of ["x.exe", "README", "x.png.exe", "x."]) {
    assert.throws(
      () => validateUpload(name, b64(3)),
      (e: unknown) => e instanceof FileUploadError && e.reason === "file_type_not_allowed",
      name,
    );
  }
});

test("exactly the limit passes, one byte more is too large", () => {
  assert.equal(validateUpload("a.png", b64(10), 10).data.length, 10);
  assert.throws(
    () => validateUpload("a.png", b64(11), 10),
    (e: unknown) => e instanceof FileUploadError && e.reason === "file_too_large" && e.maxBytes === 10,
  );
});

test("line-wrapped base64 is measured on the real file", () => {
  const wrapped = (n: number, eol: string) =>
    (b64(n).match(/.{1,76}/g) ?? []).join(eol);
  assert.equal(validateUpload("a.png", wrapped(9800, "\r\n"), 10000).data.length, 9800);
  assert.equal(validateUpload("a.png", wrapped(10000, "\n"), 10000).data.length, 10000);
  assert.equal(validateUpload("a.png", b64(10) + "\n", 10).data.length, 10);
});

test("a payload far above the limit is refused before decoding", () => {
  assert.throws(
    () => validateUpload("a.png", "A".repeat(10_000), 1000),
    (e: unknown) => e instanceof FileUploadError && e.reason === "file_too_large",
  );
});

test("error messages are the agreed text", () => {
  assert.throws(() => validateUpload("a.png", b64(11), 10), { message: "File is larger than 50 MB" });
  assert.throws(() => validateUpload("a.exe", b64(1)), {
    message: "File type not allowed (allowed: jpg, jpeg, png, webp, mp4, mov, pdf)",
  });
});

test("safe name keeps the name without its path", () => {
  assert.equal(validateUpload("../../etc/x.png", b64(1)).safeName, "x.png");
});

test("safeFileName strips paths and odd characters", () => {
  assert.equal(safeFileName("../../etc/x.png"), "x.png");
  assert.equal(safeFileName("..\\a.png"), "a.png");
  assert.equal(safeFileName("my photo (1).jpg"), "my_photo__1_.jpg");
  assert.equal(safeFileName("/"), "file");
});
