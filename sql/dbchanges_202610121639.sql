ALTER TABLE list_chats ADD user_referrer_id varchar(100) DEFAULT NULL NULL;
ALTER TABLE list_chats CHANGE user_referrer_id user_referrer_id varchar(100) DEFAULT NULL NULL AFTER user_name;
