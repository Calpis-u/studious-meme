// dsh-plugin-gate — switch installed plugins on/off per project, with an
// always-on whitelist and a small Web UI (Settings → Plugins → 插件开关).
//
// Host side: one tool (`plugin_gate`), two HTTP routes for the settings tab,
// and a white list stored in ~/.dsh/plugin-gate/state.json.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'plugin-gate'
export const inject = ['tools', 'webServer']

const SELF = 'dsh-plugin-gate'
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const STATE_DIR = path.join(DSH_HOME, 'plugin-gate')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const DEBUG_LOG = path.join(STATE_DIR, 'debug.log')

function log(text) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${text}\n`)
  } catch {
    /* best effort */
  }
}

function normalize(raw) {
  const whitelist = Array.isArray(raw && raw.whitelist) ? raw.whitelist.filter((n) => typeof n === 'string' && n.trim()) : []
  const disabled = Array.isArray(raw && raw.disabled) ? raw.disabled.filter((n) => typeof n === 'string' && n.trim()) : []
  return { whitelist: [...new Set(whitelist.map((s) => s.trim()))], disabled: [...new Set(disabled.map((s) => s.trim()))] }
}

function readState() {
  try {
    return normalize(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')))
  } catch {
    return { whitelist: [], disabled: [] }
  }
}

function writeState(state) {
  const clean = normalize(state)
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(clean, null, 2)}\n`)
  return clean
}

function isSystem(moduleName) {
  return !moduleName || moduleName.startsWith('@deepseek-ai/') || moduleName.startsWith('cordis:')
}

function titleOf(entry) {
  const t = entry.meta && entry.meta.title
  return (typeof t === 'string' ? t : t && (t.zh || t.en)) || entry.moduleName
}

function managerOf(ctx) {
  try {
    return typeof ctx.get === 'function' ? ctx.get('pluginManager') : undefined
  } catch {
    return undefined
  }
}

async function userRows(manager) {
  const rows = await manager.listPlugins()
  return {
    systemCount: rows.filter((r) => isSystem(r.moduleName)).length,
    rows: rows
      .filter((r) => !isSystem(r.moduleName))
      .map((r) => ({
        id: r.entryId,
        module: r.moduleName,
        title: titleOf(r),
        enabled: r.enabled !== false,
        phase: r.fiberPhase ?? null,
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  }
}

function matchEntry(rows, key) {
  return (
    rows.find((r) => r.module === key) ||
    rows.find((r) => r.id === key) ||
    rows.find((r) => r.title === key) ||
    rows.find((r) => r.module.endsWith(`/${key}`)) ||
    rows.find((r) => r.title.toLowerCase() === String(key).toLowerCase())
  )
}

function json(res, code, value) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1e6) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

export function apply(ctx) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  if (!fs.existsSync(STATE_FILE)) writeState({ whitelist: [], disabled: [] })

  const usage = new Map()

  // Shared operation: toggle / whitelist mutations used by both tool and UI.
  async function operate(action, keys) {
    const state = readState()
    const manager = managerOf(ctx)
    if (!manager) throw new Error('pluginManager is not available in this context')
    const { rows } = await userRows(manager)
    const changed = []
    const skipped = []
    const result = { action, disabled: state.disabled, whitelist: state.whitelist, changed, skipped }

    if (action === 'enable' || action === 'disable') {
      for (const key of keys) {
        const row = matchEntry(rows, key)
        if (!row) {
          skipped.push(`${key} (not installed)`)
          continue
        }
        if (row.module === SELF) {
          skipped.push(`${key} (plugin-gate cannot disable itself)`)
          continue
        }
        if (action === 'disable' && state.whitelist.includes(row.module)) {
          skipped.push(`${key} (always-on)`)
          continue
        }
        const outcome = await manager.setPluginEnabled(row.id, action === 'enable')
        if (outcome && outcome.changed) {
          changed.push(row.module)
          const next = readState()
          next.disabled = action === 'disable' ? [...new Set([...next.disabled, row.module])] : next.disabled.filter((m) => m !== row.module)
          writeState(next)
          result.disabled = readState().disabled
        } else if (outcome && outcome.application === 'restart-required') {
          changed.push(`${row.module} (restart required)`)
        } else {
          skipped.push(`${key} (${outcome ? outcome.application : 'unchanged'})`)
        }
      }
    } else if (action === 'whitelist_add' || action === 'whitelist_remove') {
      for (const key of keys) {
        const row = matchEntry(rows, key)
        const target = row ? row.module : key
        if (action === 'whitelist_add') {
          if (!state.whitelist.includes(target)) {
            state.whitelist.push(target)
            changed.push(target)
          }
        } else if (state.whitelist.includes(target)) {
          state.whitelist = state.whitelist.filter((m) => m !== target)
          changed.push(target)
        }
      }
      writeState(state)
      result.whitelist = readState().whitelist
    } else {
      throw new Error(`unknown action "${action}"`)
    }
    if (changed.length) log(`ui/tool ${action} ${keys.join(',')} -> ${changed.join(',')}`)
    return result
  }

  // ---- Web UI routes -------------------------------------------------------
  try {
    const server = ctx.get('webServer')
    if (server) {
      ctx.effect(() =>
        server.register({
          kind: 'exact',
          path: '/plugin-gate/api/overview',
          handler: async (req, res) => {
            try {
              const manager = managerOf(ctx)
              if (!manager) return json(res, 503, { error: 'pluginManager unavailable' })
              const { rows, systemCount } = await userRows(manager)
              const state = readState()
              let best = null
              for (const [, m] of usage) {
                let last = 0
                for (const v of m.values()) last = Math.max(last, v.lastAt)
                if (!best || last > best.last) best = { last, m }
              }
              const tools = best
                ? [...best.m.entries()].map(([n, v]) => ({ name: n, count: v.count })).sort((a, b) => b.count - a.count)
                : []
              return json(res, 200, {
                whitelist: state.whitelist,
                plugins: rows.map((r) => ({ ...r, whitelist: state.whitelist.includes(r.module) })),
                systemCount,
                tools,
                self: SELF,
              })
            } catch (error) {
              log(`overview failed: ${error && error.message}`)
              return json(res, 500, { error: String(error && error.message) })
            }
          },
        }),
      )
      ctx.effect(() =>
        server.register({
          kind: 'exact',
          path: '/plugin-gate/api/action',
          handler: async (req, res) => {
            try {
              if ((req.method || 'GET').toUpperCase() !== 'POST') return json(res, 405, { error: 'POST only' })
              const body = await readBody(req)
              const action = String(body.action || '')
              const keys = Array.isArray(body.keys) ? body.keys.map(String).filter(Boolean) : []
              if (!keys.length) return json(res, 400, { error: 'keys required' })
              const result = await operate(action, keys)
              return json(res, 200, result)
            } catch (error) {
              log(`action failed: ${error && error.message}`)
              return json(res, 500, { error: String(error && error.message) })
            }
          },
        }),
      )
    } else {
      log('webServer unavailable; UI routes not registered')
    }
  } catch (error) {
    log(`route register failed: ${error && error.message}`)
  }

  // ---- Tool usage feed for the UI -----------------------------------------
  try {
    ctx.on('session/event', (session, event) => {
      if (!event || event.type !== 'tool/call') return
      const name = event.name || (event.data && event.data.name)
      if (!name) return
      const sid = (session && session.id) || 'unknown'
      let m = usage.get(sid)
      if (!m) {
        m = new Map()
        usage.set(sid, m)
      }
      const prev = m.get(name) || { count: 0, lastAt: 0 }
      m.set(name, { count: prev.count + 1, lastAt: Date.now() })
      while (usage.size > 40) usage.delete(usage.keys().next().value)
    })
  } catch (error) {
    log(`usage listener failed: ${error && error.message}`)
  }

  // ---- Agent tool ---------------------------------------------------------
  const definition = {
    name: 'plugin_gate',
    description:
      'Turn installed plugins on or off to save context tokens, and pin plugins that must always stay enabled. Use `list` before changing anything. Toggles go through the host plugin manager and apply live where possible.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'One of: status, list, disable, enable, whitelist_add, whitelist_remove.',
      },
      names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Plugin names (package name, title, or entry id). Required for disable/enable/whitelist_*; ignored by status/list.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string' },
          disabled: { type: 'array', items: { type: 'string' } },
          whitelist: { type: 'array', items: { type: 'string' } },
          changed: { type: 'array', items: { type: 'string' } },
          skipped: { type: 'array', items: { type: 'string' } },
          plugins: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string' }, enabled: { type: 'boolean' }, state: { type: 'string' } },
              required: ['name', 'enabled', 'state'],
            },
          },
          system: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['action', 'disabled', 'whitelist', 'changed', 'skipped', 'plugins'],
      },
      render: (_args, value) => {
        const lines = [`plugin_gate ${value.action}`]
        if (value.action === 'list') {
          const on = value.plugins.filter((p) => p.enabled).length
          lines.push(`your plugins: ${value.plugins.length} (on ${on} / off ${value.plugins.length - on})`)
          if (typeof value.system === 'number') lines.push(`DSH system rows hidden: ${value.system}`)
          for (const p of value.plugins) lines.push(`${p.enabled ? 'on ' : 'off'} ${p.name}${p.state === 'failed' ? ' (failed)' : ''}`)
        } else {
          lines.push(`off(${value.disabled.length}): ${value.disabled.join(', ') || '-'}`)
          lines.push(`always-on(${value.whitelist.length}): ${value.whitelist.join(', ') || '-'}`)
          if (value.changed.length) lines.push(`changed: ${value.changed.join(', ')}`)
          if (value.skipped.length) lines.push(`skipped: ${value.skipped.join(', ')}`)
        }
        if (value.note) lines.push(value.note)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const action = String((args && args.action) || 'status')
      const names = Array.isArray(args && args.names) ? args.names.map((n) => String(n).trim()).filter(Boolean) : []
      const state = readState()
      const manager = managerOf(ctx)
      const plugins = []
      let systemCount = 0
      let changed = []
      let skipped = []

      if (action === 'list' || action === 'disable' || action === 'enable') {
        if (!manager) throw new Error('pluginManager service is not available in this context')
        const { rows, systemCount: sys } = await userRows(manager)
        systemCount = sys
        for (const r of rows) plugins.push({ name: r.module, enabled: r.enabled, state: r.phase === 'failed' ? 'failed' : 'ok' })
        if (action !== 'list') {
          if (!names.length) throw new Error(`plugin_gate ${action} needs at least one plugin name`)
          const result = await operate(action, names)
          changed = result.changed
          skipped = result.skipped
        }
      } else if (action === 'status') {
        /* nothing to load */
      } else if (action === 'disable' || action === 'enable') {
        /* handled above */
      } else if (action === 'whitelist_add' || action === 'whitelist_remove') {
        if (!manager) throw new Error('pluginManager service is not available in this context')
        if (!names.length) throw new Error(`plugin_gate ${action} needs at least one plugin name`)
        const result = await operate(action, names)
        changed = result.changed
        skipped = result.skipped
      } else {
        throw new Error(`unknown plugin_gate action "${action}"`)
      }

      const next = readState()
      const out = {
        action,
        disabled: next.disabled,
        whitelist: next.whitelist,
        changed,
        skipped,
        plugins,
      }
      if (action === 'list') out.system = systemCount
      if (changed.length) out.note = 'applies live where the loader supports it'
      return out
    },
    presentCall(args) {
      return { card: 'generic', title: `plugin_gate ${args.action}`, kind: 'write', rawInput: args.action }
    },
  }

  try {
    ctx.tools.register(definition)
    log('tool registered: plugin_gate')
  } catch (error) {
    log(`tool register failed: ${error && error.message}`)
  }
}
