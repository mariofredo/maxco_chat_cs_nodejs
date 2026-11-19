/** One `list_chats` row (the pool returns times as ISO 8601 UTC strings: utils/dbTime). */
export type ChatDataInfo = {
  id: number;
  chat_ticket: string;
  category_id: number;
  user_id: string;
  user_name: string | null;
  user_referrer_id: string | null;
  user_referrer_name: string | null;
  admin_id: string | null;
  admin_name: string | null;
  status: string;
  created_at: string;
  closed_at: string | null;
};

export type SendMessageInput = {
  chat_id: number;
  sender_id: string;
  sender_type: string;
  sender_name: string | null;
  content_type: number;
  message?: string | null;
  file_name?: string | null;
  file_data?: string | null;
  content_url?: string | null;
  metadata?: any | null;
};

export type CrmChatDataInfo = {
  id: number;
  chat_ticket: string;
  user_id: string;
  admin_id: string | null;
  status: string;
  created_at: Date;
  closed_at: Date | null;
  last_message: string | null;
  last_message_content_type: number | null;
  last_message_content_type_name: string | null;
  last_message_metadata: any | null;
  last_message_time: Date | null;
  last_message_admin: string | null;
  last_message_admin_content_type: number | null;
  last_message_admin_metadata: any | null;
  last_message_admin_time: Date | null;
};