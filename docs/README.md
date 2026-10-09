# 文档导航

按使用、部署、原理与开发组织文档。第一次使用从快速开始进入；维护已有安装从安装与运维进入。本文只负责导航，命令参数、配置和算法分别在对应文档中维护。

## 使用应用

1. [快速开始](getting-started.md)：源码运行、独立可执行文件、首次数据采集与离线复现。
2. [命令参考](commands.md)：固定命令、语义提问、CLI 参数、管理员操作。
3. [语言与管道](language-pipelines.md)：原文、语言识别、翻译、一次性问答、错误输入修复。
4. [上香与订阅](pray-subscriptions.md)：可信身份、功德档案、榜单、固定时间私聊报告。
5. [集体彩蛋庆典](collective-celebrations.md)：六级大场面、18 套随机保底、可选祝词和分条投递。
6. [预测报告格式](forecast-report.md)：固定模板、参考消息筛选、简短理由与信息不足时的写法。
7. [基础聊天与引用对话](chat.md)：单轮聊天、Lark 引用链、多轮历史和边界。

## 配置、部署与接入

- [配置参考](configuration.md)：配置优先级、全部支持的设置、状态目录。
- [安装与运维](operations.md)：macOS 两个后台服务的安装、更新、重启、卸载和验收。
- [MCP 接入](mcp.md)：客户端配置、五个工具、stdio 协议与权限边界。
- [Lark 接入](lark.md)：应用能力、事件权限、群白名单、长连接和实际收发验收。
- [会话接入与通知边界](conversation-access.md)：普通群 `all`、独立操作群、个人与群订阅、配置和确认。
- [故障排查](troubleshooting.md)：根据本地证据区分采集、模型、进程与投递故障。

## 原理与开发

- [判断算法与证据约定](decision-contract.md)：global/banked、条件样本、四个候选模型、自适应权重与局限。
- [AI 任务与预算](ai-research.md)：任务开关、引用校验、搜索、缓存、熔断和隐私。
- [重置之神实现约定](oracle.md)：分身回应、品牌彩蛋、官方时事与祈祷吉祥话。
- [架构与模块](architecture.md)：目录职责、依赖方向、公共接口与执行流程。
- [开发指南](development.md)：源码地图、构建测试、命令扩展与交付检查。
- [AI 与执行边界](execution-boundary.md)：固定业务方法、本地维护、管理确认与无任意执行接口。
- [IM 触发与回复节奏](im-triggers.md)：关键词相关度、独立群/个人预算、匿名近期上下文与祈祷素材。
- [IM 接入契约](im-adapters.md)：可信上下文、人工输入修复、订阅与共享报告，适用于后续其他 IM。

## 查找具体问题

| 问题 | 入口 |
| --- | --- |
| `query 'posts 2'` 与语义查询为何输出不同 | [语言规则](language-pipelines.md#原文与回复语言) |
| `|翻译` 或语言名称不认识怎么办 | [输入修复](language-pipelines.md#错误输入的-ai-修复) |
| CLI 如何传上香身份 | [CLI 上香](pray-subscriptions.md#cli-上香与档案) |
| 如何关闭 AI、为什么私有配置没有生效 | [配置优先级](configuration.md#配置读取与优先级) |
| 安装成功是否代表正在产出报告 | [安装验收](operations.md#确认服务实际工作) |
| 最新发言与 AI 输入是否一致 | [发言与采集](troubleshooting.md#发言不够新或条数不足) |
| 如何确认 Lark 真正发出消息 | [实际接入验收](lark.md#实际接入验收) |
| 刚重置与七天自动刷新如何区分、怎样复盘真实预测 | [重置时钟与实际复盘](troubleshooting.md#重置时钟与实际复盘) |
| 为什么关键词只回表情、如何避免刷屏 | [三级与轻量表情](im-triggers.md#三级低优先级与轻量表情) |

文档示例中 `tibo` 指已安装的 `~/.local/lib/tibo/tibo`，`tibo-lark` 指同目录下的 Lark 可执行文件；源码运行可以分别替换为 `bun bin/tibo.mjs` 和 `bun adapters/lark/start.mjs`。固定的安装路径在运维文档中写出。
