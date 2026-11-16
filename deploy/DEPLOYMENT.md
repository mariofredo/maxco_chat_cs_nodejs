# Maxco Chat CS — Deployment Guide (image-only)

This guide is for the client's server. No source code and no build step are required —
only the Docker image plus the configuration files in this folder.

---

## 1. What this package contains

The package unzips to one **install folder** with two sub-folders. Keep this layout on the server
(e.g. `/opt/maxco-chat-cs`) and run every command in this guide **from the install folder**:

```
<install folder>/                      # run all commands from here
├── deploy/
│   ├── docker-compose.yml             # image-only deployment (required)
│   ├── docker-compose.with-db.yml     # optional: also runs MySQL
│   ├── .env.example                   # configuration template -> copy to deploy/.env
│   ├── install.sh                     # installer / updater (load image + up + health wait)
│   ├── DEPLOYMENT.md                  # this document
│   └── sql/
│       ├── 01_schema.sql              # base schema (required, run first)
│       ├── 02_migrations.sql          # subsequent schema changes (run second)
│       └── 0N_dbchanges_*.sql         # incremental changes (run in file-name order)
└── release/
    └── maxco-chat-cs_1.0.0_linux-amd64.tar (+ .sha256)   # for Intel/AMD 64-bit servers
        maxco-chat-cs_1.0.0_linux-arm64.tar (+ .sha256)   # for ARM64 servers (e.g. Graviton)
```

Each package contains the image file for **one** CPU type (amd64 or arm64).

`docker compose` commands must run inside `deploy/` (that is where `.env` lives), so this guide
writes them as `(cd deploy && docker compose ...)`. The parentheses return you to the install
folder afterwards.

If the client has their own registry, the image can be pushed and pulled instead — see §9.

---

## 2. Prerequisites on the client's server

| Requirement | Value |
|---|---|
| Docker Engine | 24+ with the `docker compose` v2 plugin |
| Server CPU | x86_64 → **amd64** tar; ARM64 → **arm64** tar (do not mix them up — the symptom is `exec format error`) |
| Database | MySQL 8.0 / MariaDB 10.4+ (self-hosted or managed), charset `utf8mb4` |
| Application port | 1 TCP port (default 3000) — REST **and** Socket.IO share the same port |
| Resources | ~0.5 vCPU / 512 MB RAM is enough for the application (database separate) |
| Storage | the `chat_uploads` volume for chat files (start with 1 GB, monitor under heavy traffic) |

---

## 3. Quick install (first time)

```bash
# Run from the install folder (the one that contains deploy/ and release/)

# 1. Verify the image file
(cd release && sha256sum -c maxco-chat-cs_1.0.0_linux-amd64.tar.sha256)   # (macOS: shasum -a 256 -c ...)

# 2. Configuration: fill in the MySQL credentials
cp deploy/.env.example deploy/.env && nano deploy/.env

# 3. Install (automatically docker load + compose up + health wait)
IMAGE_TAR=release/maxco-chat-cs_1.0.0_linux-amd64.tar sudo ./deploy/install.sh

# If the client has no MySQL yet, one command for app + database:
IMAGE_TAR=release/maxco-chat-cs_1.0.0_linux-amd64.tar sudo ./deploy/install.sh --with-db
```

On ARM64 servers use the `linux-arm64` file name. `deploy/install.sh` is idempotent: re-running it
to apply new configuration or redeploy is safe. To install a newer version later, see
**§10 Update to a new version**.

> [!NOTE]
> With the default `sudo` configuration, a variable written *before* `sudo` (as above) is not
> passed to the script. That is fine: when `IMAGE_TAR` is missing, `install.sh` picks
> `release/maxco-chat-cs_<APP_IMAGE version>_linux-<this server's CPU>.tar` by itself. To pass it
> explicitly anyway, put it after `sudo`: `sudo IMAGE_TAR=release/... ./deploy/install.sh`.

---

## 4. Manual install (without install.sh)

```bash
# From the install folder
# a. Load the image
docker load -i release/maxco-chat-cs_1.0.0_linux-amd64.tar
docker image inspect maxco-chat-cs:1.0.0 --format 'arch={{.Architecture}} version={{index .Config.Labels "org.opencontainers.image.version"}}'

# b. Configuration
cp deploy/.env.example deploy/.env && nano deploy/.env

# c. Prepare the database (see §5), then:
(cd deploy && docker compose up -d)
(cd deploy && docker compose ps)
curl -s http://127.0.0.1:3000/healthz          # {"ok":true}
(cd deploy && docker compose logs -f app)       # Listening on 3000
```

---

## 5. Database

**Scenario A — the client already has MySQL** (most common):

```bash
for f in deploy/sql/*.sql; do echo "== $f"; mysql -h <MYSQLHOST> -u <MYSQLUSER> -p < "$f"; done
# the order comes from the file names: 01_schema, 02_migrations, 03.._dbchanges
```

**Scenario B — MySQL runs from this compose file**: use `sudo ./deploy/install.sh --with-db` or
`(cd deploy && docker compose -f docker-compose.yml -f docker-compose.with-db.yml up -d)`; the
`deploy/sql/` folder is executed in order when the database volume is created for the first time.

Important notes:

- `01_schema.sql` contains `CREATE DATABASE` + `USE`, and the database name inside it (`maxco_chat_im`)
  **must match** `MYSQLDATABASE` in `deploy/.env`. If the client uses a different name, change it in both places.
- No file is **idempotent** — run them once against an empty database, in file-name order.
  For an **existing** database, request the incremental migration files (in the source repo: the
  `sql/dbchanges_*.sql` folder). The latest one, `sql/dbchanges_202610191417.sql`, is required for
  databases that already run the app: it removes the duplicate inside sales chats (category 3) that
  older builds could create in parallel, and adds the unique index that prevents them.
  `sql/dbchanges_202610221020.sql` adds the indexes the client app pagination needs
  (`list_chats.user_id` and `list_messages(chat_id, created_at, id)`); without them every page of
  the list and of the message history scans the whole table. It is optional but recommended.
- `01_schema.sql` already includes the **required seed** rows for `list_content_type` (id 1 = Text, 2 = File).
  Without them, messages fail to save (foreign key) and the CRM message list stays empty.
  `05_dbchanges_202610161456.sql` seeds chat category 3 (Inside Sales); without it the client app
  cannot create the inside sales chat (`POST /api/chats/user` fails on the foreign key).
- 6 tables must exist after §5: `list_chats`, `list_messages`, `list_content_type`,
  `list_chat_category`, `list_chat_admin_history`, `list_user_devices` (the last one only
  matters for push notifications, see §13). Quick check:
  `mysql -h ... -e "SHOW TABLES FROM maxco_chat_im;"`
- Timezone: `TZ` in `.env` should match the MySQL server timezone so chat timestamps stay consistent.

---

## 6. Environment variables

All variables live in `deploy/.env`.

| Variable | Required | Example | Notes |
|---|---|---|---|
| `MYSQLHOST` | yes | `host.docker.internal` | Use this when MySQL runs on the same host; for another container use the service name (e.g. `db`) |
| `MYSQLPORT` | yes | `3306` | |
| `MYSQLUSER` | yes | `maxco_chat` | Needs DML + DDL rights (for migrations) on that database |
| `MYSQLPASSWORD` | yes | — | |
| `MYSQLDATABASE` | yes | `maxco_chat_im` | Must match the database name in `01_schema.sql` |
| `PORT` | no | `3000` | Port inside the container |
| `APP_PORT` | no | `3000` | Port exposed on the server (used by the CRM) |
| `APP_IMAGE` | no | `maxco-chat-cs:1.0.0` | Image tag used by compose |
| `CHAT_API_KEY` | recommended | `openssl rand -hex 32` | Protects REST + Socket.IO with a static API key (§6 note below). Empty = open mode (development) |
| `TZ` | no | `Asia/Jakarta` | Container timezone |
| `PRESENCE_GRACE_SECONDS` | no | `10` | Seconds before a disconnected CRM/app socket is shown offline (online status of CS and users). `0` = no waiting |
| `FCM_PUSH_ENABLED` | no | `true` | Enables push notifications to the mobile app (see §13). Off by default |
| `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | for push | — | Base64 of the Firebase service account JSON (option 1, see §13) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | for push | — | Raw service account JSON on one line (option 2) |
| `FIREBASE_SERVICE_ACCOUNT_FILE` | for push | `/app/firebase-service-account.json` | Path inside the container (option 3, needs the compose volume) |
| `FIREBASE_PROJECT_ID` | no | `maxco-807ff` | Only when the project id is not taken from the service account file |

The application requires **no** API key by default. When `CHAT_API_KEY` is set (strongly
recommended in production), every protected endpoint needs `X-API-Key: <key>` (or
`Authorization: Bearer <key>`, or `?api_key=<key>`), and Socket.IO connections must pass it in
`auth: { api_key: "<key>" }` (or `?api_key=`). Outbound calls are limited to MySQL and,
**only when push notifications are enabled** (§13), to Firebase Cloud Messaging.

> [!IMPORTANT]
> When you first set `CHAT_API_KEY`, the CRM/frontends and Socket.IO clients must start sending
> the key at the same time or they will get 401 / `connect_error`. Coordinate the change: set the
> key in `.env`, deploy, then update the mobile app / CRM config with the same value.


---

## 7. Post-deployment verification

```bash
curl -s http://127.0.0.1:3000/healthz
# {"ok":true}

# create a test chat (must return 201 with a chat_ticket)
curl -s -X POST http://127.0.0.1:3000/api/chats/crm/create_service_chat \
  -H 'Content-Type: application/json' -d '{"user_id":"smoke-test","user_name":"Smoke Test"}'

# upload a file (must succeed and store the file in the chat_uploads volume)
B64=$(printf 'hello' | base64)
curl -s -X POST http://127.0.0.1:3000/api/chats/crm/chat/upload \
  -H 'Content-Type: application/json' -d "{\"fileName\":\"test.txt\",\"fileDataBase64\":\"$B64\"}"
docker exec maxco_chat_cs ls -l /app/uploads/chat

# Socket.IO handshake (used by realtime chat)
curl -s 'http://127.0.0.1:3000/socket.io/?EIO=4&transport=polling'
```

Available endpoints (prefix `/api/chats`):

| Method & path | Purpose |
|---|---|
| `GET /api/chats/active` | list active chats |
| `GET /api/chats/user/:userId` | chats belonging to one user (add `?page=&pageSize=` to page through them) |
| `POST /api/chats/user` | chats of one user, creating the inside sales chat when missing (add `page` / `pageSize` to the body to page through them) |
| `POST /api/chats/` | create a chat (body: `userId`, `userName`) |
| `GET /api/chats/:chatId/messages` | messages of one chat (add `?page=&pageSize=`; page 1 = newest, later pages = older history) |
| `PUT /api/chats/:chatId/read` | mark messages as read |
| `POST /api/chats/crm/create_service_chat` | create a service chat (body: `user_id`, `user_name`) |
| `POST /api/chats/crm/chat/pending` \| `/chat/active` \| `/chat/close` \| `/closed` | CRM flow |
| `POST /api/chats/crm/messages` | CRM chat messages (body: `chatId`, `updateRead`, `userId`) |
| `POST /api/chats/crm/chat/upload` | upload a file (body: `fileName`, `fileDataBase64`) |
| `GET /uploads/...` | access uploaded files |
| `GET /api/client/presence` | online status of the teams: `{ data: { customer_support, sales } }` |
| `GET /api/chats/crm/presence?userIds=a,b,c` | online status of up to 100 users: `{ data: { "<userId>": boolean } }` |
| `GET /healthz` | health check |

Socket.IO events (client → server): `join_chat`, `join_user`, `send_message`, `close_chat`,
`assigned_admin_chat`, `typing`, `presence_register`, `presence_leave`, `presence_subscribe`,
`presence_unsubscribe`, `presence_user_register`, `presence_user_leave`. Server → client:
`chat_room_created`, `new_message`, `chat_closed`, `assigned_admin_chat`, `typing`,
`presence_changed`, `presence_user_changed`. Default path: `/socket.io`, default namespace.
Presence ids (`adminId`, `userId`) must be strings; the payloads are in
`docs/superpowers/specs/2026-11-10-presence-status-design.md`.

---

## 8. Reverse proxy (if the client uses nginx/Traefik)

Two settings are mandatory, otherwise realtime chat and uploads will fail:

```nginx
location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;        # REQUIRED for Socket.IO
    proxy_set_header   Connection "upgrade";         # REQUIRED for Socket.IO
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;                        # long-lived websocket connections
    client_max_body_size 50m;                        # upload/base64 payloads up to 50 MB
}
```

Note: CORS in the application is still a wildcard (`origin: "*"`) for both REST and Socket.IO.
If the client needs domain restrictions, contact us for a custom build.

---

## 9. Registry (tar alternative)

```bash
# vendor (needs docker login access to the client's registry)
docker push <client-registry>/maxco-chat-cs:1.0.0

# client
docker pull <client-registry>/maxco-chat-cs:1.0.0
# then set APP_IMAGE=<client-registry>/maxco-chat-cs:1.0.0 in deploy/.env
```

If a single multi-arch tag is preferred (the registry picks the right one for the server CPU):

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t <client-registry>/maxco-chat-cs:1.0.0 --push .
```

---

## 10. Persistent data, backup, upgrade

- **Volume** `chat_uploads` → mounted at `/app/uploads` (contents: `uploads/chat/<timestamp>_<file name>`).
  Do not replace it with a bind mount to a source folder. Backup:
  ```bash
  docker run --rm -v maxco-chat-cs_chat_uploads:/data -v "$PWD":/backup alpine \
    tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
  ```
- **Database** is backed up separately by the client (e.g. `mysqldump maxco_chat_im`); the application stores nothing else.
- **Upgrade**: see *Update to a new version* below. A few seconds of downtime;
  `restart: unless-stopped` brings the container back up.
- **Rollback**: set `APP_IMAGE` in `deploy/.env` back to the previous tag (the old image stays on
  the server), then `sudo ./deploy/install.sh`.
- **Logs**: stdout only (json-file driver, rotation 10 MB × 3 files). `(cd deploy && docker compose logs -f app)`.

### Update to a new version

The new package has the same `deploy/` + `release/` layout. Unzip it somewhere else (below:
`<new package>`), then run from the install folder:

```bash
# 1. Copy the new image file into release/ and verify it (keep the previous tar for rollback)
cp <new package>/release/maxco-chat-cs_1.0.0_linux-amd64.tar* release/
(cd release && sha256sum -c maxco-chat-cs_1.0.0_linux-amd64.tar.sha256)

# 2. Refresh deploy/ (compose files, install.sh, sql/, this guide). The package never
#    contains .env, so your deploy/.env is kept.
cp -R <new package>/deploy/. deploy/

# 3. Existing database: run the new SQL files named in the release notes, once, in order
#    mysql -h <MYSQLHOST> -u <MYSQLUSER> -p < deploy/sql/<file>.sql

# 4. Copy new variables from deploy/.env.example into deploy/.env (keep your current values),
#    then point APP_IMAGE to the new version
sed -i 's/^APP_IMAGE=.*/APP_IMAGE=maxco-chat-cs:1.0.0/' deploy/.env

# 5. Update (load image + recreate container + health wait)
IMAGE_TAR=release/maxco-chat-cs_1.0.0_linux-amd64.tar sudo ./deploy/install.sh
```

At the end, `install.sh` prints `Running image : maxco-chat-cs:<version>`; check it shows the new
version. If step 4 was skipped, `install.sh` either stops with "tarball ... contains image(s) ...
but APP_IMAGE in deploy/.env expects ..." or warns "release/ has a newer version ... than
APP_IMAGE" and keeps the old version running. Fix `APP_IMAGE` and run step 5 again.

---

## 11. Troubleshooting

| Symptom | Cause & action |
|---|---|
| `exec format error` during `docker compose up` | Image architecture does not match the server → use the matching amd64/arm64 tar |
| Container restarts repeatedly, MySQL `ECONNREFUSED` / `ETIMEDOUT` in logs | Wrong `MYSQLHOST` (from inside a container, `localhost` means the container itself) or MySQL refuses connections from the container IP → use `host.docker.internal` with `extra_hosts: host-gateway` |
| `ER_NO_SUCH_TABLE list_chats` | `01_schema.sql` was not run, or `MYSQLDATABASE` differs from the database name used by the schema |
| `ER_BAD_FIELD_ERROR sender_name/user_name/admin_name` | `02_migrations.sql` was not run |
| `ER_BAD_FIELD_ERROR user_referrer_id/user_referrer_name` | `04_dbchanges_*` / `06_dbchanges_*` not run on an existing database → run `sql/dbchanges_202610121639.sql` then `sql/dbchanges_202610190950.sql` |
| `ER_NO_DB/ER_FK_ON_CATEGORY` or `POST /api/chats/user` fails with a foreign key error on `list_chats.category_id` | category 3 seed missing → run `sql/dbchanges_202610161456.sql` |
| A user shows two inside sales chats (category 3) | `sql/dbchanges_202610191417.sql` not run yet → run it (it removes the duplicates and adds `uq_list_chats_sales_chat`) |
| Upload returns `{"success":false,"message":"File upload failed"}` with `EACCES` in the logs | `/app/uploads` is mounted with the wrong ownership (e.g. a host folder bind mount) → use the `chat_uploads` named volume, or `chown -R 1000:1000` the host folder |
| Upload fails behind nginx (413) | `client_max_body_size` is too low (payloads can reach 50 MB) |
| Chat is not realtime | The reverse proxy is not forwarding the `Upgrade`/`Connection` headers, or `proxy_read_timeout` is too short |
| Message timestamps are off | Container `TZ` differs from the MySQL timezone; align both |
| Check the running image version | `docker inspect maxco_chat_cs --format '{{.Config.Image}}'` and the `org.opencontainers.image.version` label |
| `IMAGE_TAR points to a file that does not exist` | The tar is not in `release/`, or the command was not run from the install folder → `cd` to the folder that contains `deploy/` and `release/` |
| `image ... is not loaded and no matching tarball was found` | No `release/maxco-chat-cs_<APP_IMAGE version>_linux-<CPU>.tar` → copy the tar into `release/` and check `APP_IMAGE` in `deploy/.env` |
| After an update the old version is still running | `APP_IMAGE` in `deploy/.env` still has the old tag → set the new tag and run `deploy/install.sh` again (§10) |

---

## 12. What we deliver

| Item | Value |
|---|---|
| Image | `maxco-chat-cs:1.0.0` (+ amd64/arm64 tar files with their `.sha256`) |
| Port | 3000 (changeable via `PORT`/`APP_PORT`) |
| Volume | `chat_uploads` → `/app/uploads` |
| Health check | `GET /healthz` (already enabled in the image and compose file) |
| Container user | non-root (`node`, uid 1000) |
| Node.js | 24 (Alpine) |
| Needed from the client | MySQL credentials, port to expose, domain (if any), registry preference (if not using the tar) |

---

## 13. Push notification for the mobile app (optional)

When `FCM_PUSH_ENABLED=true`, every message sent from the CRM is also delivered as a push
notification to the devices registered by the client who owns the chat. The feature is fully
optional: with the variable off (the default) the service never contacts Firebase.

### What is required

1. **Mobile app build** that carries the Firebase config files
   (`android/app/google-services.json`, `ios/Runner/GoogleService-Info.plist`) and has
   `PUSH_NOTIFICATION_ENABLED=true` in its own `.env`.
2. **Firebase service account**: Firebase console → Project settings → Service accounts →
   *Generate new private key*.
3. **`deploy/.env` on this server**: `FCM_PUSH_ENABLED=true` plus one credential option (§6).
   Recommended:
   ```bash
   base64 -i service-account.json | tr -d '\n'   # paste the output into .env
   FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=...
   ```
4. **Database**: the `list_user_devices` table (§5). It is created by `02_migrations.sql`;
   for an existing database run `sql/dbchanges_202610051115.sql` from the source repo.
5. **Restart** after changing `deploy/.env`: `(cd deploy && docker compose up -d)`.

Push is sent only for messages with `sender_type = admin` (CRM). The client's own replies are
never pushed. Invalid/expired tokens are removed automatically.

### Verify

```bash
# 1. From the mobile app log, copy the FCM token, then register it:
curl -s -X POST http://127.0.0.1:3000/api/chats/devices \
  -H 'Content-Type: application/json' \
  -d '{"userId":"<member id>","token":"<fcm token>","platform":"android"}'

# 2. Send a message from the CRM and follow the log:
(cd deploy && docker compose logs -f app) | grep FCM
```

Expected: `FCM: chat <id> -> 1/1 delivered`, and the notification on the device.

### Troubleshooting

| Symptom | Cause & action |
|---|---|
| `FCM: not configured ... push skipped` | No credential in `.env`, or the variable name is misspelled |
| `FCM: firebase-admin init failed` | The service account JSON is truncated/corrupt, or it belongs to another project than the mobile app |
| `FCM: chat <id> -> 0/1 delivered` with `UNREGISTERED` | Token no longer valid (app reinstalled) — it is removed automatically; the next app login registers the new token |
| No notification on the device | Notification permission denied in the app, or `FCM_PUSH_ENABLED` / `PUSH_NOTIFICATION_ENABLED` not set to `true` |
