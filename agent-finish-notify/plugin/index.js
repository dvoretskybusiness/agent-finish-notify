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

const DEFAULT_THRESHOLD_MS = 30000
const PRESENCE_TTL_MS = 45000
const CATEGORY_TITLE = 'Агент Chatium code: уведомление'

const presence = { focused: false, at: 0, activeSessionId: null }
const turnStarted = new WeakMap()
const pendingApprovals = new Map()

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

function notifyApproval(entry) {
  if (!entry || entry.notified || watchingSession(entry.sessionId)) return
  entry.notified = true
  sendChatiumNotification({
    id: `agent-finish:${entry.sessionId}:approval:${entry.key}`,
    typeKey: 'agent.needs_answer',
    title: 'Нужен ответ: подтвердите действие',
    text: `${entry.title}\nАгент ждёт подтверждения действия`,
  })
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
const result = await sendNotification(ctx, {
  id: ${JSON.stringify(id)},
  source: { key: "agent-finish", title: ${JSON.stringify(CATEGORY_TITLE)} },
  recipients: { userIds: [ctx.user.id] },
  typeKey: ${JSON.stringify(typeKey)},
  title: ${JSON.stringify(title)},
  text: ${JSON.stringify(text)},
  url: ctx.account.url("/app/dev/code")
});
return JSON.stringify(result);
`
  execFile('chatium', ['exec', script], { cwd: '/data/workspace', timeout: 25000 }, (error) => {
    if (error) console.error('notify-panel: send failed:', error.message)
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

  ctx.on('session/event', (session, event) => {
    try {
      if ((session?.header?.delegationDepth ?? 0) > 0) return
      if (event.type === 'turn/start') {
        turnStarted.set(session, event.time ?? Date.now())
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
        if (started === undefined) return
        const elapsed = (event.time ?? Date.now()) - started
        if (elapsed < thresholdMs()) return
        if (userIsWatching()) return
        const minutes = Math.max(1, Math.round(elapsed / 60000))
        sendChatiumNotification({
          id: `agent-finish:${session.id}:done:${event.seq ?? started}`,
          typeKey: 'agent.finished',
          title: 'Готово: задача выполнена',
          text: `${sessionTitle(session)}\nДлительность: ${minutes} мин`,
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
