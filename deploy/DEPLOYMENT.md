# Maxco Chat CS — Deployment Guide (image-only)

This guide is for the client's server. No source code and no build step are required —
only the Docker image plus the configuration files in this folder.

---

## 1. What this package contains

Hand over this folder together with **one** of the image files (matching the client's CPU):

```
deploy/
├── docker-compose.yml            # image-only deployment (required)
├── docker-compose.with-db.yml    # optional: also runs MySQL
├── .env.example                  # configuration template -> copy to .env
├── install.sh                    # installer (load image + up + health wait)
├── check-endpoints.sh            # smoke test of a running deployment (§7)
├── DEPLOYMENT.md                 # this document
├── sql/
│   ├── 01_schema.sql             # base schema (required, run first)
│   └── 02_migrations.sql         # subsequent schema changes (run second)
└── maxco-chat-cs_1.0.0_linux-amd64.tar (+ .sha256)   # for Intel/AMD 64-bit servers
    maxco-chat-cs_1.0.0_linux-arm64.tar (+ .sha256)   # for ARM64 servers (e.g. Graviton)
```

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

## 3. Quick install

```bash
# 1. In this folder:
sha256sum -c maxco-chat-cs_1.0.0_linux-amd64.tar.sha256   # (macOS: shasum -a 256 -c ...)

# 2. If the client already has MySQL, fill in .env first
cp .env.example .env && nano .env

# 3. Install (automatically docker load + compose up + health wait)
IMAGE_TAR=maxco-chat-cs_1.0.0_linux-amd64.tar ./install.sh

# If the client has no MySQL yet, one command for app + database:
cp .env.example .env && nano .env
./install.sh --with-db

# 4. Check the whole deployment (app, database, API key) - see §7
./check-endpoints.sh http://127.0.0.1:3000     # use APP_PORT from .env
```

`install.sh` ending with `Done. Status: healthy` means the image is loaded and the app answers
`/healthz`. That check does not touch the database, so always finish with `check-endpoints.sh`:
the deployment is ready when it prints `RESULT: all checks passed`.

`install.sh` is idempotent: re-running it to apply new configuration or redeploy is safe.

Without `IMAGE_TAR`, `install.sh` picks the tar for the `APP_IMAGE` version **and this server's
CPU** by itself, refuses a tar built for the other CPU, and replaces an image of the wrong CPU that
was loaded earlier. On ARM64 servers use the `linux-arm64` file name.

> [!IMPORTANT]
> When you run it with `sudo`, write `IMAGE_TAR=...` **after** `sudo`:
> `sudo IMAGE_TAR=maxco-chat-cs_1.0.0_linux-arm64.tar ./install.sh`.
> A variable written before `sudo` (`IMAGE_TAR=... sudo ./install.sh`) is dropped by `sudo`;
> `install.sh` then prints `IMAGE_TAR not set` and chooses by CPU as above.

---

## 4. Manual install (without install.sh)

```bash
# a. Load the image
docker load -i maxco-chat-cs_1.0.0_linux-amd64.tar
docker image inspect maxco-chat-cs:1.0.0 --format 'arch={{.Architecture}} version={{index .Config.Labels "org.opencontainers.image.version"}}'

# b. Configuration
cp .env.example .env && nano .env

# c. Prepare the database (see §5), then:
docker compose up -d
docker compose ps
curl -s http://127.0.0.1:3000/healthz          # {"ok":true}
docker compose logs -f app                      # Listening on 3000
```

---

## 5. Database

**Scenario A — the client already has MySQL** (most common):

```bash
for f in sql/*.sql; do echo "== $f"; mysql -h <MYSQLHOST> -u <MYSQLUSER> -p < "$f"; done
# the order comes from the file names: 01_schema, 02_migrations, 03..11_dbchanges
```

**Scenario B — MySQL runs from this compose file**: use `install.sh --with-db` or
`docker compose -f docker-compose.yml -f docker-compose.with-db.yml up -d`; the `sql/` folder
is executed in order when the database volume is created for the first time.

Important notes:

- `01_schema.sql` contains `CREATE DATABASE` + `USE`, and the database name inside it (`maxco_chat_im`)
  **must match** `MYSQLDATABASE` in `.env`. If the client uses a different name, change it in both places.
- Except `11_dbchanges_202611161515.sql`, no file is **idempotent** — run them once against an empty database, in file-name order.
  For an **existing** database, request the incremental migration files (in the source repo: the
  `sql/dbchanges_*.sql` folder). The latest one, `sql/dbchanges_202610191417.sql`, is required for
  databases that already run the app: it removes the duplicate inside sales chats (category 3) that
  older builds could create in parallel, and adds the unique index that prevents them.
  `sql/dbchanges_202610221020.sql` adds the indexes the client app pagination needs
  (`list_chats.user_id` and `list_messages(chat_id, created_at, id)`); without them every page of
  the list and of the message history scans the whole table. It is optional but recommended.
  `sql/dbchanges_202611181400.sql` adds the automated message type and the auto-close settings that
  the Customer Support ticket flow needs; run it once. Auto-close stays off until
  `auto_close_minutes` in `list_chat_config` is set above `0`.
- `11_dbchanges_202611161515.sql` (source repo: `sql/dbchanges_202611161515.sql`) **repairs** a
  database where `07_dbchanges_202610191417.sql` stopped at line 53 with `ERROR 1215 ... Cannot add
  foreign key constraint` (MySQL 8) or `ERROR 1901 ... cannot be used in the GENERATED ALWAYS AS clause`
  (newer MariaDB). Such a database has no unique index, so duplicate inside sales chats can be created
  again. The file merges those duplicates (per user the newest **active** chat is kept — the newest
  chat when none is active — and the messages of the others move to it), changes the category
  foreign key to `ON UPDATE RESTRICT`, and adds the missing column and unique index — each step only
  when needed, so it is safe on any database and safe to run more than once. Back up first:
  ```bash
  # Scenario A - your own MySQL
  mysqldump -h <MYSQLHOST> -u <MYSQLUSER> -p maxco_chat_im > backup.sql
  mysql -h <MYSQLHOST> -u <MYSQLUSER> -p < sql/11_dbchanges_202611161515.sql

  # Scenario B - MySQL from docker-compose.with-db.yml (root password = MYSQLPASSWORD in .env)
  DB="docker compose -f docker-compose.yml -f docker-compose.with-db.yml exec -T db"
  $DB mysqldump -uroot -p"<MYSQLPASSWORD>" maxco_chat_im > backup.sql
  $DB mysql -uroot -p"<MYSQLPASSWORD>" < sql/11_dbchanges_202611161515.sql
  # an older --with-db install stopped at 07 during its first setup, so 08, 09 and 10 never ran:
  $DB mysql -uroot -p"<MYSQLPASSWORD>" -e "SHOW TABLES FROM maxco_chat_im LIKE 'list_chat_config'"
  # no output -> run them too, in order:
  $DB mysql -uroot -p"<MYSQLPASSWORD>" < sql/08_dbchanges_202610221020.sql
  $DB mysql -uroot -p"<MYSQLPASSWORD>" < sql/09_dbchanges_202610231200.sql
  $DB mysql -uroot -p"<MYSQLPASSWORD>" < sql/10_dbchanges_202611181400.sql
  ```
  The last lines file 11 prints should read `1  1  RESTRICT  0`.
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

**Smoke test (run this first).** `check-endpoints.sh` calls the main endpoints of a running
deployment and tells apart the problems that look alike from the client app. It is read-only:
it creates nothing.

```bash
./check-endpoints.sh                                   # http://localhost:3000
./check-endpoints.sh http://127.0.0.1:<APP_PORT>       # other port
./check-endpoints.sh https://chat.example.com          # through the reverse proxy / domain

# when CHAT_API_KEY is set on the server, pass the same key;
# USER_ID / CHAT_ID (optional) check a real member's chat list and a real chat's messages
CHAT_API_KEY=<key> USER_ID=<member id> CHAT_ID=<chat id> ./check-endpoints.sh <url>
```

| Output | Meaning / action |
|---|---|
| `RESULT: all checks passed.` | Deployment works (app, routes, database, API key) |
| `RESULT: all checks passed, with a warning.` + `OPEN API` | Works, but REST answers without an API key → set `CHAT_API_KEY` in `.env` (§6) and share it with the app/CRM teams |
| `RESULT: N check(s) failed.` | One or more of the hints below is printed |
| `UNREACHABLE` | No answer → check the URL/port, DNS, TLS certificate, and that the container is running (`docker compose ps`) |
| `API KEY` | The server has `CHAT_API_KEY` set → run again with `CHAT_API_KEY=<key>` (the value from `.env`) |
| `OLD BUILD` | Routes return Express `Cannot GET/POST ...` 404 → an older image is running; check `APP_IMAGE` in `.env` and `docker inspect maxco_chat_cs --format '{{.Config.Image}}'` (§10) |
| `DATABASE` | Endpoints that query MySQL answer 500 → `docker compose logs app` (`ECONNREFUSED` / `ER_ACCESS_DENIED` / `ER_NO_SUCH_TABLE`); fix `MYSQL*` in `.env` or run the missing `sql/` files (§5) |

Exit code: `0` = all checks passed, `1` = at least one FAIL, `2` = usage error, so it can also run
from a script or monitoring.

**Manual checks** (upload storage and realtime are not covered by the smoke test):

```bash
curl -s http://127.0.0.1:3000/healthz
# {"ok":true}

# create a test chat (must return 201 with a chat_ticket)
curl -s -X POST http://127.0.0.1:3000/api/chats/crm/create_service_chat \
  -H 'Content-Type: application/json' -d '{"user_id":"smoke-test","user_name":"Smoke Test"}'

# upload a file (must succeed and store the file in the chat_uploads volume)
B64=$(printf 'hello' | base64)
curl -s -X POST http://127.0.0.1:3000/api/chats/crm/chat/upload \
  -H 'Content-Type: application/json' -d "{\"fileName\":\"test.png\",\"fileDataBase64\":\"$B64\"}"
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
    client_max_body_size 72m;                        # 50 MB files sent as base64 (about 67 MB)
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
# then set APP_IMAGE=<client-registry>/maxco-chat-cs:1.0.0 in .env
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
- **Upgrade**: `docker load -i maxco-chat-cs_1.0.1_linux-amd64.tar`, update `APP_IMAGE` in `.env`,
  then `docker compose up -d`. A few seconds of downtime; `restart: unless-stopped` brings the container back up.
- **Rollback**: set `APP_IMAGE` back to the previous tag (the old image stays on the server) then `docker compose up -d`.
- **Logs**: stdout only (json-file driver, rotation 10 MB × 3 files). `docker compose logs -f app`.

---

## 11. Troubleshooting

| Symptom | Cause & action |
|---|---|
| `exec format error` during `docker compose up` | Image architecture does not match the server → use the matching amd64/arm64 tar |
| `The requested image's platform (linux/amd64) does not match the detected host platform (linux/arm64/v8)` (or the reverse) | The other CPU's image was loaded, e.g. by an older `install.sh` run as `IMAGE_TAR=... sudo ./install.sh` (sudo drops the variable). Current `install.sh` replaces it by itself: `sudo ./install.sh`. With an older `install.sh`: `sudo docker compose down`, `sudo docker rmi maxco-chat-cs:1.0.0`, then `sudo IMAGE_TAR=maxco-chat-cs_1.0.0_linux-arm64.tar ./install.sh` |
| Container restarts repeatedly, MySQL `ECONNREFUSED` / `ETIMEDOUT` in logs | Wrong `MYSQLHOST` (from inside a container, `localhost` means the container itself) or MySQL refuses connections from the container IP → use `host.docker.internal` with `extra_hosts: host-gateway` |
| `ER_NO_SUCH_TABLE list_chats` | `01_schema.sql` was not run, or `MYSQLDATABASE` differs from the database name used by the schema |
| `ER_BAD_FIELD_ERROR sender_name/user_name/admin_name` | `02_migrations.sql` was not run |
| `ER_BAD_FIELD_ERROR user_referrer_id/user_referrer_name` | `04_dbchanges_*` / `06_dbchanges_*` not run on an existing database → run `sql/dbchanges_202610121639.sql` then `sql/dbchanges_202610190950.sql` |
| `ER_NO_DB/ER_FK_ON_CATEGORY` or `POST /api/chats/user` fails with a foreign key error on `list_chats.category_id` | category 3 seed missing → run `sql/dbchanges_202610161456.sql` |
| A user shows two inside sales chats (category 3) | The unique index `uq_list_chats_sales_chat` is missing → run `sql/11_dbchanges_202611161515.sql` (§5; it removes the duplicates and adds the index, safe to re-run) |
| `ERROR 1215 (HY000) at line 53: Cannot add foreign key constraint` or `ERROR 1901 ... cannot be used in the GENERATED ALWAYS AS clause` while running `07_dbchanges_202610191417.sql` | The category foreign key still uses `ON UPDATE CASCADE`, which MySQL 8 / newer MariaDB refuse for that column → run `sql/11_dbchanges_202611161515.sql` (§5), then any later file that has not run yet (§5 shows how to check 08/09/10) |
| `install.sh --with-db` on a first install stops with `container maxco_chat_cs_db is unhealthy` | Check `docker compose -f docker-compose.yml -f docker-compose.with-db.yml logs db`. **No `ERROR` line**: MySQL was only slow to finish its first setup (slow disk/CPU) — wait a minute and run `./install.sh --with-db` again. **An `ERROR` line from an `.sql` file** (the line stays in the log for the container's whole life, so it can be old): first count the chats — `docker compose -f docker-compose.yml -f docker-compose.with-db.yml exec -T db mysql -uroot -p"<MYSQLPASSWORD>" -N -e "SELECT COUNT(*) FROM maxco_chat_im.list_chats"`. **Only if it prints `0`** (nothing to lose): `docker compose -f docker-compose.yml -f docker-compose.with-db.yml down -v` (deletes the database volume), then `./install.sh --with-db` again with the fixed `sql/` files. **Any other result: never run `down -v`** — follow the `ERROR 1215` row above (run file 11 per §5) |
| Upload returns `{"success":false,"message":"File upload failed"}` with `EACCES` in the logs | `/app/uploads` is mounted with the wrong ownership (e.g. a host folder bind mount) → use the `chat_uploads` named volume, or `chown -R 1000:1000` the host folder |
| Upload fails behind nginx (413) | `client_max_body_size` is too low (a 50 MB file reaches about 72 MB as base64) |
| Chat is not realtime | The reverse proxy is not forwarding the `Upgrade`/`Connection` headers, or `proxy_read_timeout` is too short |
| Message timestamps are off | Container `TZ` differs from the MySQL timezone; align both |
| Check the running image version | `docker inspect maxco_chat_cs --format '{{.Config.Image}}'` and the `org.opencontainers.image.version` label |

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
3. **`.env` on this server**: `FCM_PUSH_ENABLED=true` plus one credential option (§6).
   Recommended:
   ```bash
   base64 -i service-account.json | tr -d '\n'   # paste the output into .env
   FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=...
   ```
4. **Database**: the `list_user_devices` table (§5). It is created by `02_migrations.sql`;
   for an existing database run `sql/dbchanges_202610051115.sql` from the source repo.
5. **Restart** after changing `.env`: `docker compose up -d`.

Push is sent only for messages with `sender_type = admin` (CRM). The client's own replies are
never pushed. Invalid/expired tokens are removed automatically.

### Verify

```bash
# 1. From the mobile app log, copy the FCM token, then register it:
curl -s -X POST http://127.0.0.1:3000/api/chats/devices \
  -H 'Content-Type: application/json' \
  -d '{"userId":"<member id>","token":"<fcm token>","platform":"android"}'

# 2. Send a message from the CRM and follow the log:
docker compose logs -f app | grep FCM
```

Expected: `FCM: chat <id> -> 1/1 delivered`, and the notification on the device.

### Troubleshooting

| Symptom | Cause & action |
|---|---|
| `FCM: not configured ... push skipped` | No credential in `.env`, or the variable name is misspelled |
| `FCM: firebase-admin init failed` | The service account JSON is truncated/corrupt, or it belongs to another project than the mobile app |
| `FCM: chat <id> -> 0/1 delivered` with `UNREGISTERED` | Token no longer valid (app reinstalled) — it is removed automatically; the next app login registers the new token |
| No notification on the device | Notification permission denied in the app, or `FCM_PUSH_ENABLED` / `PUSH_NOTIFICATION_ENABLED` not set to `true` |
