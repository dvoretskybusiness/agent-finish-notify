# Обновление навыка

Когда: `arm` вернул `update.updateAvailable: true`, это не отклонённая версия, и человек согласился.

## 1. Возьми релиз

```bash
tmp=$(mktemp -d)
git clone --depth=1 --branch v<latest> https://github.com/dvoretskybusiness/agent-finish-notify "$tmp/src"
```

Тег — `v<latest>`, например `v1.3.0`. Обновляйся только на релиз, не на `main`: в `main` может
лежать недоделанное.

## 2. Проверь, что навык цел

```bash
grep -m1 '^name:' "$tmp/src/agent-finish-notify/SKILL.md"
grep -m1 '^version:' "$tmp/src/agent-finish-notify/SKILL.md"
```

`name` — `agent-finish-notify`, `version` — `latest`. Не совпало или файла нет — не обновляй,
скажи человеку, что релиз выглядит битым.

## 3. Замени папку

**Аккаунт** (`.agents/skills`):

```bash
root=$(git rev-parse --show-toplevel)
git -C "$root" fetch origin main
tree=$(mktemp -d)/main
git -C "$root" worktree add --detach "$tree" origin/main
rm -rf "$tree/.agents/skills/agent-finish-notify"
cp -R "$tmp/src/agent-finish-notify" "$tree/.agents/skills/agent-finish-notify"
git -C "$tree" add -A .agents/skills
git -C "$tree" commit --no-verify -m "Навык agent-finish-notify: обновление до <latest>"
git -C "$tree" push origin HEAD:main
git -C "$root" worktree remove --force "$tree"
```

**Только окружение** (`/data/dsh/skills`):

```bash
rm -rf /data/dsh/skills/agent-finish-notify
cp -R "$tmp/src/agent-finish-notify" /data/dsh/skills/agent-finish-notify
```

Сначала посмотри, где навык стоит: если есть `.agents/skills/agent-finish-notify`, обновляй его —
он важнее локального.

## 4. Обнови скрипт состояния

```bash
cp "<папка-навыка>/scripts/state.mjs" /data/external/agent-finish-notify/state.mjs
```

Иначе новые команды не появятся.

## 5. Проверь

- Обновляли аккаунт — дождись сборки: в выводе `push` будет `build ... success`.
- `state.mjs update-check` — `local` равен `latest`, `updateAvailable: false`.
- `state.mjs status` — настройки и отметки сессий на месте.

## Если что-то пошло не так

- Сборка упала — откати коммит обновления (`git revert`) и скажи человеку: рабочий навык важнее
  новой версии.
- Тег не клонируется — не обновляй, останься на текущей версии.
- Настройки не трогаются: они лежат в `/data/external`, а не в папке навыка.
