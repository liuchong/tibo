# Tibo

Tibo 根据 Tibo（[@thsottiaux](https://x.com/thsottiaux)）的公开发言和历史公告，观察 Codex global 重置，并估计未来 24h / 48h 的重置概率。

它是独立应用：业务使用 Eliscript，运行与打包使用 Bun。CLI 和 MCP 直接调用核心，Lark 是独立的 IM 接入层。核心通过官方公开页面采集，不需要 API key，不加载外部运行库；构建需要 Eliscript 工具链。AI 辅助和 Lark 接入各自可选，直接调用 HTTP API，不使用供应商 SDK。

## 开始使用

开发环境需要 Bun 1.4+。`bun install` 会安装已发布的 [Eliscript npm 包](https://www.npmjs.com/package/eliscript)，不需要相邻源码仓库或 Emacs。

```bash
bun install
bun run build
bun run start -- help
bun run start -- posts --limit 5
bun run start -- forecast --no-ai
```

已安装的程序可这样使用：

```bash
~/.local/lib/tibo/tibo query '预测'
~/.local/lib/tibo/tibo query 'posts 2'
~/.local/lib/tibo/tibo query 'posts 2 |translate zh'
~/.local/lib/tibo/tibo pray
```

固定命令无需语义解析。翻译、自然语言提问和输入修复需单独启用对应 AI 功能。首次启动没有足够历史时不能生成概率；已有本地历史后可以离线计算。

## 阅读入口

完整目录见 [文档导航](docs/README.md)。代码组织与依赖方向见 [架构与模块](docs/architecture.md)。

| 你想做什么 | 阅读 |
| --- | --- |
| 从源码运行、打包、第一次查询 | [快速开始](docs/getting-started.md) |
| 查询概率、发言、历史与帮助 | [命令参考](docs/commands.md) |
| 查看原文、翻译、连续处理输出 | [语言与管道](docs/language-pipelines.md) |
| 自然聊天、引用回复与连续追问 | [基础聊天与引用对话](docs/chat.md) |
| 上香、查看档案、订阅私聊报告 | [上香与订阅](docs/pray-subscriptions.md) |
| 设置 AI、状态目录与接入凭据 | [配置参考](docs/configuration.md) |
| 安装、重装、重启后台服务 | [安装与运维](docs/operations.md) |
| 接入 MCP / Lark | [MCP](docs/mcp.md) / [Lark](docs/lark.md) |
| 普通群交互、操作群与报告订阅 | [会话接入与通知边界](docs/conversation-access.md) |
| 排查旧发言、AI 降级与投递问题 | [故障排查](docs/troubleshooting.md) |
| 理解算法、AI 策略或扩展程序 | [判断算法](docs/decision-contract.md) / [AI 任务](docs/ai-research.md) / [开发指南](docs/development.md) |

## 结果的含义

- **global**：服务方宣布的统一重置；公开公告不能证明你的个人账户已经生效。
- **banked**：需要用户手动使用的额度卡，不移动 global 时钟。
- **概率**：自有历史模型、承诺兑现估计与平滑先验，固定输出24h/48h整数百分比；AI理解原文，程序计算数值。计算细节见[数值预测](docs/numeric-forecast.md)。
- **发言**：保留原帖链接、核实状态与截断提示。主页、存档和已知帖子的原文核实都可能漏掉新帖。

AI 失败时保留可用的自有算法结果；来源不足时说明未知。上香是趣味功能，不改变概率。定时报告只有北京时间 **09:00 和 21:00** 两个时间点，每个定点生成一次，再发送给群和订阅者。此外，每五分钟监测新原帖，向有效订阅发送高概率/明确承诺预警与独立已重置确认，见 [实时通知](docs/realtime-alerts.md)。

公开资料支持 `search` 搜索并读取结果正文，或 `read-page URL` 直接读取网页；自然语言和引用追问共用同一能力。静态获取使用 Bun 原生接口，动态页面按需使用 WebView。见 [网页读取设计](docs/design/web-reading.md) 和 [运行条件](docs/operations.md#网页读取运行条件)。
