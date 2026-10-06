# 开发指南

## 模块与目录

业务使用 Eliscript 的 `module`、`import` 和 `export`。每个 `.eli` 文件是一个模块，通过相对路径明确导入需要的符号；模块只导出调用方需要的接口。构建器保持相对目录结构生成 ESM，例如 `src/forecast/history.eli` 编译到 `dist/src/forecast/history.mjs`。目录层级不是命名空间访问语法，模块声明和实际导入路径各有用途。

| 目录 | 职责与主要入口 |
| --- | --- |
| `src/app/` | CLI、MCP、后台采集入口；engine 编排采集、算法和可选 AI |
| `src/commands/` | index 公共查询接口；catalog、parser、router、execute、help、admin 分别负责命令定义、固定解析、语义解析、执行、帮助和管理票据 |
| `src/forecast/` | 事件与信号、历史统计、模型、信息完整度、预测经验；不调用 AI 或 IM |
| `src/evidence/` | 采集、原文判定、HTML、受限搜索和资料校验；不依赖预测模型或 AI 网关 |
| `src/ai/` | runtime 任务网关、enhance 预测辅助、repair 人工输入修复 |
| `src/presentation/` | language 语言与提示、syntax 管道定义/解析、text 一次性文字处理、pipeline 顺序执行、business 业务展示、report 完整报告；index 提供共用文字接口 |
| `src/prayer/` | 祈祷档案、festivals 会话次数彩蛋与展示确认、wish 吉祥话、oracle 神谕、时事素材、oracle-context 话题/资料匹配、oracle-memory 会话避重与 material 祈祷素材 |
| `src/subscriptions/` | registry 本人订阅、schedule 固定定点、bulletin 共享报告 |
| `src/im/` | 多级触发与相关度、独立回复预算、匿名近期上下文和同会话事务 |
| `src/platform/` | 宿主、工具函数、配置、原子状态、transaction 同进程排队与跨进程锁等待、公开文本保护与本地安装管理 |
| `adapters/lark/` | Lark API、WebSocket、inbox-store 磁盘事件队列、inbox 有限缓存与并发工作任务、广播与投递 |
| `tests/` | 按职责组织的测试；共用 fixture 与协议入口在 helpers |

依赖方向、查询执行流程及新增代码的归属见 [架构与模块](architecture.md)。Bun 提供文件、HTTP、WebSocket、加密和宿主能力；JavaScript 只用于构建、架构检查、启动、打包和测试。没有模型或 IM SDK 运行依赖。

## 构建与测试

```bash
bun install
bun run check:architecture
bun run build
bun run test
bun run compile
```

工具链使用锁定的 Eliscript npm 发布包，安装不依赖本机其他仓库；路径覆盖只用于可选的编译器联调，见 [快速开始](getting-started.md)。`eliscript.json` 配置 CLI、MCP 和 Lark 三个入口，输出 dist；缓存由编译器管理。dist 是编译输出，不手工修改或提交。`.tibo` 是被 Git 忽略的本地目录，可能同时包含编译程序、试用状态、日志与验收证据；不能把整个目录当作可删除缓存。

`bun run test` 先检查模块依赖，再构建并运行测试。`check:architecture` 检查本地导入、模块名唯一、依赖无环、基础层方向与公开业务路径没有进程/安装能力；它是结构约束，不替代实际运行测试。

测试覆盖纯算法、来源解析、经验、AI 校验/冷却、管理员权限、语言管道/修复、CLI/MCP、状态并发、上香、订阅、daemon 与 Lark 协议。改算法时跑 `tests/forecast` 与 `tests/app/core.test.mjs`；改文字流程时跑 `tests/presentation` 与 `tests/commands/input-repair.test.mjs`；改接入时跑 `tests/im` 与 `tests/app/interfaces.test.mjs`，最后运行完整套件。

测试快照在 `tests/helpers/fixture.mjs`，都是人工数据，不是当前历史。可生成一份用于 CLI 的演示快照：

```bash
bun --eval 'import {snapshot} from "./tests/helpers/fixture.mjs"; await Bun.write(".tibo/example-snapshot.json", JSON.stringify(snapshot()));'
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

角色功能的触发、事实与娱乐边界、私有开关、缓存和验收见 [重置之神实现约定](oracle.md)。神谕不得增加管理能力或改动预测模型；祈祷吉祥话由 wish 独立控制，先记账、短预算生成、失败本地兜底，验证时要检查重复事件与实际回复。

公开业务面的模型执行能力以 [执行边界](execution-boundary.md) 为准：只选择固定方法与校验后的数据，不增加通用 shell、动态求值或任意路径工具。
