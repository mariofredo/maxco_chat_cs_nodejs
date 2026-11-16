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
import path from "path";


const app = express();

// middleware urutannya harus rapi
app.use(cors());             // buka akses dulu
// Allow larger JSON payloads for base64 uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

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


// bikin HTTP server
const server = http.createServer(app);

// pasang socket.io
const io = new Server(server, {
  cors: {
    origin: "*", // ganti sesuai kebutuhan,
  },
  maxHttpBufferSize: 5e7
});
// Semua koneksi socket wajib bawa API key (auth/query/header)
io.use(requireSocketApiKey);
setIO(io);

// pasang handler socket
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  registerChatSocket(io, socket);
  registerPresenceSocket(socket);
  registerTypingSocket(socket);
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
