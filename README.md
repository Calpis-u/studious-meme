# dsh-plugin-gate

给 DeepSeek Harness（DSH）用的插件开关：按项目关掉不相关的插件省上下文，白名单里的插件常驻。

## 为什么

DSH 的每个已启用插件都会把工具定义塞进每一轮请求。工具多的插件（例如 agent-teams）单是工具定义就占 3 万 tokens 级的前缀。项目用不到的插件，关掉就是净省。

实测：关掉 `@nanmicoder/dsh-agent-teams` 后，新会话工具定义从 105 个 / 103406 字符降到 92 个 / 85967 字符，约省 4.8K tokens / 请求。

## 功能

- **插件开关**：按名字（包名 / 标题 / 入口 id）开启或关闭已装插件，热应用。
- **白名单**：钉住的插件不会被关闭，也不会被"智能判断"误关。
- **设置页**：DSH → 设置 → 插件 → 「插件开关」，可点开关、钉白名单、看入口 id / 运行阶段 / 本会话工具调用次数。
- **Agent 工具**：`plugin_gate`，action = status / list / disable / enable / whitelist_add / whitelist_remove。

保护规则：插件不能关自己；`@deepseek-ai/*` 与 `cordis:*` 属于 DSH 系统模块，不会出现在列表里也关不掉。

## 安装

```bash
plugin_manager install_bundle target=file:/path/to/dsh-plugin-gate
```

或把目录放进 profile 后：

```bash
pnpm --dir ~/.dsh/profiles/desktop add file:/path/to/dsh-plugin-gate
```

装完刷新页面（⌘R）就能在设置里看到页签。

## 状态文件

`~/.dsh/plugin-gate/state.json`

```json
{ "whitelist": ["dsh-plugin-gate"], "disabled": [] }
```

日志：`~/.dsh/plugin-gate/debug.log`

## 边界

- 只对当前 profile 生效。
- 需要重启才能生效的模块，工具会返回 `restart-required`。
- 关掉插件只移除它注册的工具，不会卸载文件。
