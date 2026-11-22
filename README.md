# dsh-plugin-gate

给 DeepSeek Harness 用的插件开关：按项目关掉不相关插件省上下文、把关键插件钉成常驻，并带一个设置在「插件」里的管理页签。

## 它解决什么

插件每多一个，工具定义就多占一份上下文。这个插件把「判断该关谁」交给技能 `plugin-gate`，把「真的关掉」交给宿主 `pluginManager`：

- **关 / 开**：调宿主 `pluginManager.setPluginEnabled(entryId, enabled)`，能热应用的立刻生效（`application: applied`），需要重启的会如实返回 `restart-required`。
- **白名单**：白名单里的插件不会被关，`disable` 直接返回 `skipped (always-on)`；状态存 `~/.dsh/plugin-gate/state.json`。
- **系统保护**：`@deepseek-ai/*` 与 `cordis:*` 是 DSH 自身，一律拒绝关闭；`dsh-plugin-gate` 不能关自己。
- **UI**：设置在「插件」分区多出「插件开关」页签，能看白名单、逐插件开关/钉住/看详情，以及最近活跃会话的工具调用次数。

## 安装

```bash
# 在本机 DSH 里
plugin_manager install_bundle target=file:/path/to/dsh-plugin-gate
```

刚装完插件会自动加载；客户端页签需要刷新页面（⌘R）。

## 工具

`plugin_gate`：

| action | 说明 |
| --- | --- |
| `status` | 当前打开/关闭数量 |
| `list` | 只列用户插件（系统模块只给计数） |
| `disable` / `enable` | 按包名、标题或 entry id 开关 |
| `whitelist_add` / `whitelist_remove` | 钉住 / 解除钉住 |

## 本地 API

- `GET /plugin-gate/api/overview` — `{ whitelist, plugins, systemCount, tools, self, sessionId }`
- `POST /plugin-gate/api/action` — `{ action, keys }`

只监听本机，没做鉴权；和 DSH 的 Web 服务同端口。

## 已知边界

- 「每个插件调用了几次」没有做：工具到插件的归属拿不到可靠字段，宁可空着也不编。
- 宿主自带的插件管理界面不受白名单约束，白名单只在 `plugin_gate` 这条路径上生效。
- 白名单只按名字匹配，不校验插件是否真的存在。

## 开发

```bash
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" --check lib/index.js
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" --check client.js
```

改完 `plugin_manager remove_bundle dsh-plugin-gate` 再 `install_bundle`，`file:` 依赖不会热更新代码。
