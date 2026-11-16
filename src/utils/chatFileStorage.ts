import * as fs from "fs";

export async function saveChatFile(fileName: string, fileDataBase64: string) {
  const buffer = Buffer.from(fileDataBase64, "base64");
  const uploadDir = "uploads/chat";
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const filePath = `${uploadDir}/${Date.now()}_${fileName}`;
  await fs.promises.writeFile(filePath, buffer);

  return {
    contentUrl: filePath,
    metadata: {
      fileName,
      size: buffer.length
    }
  };
}
