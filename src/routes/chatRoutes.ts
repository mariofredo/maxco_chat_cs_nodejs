import { Router } from "express";
import { createChat, getActiveChats, getUserChats, getUserSalesChat, getChatMessages , updateReadMessages} from "../controllers/chatController.js";
import * as CrmChat from "../controllers/crmChatController.js";
import * as Device from "../controllers/deviceController.js";

const router = Router();

// ==================== HUB ROUTES ====================
const chatRoutes = Router();
chatRoutes.get("/active", getActiveChats);
chatRoutes.get("/user/:userId", getUserChats);
// get user/client chat with post to check the sales chat
chatRoutes.post("/user", getUserSalesChat);
chatRoutes.post("/", createChat);
chatRoutes.get("/:chatId/messages", getChatMessages);
chatRoutes.put("/:chatId/read", updateReadMessages);

// ==================== PUSH NOTIFICATION (FCM) ====================
// Registrasi token device client agar bisa menerima push chat masuk.
chatRoutes.post("/devices", Device.registerDevice);
chatRoutes.post("/devices/unregister", Device.unregisterDevice);

// ==================== CRM ROUTES ====================
const crmRoutes = Router();
crmRoutes.get("/config", CrmChat.getCrmChatConfig);
crmRoutes.post("/messages", CrmChat.getCrmChatMessages);
crmRoutes.get("/chat/pending", CrmChat.getCrmPendingChat);
crmRoutes.post("/chat/active", CrmChat.getCrmActiveChat);
// Single flat list for the CRM sales view: chats whose user_referrer_id is
// the sales member who is logged in (no Assigned / Waiting / Closed tabs).
crmRoutes.post("/chat/referred", CrmChat.getCrmReferredChat);
crmRoutes.post("/chat/close", CrmChat.crmCloseChat);
crmRoutes.get("/closed", CrmChat.getCrmClosedChat);
crmRoutes.get("/chat/room/:chatId", CrmChat.getChatInfo);
crmRoutes.post("/chat/upload", CrmChat.uploadChatFile);
crmRoutes.post("/current_service_chat", CrmChat.getCurrentServiceChat);
crmRoutes.post("/create_service_chat", CrmChat.createUserServiceChat);
crmRoutes.post("/promotion_chat", CrmChat.getCurrentPromotionChat);
// Opens the promotion / inside sales chat for a user picked in the search
// results. When the chat already exists (and is still active) the existing
// chat is returned, so no duplicate chat is created.
crmRoutes.post("/open_promotion_chat", CrmChat.openPromotionChat);
crmRoutes.post("/open_inside_sales_chat", CrmChat.openInsideSalesChat);
// Called when admin moves a client to another sales person: the old sales chat
// is closed and a new one is opened for the new sales person.
crmRoutes.post("/reassign_sales_chat", CrmChat.reassignSalesChat);
// Initial online state of users (updates come from the presence_user_changed event).
crmRoutes.get("/presence", CrmChat.getCrmUsersPresence);

// Mount routes ke main router
router.use("/", chatRoutes);
router.use("/crm", crmRoutes);

export default router;