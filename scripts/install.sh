#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

echo "📦 Installing dependencies..."
npm install

echo "🔨 Building Skill Docs MCP server, CLI, and UI..."
npm run build

echo "🚀 Installing plugin to Antigravity..."
node ./dist/cli.mjs install "$@"
