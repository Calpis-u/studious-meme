window.__ModuleLoader__.load({
  id: 'dsh-plugin-gate',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/plugin-gate/api'

    const css = `
      .pg-wrap { padding: 4px 2px 24px; font-size: 13px; }
      .pg-head { display:flex; align-items:baseline; gap:10px; margin-bottom:14px; flex-wrap:wrap; }
      .pg-title { font-size:15px; font-weight:600; }
      .pg-dim { opacity:.6; }
      .pg-btn { border:1px solid rgba(127,127,127,.35); background:transparent; color:inherit;
        border-radius:6px; padding:3px 9px; font-size:12px; cursor:pointer; }
      .pg-btn:hover { background:rgba(127,127,127,.12); }
      .pg-btn[disabled] { opacity:.4; cursor:default; }
      .pg-chip { display:inline-flex; align-items:center; gap:6px; border:1px solid rgba(127,127,127,.35);
        border-radius:999px; padding:2px 10px; font-size:12px; margin:0 6px 6px 0; }
      .pg-chip b { font-weight:500; }
      .pg-chip button { border:0; background:transparent; color:inherit; opacity:.55; cursor:pointer; padding:0 0 0 2px; }
      .pg-row { border-bottom:1px solid rgba(127,127,127,.16); padding:8px 2px; }
      .pg-line { display:flex; align-items:center; gap:10px; }
      .pg-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pg-mod { font-size:11px; opacity:.5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pg-detail { margin:8px 0 2px 2px; font-size:12px; opacity:.8; line-height:1.7; }
      .pg-detail code { font-size:11px; opacity:.8; }
      .pg-pin { border:1px dashed rgba(127,127,127,.45); background:transparent; color:inherit;
        border-radius:6px; padding:2px 8px; font-size:11px; cursor:pointer; opacity:.75; }
      .pg-pin.on { border-style:solid; opacity:1; background:rgba(120,170,255,.14); }
      .pg-sec { margin:18px 0 8px; font-size:13px; font-weight:600; }
      .pg-empty { opacity:.55; padding:6px 2px; }
      .pg-tool { display:flex; justify-content:space-between; padding:4px 2px; font-size:12px; }
      .pg-err { color:#d4574e; padding:8px 0; }
      .pg-input { border:1px solid rgba(127,127,127,.35); background:transparent; color:inherit;
        border-radius:6px; padding:4px 8px; font-size:12px; min-width:200px; }
    `

    function Styles() {
      return h('style', { 'data-plugin-gate': '' }, css)
    }

    async function api(path, init) {
      const res = await fetch(API + path, init)
      if (!res.ok) {
        let msg = res.statusText
        try {
          const body = await res.json()
          if (body && body.error) msg = body.error
        } catch {}
        throw new Error(msg)
      }
      return res.json()
    }

    function GateTab() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [open, setOpen] = React.useState({})
      const [adding, setAdding] = React.useState('')

      const load = React.useCallback(async () => {
        try {
          setData(await api('/overview'))
          setError('')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        }
      }, [])

      React.useEffect(() => {
        load()
        const timer = setInterval(load, 8000)
        return () => clearInterval(timer)
      }, [load])

      const act = async (action, keys) => {
        setBusy(action + ':' + keys.join(','))
        try {
          await api('/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, keys }),
          })
          await load()
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setBusy('')
        }
      }

      if (!data) return h('div', { className: 'pg-wrap' }, h(Styles), error ? h('div', { className: 'pg-err' }, error) : h('div', { className: 'pg-empty' }, '加载中…'))

      const on = data.plugins.filter((p) => p.enabled).length
      const list = data.plugins
      const choices = list.filter((p) => !data.whitelist.includes(p.module))

      return h(
        'div',
        { className: 'pg-wrap' },
        h(Styles),
        h(
          'div',
          { className: 'pg-head' },
          h('div', { className: 'pg-title' }, '插件开关'),
          h('div', { className: 'pg-dim' }, `已装 ${list.length} 个 · 开启 ${on} · 关闭 ${list.length - on} · 系统模块 ${data.systemCount} 已隐藏`),
          h('button', { className: 'pg-btn', onClick: load }, '刷新'),
        ),
        error ? h('div', { className: 'pg-err' }, error) : null,
        h('div', { className: 'pg-sec' }, '常驻白名单'),
        h(
          'div',
          null,
          data.whitelist.length
            ? data.whitelist.map((m) =>
                h(
                  'span',
                  { className: 'pg-chip', key: m },
                  h('b', null, m),
                  h('button', { title: '移出白名单', onClick: () => act('whitelist_remove', [m]) }, '×'),
                ),
              )
            : h('div', { className: 'pg-empty' }, '还没有常驻插件。白名单里的插件不会被关闭。'),
        ),
        h(
          'div',
          { style: { marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('input', {
            className: 'pg-input',
            placeholder: '输入插件名（模块名或标题）',
            value: adding,
            onChange: (e) => setAdding(e.target.value),
            list: 'plugin-gate-names',
          }),
          h(
            'datalist',
            { id: 'plugin-gate-names' },
            choices.map((p) => h('option', { key: p.module, value: p.module }, p.title)),
          ),
          h(
            'button',
            {
              className: 'pg-btn',
              disabled: !adding.trim(),
              onClick: () => {
                act('whitelist_add', [adding.trim()]).then(() => setAdding(''))
              },
            },
            '加白名单',
          ),
        ),
        h('div', { className: 'pg-sec' }, '插件'),
        list.length === 0 ? h('div', { className: 'pg-empty' }, '没有可显示的插件。') : null,
        list.map((p) => {
          const isOpen = Boolean(open[p.module])
          const pinned = p.whitelist
          return h(
            'div',
            { className: 'pg-row', key: p.module },
            h(
              'div',
              { className: 'pg-line' },
              h('span', { className: 'pg-name', title: p.module }, p.title),
              h('span', { className: 'pg-dim', style: { fontSize: 11 } }, p.enabled ? 'on' : 'off'),
              h(
                'button',
                { className: 'pg-pin' + (pinned ? ' on' : ''), onClick: () => act(pinned ? 'whitelist_remove' : 'whitelist_add', [p.module]) },
                pinned ? '常驻' : '钉住',
              ),
              h(
                'button',
                {
                  className: 'pg-btn',
                  disabled: p.module === data.self || busy.startsWith('disable') || busy.startsWith('enable'),
                  onClick: () => act(p.enabled ? 'disable' : 'enable', [p.module]),
                },
                p.enabled ? '关闭' : '开启',
              ),
              h('button', { className: 'pg-btn', onClick: () => setOpen((s) => Object.assign({}, s, { [p.module]: !isOpen })) }, isOpen ? '收起' : '详情'),
            ),
            h('div', { className: 'pg-mod' }, p.module),
            isOpen
              ? h(
                  'div',
                  { className: 'pg-detail' },
                  h('div', null, '入口 id：', h('code', null, p.id || '—')),
                  h('div', null, '运行阶段：', p.phase || 'unknown'),
                  h('div', null, '白名单：', pinned ? '是（不会被关闭）' : '否'),
                  h('div', null, '能否关闭：', p.module === data.self ? '否，插件自己不能关自己' : '可以'),
                )
              : null,
          )
        }),
        h('div', { className: 'pg-sec' }, '本会话工具用量'),
        data.tools.length
          ? data.tools.map((t) => h('div', { className: 'pg-tool', key: t.name }, h('span', null, t.name), h('span', { className: 'pg-dim' }, `× ${t.count}`)))
          : h('div', { className: 'pg-empty' }, '当前还没有工具调用记录。'),
        h('div', { className: 'pg-dim', style: { marginTop: 14, fontSize: 11 } }, '关闭插件会移除它注册的工具，下一轮请求立即少掉这些定义。'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.plugins.tab', () =>
          ctx.slots.register({ name: 'settings.plugins.tab', id: 'gate', order: 30, label: '插件开关' }, GateTab),
        )
      },
    }
  },
})
