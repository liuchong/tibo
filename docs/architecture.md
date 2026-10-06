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
- ai 依赖 platform、evidence 与 forecast，提供可选的结构化任务及调整。证据校验与算法保持可独立运行。
- presentation 负责输出与文字处理；prayer 负责档案、角色和吉祥话；subscriptions 负责订阅、定点与共享报告。需要编排多个能力时，通过明确模块调用完成。
- commands 组合业务能力，并分离目录、固定解析、语义路由、执行和管理确认。app 负责进程入口和预测编排。
- im 提供跨平台触发规则；adapters/lark 实现平台身份认证、事件读取与投递。src 内的模块不能导入具体适配器。

部分上层模块会跨职责调用，例如共享定点报告使用 app/engine 和 presentation/business；这属于报告编排，不让订阅人数进入预测计算。模块依赖保持无环，不能为了方便在基础层反向调用命令入口。

`bun run check:architecture` 检查本地导入有效、模块名唯一、依赖无环以及上述基础层方向。它也检查命令、MCP 和 Lark 收件/广播路径不能依赖子进程或本地安装模块。实际模型输出不会调用进程的行为仍由运行测试验证，见 [执行边界](execution-boundary.md)。

## 查询与管道

1. app 或适配器取得实际输入和可信身份，调用 commands 的公共接口。
2. parser 处理固定命令；router 仅在需要时调用语义解析，catalog 统一校验参数和权限可见性。未知人工参数只修复当前失败片段。
3. execute 执行一次业务操作；管理员写操作由 admin 申请与确认，不进入文字管道。
4. presentation/pipeline 保存原始完整结果，依次运行文字步骤。syntax 只解析和校验，text 只处理文字，language 只确定语言与提示。
5. 步骤失败保留已经取得的结果，不从头重跑祈祷、订阅等有副作用的业务。

CLI、MCP 和 Lark 不维护三份命令实现。IM 身份从平台边界取得，不能由模型或消息正文构造。

## 采集与预测

app/engine 组织采集、标准化与判断。evidence 获取公开内容并保留核实等级；forecast 分析完成事件、条件承诺、banked 和历史间隔，结合信息完整度选用可用模型。AI 开启且可用时，ai/enhance 执行受校验的可选任务，再由经验与展示模块记录、输出结果。

没有模型服务或部分资料获取失败时，自有算法仍可运行；证据不足时明确返回未知，不填造概率。重组目录不改变概率规则、状态格式、固定推送时间、权限或模型能力。详细算法见 [判断约定](decision-contract.md)，可选任务见 [AI 资料与任务](ai-research.md)。

## 扩展与维护

新增能力放在其职责目录，不在 src 第一层重新堆积文件，也不创建收容各种业务的通用 helper。仅在一个模块有明确的独立职责时拆分，避免为每个小函数增加包装层。

新增 IM 实现放在 `adapters/<平台>/`，复用 commands、im 和 prayer 接口。新增命令先更新 catalog；新增管道先更新 syntax；新增 AI 任务进入 runtime 的固定任务机制。共用 fixture 在 `tests/helpers/fixture.mjs`，测试按职责分组，独立协议试用保持在 im 与 app 测试中。

目录或接口变动后运行架构检查和相关测试，再运行完整测试、编译独立程序并实际试用。影响已安装代码时按 [安装与运维](operations.md) 重装两个服务，保留配置与运行数据。
