# 架构与模块

Tibo 是一个独立应用。CLI、MCP 和 IM 共用业务能力，IM 接入放在 adapters 下。业务实现全部使用 Eliscript；目录按职责划分，不依赖相邻源码仓库，发布的编译器支持跨目录模块与 ESM 输出。

## 模块接口

每个 `.eli` 文件声明 module，通过 import 选择依赖，通过 export 暴露接口。未导出的辅助函数由该模块维护。目录移动时需要同步实际相对导入、构建入口、启动器和测试导入；仅修改 module 名称不会替代路径更新。

```lisp
(module tibo.example
  (import "../forecast/history.eli" summarize-history)
  (defun summarize (events now)
    (summarize-history events now))
  (export summarize))
```

构建配置的 sourceRoot 是项目根目录，以覆盖 src 和 adapters；CLI、MCP 和 Lark 是三个入口。构建输出保留目录层级，例如 `src/app/cli.eli` 对应 `dist/src/app/cli.mjs`。`bin/tibo.mjs` 和 `adapters/lark/start.mjs` 是薄启动器。dist 是生成物，不手工修改或提交。

统一查询接口是 `src/commands/index.eli`：固定解析、语义解析、执行、帮助及公开目录由这里导出。统一文字接口是 `src/presentation/index.eli`：语言、管道结构和文字处理由这里导出。目录内部实现直接导入所需的细分模块，避免通过公共入口反向引入自身。

## 职责与依赖方向

- platform 提供宿主、配置、状态、隐私与通用工具，不依赖上层业务。
- evidence 依赖 platform，负责发现、获取与证据判定。reset-text 是采集与信号分析共用的原文判定规则，不包含预测模型。
- forecast 依赖 platform 和 evidence，进行历史统计、信号分析与概率计算。它不依赖 AI、入口、命令、展示或 IM；experience 通过固定状态接口保存历史成绩。
- ai 依赖 platform、evidence 与 forecast，提供可选的结构化提取和解释任务，数值调整由 forecast 独立计算。证据校验与算法保持可独立运行。
- chat 只依赖 chat、ai 和 platform，提供跨接入方式的会话隔离、导入去重、追加提交、容量摘要与串行处理。它不解析平台原始事件，不读取平台 API，不生成平台回复参数。
- presentation 负责输出与文字处理；prayer 负责档案、角色和吉祥话；subscriptions 负责订阅、定点、共享报告及平台无关的实时通知。需要编排多个能力时，通过明确模块调用完成。
- capabilities 只依赖 evidence、platform 与自身，按需准备聊天所需的固定状态、搜索、计算和时间；模型不定义调用流程。
- commands 组合业务能力，并分离目录、固定解析、语义路由、执行和管理确认。app 负责进程入口和预测编排。
- im 提供跨平台触发规则；adapters/lark 实现平台身份认证、事件读取与投递。src 内的模块不能导入具体适配器。

部分上层模块会跨职责调用，例如共享定点报告使用 app/engine 和 presentation/business；这属于报告编排，不让订阅人数进入预测计算。模块依赖保持无环，不能为了方便在基础层反向调用命令入口。

`bun run check:architecture` 检查本地导入有效、模块名唯一、依赖无环以及上述基础层方向。它还约束 chat 的依赖层，并阻止平台专用的标识格式和事件/回复字段进入 chat。命令、MCP 和 Lark 收件/广播路径不能依赖子进程或本地安装模块。实际模型输出不会调用进程的行为仍由运行测试验证，见 [执行边界](execution-boundary.md)。

## 查询与管道

1. app 或适配器取得实际输入和可信身份，调用 commands 的公共接口。
2. parser 处理固定命令；router 仅在需要时调用语义解析，catalog 统一校验参数和权限可见性。未知人工参数只修复当前失败片段。
3. execute 执行一次业务操作；管理员写操作由 admin 申请与确认，不进入文字管道。
4. presentation/pipeline 保存原始完整结果，依次运行文字步骤。syntax 只解析和校验，text 只处理文字，language 只确定语言与提示。
5. 步骤失败保留已经取得的结果，不从头重跑祈祷、订阅等有副作用的业务。

CLI、MCP 和 Lark 不维护三份命令实现。IM 身份从平台边界取得，不能由模型或消息正文构造。

本群订阅使用独立的角色权限：Lark 的 authority 在申请及确认时读取当前群信息，向核心传入绑定接入应用、会话与操作者的已核实群角色。核心 im/authority 只校验这份身份和本群作用域，不依赖平台 API；commands/admin 复用限时确认单，仅允许该角色申请或确认本群订阅、退订，系统管理仍走原管理员白名单。新增 IM 时由各自适配器核实本平台角色，不能从用户文字或 AI 结果构造授权。

引用消息先识别本轮明确的业务意图；普通追问进入 ask 后，接入层再加载真实引用链，重新准备含历史的对话输入，不沿用只有本轮消息的路由准备结果。上香与订阅仍由任务组合独立执行，群角色读取不占用上香分支。

`presentation/chat` 承担了解应用背景的基础聊天，`presentation/text` 保留管道文字处理。`ai/conversation` 只接受 user/assistant 文字轮次，脱敏但不裁剪轮次；runtime 将历史作为原生 AI messages，并把历史纳入缓存身份。Lark 的 `thread` 模块按需读取平台话题或普通引用链，核对会话和当前发言人，排除无关消息，再由固定 reply API 延续引用关系。chat/store 按应用、会话和根消息保存脱敏的追加轮次；chat/memory 按容量单独摘要，再从摘要继续。只有确认发送后才提交 AI 轮次；未引用消息不建立会话。详见 [基础聊天与引用对话](chat.md)。

chat/budget 按总上下文计量，不限制单条正文字符数；chat/packing 在超窗时有限摘要，chat/archive 保存完整原文和虚拟文件目录。`context-read` 在既有一次只读资料准备中取回当前范围的原文，平台层不复制这套存储和容量逻辑。归档随持久会话保存，单轮请求的归档不会自动累积为会话，见 [固定设计](chat-context-design.md)。

## 采集与预测

app/engine 组织采集、标准化与判断。evidence 获取公开内容并保留核实等级；post-thread 在固定官方详情页补充有限的作者自回复，与主页发现共用短期缓存。forecast 分析完成事件、条件承诺、banked 和历史间隔，结合信息完整度选用可用模型；promise-history 按周期去重限时承诺、记录兑现状态和未知结果；promise-policy 在审计覆盖与样本精度足够时应用条件兑现估计，否则对有效限时承诺使用平滑数值估计。AI 开启且可用时，ai/enhance 执行受校验的可选任务，再由经验与展示模块记录、输出结果。

evidence/post-events 从独立原文和已核实的本人引用关系生成完成事实；forecast/signals 在任何基线、承诺、特征或状态计算前统一合并事件。省略对象的完成短句通过 post-context 补齐来源链，不能仅靠相邻发言或模型分类推进时钟。实时监测指纹包含引用关系，补齐关系立即重算；共享缓存与通知使用同一完成事件。

im/plan 将独立意图组织为任务组合，im/tasks 执行可嵌套的并发组和顺序链；例如上香与“分身回应 → 预测”并行。链的前置必须确认成功，分支完成即发送；平台账本、去重和引用投递由接入层负责。组合只由程序构造，AI 不生成任务，也不获得系统执行能力。详见 [IM 接入契约](im-adapters.md#触发策略与消息素材)。

app/forecast-cache 为交互预测提供两分钟共享结果，CLI、MCP 和所有 IM 复用同一核心。并发请求通过专用事务合并为一次采集与分析，其他调用等待其结果；每个调用取得独立副本，再按自己的语言、窗口、管道与会话发送。缓存不保存提问或身份，保留原采集时间，命中不新增采集、预测 AI 调用或训练样本。AI 与 no-AI 分开；已取得的新帖子/重置证据、经验、相关 AI 配置/冷却变化以及管理员清理会使缓存提前失效。离线、指定快照与定点报告跳过交互缓存。跨进程锁只协调这份预测生成，不阻塞上香、其他业务或 AI 网关；缓存损坏或无法保存时仍可生成新结果。

evidence/cache 在公开采集入口提供两分钟共享资料，供预测、发言和状态查询共同使用，也合并不同进程的并发采集；主页发现失败时只缓存 15 秒。完整核实原文存入 ledger，无自动过期，后续刷新只为发现新帖或重新核实变化、截断的正文。采集命中时来源和原文时间不变，新的观察时钟按当前时间推进。定点报告跳过预测结果缓存，但可以使用短期公开资料缓存。完整规则与诊断字段见 [公开资料与原文缓存](evidence-cache.md)。

evidence/post-context 提供计划和核实关系，八帖候选只限制单轮网络核实。evidence/dimensions 从全部永久原文构造六窗及资料窗；ai/dimensions 单次评分或本地降级；forecast/calendar 始终计算历史与日历曲线，forecast/dimensions 将未消耗分数和时间代入公式。day-plan 区分当日交付选择与完成，pacific-time 统一作者时区换算。

evidence/x-page 解析官方主页及单帖页面，区分引用文章与自身正文，不执行脚本；evidence/post-body 从官方单帖页补取长帖全文，核对作者、ID 与官方截断片段后保留原文等级。forecast/cycle 区分统一完成时钟、从公告起算的 7 天参考与未知的个人刷新日期；forecast/journal 保存每份真实报告的复盘，experience 仍单独保存不重叠训练样本。im/reactions 决定是否适合轻量表情，reply-policy 统一预留预算，Lark 的固定 react 方法完成发送；核心不依赖 Lark API。

没有模型或部分资料失败时，仍计算相同的时间基础层和本地发言分数，正常给出百分比。evidence/post-features 校验断言；forecast/features 管理消耗、过期和未知值，feature-log 保存独立前瞻日志。ai/post-features 与 feature-model 的独立研究接口保留，正式多维路径不逐批调用或自动拟合。没有经过审计的负窗口不训练，详见[固定设计](dimensional-forecast.md)。

evidence/reset-timing 校验作者态度、时间词、明写数字与时区，forecast/reset-timing 解析可核实的预期窗口。语义理解包含在单次多维提取中，不另请求概率；确定承诺和非确定时间预期分别管理。没有经过验证的一般消息系数时，不凭样本不足任意加分。

详细算法见 [判断约定](decision-contract.md)，可选任务见 [AI 资料与任务](ai-research.md)。

presentation/forecast-evidence 选择公开参考与必要理由，presentation/report 渲染唯一固定模板，business 复用此模板。CLI、MCP 和订阅生成不维护各自的报告版本；完整数据仍保留在本地 JSON 中。evidence/public-posts 为受限搜索核实固定官方 X 账户的补充原帖，不引入任意抓取或系统执行能力。报告约定见 [预测报告格式](forecast-report.md)。

`src/capabilities/` 负责一般聊天的信息准备：固定状态、搜索、计算和时间；不依赖 IM，不提供模型工具接口。

## 扩展与维护

新增能力放在其职责目录，不在 src 第一层重新堆积文件，也不创建收容各种业务的通用 helper。仅在一个模块有明确的独立职责时拆分，避免为每个小函数增加包装层。

新增 IM 实现放在 `adapters/<平台>/`，复用 commands、im 和 prayer 接口。新增命令先更新 catalog；新增管道先更新 syntax；新增 AI 任务进入 runtime 的固定任务机制。共用 fixture 在 `tests/helpers/fixture.mjs`，测试按职责分组，独立协议试用保持在 im 与 app 测试中。

目录或接口变动后运行架构检查和相关测试，再运行完整测试、编译独立程序并实际试用。影响已安装代码时按 [安装与运维](operations.md) 重装两个服务，保留配置与运行数据。
