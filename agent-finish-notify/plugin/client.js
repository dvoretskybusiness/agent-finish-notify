// Prototype: notification panel for Chatium Code.
// Client half only: a bell button, a settings panel, and a local notification
// when the agent finishes a turn longer than the threshold.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-chatium-notify-panel',
  factory(require) {
    const React = require('react')

    const STORAGE_KEY = 'chatium-notify-panel:v1'
    const DEFAULTS = { enabled: true, quiet: true, thresholdMs: 30000, sound: true, soundId: 'chime', volume: 70 }

    function readSettings() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
        if (parsed === null || typeof parsed !== 'object') return { ...DEFAULTS }
        return { ...DEFAULTS, ...parsed }
      } catch {
        return { ...DEFAULTS }
      }
    }

    function writeSettings(value) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch {
        // приватный режим — настройки не переживут перезагрузку
      }
    }

    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        get: () => value,
        set: (patch) => {
          value = { ...value, ...patch }
          for (const listener of [...listeners]) listener()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    function useStore(store) {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(store.subscribe, store.get, store.get)
      }
      const [value, setValue] = React.useState(store.get())
      React.useEffect(() => store.subscribe(() => setValue(store.get())), [store])
      return value
    }

    /** Soft two-note chime with a bell-like tail; no audio files needed. */
    function playSound(kind, volume) {
      try {
        const AudioCtor = window.AudioContext || window.webkitAudioContext
        if (typeof AudioCtor !== 'function') return
        const audio = new AudioCtor()
        const master = audio.createGain()
        master.gain.value = 0.4 * (Math.max(0, Math.min(100, Number(volume) || 0)) / 100)
        master.connect(audio.destination)
        const filter = audio.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = 5200
        filter.Q.value = 0.6
        filter.connect(master)

        const note = (freq, delay, length, level, type) => {
          const at = audio.currentTime + delay
          const gain = audio.createGain()
          gain.gain.setValueAtTime(0.0001, at)
          gain.gain.exponentialRampToValueAtTime(level, at + 0.012)
          gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
          gain.connect(filter)
          const osc = audio.createOscillator()
          osc.type = type || 'sine'
          osc.frequency.value = freq
          osc.connect(gain)
          osc.start(at)
          osc.stop(at + length + 0.02)
        }

        if (kind === 'soft') {
          note(659.25, 0, 1.15, 0.75)
          note(987.77, 0.04, 1.05, 0.22)
        } else if (kind === 'two') {
          note(880, 0, 0.35, 0.85)
          note(1318.5, 0.14, 0.5, 0.6)
        } else {
          note(880, 0, 1.05, 0.8)
          note(1318.5, 0.12, 1.15, 0.45)
          note(1760, 0.12, 0.9, 0.16, 'triangle')
        }

        setTimeout(() => {
          try { audio.close() } catch {}
        }, 1800)
      } catch {
        // звук не критичен
      }
    }

    function showNotification(title, body) {
      try {
        if (typeof Notification === 'undefined') return false
        if (Notification.permission !== 'granted') return false
        new Notification(title, { body, tag: 'chatium-notify', silent: true })
        return true
      } catch {
        return false
      }
    }

    const clearBadge = () => {
      try {
        if (document.title.startsWith('● ')) document.title = document.title.slice(2)
      } catch {}
    }

    const setBadge = () => {
      try {
        if (!document.title.startsWith('● ')) document.title = '● ' + document.title
      } catch {}
    }

    const pageTitle = () => {
      try { return document.title.replace(/^●\s*/, '') || 'Chatium Code' } catch { return 'Chatium Code' }
    }

    function permission() {
      try {
        if (typeof Notification === 'undefined') return 'unsupported'
        return Notification.permission
      } catch {
        return 'unsupported'
      }
    }

    function requestPermission() {
      try {
        if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') return
        Promise.resolve(Notification.requestPermission()).catch(() => {})
      } catch {
        // старые браузеры
      }
    }

    const palette = {
      bg: 'rgba(24, 24, 27, 0.96)',
      border: 'rgba(255, 255, 255, 0.12)',
      text: '#f4f4f5',
      muted: 'rgba(244, 244, 245, 0.6)',
      accent: '#7c9cff',
    }

    const selectStyle = {
      background: 'rgba(255,255,255,0.08)',
      color: palette.text,
      border: '1px solid ' + palette.border,
      borderRadius: '8px',
      padding: '4px 8px',
      fontSize: '12px',
      font: 'inherit',
    }

    function Toggle(props) {
      const h = React.createElement
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': props.value ? 'true' : 'false',
        onClick: props.onChange,
        style: {
          width: '38px', height: '22px', padding: '0', border: 'none', borderRadius: '999px',
          background: props.value ? palette.accent : 'rgba(255,255,255,0.18)',
          position: 'relative', cursor: 'pointer', flex: 'none',
        },
      }, h('span', {
        style: {
          position: 'absolute', top: '3px', left: props.value ? '19px' : '3px',
          width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
          transition: 'left 120ms ease',
        },
      }))
    }

    function Row(props) {
      const h = React.createElement
      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', padding: '8px 0',
        },
      },
      h('div', { style: { minWidth: 0 } },
        h('div', { style: { color: palette.text, fontSize: '13px' } }, props.title),
        props.hint ? h('div', { style: { color: palette.muted, fontSize: '11px', marginTop: '2px' } }, props.hint) : null,
      ),
      props.children)
    }

    /** Dropdown styled like the panel; native select menus ignore dark colors. */
    function Select(props) {
      const h = React.createElement
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => {
        if (!open) return
        const close = (event) => {
          const root = event.target && event.target.closest ? event.target.closest('[data-notify-select]') : null
          if (!root) setOpen(false)
        }
        document.addEventListener('mousedown', close)
        return () => document.removeEventListener('mousedown', close)
      }, [open])
      const current = props.options.find((option) => option.value === props.value) || props.options[0]
      return h('div', { 'data-notify-select': 'true', style: { position: 'relative' } },
        h('button', {
          type: 'button',
          onClick: () => setOpen(!open),
          style: {
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '5px 9px', borderRadius: '8px', border: '1px solid ' + palette.border,
            background: 'rgba(255,255,255,0.08)', color: palette.text, font: 'inherit',
            fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
          },
        }, current ? current.label : '', h('span', { style: { opacity: 0.55, fontSize: '10px' } }, '▾')),
        open ? h('div', {
          style: {
            position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: '100%',
            background: '#1f1f24', border: '1px solid ' + palette.border, borderRadius: '10px',
            padding: '4px', zIndex: 2147483200, boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
          },
        }, props.options.map((option) => h('button', {
          key: option.value,
          type: 'button',
          onClick: () => { props.onChange(option.value); setOpen(false) },
          style: {
            display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
            borderRadius: '7px', border: 'none', font: 'inherit', fontSize: '12px', cursor: 'pointer',
            background: option.value === props.value ? 'rgba(124,156,255,0.2)' : 'transparent',
            color: palette.text, whiteSpace: 'nowrap',
          },
        }, option.label))) : null,
      )
    }

    function Panel(props) {
      const h = React.createElement
      const settings = useStore(props.store)
      const panel = useStore(props.panel)
      const [perm, setPerm] = React.useState(permission())
      const [pos, setPos] = React.useState(() => {
        try {
          const saved = JSON.parse(localStorage.getItem('chatium-notify-panel:pos') || 'null')
          return saved && typeof saved.x === 'number' && typeof saved.y === 'number' ? saved : null
        } catch {
          return null
        }
      })
      const [drag, setDrag] = React.useState(null)

      React.useEffect(() => {
        if (!drag) return
        const width = 360
        const height = 520
        const move = (event) => {
          const x = Math.min(Math.max(8, event.clientX - drag.dx), Math.max(8, window.innerWidth - width - 8))
          const y = Math.min(Math.max(8, event.clientY - drag.dy), Math.max(8, window.innerHeight - height - 8))
          setPos({ x, y })
        }
        const up = () => setDrag(null)
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
        return () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
        }
      }, [drag])

      React.useEffect(() => {
        if (!pos) return
        try { localStorage.setItem('chatium-notify-panel:pos', JSON.stringify(pos)) } catch {}
      }, [pos])

      if (!panel.open) return null

      const set = (patch) => props.store.set({ ...settings, ...patch })
      const section = (title) => h('div', {
        style: { color: palette.muted, fontSize: '11px', letterSpacing: '0.04em', textTransform: 'uppercase', margin: '14px 0 4px' },
      }, title)
      const startDrag = (event) => {
        if (event.button !== 0) return
        const rect = event.currentTarget.closest('[data-notify-panel]').getBoundingClientRect()
        setDrag({ dx: event.clientX - rect.left, dy: event.clientY - rect.top })
      }
      const placement = pos ? { left: pos.x + 'px', top: pos.y + 'px' } : { right: '16px', top: '56px' }

      return h('div', {
        'data-notify-panel': 'true',
        style: {
          position: 'fixed', ...placement, width: '360px', maxHeight: 'min(560px, calc(100vh - 32px))',
          overflowY: 'auto', zIndex: 2147483000,
          background: palette.bg, color: palette.text, border: '1px solid ' + palette.border,
          borderRadius: '16px', padding: '14px 16px 16px', boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
          backdropFilter: 'blur(18px)', font: 'inherit', pointerEvents: 'auto',
        },
      },
      h('div', {
        onMouseDown: startDrag,
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'grab', userSelect: 'none' },
      },
        h('div', { style: { fontSize: '14px', fontWeight: 600 } }, 'Уведомления'),
        h('button', {
          type: 'button', onClick: () => props.panel.set({ open: false }),
          style: { background: 'transparent', border: 'none', color: palette.muted, cursor: 'pointer', fontSize: '16px', lineHeight: 1 },
          'aria-label': 'Закрыть',
        }, '×'),
      ),
      section('Когда уведомлять'),
      h(Row, { title: 'О завершении работы', hint: 'Короткие ответы не уведомляют' },
        h(Toggle, { value: settings.enabled, onChange: () => set({ enabled: !settings.enabled }) })),
      h(Row, { title: 'Порог', hint: 'Сколько должна идти задача' },
        h(Select, {
          value: String(settings.thresholdMs),
          options: [
            { value: '30000', label: '30 секунд' },
            { value: '180000', label: '3 минуты' },
            { value: '600000', label: '10 минут' },
            { value: '1800000', label: '30 минут' },
          ],
          onChange: (value) => set({ thresholdMs: Number(value) }),
        })),
      h(Row, { title: 'Тишина, когда окно активно', hint: 'Не мешать, если вы смотрите на ответ' },
        h(Toggle, { value: settings.quiet, onChange: () => set({ quiet: !settings.quiet }) })),
      h(Row, { title: 'Звук', hint: 'Проверить можно кнопкой ниже' },
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          h(Select, {
            value: settings.soundId,
            options: [
              { value: 'chime', label: 'Колокольчик' },
              { value: 'soft', label: 'Мягкий' },
              { value: 'two', label: 'Два тона' },
            ],
            onChange: (value) => {
              set({ soundId: value })
              playSound(value, settings.volume)
            },
          }),
          h(Toggle, { value: settings.sound, onChange: () => set({ sound: !settings.sound }) }))),
      h(Row, { title: 'Громкость', hint: 'Проверить можно кнопкой ниже' },
        h('input', {
          type: 'range', min: '0', max: '100', step: '5',
          value: String(settings.volume),
          onChange: (event) => set({ volume: Number(event.target.value) }),
          onMouseUp: () => playSound(settings.soundId, settings.volume),
          style: { width: '120px', accentColor: palette.accent },
        })),

      section('Разрешение браузера'),
      h('div', { style: { color: palette.muted, fontSize: '12px', marginBottom: '8px' } },
        perm === 'granted' ? 'Системные уведомления разрешены' : perm === 'denied' ? 'Запрещены в настройках браузера' : perm === 'unsupported' ? '��раузер не поддерживает' : 'Ещё не спрашивали'),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button', {
          type: 'button',
          onClick: () => { if (perm !== 'granted') requestPermission(); else setPerm(permission()) },
          style: { flex: 1, padding: '7px 10px', borderRadius: '9px', border: '1px solid ' + palette.border, background: 'rgba(255,255,255,0.06)', color: palette.text, cursor: 'pointer', font: 'inherit', fontSize: '12px' },
        }, perm === 'granted' ? 'Проверить разрешение' : 'Разрешить уведомления'),
        h('button', {
          type: 'button',
          onClick: () => {
            showNotification('Проверка связи', 'Так будет выглядеть уведомление о завершении задачи')
            if (settings.sound) playSound(settings.soundId, settings.volume)
            setPerm(permission())
          },
          style: { flex: 1, padding: '7px 10px', borderRadius: '9px', border: '1px solid ' + palette.border, background: 'rgba(255,255,255,0.06)', color: palette.text, cursor: 'pointer', font: 'inherit', fontSize: '12px' },
        }, 'Проверить')),
      h('div', { style: { color: palette.muted, fontSize: '11px', marginTop: '10px' } },
        'Настройки хранятся на этой машине. Версия 1.4.8.'),
      )
    }

    function FloatingBell(props) {
      const h = React.createElement
      return h('button', {
        type: 'button',
        onClick: () => props.open(),
        title: 'Уведомления',
        'aria-label': 'Уведомления',
        style: {
          position: 'fixed', right: '16px', bottom: '92px', width: '34px', height: '34px',
          borderRadius: '10px', border: '1px solid rgba(255,255,255,0.14)',
          background: 'rgba(24,24,27,0.72)', color: '#f4f4f5', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 18px rgba(0,0,0,0.3)', backdropFilter: 'blur(10px)',
          zIndex: 2147482000, opacity: 0.85,
        },
      }, h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.35', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M8 2.2a3.6 3.6 0 0 1 3.6 3.6v2.1l1.1 1.9H3.3l1.1-1.9V5.8A3.6 3.6 0 0 1 8 2.2Z' }),
        h('path', { d: 'M6.4 12.1a1.7 1.7 0 0 0 3.2 0' })))
    }

    function HeaderButton(props) {
      const h = React.createElement
      React.useEffect(() => {
        try { window.__chatiumBellMounted = true } catch {}
        return () => { try { window.__chatiumBellMounted = false } catch {} }
      }, [])
      return h('button', {
        type: 'button',
        onClick: () => props.open(),
        title: 'Уведомления',
        'aria-label': 'Уведомления',
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '28px', height: '28px', padding: '0', border: 'none', borderRadius: '8px',
          background: 'transparent', color: 'currentColor', cursor: 'pointer',
        },
      },
      h('svg', {
        width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: '1.35', strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      h('path', { d: 'M8 2.2a3.6 3.6 0 0 1 3.6 3.6v2.1l1.1 1.9H3.3l1.1-1.9V5.8A3.6 3.6 0 0 1 8 2.2Z' }),
      h('path', { d: 'M6.4 12.1a1.7 1.7 0 0 0 3.2 0' })))
    }

    function SettingsRow(props) {
      const h = React.createElement
      return h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0' },
      },
      h('div', {},
        h('div', { style: { fontSize: '13px' } }, 'Уведомления'),
        h('div', { style: { color: 'rgba(244,244,245,0.6)', fontSize: '11px', marginTop: '2px' } },
          'Когда агент закончил работу')),
      h('button', {
        type: 'button',
        onClick: () => props.open(),
        style: { padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.16)', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '12px' },
      }, 'Настроить'))
    }

    function TurnWatcher(props) {
      const settings = useStore(props.store)
      React.useEffect(() => {
        const id = props.sessionId
        if (!id || !props.activeSessions) return
        props.activeSessions.add(id)
        if (props.ping) props.ping()
        return () => {
          props.activeSessions.delete(id)
          if (props.ping) props.ping()
        }
      }, [props.sessionId])
      const running = typeof props.useSession === 'function'
        ? props.useSession((session) => Boolean(session && session.running === true))
        : false
      const started = React.useRef(0)
      const latest = React.useRef(settings)
      latest.current = settings

      React.useEffect(() => {
        if (running) {
          started.current = Date.now()
          return
        }
        if (!started.current) return
        const elapsed = Date.now() - started.current
        started.current = 0
        const current = latest.current
        if (props.log) props.log.set({ items: [new Date().toLocaleTimeString() + ' ui финиш ' + Math.round(elapsed / 1000) + 'с', ...props.log.get().items].slice(0, 8) })
        if (!current.enabled || elapsed < current.thresholdMs) return
        const focused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' && document.hasFocus()
        if (current.quiet && focused) return
        const minutes = Math.max(1, Math.round(elapsed / 60000))
        showNotification('Задача выполнена', pageTitle() + ' · ' + minutes + ' мин')
        setBadge()
        if (current.sound) playSound(current.soundId, current.volume)
      }, [running])

      return null
    }

    return {
      name: 'chatium-notify-panel',
      inject: ['slots', 'sessions'],
      apply(ctx) {
        try {
          const settings = createStore(readSettings())
          settings.subscribe(() => writeSettings(settings.get()))

          const activeSessions = new Set()
          const apiBase = (() => { try { return new URL(document.baseURI).pathname.replace(/[/]+$/, '') } catch { return '' } })()
          const settingsUrl = apiBase + '/__notify-panel/settings'
          let saveTimer = null
          const pushSettings = () => {
            clearTimeout(saveTimer)
            saveTimer = setTimeout(() => {
              try {
                fetch(settingsUrl, {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(settings.get()),
                }).catch(() => {})
              } catch {}
            }, 250)
          }
          const server = { available: false }
          try {
            fetch(settingsUrl, { credentials: 'same-origin' })
              .then((response) => {
                server.available = response.ok
                return response.ok ? response.json() : null
              })
              .then((saved) => {
                if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
                  settings.set({ ...settings.get(), ...saved })
                }
              })
              .catch(() => { server.available = false })
          } catch {}
          settings.subscribe(pushSettings)

          const presenceUrl = apiBase + '/__notify-panel/presence'
          const postPresence = () => {
            try {
              fetch(presenceUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ focused: true, at: Date.now(), activeSessionId: [...activeSessions][0] || null }),
              }).catch(() => {})
            } catch {}
          }
          postPresence()
          setInterval(postPresence, 15000)
          window.addEventListener('focus', postPresence)
          window.addEventListener('blur', postPresence)
          document.addEventListener('visibilitychange', postPresence)
          window.addEventListener('pagehide', () => {
            try {
              navigator.sendBeacon(presenceUrl, JSON.stringify({ focused: false, at: Date.now(), activeSessionId: null }))
            } catch {}
          })

          window.addEventListener('focus', clearBadge)
          document.addEventListener('visibilitychange', () => { if (!document.hidden) clearBadge() })

          let lastApprovalKey = null
          setInterval(() => {
            try {
              const card = document.querySelector('[data-approval-key]')
              const key = card ? card.getAttribute('data-approval-key') : null
              if (!key) { lastApprovalKey = null; return }
              if (key === lastApprovalKey) return
              lastApprovalKey = key
              const current = settings.get()
              if (!current.enabled) return
              if (current.quiet && document.hasFocus()) return
              showNotification('Нужен ответ', pageTitle() + ' — агент ждёт подтверждения')
              setBadge()
              if (current.sound) playSound(current.soundId, current.volume)
            } catch {}
          }, 1500)

          const panel = createStore({ open: false })
          const log = createStore({ items: [] })
          const addLog = (text) => {
            const items = [new Date().toLocaleTimeString() + ' ' + text, ...log.get().items].slice(0, 8)
            log.set({ items })
          }
          const sessionRuns = new Map()
          const debug = { registered: [], failed: [] }
          try { window.__chatiumNotifyDebug = debug } catch {}

          const register = (slot, id, order, inject, component) => {
            try {
              ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, id, order, inject }, component))
              debug.registered.push(slot)
            } catch (error) {
              debug.failed.push(slot + ': ' + (error && error.message ? error.message : String(error)))
            }
          }

          register('conversation.session.header.utilities', 'notify-panel-button', 10,
            () => ({ open: () => panel.set({ open: true }) }), HeaderButton)
          register('shell.overlay', 'notify-panel', 46,
            () => ({ store: settings, panel, log }), Panel)
          register('conversation.input.overlay', 'notify-panel-turn', 81,
            (sessionId) => ({ store: settings, server, sessionId, activeSessions, log, ping: postPresence }), TurnWatcher)
          register('settings.general.item', 'notify-panel-settings', 61,
            () => ({ open: () => panel.set({ open: true }) }), SettingsRow)

          try {
            addLog('подписка: ' + typeof ctx.sessions?.list?.subscribe)
            const offSessions = ctx.sessions.list.subscribe(() => {
              const state = ctx.sessions.list.getSnapshot()
              if (!state || !state.ids) { addLog('нет снимка'); return }
              const now = Date.now()
              for (const id of state.ids || []) {
                const entry = state.byId ? state.byId[id] : null
                if (!entry) continue
                const run = sessionRuns.get(id)
                if (entry.running) {
                  if (!run) { sessionRuns.set(id, { startedAt: now }); addLog(id.slice(-6) + ' старт') }
                  continue
                }
                if (!run) continue
                sessionRuns.delete(id)
                const elapsed = now - run.startedAt
                const current = settings.get()
                addLog(id.slice(-6) + ' финиш ' + Math.round(elapsed / 1000) + 'с активна=' + activeSessions.has(id))
                if (activeSessions.has(id)) continue
                if (!current.enabled || elapsed < current.thresholdMs) continue
                const minutes = Math.max(1, Math.round(elapsed / 60000))
                const title = entry.displayTitle || entry.title || 'Chatium Code'
                showNotification('Задача выполнена', title + ' · ' + minutes + ' мин')
                setBadge()
                if (current.sound) playSound(current.soundId, current.volume)
              }
            })
            ctx.effect(() => offSessions, 'notify-panel: sessions watch')
          } catch (error) {
            addLog('ошибка подписки: ' + (error && error.message ? error.message : String(error)))
          }
          try {
            window.__chatiumNotifyPanel = () => settings.get()
          } catch {}
        } catch (error) {
          try { console.error('notify-panel: disabled after error', error) } catch {}
        }
      },
    }
  },
})
