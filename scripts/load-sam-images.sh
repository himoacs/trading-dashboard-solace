#!/usr/bin/env bash
#
# Loads the Solace Agent Mesh container image into the local Docker daemon.
#
# Agent Mesh images are not published to a public registry, so they cannot be
# pulled by docker compose. Download the release archive from the Solace product
# portal (https://products.solace.com/ -> Agent_Mesh) and point this script at
# the directory holding the .tar.gz files.
#
# Usage:
#   ./scripts/load-sam-images.sh [ARTIFACT_DIR]
#
# ARTIFACT_DIR defaults to $SAM_ARTIFACT_DIR, then ~/dev/sam_go.
#
# Only the "-app-" image is required: it embeds every runtime component
# (entrypoint executor, platform service, secure tool runtime, agent-workflow
# executor) plus the `sam` CLI. The separate "-str-" image is for deployments
# that scale the tool runtime independently and is not used by this demo.

set -euo pipefail

ARTIFACT_DIR="${1:-${SAM_ARTIFACT_DIR:-$HOME/dev/sam_go}}"

if ! docker info >/dev/null 2>&1; then
  echo "error: Docker does not appear to be running." >&2
  exit 1
fi

if [[ ! -d "$ARTIFACT_DIR" ]]; then
  cat >&2 <<EOF
error: artifact directory not found: $ARTIFACT_DIR

Download the Agent Mesh release from https://products.solace.com/ (Agent_Mesh),
then either pass the directory explicitly:

  ./scripts/load-sam-images.sh /path/to/artifacts

or export SAM_ARTIFACT_DIR=/path/to/artifacts
EOF
  exit 1
fi

# Pick the newest app image archive matching this machine's architecture.
case "$(uname -m)" in
  arm64|aarch64) ARCH_PATTERN="arm64" ;;
  x86_64|amd64)  ARCH_PATTERN="amd64" ;;
  *)             ARCH_PATTERN="" ;;
esac

shopt -s nullglob
candidates=("$ARTIFACT_DIR"/solace-agent-mesh-*-app-*.tar.gz)
shopt -u nullglob

if (( ${#candidates[@]} == 0 )); then
  echo "error: no solace-agent-mesh-*-app-*.tar.gz found in $ARTIFACT_DIR" >&2
  exit 1
fi

archive=""
if [[ -n "$ARCH_PATTERN" ]]; then
  for c in "${candidates[@]}"; do
    if [[ "$c" == *"$ARCH_PATTERN"* ]]; then archive="$c"; break; fi
  done
fi

if [[ -z "$archive" ]]; then
  archive="${candidates[0]}"
  echo "warning: no archive matching arch '$ARCH_PATTERN'; falling back to:" >&2
  echo "         $(basename "$archive")" >&2
  echo "         If the container fails to start, download the archive built" >&2
  echo "         for $(uname -m) from the Solace product portal." >&2
fi

# The archive is a `docker save` bundle; its repositories file names the tag.
tag="$(tar -xzOf "$archive" repositories 2>/dev/null \
  | python3 -c 'import json,sys
d=json.load(sys.stdin)
repo=next(iter(d))
name=repo.split("/")[-1]
print(f"{name}:{next(iter(d[repo]))}")' 2>/dev/null || true)"

if [[ -n "$tag" ]] && docker image inspect "$tag" >/dev/null 2>&1; then
  echo "already loaded: $tag  (skipping $(basename "$archive"))"
  exit 0
fi

echo "loading $(basename "$archive") ... this takes a minute or two"
docker load -i "$archive"

if [[ -n "$tag" ]]; then
  echo
  echo "loaded: $tag"
  if [[ "$tag" != "solace-agent-mesh:2.275.10" ]]; then
    echo "note: docker-compose.yaml defaults to solace-agent-mesh:2.275.10."
    echo "      Run with SAM_VERSION=${tag#*:} or update the default."
  fi
fi
