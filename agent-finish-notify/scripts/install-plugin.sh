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
else
  : > "$PATCH"
fi

# Содержимое без комментариев и пробелов: пусто или "[]" — плагинов нет.
meaningful="$(sed 's/#.*$//' "$PATCH" | tr -d '[:space:]')"

if printf '%s' "$meaningful" | grep -q "$PLUGIN_NAME"; then
  # уже установлен — ничего не меняем
  :
elif [ -z "$meaningful" ] || [ "$meaningful" = "[]" ]; then
  # Сохраняем комментарии, убираем пустой список и дописываем блок.
  awk '{ if ($0 ~ /^[[:space:]]*\[\][[:space:]]*(#.*)?$/) next; print }' "$PATCH" > "$PATCH.tmp"
  printf '%s\n' '- insert:' '    - id: chatium-notify-panel' "      name: $PLUGIN_NAME" >> "$PATCH.tmp"
  mv "$PATCH.tmp" "$PATCH"
else
  # Есть другие плагины: добавляем ещё один элемент списка.
  printf '\n' >> "$PATCH"
  printf '%s\n' '- insert:' '    - id: chatium-notify-panel' "      name: $PLUGIN_NAME" >> "$PATCH"
fi

echo "плагин: $DST"
echo "профиль: $PATCH"
echo "дальше: обнови вкладку Chatium Code; фоновые уведомления включатся при следующем старте Code"
