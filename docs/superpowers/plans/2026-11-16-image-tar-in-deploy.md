# Image tar in deploy/ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `release/build_release.sh` saves the amd64 + arm64 image tars (+ `.sha256`) straight into `deploy/`, as DEPLOYMENT.md §1 shows, then build 1.0.0.

**Architecture:** One bash script edit (output dir, version discovery, archive old tars, safe `.env` handling, drop handover/zip step) plus one `.gitignore` rule. Then a real build on Docker Desktop (Windows, Git Bash).

**Tech Stack:** bash (Git Bash on Windows), Docker Desktop + buildx, `sha256sum`.

**Spec:** `docs/superpowers/specs/2026-11-16-image-tar-in-deploy-design.md`

## Global Constraints

- Output: `deploy/maxco-chat-cs_<VERSION>_linux-amd64.tar`, `deploy/maxco-chat-cs_<VERSION>_linux-arm64.tar`, each with `<tar>.sha256` beside it.
- Image tag `maxco-chat-cs:<VERSION>`, built with `--build-arg APP_VERSION=<VERSION>`.
- First build VERSION = `1.0.0`.
- `deploy/.env` is never deleted, modified or written by the script.
- No zips, no handover folders. Git untouched by the script.
- DEPLOYMENT.md not changed.

## Review Focus

1. Real `deploy/.env` present before build → still present, byte-identical after (old preflight deleted it).
2. No `deploy/.env` present → preflight still validates compose and leaves no dummy `.env` behind.
3. Tars of another version already in `deploy/` → moved to `release/`, not deleted, not overwritten.
4. No VERSION arg, only arm64 tar of 1.0.0 in `deploy/` → next version 1.0.1 (old code looked only at amd64 → fell back to 1.0.0).
5. Docker Desktop with containerd image store → saved tar holds exactly one platform matching its file name.

---

### Task 1: Script writes tars into deploy/

**Files:**
- Modify: `release/build_release.sh` (header comment, step 0 version discovery, preflight `.env` block lines ~78-87, step 1 save/sha256 lines ~92-105, remove step 2 handover/zip lines ~107-138, summary text)
- Modify: `.gitignore` (after `!release/build_release.sh`)

**Interfaces:**
- Produces: `release/build_release.sh [VERSION]` → files listed in Global Constraints; exit non-zero on any failure.

- [ ] **Step 1: Baseline checks that fail today**

```bash
sha256sum deploy/.env > "$SCRATCH/env.before"
grep -n 'rm -f deploy/.env' release/build_release.sh      # expect: match (bug present)
grep -n 'deploy/maxco-chat-cs_' .gitignore               # expect: no match
```

- [ ] **Step 2: Edit the script**
  - Version discovery: `ls deploy/maxco-chat-cs_*_linux-*.tar release/maxco-chat-cs_*_linux-*.tar`, extract version, `sort -Vu | tail -1`, bump patch. Guard: refuse when `deploy/maxco-chat-cs_${VERSION}_linux-*.tar` already exists unless `FORCE=1`.
  - Preflight: `CREATED_ENV=0; [ -f deploy/.env ] || { touch deploy/.env; CREATED_ENV=1; }`; remove only when `CREATED_ENV=1` (also on error paths).
  - Before build: `mkdir -p release`; move every `deploy/maxco-chat-cs_*_linux-*.tar*` whose version ≠ VERSION into `release/`.
  - Save: `docker save --platform "linux/$ARCH"` when `docker save --help` lists `--platform`, else plain `docker save`; `-o deploy/maxco-chat-cs_${VERSION}_linux-${ARCH}.tar`; checksum `(cd deploy && sha256sum <tar> > <tar>.sha256)` (fallback `shasum -a 256`).
  - Delete handover folder/zip section; summary lists `deploy/` files + manual SQL list + client steps from DEPLOYMENT.md §3.
  - Build log path: `${TMPDIR:-/tmp}/buildx_$ARCH.log`.

- [ ] **Step 3: `.gitignore`**

```
deploy/maxco-chat-cs_*.tar
deploy/maxco-chat-cs_*.tar.sha256
```

- [ ] **Step 4: Static checks pass**

Run: `bash -n release/build_release.sh && ! grep -n 'zip' release/build_release.sh && git check-ignore deploy/maxco-chat-cs_1.0.0_linux-amd64.tar`
Expected: no syntax error, no zip references, path printed as ignored.

### Task 2: Build 1.0.0 and verify

**Files:** none edited; produces the four `deploy/` artifacts.

**Interfaces:**
- Consumes: `release/build_release.sh [VERSION]` from Task 1.

- [ ] **Step 1: Docker ready**

Run: `docker info --format '{{.ServerVersion}}' && docker buildx ls`
Expected: server version printed, `desktop-linux` builder running with `linux/amd64, linux/arm64` platforms.

- [ ] **Step 2: Build**

Run: `bash release/build_release.sh 1.0.0`
Expected: `RELEASE BUILT`, exit 0.

- [ ] **Step 3: Verify artifacts**

```bash
cd deploy && sha256sum -c maxco-chat-cs_1.0.0_linux-amd64.tar.sha256 maxco-chat-cs_1.0.0_linux-arm64.tar.sha256   # both OK
tar -xOf maxco-chat-cs_1.0.0_linux-amd64.tar manifest.json | grep -c '"maxco-chat-cs:1.0.0"'   # 1
tar -xOf maxco-chat-cs_1.0.0_linux-arm64.tar manifest.json | grep -c '"maxco-chat-cs:1.0.0"'   # 1
sha256sum -c "$SCRATCH/env.before"                                                              # deploy/.env: OK
git status --short deploy/                                                                     # no tar listed
```

- [ ] **Step 4: Arch check**: `docker load -i` each tar, `docker image inspect maxco-chat-cs:1.0.0 --format '{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.version"}}'` → `amd64 1.0.0` / `arm64 1.0.0`; `docker rmi` between loads.

- [ ] **Step 5: Commit** — only when the user asks (script + `.gitignore` + spec + plan; tars are ignored).
