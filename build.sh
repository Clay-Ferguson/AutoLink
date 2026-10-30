#!/usr/bin/env bash
# Checks and builds the AutoLink .vsix package, then offers to install it into VS Code.
#
#   ./build.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm ci
fi

# Typecheck, lint and test; `set -e` stops the build if any of them fail.
npm run check

# `vsce package` runs vscode:prepublish, which makes the production bundle.
npm run package

name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")
vsix="$name-$version.vsix"

if [[ ! -f "$vsix" ]]; then
  echo "Error: expected $vsix, but it wasn't created." >&2
  exit 1
fi

echo
echo "Built $vsix"
echo

read -r -p "Install $vsix into VS Code now? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]; then
  echo "Not installed. To install it later, run:"
  echo "  code --install-extension $vsix --force"
  exit 0
fi

if ! command -v code >/dev/null 2>&1; then
  echo "Error: the 'code' command isn't on your PATH." >&2
  exit 1
fi

code --install-extension "$vsix" --force
echo "Installed. Reload any open VS Code windows (Developer: Reload Window) to use the new version."
