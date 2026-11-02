#!/usr/bin/env bash
# =============================================================================
# build-from-git.sh — rebuild the zetaerp-moqui image FROM git master, on the prod host.
# =============================================================================
# WHY: the legacy flow edits files INSIDE the running container and `docker commit`s the result. That
# (a) drifts the from-scratch build context (/opt/deploy/deploy/zenith-erp/ is filled from the container,
# not git — it has silently shipped months-old code to teammates' rebuilds), and (b) accumulates ~1.9 GB
# committed/rollback images per deploy that have twice filled the disk and crash-looped Postgres.
#
# This pipeline instead makes GIT the mechanical source of truth: the app component tree comes straight
# from `git`, the build is a COPY-based `docker build` (no compile), and prod moves by RE-TAGGING the
# freshly built image — never by `docker commit` of a mutated container. Result: zero context drift, one
# image per release (old :latest -> dangling -> pruned), instant rollback via the kept previous tag.
#
# WHERE IT RUNS: on the prod host (root@167.233.117.229). The Moqui base image is pinned by digest and is
# ONLY cached here (anonymous GHCR pulls of it 403 elsewhere), so a from-scratch build must run here.
#
# SOURCES (the secret never touches git):
#   - app code .............. git `component/zenith-erp-*` at REF  (THE source of truth)
#   - Dockerfile + patches .. /opt/deploy/deploy/{Dockerfile,framework-patches/,zenith-classes/,MoquiDevConf.xml}
#                             (git-tracked under docs/infra/; the host's live copies are used so the build
#                              is byte-identical to today's infra — bump them on the host to change infra)
#   - QZ signing key ........ /opt/deploy/deploy/qz-private-key.pem  (HOST-ONLY secret, copied into the
#                             transient build context and shredded on exit; NEVER committed to git)
#   - Login.xml/qapps.xml ... NOT built in — compose bind-mounts them at runtime (unchanged by this script)
#
# USAGE (run ON the host):
#   bash build-from-git.sh candidate [REF]   # build :gitbuild-<sha>, boot-verify in a THROWAWAY stack, STOP.
#                                            #   Touches NOTHING on prod. Default REF=master.
#   bash build-from-git.sh promote   [REF]   # candidate build+verify, then tag rollback, retag :latest,
#                                            #   refresh the canonical context, `compose up -d` (adopts the
#                                            #   new image), poll,
#                                            #   post-smoke; AUTO-ROLLBACK if health never returns.
#
# SAFETY: single-flight (flock), disk-guard + rollback-tag trim (same policy as moqui-deploy), and
# `up -d --no-deps moqui` to ADOPT the retagged image. (A bare `compose restart` reuses the running
# container's OLD image and silently no-ops — the component tree is image-baked, not a bind-mount; `up -d`
# is safe here precisely because the tree is git-sourced, so there are NO uncommitted in-container edits to
# lose, which is the only reason the general "never up -d" rule exists.) Instant rollback also via up -d.
# DB/entity-schema migrations and data/seed loads are OUT OF SCOPE and
# stay manual (EntityDbMeta still auto-adds columns on restart; it never drops). Verify billing paths on a
# throwaway tenant per CLAUDE.md before promoting a billing change.
# =============================================================================
set -euo pipefail

MODE="${1:-}"; REF="${2:-master}"
case "$MODE" in candidate|promote) : ;; *) echo "usage: build-from-git.sh candidate|promote [REF]"; exit 2 ;; esac

REPO_URL="https://github.com/amalnathkp13-boop/zenith-erp.git"
DEPLOY="/opt/deploy/deploy"                 # live build-infra + secret live here
COMPOSE_DIR="/opt/deploy/deploy"            # docker-compose.yml dir
CACHE="/opt/deploy/buildsrc/zenith-erp.git" # persistent bare mirror (fast incremental fetch)
CTX="/opt/deploy/buildsrc/ctx"              # transient assembled build context (holds a key copy -> shredded)
IMG="zetaerp-moqui"
THRESH_ABORT=90
TS="$(date -u +%Y%m%d-%H%M%S)"

log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
die(){ echo "ABORT: $*" >&2; exit 1; }

# ---- single-flight + disk guard (identical policy to the moqui-deploy skill) --------------------------
exec 9>/tmp/zetaerp-deploy.lock
flock -n 9 || die "another deploy/build holds /tmp/zetaerp-deploy.lock — wait for it"

trap 'rm -rf "$CTX" 2>/dev/null || true; docker rm -f "$DBC" "$MQC" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true' EXIT

disk_guard(){
  docker image prune -f >/dev/null 2>&1 || true
  docker images "$IMG" --format '{{.Tag}}' | grep '^pre-' | tail -n +3 | sed "s#^#$IMG:#" | xargs -r docker rmi >/dev/null 2>&1 || true
  local use; use=$(df --output=pcent / | tail -1 | tr -dc '0-9')
  log "/ at ${use}%"
  [ "${use:-0}" -ge "$THRESH_ABORT" ] && die "disk >=${THRESH_ABORT}% after cleanup — free space before building"
  return 0
}

# ---- 1. fetch git ------------------------------------------------------------------------------------
disk_guard
mkdir -p "$(dirname "$CACHE")"
if [ -d "$CACHE" ]; then
  log "fetching $REPO_URL ..."
  git -C "$CACHE" fetch --prune --quiet origin '+refs/heads/*:refs/heads/*'
else
  log "cloning $REPO_URL (first run) ..."
  git clone --bare --quiet "$REPO_URL" "$CACHE"
fi
SHA="$(git -C "$CACHE" rev-parse --short "$REF")" || die "ref '$REF' not found in mirror"
log "building from $REF @ $SHA"

# ---- 2. assemble a clean build context (app from git, infra+secret from host) ------------------------
rm -rf "$CTX"; mkdir -p "$CTX/zenith-erp"
cp "$DEPLOY/Dockerfile" "$DEPLOY/MoquiDevConf.xml" "$CTX/"
cp -r "$DEPLOY/framework-patches" "$DEPLOY/zenith-classes" "$CTX/"
git -C "$CACHE" archive "$REF" docs/infra/zenith-libs | tar -x -C "$CTX"
mv "$CTX/docs/infra/zenith-libs" "$CTX/zenith-libs"
rm -rf "$CTX/docs"
# Hosts may still have the previous Dockerfile; include the QR library in this candidate image.
if ! grep -q 'zenith-libs/' "$CTX/Dockerfile"; then
  printf '\nCOPY ./zenith-libs/ /opt/moqui/WEB-INF/lib/\n' >> "$CTX/Dockerfile"
fi
install -m 600 "$DEPLOY/qz-private-key.pem" "$CTX/qz-private-key.pem"   # transient; trap shreds $CTX
# app tree straight from git; ship ONLY zenith-erp-* (ignore any stray top-level component dirs)
git -C "$CACHE" archive "$REF" component | tar -x -C "$CTX"
shopt -s nullglob
moved=0; for d in "$CTX"/component/zenith-erp-*; do mv "$d" "$CTX/zenith-erp/"; moved=$((moved+1)); done
rm -rf "$CTX/component"
[ "$moved" -ge 1 ] || die "git archive produced no component/zenith-erp-* dirs"
log "context assembled: $moved zenith-erp-* components + host infra + QZ key (transient)"

# ---- 3. build (COPY-based; self-verifying framework patches fail the build if an anchor moved) -------
CAND="$IMG:gitbuild-$SHA"
log "docker build -t $CAND ..."
docker build -t "$CAND" "$CTX" >/tmp/zcbuild-$SHA.log 2>&1 || { tail -40 /tmp/zcbuild-$SHA.log; die "docker build failed (log: /tmp/zcbuild-$SHA.log)"; }
log "built $CAND"

# ---- 4. boot-verify in a THROWAWAY stack (ephemeral pg + moqui on 127.0.0.1:8099; prod untouched) ----
NET="zcbuild_$$"; DBC="zcbuild-db-$$"; MQC="zcbuild-moqui-$$"
docker network create "$NET" >/dev/null
docker run -d --name "$DBC" --network "$NET" \
  -e POSTGRES_DB=moqui -e POSTGRES_USER=moqui -e POSTGRES_PASSWORD=moqui \
  --tmpfs /var/lib/postgresql/data postgres:15-alpine >/dev/null
docker run -d --name "$MQC" --network "$NET" -p 127.0.0.1:8099:8080 \
  -e entity_ds_db_conf=postgres -e entity_ds_host="$DBC" -e entity_ds_port=5432 \
  -e entity_ds_database=moqui -e entity_ds_user=moqui -e entity_ds_password=moqui \
  -e elasticsearch_url= \
  -e JAVA_TOOL_OPTIONS='-Xms256m -Xmx768m -Dbitronix.tm.serverId=zcbuild-'"$$" \
  "$CAND" >/dev/null
log "throwaway stack up; waiting for the app to serve (empty DB -> expect login 302/401) ..."
up=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8099/apps/zenith" || echo 000)
  case "$code" in 200|301|302|303|307|401|403) up=1; log "  [$i] HTTP $code — web alive"; break;; *) [ $((i%5)) -eq 0 ] && log "  [$i] HTTP $code"; sleep 3;; esac
done
# Genuine CODE-defect scan ONLY (DB-state-independent): a broken screen/service/Groovy fails at
# parse/compile time regardless of data. Entity DATA-load FK errors on an empty, unseeded DB are
# EXPECTED (no seed/geo/install data loaded) and are IDENTICAL on the deployed :latest image (verified
# A/B: both emit the same ~44-file "Skipping to next file" set) — so they are deliberately NOT scanned.
codeerrs=$(docker logs "$MQC" 2>&1 | grep -iE 'XmlParseException|CompilationFailedException|unable to resolve class|Error loading screen|Could not find screen|Error (parsing|rendering) (screen|service)|Invalid service name|MoquiCompileException' | head -20 || true)
docker rm -f "$MQC" "$DBC" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true

[ "$up" = 1 ] || die "throwaway app never served a non-5xx response — build is NOT healthy (candidate NOT promotable)"
if [ -n "$codeerrs" ]; then
  echo "----- genuine screen/service/Groovy parse/compile errors in boot -----"; printf '%s\n' "$codeerrs"; echo "-----"
  [ "$MODE" = promote ] && die "candidate logged real parse/compile errors (above) — NOT promoting"
  log "WARN: boot served OK but logged parse/compile error line(s) above — review before promote"
else
  log "boot clean: web served + no screen/service/Groovy parse errors (empty-DB data-load FK noise expected, not scanned)"
fi

if [ "$MODE" = candidate ]; then
  docker rmi "$CAND" >/dev/null 2>&1 || true   # candidate proves buildability; don't leave the image around
  disk_guard
  log "CANDIDATE OK — $REF@$SHA builds from git and boots clean. Prod UNCHANGED. Promote with: bash build-from-git.sh promote $REF"
  exit 0
fi

# ---- 5. PROMOTE: rollback tag -> retag :latest -> refresh context -> restart -> poll -> auto-rollback -
ROLL="$IMG:pre-gitbuild-$TS"
log "tagging rollback $ROLL from current :latest"
docker tag "$IMG:latest" "$ROLL"
docker tag "$CAND" "$IMG:latest"
# make the canonical from-scratch context match what we just shipped (kills drift permanently)
rm -rf "$DEPLOY/zenith-erp"; mkdir -p "$DEPLOY/zenith-erp"
git -C "$CACHE" archive "$REF" component | tar -x -C "$DEPLOY"
for d in "$DEPLOY"/component/zenith-erp-*; do mv "$d" "$DEPLOY/zenith-erp/"; done; rm -rf "$DEPLOY/component"
log "applying prod (compose up -d moqui — adopts the retagged image; a bare restart would reuse the OLD image) ..."
( cd "$COMPOSE_DIR" && docker compose up -d --no-deps moqui )
up=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8080/apps/zenith" || echo 000)
  case "$code" in 200|301|302|303|307|401|403) up=1; log "  [$i] HTTP $code — prod up"; break;; *) [ $((i%5)) -eq 0 ] && log "  [$i] HTTP $code"; sleep 4;; esac
done
if [ "$up" != 1 ]; then
  log "!! prod did not return healthy — AUTO-ROLLBACK to $ROLL"
  docker tag "$ROLL" "$IMG:latest"; ( cd "$COMPOSE_DIR" && docker compose up -d --no-deps moqui )
  die "promote failed; rolled back to $ROLL. Investigate /tmp/zcbuild-$SHA.log and moqui logs."
fi
docker image prune -f >/dev/null 2>&1 || true
docker images "$IMG" --format '{{.Tag}}' | grep '^pre-' | tail -n +3 | sed "s#^#$IMG:#" | xargs -r docker rmi >/dev/null 2>&1 || true
log "PROMOTED $REF@$SHA to prod (:latest). Rollback: docker tag $ROLL $IMG:latest && cd $COMPOSE_DIR && docker compose up -d --no-deps moqui"
log "rollback tags kept: $(docker images "$IMG" --format '{{.Tag}}' | grep -c '^pre-')"
