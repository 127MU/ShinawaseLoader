#!/bin/bash
# Double-click to open the interactive macOS setup menu.
# Windows setup remains setup-modloader.bat.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

find_node() {
  if [[ -n "${ECHO_NODE_PATH:-}" && -x "${ECHO_NODE_PATH}" ]] && "$ECHO_NODE_PATH" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
    printf '%s\n' "$ECHO_NODE_PATH"
    return
  fi
  local candidate
  local candidates=()
  if command -v node >/dev/null 2>&1; then
    candidates+=("$(command -v node)")
  fi
  candidates+=(
    "$HOME/.local/bin/node"
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
  )
  local bundled
  for bundled in "$HOME/.local/opt"/node-v22.23.2*/bin/node; do
    candidates+=("$bundled")
  done
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  return 1
}

NODE="$(find_node || true)"
if [[ -z "$NODE" ]]; then
  echo "没有找到 Node。请安装 Node 22.23.2，或设置 ECHO_NODE_PATH。"
  exit 1
fi
"$NODE" "$ROOT/scripts/setup-modloader-macos.mjs" "$@"
result=$?
if [[ $result -ne 0 && -t 0 ]]; then
  read -r -p "操作失败。按回车关闭…" _reply
fi
exit "$result"
