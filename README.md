# Tibo

Tibo 根据 Tibo（[@thsottiaux](https://x.com/thsottiaux)）的公开发言和历史公告，观察 Codex global 重置，并估计未来 24h / 48h 的重置概率。

它是独立应用：业务使用 Eliscript，运行与打包使用 Bun。CLI 和 MCP 直接调用核心，Lark 是独立的 IM 接入层。核心不需要 API key，不加载第三方运行库；构建需要 Eliscript 工具链。AI 辅助和 Lark 接入各自可选，直接调用 HTTP API，不使用供应商 SDK。

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

完整目录见 [文档导航](docs/README.md)。

| 你想做什么 | 阅读 |
| --- | --- |
| 从源码运行、打包、第一次查询 | [快速开始](docs/getting-started.md) |
| 查询概率、发言、历史与帮助 | [命令参考](docs/commands.md) |
| 查看原文、翻译、连续处理输出 | [语言与管道](docs/language-pipelines.md) |
| 上香、查看档案、订阅私聊报告 | [上香与订阅](docs/pray-subscriptions.md) |
| 设置 AI、状态目录与接入凭据 | [配置参考](docs/configuration.md) |
| 安装、重装、重启后台服务 | [安装与运维](docs/operations.md) |
| 接入 MCP / Lark | [MCP](docs/mcp.md) / [Lark](docs/lark.md) |
| 排查旧发言、AI 降级与投递问题 | [故障排查](docs/troubleshooting.md) |
| 理解算法、AI 策略或扩展程序 | [判断算法](docs/decision-contract.md) / [AI 任务](docs/ai-research.md) / [开发指南](docs/development.md) |

## 结果的含义

- **global**：服务方宣布的统一重置；公开公告不能证明你的个人账户已经生效。
- **banked**：需要用户手动使用的额度卡，不移动 global 时钟。
- **概率**：历史估计加可选 AI 建议，尚未充分校准。当前概率置信度保持低，承诺的证据强度另列。
- **发言**：保留原帖链接、核实状态与截断提示。主页、存档和已知帖子的原文核实都可能漏掉新帖。

AI 失败时保留可用的自有算法结果；来源不足时说明未知。上香是趣味功能，不改变概率。定时报告只有北京时间 **09:00 和 21:00** 两个时间点，每个定点生成一次，再发送给群和订阅者。
