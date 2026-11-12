#!/bin/bash
# Устанавливает плагин панели уведомлений в профиль web.
# Ничего не перезапускает: клиентская часть заработает после обновления вкладки,
# серверная — при следующем штатном старте Chatium Code.
set -euo pipefail

HOME_DIR="${DSH_HOME:-/data/dsh}"
PROFILE="$HOME_DIR/profiles/web"
PLUGIN_NAME="dsh-plugin-chatium-notify-panel"
SRC="$(cd "$(dirname "$0")/.." && pwd)/plugin"
DST="$HOME_DIR/plugins/$PLUGIN_NAME"
PATCH="$PROFILE/cordis.patch.yml"

if [ ! -d "$PROFILE" ]; then
  echo "не найден профиль web: $PROFILE" >&2
  exit 1
fi

mkdir -p "$HOME_DIR/plugins" "$PROFILE/node_modules"
rm -rf "$DST"
cp -R "$SRC" "$DST"
ln -sfn "$DST" "$PROFILE/node_modules/$PLUGIN_NAME"

if [ -f "$PATCH" ]; then
  cp -a "$PATCH" "$PATCH.bak.$(date +%Y%m%d-%H%M%S)"
fi

if ! grep -q "$PLUGIN_NAME" "$PATCH" 2>/dev/null; then
  if [ ! -s "$PATCH" ] || [ "$(tr -d '[:space:]' < "$PATCH")" = "[]" ]; then
    printf '%s\n' '- insert:' '    - id: chatium-notify-panel' "      name: $PLUGIN_NAME" > "$PATCH"
  else
    printf '\n%s\n' '- insert:' '    - id: chatium-notify-panel' "      name: $PLUGIN_NAME" >> "$PATCH"
  fi
fi

echo "плагин: $DST"
echo "профиль: $PATCH"
echo "дальше: обнови вкладку Chatium Code; фоновые уведомления включатся при следующем старте Code"
