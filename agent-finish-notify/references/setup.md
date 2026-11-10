# Настройка навыка «Уведомить о завершении»

Читай этот файл, когда `config: null` (первый запуск), когда человек просит поменять каналы или
порог, или когда категория уведомлений не находится.

## 1. Проверь категорию и каналы

```bash
chatium exec 'const {getNotificationSettings} = await import("@store/sdk"); const s = await getNotificationSettings(ctx, {}); const all=[...(s.sources||[]),...(s.workspaces||[])]; return JSON.stringify({ telegram: s.telegram, email: ctx.user.confirmedEmail, hasSource: all.some(x => x.schema && x.schema.key === "agent-finish") })'
```

## 2. Категории нет

Объясни в одну строку: без неё выбор каналов недоступен, включены сразу все; добавляется одной
строкой кода в аккаунт, разово и безопасно. Спроси разрешение. Согласился — выполни
[declaration.md](declaration.md) и дождись сборки (около минуты). Отказался или добавить нельзя —
работай без выбора каналов и предупреди, что включены все.

## 3. Объясни, где это в интерфейсе

- в левом меню — **значок конверта** «Уведомления»;
- внутри — «Настройки доставки»;
- ползунки под конвертом — «Настройка левого меню», к уведомлениям не относятся;
- категория называется «Агент: завершение работы».

Снимки: `../assets/notifications-menu.png` и `../assets/notification-channels.png` (инструмент
`present`). Снимки могут устареть — слова важнее.

## 4. Скажи по факту

Подключён ли Telegram, какой адрес подтверждён.

## 5. Спроси каналы

«Центр», «почта», «Telegram» — можно несколько. Поясни: центр — когда человек за компьютером, но
в другой вкладке; почта и Telegram — когда отошёл.

## 6. Примени выбор

Подставь свои значения и `true/false`:

```bash
chatium exec 'const {updateNotificationSettings} = await import("@store/sdk"); return JSON.stringify(await updateNotificationSettings(ctx, { sourceKey: `account:${ctx.account.id}:source:agent-finish`, channels: { inbox: true, email: false, telegram: true, app: false } }))'
```

Ошибка «Unknown or unavailable notification source» — категория ещё не собралась: подожди минуту,
повтори, затем вернись к шагу 2.

## 7. Спроси порог

3 минуты, 10, 30 или всегда (`0`). Поясни: меньше — больше сообщений по мелким правкам, больше —
только долгие задачи. Хочет знать о каждой задаче — «всегда».

## 8. Сохрани и включи сессию

```bash
node /data/external/agent-finish-notify/state.mjs config thresholdMinutes=3
node /data/external/agent-finish-notify/state.mjs enable
```

## 9. Проверочное уведомление

Отправь по разделу «Отправка» из `SKILL.md` с заголовком «Проверка связи» и покажи `state` и
счётчики каналов.

## Изменить настройки

- Порог: `node /data/external/agent-finish-notify/state.mjs config thresholdMinutes=10` (`0` — всегда).
- Каналы: повтори шаг 6 с новыми `true/false`.
- Выключить в этой сессии: `state.mjs disarm`.
- Полная перенастройка — только по просьбе «настрой заново».

## Если не получилось

- `chatium exec` просит вход — подожди минуту и повтори один раз; снова просит — попроси обновить
  страницу Chatium Code.
- `state: "skipped"` — все каналы выключены: скажи и предложи включить нужные.
- Категория не появляется после публикации — проверь, что модуль импортирован во входной файл
  воркспейса, а не просто лежит в `api/`; и что публикация ушла в ту ветку, из которой собирается аккаунт.
