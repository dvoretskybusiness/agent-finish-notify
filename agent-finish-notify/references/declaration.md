# Категория уведомлений в аккаунте

Без декларации `sendNotification` работает, но источник считается неизвестным: включены сразу все
каналы, а `updateNotificationSettings` отвечает `Unknown or unavailable notification source`.
Поэтому выбор «центр / почта / Telegram» появляется только после декларации.

Декларация статическая: её читают при сборке аккаунта, поэтому она добавляется кодом и публикацией.
Одна на аккаунт, от версии навыка не зависит.

## 1. Проверь, нет ли уже

```bash
chatium exec 'const {getNotificationSettings} = await import("@store/sdk"); const s = await getNotificationSettings(ctx, {}); const all=[...(s.sources||[]),...(s.workspaces||[])]; return JSON.stringify({ accountId: ctx.account.id, found: all.filter(x => x.schema && x.schema.key === "agent-finish").map(x => ({ key: x.sourceKey, title: x.title, types: (x.schema.items||[]).map(i => i.key) })) })'
```

- `found` непустой и в `types` есть `agent.finished` и `agent.needs_answer` — ничего не делай, категория уже есть.
- `found` непустой, но типа `agent.needs_answer` нет — предложи обновить декларацию (шаг 3), добавив недостающий тип. Это безопасно: настройки людей сохранятся.
- `found` пустой — переходи к шагу 2.

## 2. Найди, куда положить файл

Нужен воркспейс, который собирается и публикуется: папка с `.workspace.json` в корне репозитория
аккаунта, а в ней входной файл `index.tsx`, `index.ts` или `app.tsx`, который импортирует другие
модули `./api/*`.

```bash
root=$(git rev-parse --show-toplevel)
grep -rl "@store/notification-types" "$root" --include=*.ts --include=*.tsx 2>/dev/null | head
ls "$root"/*/.workspace.json 2>/dev/null | head
```

- Уже есть файл с `notificationTypesManifest` — посмотри, как он подключён, и сделай так же.
- Воркспейсов несколько — бери тот, где входной файл уже импортирует `./api/*` (там точно работает
  регистрация модулей). Если таких нет — любой с `index.tsx`.
- Воркспейса нет вовсе (аккаунт только из плагинов) — не добавляй, вернись к навыку с пометкой
  «категорию добавить нельзя».

## 3. Добавь файл

Создай `<воркспейс>/api/agent-finish-notify.ts`:

```ts
import { notificationTypesManifest } from "@store/sdk";

// Категория уведомлений для навыка «Уведомить о завершении» (agent-finish-notify).
// После публикации появляется в «Настройках доставки»: каждый сотрудник сам выбирает
// каналы (центр / почта / Telegram) для сообщений о завершении работы агента.
app.manifest("@store/notification-types", notificationTypesManifest, {
  key: "agent-finish",
  title: "Агент: завершение работы",
  version: "v1",
  items: [
    { key: "agent.finished", title: "Задача выполнена" },
    { key: "agent.needs_answer", title: "Нужен ответ" },
  ],
});
```

Затем в входном файле воркспейса добавь импорт рядом с другими `./api/*`:

```ts
import './api/agent-finish-notify'
```

Правила:

- `key` оставь ровно `agent-finish` — на него рассчитывают `sendNotification` и `updateNotificationSettings`.
- Не меняй и не переформатируй чужие строки: правок должно быть две — новый файл и один импорт.
- Имя файла занято — возьми другое (`agent-finish-manifest.ts`), но `key` не меняй.
- Модуль должен попасть в сборку именно через импорт: просто лежащий в `api/` файл не регистрируется.

## 4. Опубликуй

Рабочую копию не трогай, собери изменение в отдельном дереве на `origin/main`:

```bash
root=$(git rev-parse --show-toplevel)
git -C "$root" fetch origin main
tree=$(mktemp -d)/main
git -C "$root" worktree add --detach "$tree" origin/main
# скопируй новый файл и правку импорта в $tree (не в рабочую копию)
git -C "$tree" add -A
git -C "$tree" commit --no-verify -m "Навык agent-finish-notify: категория уведомлений"
git -C "$tree" push origin HEAD:main
git -C "$root" worktree remove --force "$tree"
```

- `--no-verify` обязателен: pre-commit hook переформатирует файлы и раздувает diff.
- `push` отклонён — `git -C "$tree" pull --rebase origin main` и повтори.
- Аккаунт публикуется не из `main` — уточни ветку у человека и публикуй туда, но не в рабочую копию.

## 5. Проверь

Подожди сборку (обычно меньше минуты) и повтори проверку из шага 1. Должно появиться
`account:<id>:source:agent-finish` с обоими типами. После этого в навыке работает:

```bash
chatium exec 'const {updateNotificationSettings} = await import("@store/sdk"); return JSON.stringify(await updateNotificationSettings(ctx, { sourceKey: `account:${ctx.account.id}:source:agent-finish`, channels: { inbox: true, email: false, telegram: true, app: false } }))'
```

## Если добавить нельзя

Нет прав на push, нет воркспейса, человек против правки кода — не добавляй и не обходи запрет.
Скажи прямо: выбор каналов недоступен, сейчас включены все (центр, почта, Telegram); отключить
лишнее можно в общих настройках уведомлений, но не по категории. Это рабочий режим, просто менее
удобный.
