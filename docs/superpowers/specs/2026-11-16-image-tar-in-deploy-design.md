# Image tar generated into deploy/ — design (short)

## Intent
The client package is the repo's `deploy/` folder itself, exactly as `deploy/DEPLOYMENT.md` §1 shows:
the image tars sit next to `install.sh`, not in a `release/` sub-folder and not in a separate handover folder.
`release/build_release.sh` must produce the image there.

## Goals
- `release/build_release.sh [VERSION]` builds linux/amd64 + linux/arm64 images tagged `maxco-chat-cs:<VERSION>`
  (label `org.opencontainers.image.version=<VERSION>`) and saves
  `deploy/maxco-chat-cs_<VERSION>_linux-{amd64,arm64}.tar` + `.sha256` beside them.
- First build: `1.0.0` (matches the version already written in `deploy/.env.example`, compose defaults,
  `install.sh`, DEPLOYMENT.md — no version edits needed).

## Non-goals
- No handover folders or zips (dropped from the script).
- No DEPLOYMENT.md changes (stale `sql/` list and missing `check-endpoints.sh` entry = separate fix).
- No git commit/push by the script.

## Anti-goals
- The build must never delete or ship `deploy/.env` (real credentials).
- Image tars must never be committed to git.

## Approaches
1. **Write tars straight into `deploy/` (chosen)** — matches the guide; the folder is the package.
2. Handover folder/zip per arch in `release/` (previous script) — rejected by the user: the tar must be in `deploy/`.
3. `deploy/` + `release/` sub-folder layout (HEAD commit) — rejected by the user.

## Decisions
- Preflight compose validation only creates/removes a dummy `deploy/.env` when none exists (bug: it deleted the real one).
- Version auto-detect reads `deploy/` tars of either arch (was: `release/` amd64 only).
- Before saving a new version, tars/checksums of other versions in `deploy/` move to `release/` (archive, gitignored), never deleted.
- `.gitignore`: `deploy/maxco-chat-cs_*.tar` and `deploy/maxco-chat-cs_*.tar.sha256`.
- Verification: tar `manifest.json` RepoTags = `maxco-chat-cs:<VERSION>`, image arch matches file name, `sha256sum -c` passes, `deploy/.env` still present.

## Left to the builder
- Exact checksum tool (`sha256sum` preferred, `shasum -a 256` fallback).
- Use `docker save --platform` when the Docker version supports it.
