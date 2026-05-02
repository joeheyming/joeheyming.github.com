#!/usr/bin/env bash
# Rebuild doom/src/doom.{js,wasm} from upstream wasm-doom using the exact
# Emscripten version (1.39.20) that Farrelke used for the original shipped
# bundle. Newer emcc versions have a miscompilation regression — see the
# doom/build/README.md section titled "Why emcc 1.39.20 specifically".
#
# Prerequisites:
#   - Docker (for the pinned emsdk container)
#   - wasm-doom source at $WASM_DOOM_SRC (default: ~/git/wasm-doom)
#
# Usage:
#   npm run build:doom
#   # or
#   WASM_DOOM_SRC=~/git/wasm-doom bash doom/build/build.sh
#
# See doom/build/README.md for the full story.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="${REPO_ROOT}/doom/build"
WORK_DIR="${BUILD_DIR}/work"
OUT_DIR="${REPO_ROOT}/doom/src"
PATCH_DIR="${BUILD_DIR}/patches"

: "${WASM_DOOM_SRC:=${HOME}/git/wasm-doom}"
: "${EMSDK_DOCKER_IMAGE:=emscripten/emsdk:1.39.20}"

log()  { printf '\033[1;34m[build:doom]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[build:doom]\033[0m %s\n' "$*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# 1. Toolchain check
# -----------------------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  fail "docker not on PATH - install Docker Desktop and re-run"
fi
if ! docker info >/dev/null 2>&1; then
  fail "docker daemon not running - start Docker Desktop and re-run"
fi

log "using emsdk container: ${EMSDK_DOCKER_IMAGE}"

# -----------------------------------------------------------------------------
# 2. Upstream source check
# -----------------------------------------------------------------------------

if [[ ! -d "${WASM_DOOM_SRC}" ]]; then
  cat >&2 <<EOF
[build:doom] wasm-doom source not found at: ${WASM_DOOM_SRC}

Clone it once:
  git clone https://github.com/lazarv/wasm-doom.git ${WASM_DOOM_SRC}

Or override: WASM_DOOM_SRC=/path/to/wasm-doom npm run build:doom
EOF
  exit 3
fi

log "wasm-doom src: ${WASM_DOOM_SRC}"

# -----------------------------------------------------------------------------
# 3. Clean worktree copy
# -----------------------------------------------------------------------------

log "resetting build worktree at ${WORK_DIR}"
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='build' \
    "${WASM_DOOM_SRC}/" "${WORK_DIR}/"
else
  cp -R "${WASM_DOOM_SRC}/." "${WORK_DIR}/"
fi

# -----------------------------------------------------------------------------
# 4. Apply patches
# -----------------------------------------------------------------------------

shopt -s nullglob
PATCHES=("${PATCH_DIR}"/*.patch)
shopt -u nullglob

if (( ${#PATCHES[@]} == 0 )); then
  log "no patches to apply (doom/build/patches/ is empty)"
else
  for patch in "${PATCHES[@]}"; do
    log "applying patch: $(basename "${patch}")"
    (cd "${WORK_DIR}" && patch -p1 < "${patch}")
  done
fi

# -----------------------------------------------------------------------------
# 5. Build
# -----------------------------------------------------------------------------

log "configuring + building inside ${EMSDK_DOCKER_IMAGE}"

# Pull once per run is fast if the layer is cached; the first run downloads.
docker pull --quiet "${EMSDK_DOCKER_IMAGE}" >/dev/null

# --platform linux/amd64: emsdk only ships x86_64 images; on Apple Silicon
# this transparently runs under Rosetta.
docker run --rm \
  --platform linux/amd64 \
  -v "${WORK_DIR}:/src" \
  -w /src \
  "${EMSDK_DOCKER_IMAGE}" \
  bash -c '
    set -e
    rm -rf build
    emcmake cmake -S . -B build -DCMAKE_BUILD_TYPE=Release > /tmp/cmake.log 2>&1 \
      || { cat /tmp/cmake.log; exit 1; }
    emmake cmake --build build -- -j"$(nproc)"
  '

# -----------------------------------------------------------------------------
# 6. Publish outputs
# -----------------------------------------------------------------------------

DOOM_JS="${WORK_DIR}/doom.js"
DOOM_WASM="${WORK_DIR}/doom.wasm"

[[ -f "${DOOM_JS}"   ]] || fail "no doom.js under ${WORK_DIR} - build produced nothing"
[[ -f "${DOOM_WASM}" ]] || fail "no doom.wasm under ${WORK_DIR} - build produced nothing"

log "copying ${DOOM_JS} -> ${OUT_DIR}/doom.js"
cp "${DOOM_JS}"   "${OUT_DIR}/doom.js"
log "copying ${DOOM_WASM} -> ${OUT_DIR}/doom.wasm"
cp "${DOOM_WASM}" "${OUT_DIR}/doom.wasm"

# -----------------------------------------------------------------------------
# 7. Format the generated JS so the diff stays readable
# -----------------------------------------------------------------------------

if command -v npx >/dev/null 2>&1; then
  log "running prettier on doom/src/doom.js"
  (cd "${REPO_ROOT}" && npx --no-install prettier --write doom/src/doom.js) || true
fi

# -----------------------------------------------------------------------------
# 8. Prepend lint-ignore banner
# -----------------------------------------------------------------------------
#
# doom.js is an Emscripten-generated artifact full of legacy-looking JS
# (var redeclarations, empty blocks, hasOwnProperty calls, etc.). Silence
# eslint on the file and mark it as generated so GitHub collapses it in
# diffs and tsc doesn't include it in any future type check pass.

log "prepending lint-ignore banner to doom/src/doom.js"
BANNER="$(cat <<'EOF'
/* eslint-disable */
// @ts-nocheck
// @generated - rebuilt from lazarv/wasm-doom by doom/build/build.sh
// Do not edit by hand. Run `npm run build:doom` to regenerate.
EOF
)"
TMP_JS="$(mktemp)"
{ printf '%s\n' "${BANNER}"; cat "${OUT_DIR}/doom.js"; } > "${TMP_JS}"
mv "${TMP_JS}" "${OUT_DIR}/doom.js"

log "done - doom/src/doom.js and doom/src/doom.wasm are rebuilt"
log "open doom/ in a browser and run the verification checklist in doom/build/README.md"
