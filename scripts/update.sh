#!/usr/bin/env bash
set -euo pipefail

VERSION_ARG="${1:-}"

normalize() {
  local arg="$1"
  if [[ "$arg" == v* ]]; then
    BRANCH="$arg"
    EXT_VERSION="${arg#v}"
  else
    BRANCH="v$arg"
    EXT_VERSION="$arg"
  fi
}

latest_branch() {
  git branch -a --format='%(refname:short)' \
    | sed 's|^origin/||' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -u \
    | sort -V \
    | tail -1
}

echo "→ git fetch"
git fetch --prune --quiet

if [[ -z "$VERSION_ARG" ]]; then
  VERSION_ARG="$(latest_branch)"
  if [[ -z "$VERSION_ARG" ]]; then
    echo "Error: no version branches found (expected e.g. v0.0.10)"
    exit 1
  fi
  echo "→ latest branch: $VERSION_ARG"
fi

normalize "$VERSION_ARG"
VSIX="anshin-${EXT_VERSION}.vsix"

echo "→ git checkout $BRANCH"
git checkout "$BRANCH"

echo "→ git pull"
git pull

if [[ ! -f "$VSIX" ]]; then
  echo "Error: $VSIX not found after checkout of $BRANCH"
  exit 1
fi

echo "→ installing $VSIX into Cursor"
cursor --install-extension "$VSIX"

echo "Done: checked out $BRANCH and installed $VSIX"
