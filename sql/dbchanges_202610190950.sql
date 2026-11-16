ALTER TABLE list_chats ADD user_referrer_name varchar(100) DEFAULT NULL NULL;
ALTER TABLE list_chats CHANGE user_referrer_name user_referrer_name varchar(100) DEFAULT NULL NULL AFTER user_referrer_id;
