import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import chatRoutes from "./routes/chatRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import { registerChatSocket } from "./sockets/chatSocket.js";
import { registerPresenceSocket } from "./sockets/presenceSocket.js";
import { registerTypingSocket } from "./sockets/typingSocket.js";
import { setIO } from "./sockets/io.js";
import { requireApiKey, requireSocketApiKey } from "./middleware/apiKey.js";
import { jsonBodyErrorHandler } from "./middleware/bodyErrors.js";
import { runAutoClose } from "./services/autoCloseService.js";
import { startNonOverlappingInterval } from "./utils/interval.js";
import path from "path";


const app = express();

// middleware urutannya harus rapi
app.use(cors());             // buka akses dulu
// Base64 uploads: a 50 MB file (MAX_UPLOAD_BYTES) is about 67 MB of base64,
// so the body limit leaves room for it plus the JSON around it. The real
// 50 MB check is in saveChatFile.
const BODY_LIMIT = "72mb";
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

// Kesehatan wajib terbuka: dipakai Docker HEALTHCHECK (tanpa header).
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

// routes REST — semua wajib API key (header X-API-Key)
app.use("/api/chats", requireApiKey, chatRoutes);
// Route KHUSUS app client (badge chat belum dibaca, dll.).
// Dipisah dari /api/chats supaya perubahan client tidak menyentuh kode CRM.
app.use("/api/client", requireApiKey, clientRoutes);
// app.use("/api/messages", messageRoutes);
app.use("/uploads", express.static("uploads"));
// A body over BODY_LIMIT answers JSON 413 (reason file_too_large).
app.use(jsonBodyErrorHandler);


// bikin HTTP server
const server = http.createServer(app);

// pasang socket.io
const io = new Server(server, {
  cors: {
    origin: "*", // ganti sesuai kebutuhan,
  },
  // Same room as BODY_LIMIT for a 50 MB file sent as base64 over send_message.
  // A message above this still makes Socket.IO drop the connection, so the
  // clients check the size before sending.
  maxHttpBufferSize: 72 * 1024 * 1024
});
// Semua koneksi socket wajib bawa API key (auth/query/header)
io.use(requireSocketApiKey);
setIO(io);

// Closes idle Customer Support chats (list_chat_config.auto_close_minutes,
// 0 = off). One pass per minute, never two at once.
startNonOverlappingInterval(runAutoClose, 60_000);

// pasang handler socket
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  registerChatSocket(io, socket);
  registerPresenceSocket(socket);
  registerTypingSocket(socket);
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
