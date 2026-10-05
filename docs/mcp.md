# MCP 接入

MCP 使用核心应用的 stdio 入口，不需要 Lark，也不授予客户端可信个人身份。配置、采集源与 AI 开关仍从应用配置读取。

## 客户端配置

安装完成后，在支持 stdio MCP 的客户端配置中加入：

```json
{
  "mcpServers": {
    "tibo": {
      "command": "/绝对路径/.local/lib/tibo/tibo",
      "args": ["mcp"]
    }
  }
}
```

将 command 替换为实际用户目录下的完整路径，不能指望客户端展开 `~`。不必在客户端配置里重复保存 API key；程序读取私有配置。需要与日常安装隔离时，可以通过客户端 env 设置 `TIBO_CONFIG_FILE` 与 `TIBO_STATE_DIR`。

源码调试先 `bun run build`，再将 command 设为 Bun 的绝对路径，args 设为本仓库 `bin/tibo.mjs` 的绝对路径和 `mcp`。不要把工作目录默认值当成固定状态目录。

## 五个工具

| 工具 | 参数 | 结果 |
| --- | --- | --- |
| `codex_reset_forecast` | `noAi` boolean，默认 false | 适合展示的预测文本 |
| `codex_reset_status` | `since` 可选 UTC ISO 时间 | 最新 global、证据状态、指定时间后的变化；个人账户状态仍 unknown |
| `codex_reset_history` | `offset` 非负整数默认 0；`limit` 1..100 默认 50 | 公告历史分页与总数 |
| `tibo_query` | `command` 目录中的业务命令；`args` 参数对象 | 执行结构化固定查询 |
| `tibo_ask` | `question` 字符串，≤2400 字符 | 固定指令、语义查询及最多三步文字管道 |

例如 `tibo_query` 的参数：

```json
{"command":"posts","args":{"limit":2,"hours":48}}
```

`tibo_ask` 可传 `posts 2 |translate zh`。基础查询及问答指令仍各受 800 字符限制，2400 是整条输入上限，不是单个任意问题上限。是否使用 router、translate、answer 取决于实际请求和功能开关。

## 权限与 AI 边界

客户端不能传入可信 actor 或管理员上下文。危险管理命令不在 MCP 可用目录中；上香和订阅没有可信本人身份，返回身份要求，不建立档案或订阅。

MCP 不启用“人工错误输入修复”：结构化参数错误、未知管道或语言参数不会自动调用 repair；语义路由和已明确支持的文字管道仍可显式使用。不要把 MCP 调用伪装成 humanInput 来放宽内部错误处理。

MCP 返回业务结果和安全的简短错误，不开放本地 diagnose、服务管理、密钥、目录、系统用户或模型配置。业务查询可能采集并保存历史、AI 缓存和预测经验，所以“没有危险写工具”不意味着完全不写本地缓存。

## 传输与调试

当前实现使用逐行 JSON-RPC，初始化响应中的协议版本为 `2025-11-25`。先发送 initialize，再发送 `notifications/initialized`，之后可 tools/list 与 tools/call。stdout 保持协议输出；客户端应单独保存 stderr。

最多保留 32 个在途请求，按队列串行处理，单条消息上限 1 MiB；重复请求 ID 会拒绝。取消请求不应被当作已回滚业务动作，某些进行中的工作可能已经完成。

测试固定证据可设置 `TIBO_SNAPSHOT`，搭配独立状态目录与关闭的 AI；这是测试机制，不用于 Lark 实际投递。构建与接口测试步骤见 [开发指南](development.md)。
