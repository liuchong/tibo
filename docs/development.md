# 开发指南

## 分层与源码地图

业务代码在 `.eli` 文件中。Bun 提供文件、HTTP、WebSocket、加密和标准宿主能力；JavaScript 文件用于构建启动、打包和测试。没有模型或 IM SDK 运行依赖。

| 层 | 主要文件 | 职责 |
| --- | --- | --- |
| 命令与入口 | `src/commands.eli`、`cli.eli`、`mcp.eli` | 共用目录、解析、执行与不同传输输出 |
| 公开展示 | `presentation.eli`、`input-repair.eli`、`privacy.eli` | 语言、管道、人工修复、公开文本 |
| 采集与证据 | `sources.eli`、`transport.eli`、`html.eli`、`signals.eli` | 来源抓取、原文核实、历史类型与信号 |
| 预测与经验 | `engine.eli`、`history.eli`、`models.eli`、`forecast.eli`、`experience.eli`、`report.eli` | 统计、权重、预测窗口和报告 |
| 可选 AI | `ai-runtime.eli`、`ai.eli`、`research.eli`、`search.eli` | 任务网关、引用校验、资料与受限搜索 |
| 身份与状态 | `admin.eli`、`pray.eli`、`subscriptions.eli`、`state.eli` | 确认票据、本人业务、锁与原子写入 |
| 生命周期 | `daemon.eli`、`service.eli`、`schedule.eli`、`bulletin.eli` | 采集服务、安装、定点共享报告 |
| Lark 适配 | `adapters/lark/*.eli` | API、长连接协议、过滤、收件箱、广播与投递 |

基本流程是：入口解析 → 共用命令校验 → 核心采集/业务执行 → 可选文字处理 → 公开结果。预测内部是采集 → 标准化事件/信号 → 历史模型 → 可选 AI → 经验记录与报告。后台采集、手动查询和定点生成共用核心，但使用各自报告通道。

## 构建与测试

```bash
bun install
bun run build
bun run test
bun run compile
```

工具链使用锁定的 Eliscript npm 发布包，安装不依赖本机其他仓库；路径覆盖只用于可选的编译器联调，见 [快速开始](getting-started.md)。`eliscript.json` 配置 CLI、MCP 和 Lark 三个入口，输出 dist；缓存由编译器管理。dist 与 `.tibo` 是生成物，不手工修改或提交。

测试覆盖纯算法、来源解析、经验、AI 校验/冷却、管理员权限、语言管道/修复、CLI/MCP、状态并发、上香、订阅、daemon 与 Lark 协议。改算法时跑模型/核心/经验相关用例；改文字流程时跑 presentation/input-repair/CLI；改接入时跑接口与实际协议进程测试，最后运行完整套件。

测试快照在 `tests/fixture.mjs`，都是人工数据，不是当前历史。可生成一份用于 CLI 的演示快照：

```bash
bun --eval 'import {snapshot} from "./tests/fixture.mjs"; await Bun.write(".tibo/example-snapshot.json", JSON.stringify(snapshot()));'
TIBO_CONFIG_FILE=/dev/null TIBO_STATE_DIR=.tibo/example-state TIBO_AI_FEATURES='' bun bin/tibo.mjs forecast --snapshot .tibo/example-snapshot.json
```

明确区分证据层级：单元测试通过、协议模拟通过、独立二进制试用、后台安装成功、真实 IM 收发成功是不同结论。不要用 fixture 或 check 成功代替真实平台送达。

## 扩展命令或文字能力

命令目录是共用接口与模型提示词的来源。添加命令需同时明确参数、默认值、取值范围、位置参数、用途和权限，避免为 CLI、MCP、IM 写出不同业务实现。未知输入才做语义路由，正常固定命令不多一次 AI 分析。

添加管道需明确接收前序完整文本、输出长度、失败保留策略与副作用边界。修复只处理当前人工输入错误，不吞运行异常，不丢前序结果，不重复执行非幂等动作。管理员操作不能开放到管道或模型自动确认。

新 AI 任务应有独立开关、精简结构化输入/输出、校验、缓存和冷却。先说明它能提供什么新信息；没有可用证据或相关性时跳过。模型不写历史、不改核实级别，不能把格式校验当准确率证明。见 [AI 任务](ai-research.md)。

新增采集源需区分发现、原文、站点观测和获取/发布时间，结构失配显式降级；不能为了“总有结果”悄悄填旧数据或把搜索片段当原文。修改模型时同步更新 [算法约定](decision-contract.md)，保留回放与实际预测的不同证据含义。

新增 IM 遵守 [IM 接入契约](im-adapters.md)，不把核心变成某平台专用机器人。

## 交付与文档维护

文档按主题维护：命令变更更新 commands，配置变更更新 configuration，部署变更更新 operations；其他文档链接到对应规范，避免复制多份参数表。README 保持项目入口，docs/README 保持阅读导航。

交付前检查差异与实际命令输出、跑适合变更的测试，不提交私有配置、状态、日志、密钥或无关修改。代码影响已安装程序时重新 compile 并按 [运维步骤](operations.md) 安装，核对新进程和真实产出；仅文档变更不重启服务。维护已有订阅、确认票据和投递账本，不能重装时覆盖它们。

角色功能的触发、事实与娱乐边界、私有开关、缓存和验收见 [重置之神实现约定](oracle.md)。神谕不得增加管理能力或改动预测模型；祈祷吉祥话目前仅完成探针，不能在文档中描述为已上线。

公开业务面的模型执行能力以 [执行边界](execution-boundary.md) 为准：只选择固定方法与校验后的数据，不增加通用 shell、动态求值或任意路径工具。
