# 快速开始

## 从源码运行

需要 Bun 1.4+。构建工具链使用已发布的 `eliscript@0.0.1` npm 包，版本与校验信息由 `package.json` 和 `bun.lock` 固定。无需克隆 Eliscript 仓库、安排相邻目录或安装 Emacs。

在 `tibo` 仓库中执行：

```bash
bun install
bun run build
bun run start -- help
bun run start -- posts --limit 5
bun run start -- forecast --no-ai
```

`bun install` 从 registry 安装构建依赖；Eliscript 发布包自带编译器和运行支持。业务编译输出到 `dist/`。运行入口是 `bin/tibo.mjs`，Lark 入口是 `adapters/lark/start.mjs`。修改 `.eli` 文件后先重新构建，再运行入口。

构建器默认使用 `node_modules/eliscript` 中的发布工具链。只有联调编译器源码时才需要可选覆盖，例如 `ELISCRIPT_HOME=/编译器目录 bun run build`；这不会改变应用的 npm 依赖或要求特定目录布局。

从旧的本地 `file:` 依赖切换到发布包时，可执行 `bun install --force --frozen-lockfile` 重新安装，避免沿用同版本本地内容。自动化构建使用 `bun install --frozen-lockfile`，保持依赖与已提交锁文件一致。

## 第一次取数

联网查询会尝试读取 Tibo 主页、历史存档、官方状态页和官方新闻 RSS；对最近 48h 的最多 8 条已知帖子进一步请求 X 官方 oEmbed 核实原文。

```bash
bun run start -- posts --limit 5
bun run start -- status
bun run start -- forecast --no-ai
```

能核实原文不代表已经发现全部新帖。没有足够历史时，`status` 和 `posts` 仍可查询，预测会说明无法计算；至少需要 3 个可用的非观测 global 间隔。

默认状态目录是当前工作目录的 `.tibo/`，也可用 `TIBO_STATE_DIR` 指定。安装后统一使用私有配置中的状态目录。切换目录会切换历史、AI 缓存和个人档案，详见 [配置参考](configuration.md)。

## 常见交互

```bash
bun run start -- query 'forecast 24'
bun run start -- query 'posts 2'
bun run start -- query 'posts 2 |translate zh'
bun run start -- query 'posts 2 |ask 用两句话解释和重置有什么关系'
bun run start -- query '最近的两条发言是什么？'
```

前两条是固定命令。第三条需要 `translate`，第四条需要 `answer`，最后一条需要 `router`，跨语言展示还可能使用 `translate`。AI 默认由配置显式启用，核心预测可以完全不使用 AI。见 [AI 任务](ai-research.md) 与 [语言、管道](language-pipelines.md)。

## 编译为独立程序

```bash
bun run compile
.tibo/bin/tibo help
.tibo/bin/tibo-lark help
```

这会生成两个包含 Bun 运行时的可执行文件。生成后的程序运行不需要外部 Bun、Eliscript 编译器或供应商 SDK。自动后台安装目前只支持 macOS 用户服务；其他系统可自行管理 `tibo daemon` 进程。

安装步骤见 [安装与运维](operations.md)，MCP 配置见 [MCP 接入](mcp.md)。只使用 CLI 时不需要 Lark 应用。

## 离线与固定快照

已有历史可以离线计算：

```bash
bun run start -- forecast --offline
bun run start -- evaluate
```

离线模式不访问采集源，使用当前 UTC 时间和本地历史，预测 AI 不运行。`evaluate` 使用离线证据，输出模型回放和已积累的前瞻成绩，不把它当作新的实测预测。

用测试快照可以复现固定时间下的结果。下面生成的是人工测试数据，不是当前真实历史：

```bash
bun --eval 'import {snapshot} from "./tests/fixture.mjs"; await Bun.write(".tibo/example-snapshot.json", JSON.stringify(snapshot()));'
TIBO_CONFIG_FILE=/dev/null TIBO_STATE_DIR=.tibo/example-state TIBO_AI_FEATURES='' bun bin/tibo.mjs forecast --snapshot .tibo/example-snapshot.json
TIBO_CONFIG_FILE=/dev/null TIBO_STATE_DIR=.tibo/example-state TIBO_AI_FEATURES='' bun bin/tibo.mjs posts --snapshot .tibo/example-snapshot.json --limit 2
```

快照需含 `schemaVersion: 1`、`now`、`events`、`posts`、`sources`、`unknowns`。`now` 是证据时钟；事件带 `id/at/global/banked`，帖子带 `id/at/text/author`，作者必须为 `thsottiaux`。快照和离线运行不积累前瞻预测经验，但报告状态仍可保存；实验时使用独立的 `TIBO_STATE_DIR`，避免改变日常报告比较基准。

上述离线约束针对采集和预测。显式翻译、文字问答和语义路由有各自的 AI 开关；需要完全隔离模型调用时同时设 `TIBO_AI_FEATURES=''`。
