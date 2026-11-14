// Host half of the notify-panel bundle.
// Watches session events server-side and sends Chatium notifications, so they
// arrive even when the browser tab is closed. Also stores per-machine settings.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

export const name = 'chatium-notify-panel'
export const inject = ['webServer']

const SETTINGS_DIR = path.join(process.env.DSH_HOME || '/data/dsh', 'notify-panel')
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json')
const SETTINGS_ROUTE = '/__notify-panel/settings'
const PRESENCE_ROUTE = '/__notify-panel/presence'
const CHANNELS_ROUTE = '/__notify-panel/channels'
const KB_URL = 'https://chatium.ru/app/knowledge/~/baza-znaniy/vash-akkaunt/uvedomleniya-kuda-prihodyat-i-kak-nastroit.md'

const DEFAULT_THRESHOLD_MS = 30000
const PRESENCE_TTL_MS = 45000
const CATEGORY_TITLE = 'Агент Chatium code: уведомление'
const LOG_FILE = path.join(process.env.DSH_HOME || '/data/dsh', 'notify-panel.log')

function logLine(message) {
  try {
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + message + '\n')
  } catch {}
}

const presence = { focused: false, at: 0, activeSessionId: null }
const turnStarted = new WeakMap()
const turnInfo = new WeakMap()
const pendingApprovals = new Map()
const pendingQuestions = new Map()

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeSettings(value) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(value, null, 2) + '\n')
}

function thresholdMs() {
  const value = Number(readSettings()?.thresholdMs)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_THRESHOLD_MS
}

function userIsWatching() {
  return presence.focused && Date.now() - presence.at < PRESENCE_TTL_MS
}

function watchingSession(sessionId) {
  return userIsWatching() && presence.activeSessionId === sessionId
}

function deliver(payload, sessionId = null) {
  const blocked = sessionId === null ? userIsWatching() : watchingSession(sessionId)
  if (!blocked) {
    sendChatiumNotification(payload)
    return
  }
  const at = presence.at
  setTimeout(() => {
    try {
      // heartbeat advanced and the page is still focused — человек за экраном
      if (presence.focused && presence.at !== at) return
      if (sessionId === null ? userIsWatching() : watchingSession(sessionId)) return
      sendChatiumNotification(payload)
    } catch {}
  }, PRESENCE_TTL_MS + 5000)
}

function notifyQuestion(entry) {
  if (!entry || entry.notified || watchingSession(entry.sessionId)) return
  entry.notified = true
  deliver({
    id: entry.id,
    typeKey: 'agent.needs_answer',
    title: 'Нужен ответ: ' + String(entry.header || 'вопрос').slice(0, 50),
    text: entry.sessionTitle + '\n' + String(entry.question || entry.header || '').slice(0, 220),
  }, entry.sessionId)
}

function notifyApproval(entry) {
  if (!entry || entry.notified || watchingSession(entry.sessionId)) return
  entry.notified = true
  deliver({
    id: `agent-finish:${entry.sessionId}:approval:${entry.key}`,
    typeKey: 'agent.needs_answer',
    title: 'Нужен ответ: подтвердите действие',
    text: `${entry.title}\nАгент ждёт подтверждения действия`,
  }, entry.sessionId)
}

function cachedTitle(sessionId) {
  try {
    const file = path.join(
      process.env.DSH_HOME || '/data/dsh',
      'storages',
      'session_projcache',
      'sessions',
      `${sessionId}.json`,
    )
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))?.record?.rows
    const title = record?.title?.val?.title
    if (typeof title === 'string' && title.trim() !== '') return title.trim()
    const first = record?.titleInput?.val?.first?.text
    if (typeof first === 'string' && first.trim() !== '') {
      return first.trim().split('\n')[0].slice(0, 60)
    }
  } catch {}
  return null
}

function sessionTitle(session) {
  try {
    const values = [session?.title, session?.header?.title, session?.header?.name, session?.meta?.title]
    for (const value of values) {
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  } catch {}
  return cachedTitle(session?.id) ?? 'Chatium Code'
}

/** Send through the account: center, Telegram and e-mail follow user settings. */
function sendChatiumNotification({ id, typeKey, title, text }) {
  const script = `
const { sendNotification } = await import("@store/sdk");
const user = ctx.user;
if (!user) throw new Error("chatium user is unavailable");
const result = await sendNotification(ctx, {
  id: ${JSON.stringify(id)},
  source: { key: "agent-finish", title: ${JSON.stringify(CATEGORY_TITLE)} },
  recipients: { userIds: [user.id] },
  typeKey: ${JSON.stringify(typeKey)},
  title: ${JSON.stringify(title)},
  text: ${JSON.stringify(text)},
  url: ctx.account.url("/app/dev/code")
});
return JSON.stringify(result);
`
  execFile('chatium', ['exec', script], { cwd: '/data/workspace', timeout: 25000 }, (error) => {
    if (error) {
      logLine('send failed ' + id + ': ' + error.message.split('\n')[0])
      console.error('notify-panel: send failed:', error.message)
    } else {
      logLine('sent ' + id)
    }
  })
}

function runChatium(script) {
  return new Promise((resolve) => {
    execFile('chatium', ['exec', script], { cwd: '/data/workspace', timeout: 25000 }, (error, stdout) => {
      if (error) return resolve({ ok: false, error: error.message })
      try {
        const line = String(stdout)
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean)
          .pop()
        resolve({ ok: true, data: JSON.parse(line) })
      } catch {
        resolve({ ok: false, error: 'bad chatium output' })
      }
    })
  })
}

function readBody(request, limit = 8192) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > limit) {
        reject(new Error('body too large'))
        request.destroy()
      }
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

export function apply(ctx) {
  try {
  const json = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: SETTINGS_ROUTE,
        handler: async (request, response) => {
          if (request.method === 'GET') {
            response.writeHead(200, json)
            response.end(JSON.stringify(readSettings() ?? {}))
            return
          }
          if (request.method === 'POST') {
            try {
              const parsed = JSON.parse(await readBody(request))
              if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad shape')
              writeSettings(parsed)
              response.writeHead(200, json)
              response.end('{"ok":true}')
            } catch {
              response.writeHead(400, json)
              response.end('{"ok":false}')
            }
            return
          }
          response.writeHead(405, json)
          response.end('{}')
        },
      }),
    'notify-panel: settings route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: PRESENCE_ROUTE,
        handler: async (request, response) => {
          if (request.method !== 'POST') {
            response.writeHead(405, json)
            response.end('{}')
            return
          }
          try {
            const parsed = JSON.parse(await readBody(request, 2048))
            presence.focused = parsed?.focused === true
            presence.at = Date.now()
            presence.activeSessionId = typeof parsed?.activeSessionId === 'string' ? parsed.activeSessionId : null
            for (const entry of pendingApprovals.values()) notifyApproval(entry)
            for (const entry of pendingQuestions.values()) notifyQuestion(entry)
            response.writeHead(200, json)
            response.end('{"ok":true}')
          } catch {
            response.writeHead(400, json)
            response.end('{"ok":false}')
          }
        },
      }),
    'notify-panel: presence route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: CHANNELS_ROUTE,
        handler: async (request, response) => {
          if (request.method === 'GET') {
            const result = await runChatium(`
const { getNotificationSettings } = await import("@store/sdk");
const settings = await getNotificationSettings(ctx, {});
const all = [...(settings.sources || []), ...(settings.workspaces || [])];
const source = all.find((item) => item.schema && item.schema.key === "agent-finish");
return JSON.stringify({
  hasSource: Boolean(source),
  channels: source ? source.channels : null,
  title: source ? source.title : null,
  telegramConnected: Boolean(settings.telegram && settings.telegram.connected),
  email: ctx.user ? ctx.user.confirmedEmail : null,
  accountUrl: ctx.account.url("/app")
});
`)
            response.writeHead(result.ok ? 200 : 502, json)
            response.end(JSON.stringify(result.ok ? { ok: true, data: result.data, kbUrl: KB_URL } : { ok: false, error: result.error }))
            return
          }

          if (request.method === 'POST') {
            try {
              const parsed = JSON.parse(await readBody(request, 2048))
              const channels = parsed && parsed.channels ? parsed.channels : null
              if (!channels) throw new Error('channels required')
              const payload = JSON.stringify({
                inbox: channels.inbox === true,
                email: channels.email === true,
                telegram: channels.telegram === true,
                app: false,
              })
              const result = await runChatium(`
const { updateNotificationSettings } = await import("@store/sdk");
await updateNotificationSettings(ctx, {
  sourceKey: \`account:\${ctx.account.id}:source:agent-finish\`,
  channels: ${payload}
});
return JSON.stringify({ ok: true });
`)
              response.writeHead(result.ok ? 200 : 502, json)
              response.end(JSON.stringify(result.ok ? { ok: true } : { ok: false, error: result.error }))
            } catch {
              response.writeHead(400, json)
              response.end('{"ok":false}')
            }
            return
          }

          response.writeHead(405, json)
          response.end('{}')
        },
      }),
    'notify-panel: channels route',
  )

  ctx.on('session/event', (session, event) => {
    try {
      if ((session?.header?.delegationDepth ?? 0) > 0) return
      if (event.type === 'turn/start') {
        turnStarted.set(session, event.time ?? Date.now())
        turnInfo.set(session, { lastText: '', agentNotified: false })
        return
      }

      if (event.type === 'assistant/message') {
        const blocks = event.data?.message?.content ?? []
        const text = blocks
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n')
          .trim()
        if (text !== '') {
          const info = turnInfo.get(session) ?? { lastText: '', agentNotified: false }
          info.lastText = text
          turnInfo.set(session, info)
        }
        return
      }

      if (event.type === 'tool/call') {
        const args = typeof event.data?.arguments === 'string' ? event.data.arguments : JSON.stringify(event.data?.arguments ?? '')
        const name = String(event.data?.name ?? '')

        if (args.includes('sendNotification') && args.includes('agent-finish')) {
          const info = turnInfo.get(session) ?? { lastText: '', agentNotified: false }
          info.agentNotified = true
          if (args.includes('agent.needs_answer')) info.agentQuestionNotified = true
          turnInfo.set(session, info)
        }

        if (name === 'ask_user_question' || name.endsWith('__ask_user_question')) {
          try {
            const parsed = JSON.parse(args)
            const first = parsed && parsed.questions && parsed.questions[0]
            if (first) {
              const info = turnInfo.get(session) ?? { lastText: '', agentNotified: false }
              if (!info.agentQuestionNotified) {
                const entry = {
                  sessionId: session.id,
                  callId: event.data?.callId || String(event.seq),
                  header: first.header || 'вопрос',
                  question: first.question || first.header || '',
                  sessionTitle: sessionTitle(session),
                  notified: false,
                  id: `agent-finish:${session.id}:question:${event.data?.callId || event.seq}`,
                }
                pendingQuestions.set(session.id, entry)
                notifyQuestion(entry)
              }
            }
          } catch {}
        }
        return
      }

      if (event.type === 'tool/result') {
        const pending = pendingQuestions.get(session.id)
        const callId = event.data?.message?.toolCallId
        if (pending && callId && pending.callId === callId) pendingQuestions.delete(session.id)
        return
      }

      if (event.type === 'approval/asked') {
        // The turn pauses here, so a "finished" event never arrives.
        const entry = {
          sessionId: session.id,
          key: event.data?.id ?? event.seq,
          title: sessionTitle(session),
          notified: false,
        }
        pendingApprovals.set(session.id, entry)
        notifyApproval(entry)
        return
      }

      if (event.type === 'approval/decided') {
        pendingApprovals.delete(session.id)
        return
      }

      if (event.type === 'turn/end') {
        pendingApprovals.delete(session.id)
        const started = turnStarted.get(session)
        turnStarted.delete(session)
        const elapsed = started === undefined ? 0 : (event.time ?? Date.now()) - started
        const reason = event.data?.reason?.kind

        if (reason === 'aborted') return

        if (reason === 'interrupted' || (reason !== undefined && reason !== 'completed')) {
          sendChatiumNotification({
            id: `agent-finish:${session.id}:interrupted:${event.seq ?? Date.now()}`,
            typeKey: 'agent.finished',
            title: 'Прервано: задача не завершена',
            text: `${sessionTitle(session)}\nПроцесс Chatium Code остановился — откройте сессию, чтобы продолжить.`,
          })
          return
        }

        if (started === undefined) return
        if (elapsed < thresholdMs()) return
        const info = turnInfo.get(session)
        if (info && info.agentNotified) return
        const minutes = Math.max(1, Math.round(elapsed / 60000))
        const clean = String(info?.lastText ?? '')
          .replace(/[#*_`>]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
        const first = (clean.split(/(?<=[.!?])\s/)[0] || clean).slice(0, 70)
        const rest = clean.slice(first.length).trim().slice(0, 320)
        deliver({
          id: `agent-finish:${session.id}:done:${event.seq ?? started}`,
          typeKey: 'agent.finished',
          title: first === '' ? 'Готово: задача выполнена' : 'Готово: ' + first,
          text: rest === '' ? `${sessionTitle(session)}\nДлительность: ${minutes} мин` : `${sessionTitle(session)}\n${rest}`,
        })
      }
    } catch (error) {
      console.error('notify-panel: event handling failed:', error?.message ?? error)
    }
  })
  } catch (error) {
    console.error('notify-panel: disabled after error:', error?.message ?? error)
  }
}
