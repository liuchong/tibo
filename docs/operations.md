# 安装与运维

核心采集服务和 Lark 接入服务分别安装、重启与卸载。自动安装使用 macOS 当前登录用户的 LaunchAgent，不需要 root；注销、机器睡眠或断网会影响运行。其他系统自行用进程管理器运行 `tibo daemon` 和 `tibo-lark run`。

## 安装核心服务

在仓库中执行：

```bash
bun install
bun run service:install
~/.local/lib/tibo/tibo service status
~/.local/lib/tibo/tibo daemon-status
```

`service:install` 会构建并编译两个独立程序，再安装核心采集服务。不能用 `bun bin/tibo.mjs service install` 代替：安装要求当前入口已经是编译后的可执行文件。

安装补齐缺失配置，并保留已有设置。AI 功能键已存在时不会追加新功能；有意关闭的空值也会保留。只有缺少本地管理员 UID 时才补当前 UID。历史初始化只在目标不存在时复制来源的 `ledger.json` 与 `experience.json`，不会覆盖已有历史。

首次安装默认目录：

| 路径 | 用途 |
| --- | --- |
| `~/.local/lib/tibo/tibo` | 核心可执行文件 |
| `~/.local/lib/tibo/tibo-lark` | 单独安装 Lark 服务后使用的接入程序 |
| `~/.config/tibo/config.env` | 两个服务共享的私有配置，0600 |
| `~/.local/state/tibo/` | 默认应用状态目录，0700 |
| `~/Library/LaunchAgents/com.liuchong.tibo.plist` | 核心 LaunchAgent |
| `~/Library/LaunchAgents/com.liuchong.tibo.lark.plist` | Lark LaunchAgent |

日志固定在 `~/.local/state/tibo/daemon.stdout.log`、`daemon.stderr.log`、`lark.stdout.log`、`lark.stderr.log`。即使配置了其他 `TIBO_STATE_DIR`，安装器仍将 launchd 工作目录和日志放在上述固定目录；业务 JSON 状态使用配置的目录。

自定义配置路径需在安装时设置 `TIBO_CONFIG_FILE`，提前创建其父目录。安装会把该路径写入 plist，之后重启沿用；重新安装时也应指定同一个路径。

## 确认服务实际工作

```bash
~/.local/lib/tibo/tibo service status
~/.local/lib/tibo/tibo daemon-status
~/.local/lib/tibo/tibo diagnose
```

分三步判断：

1. `service status` 的 loaded 为 true，launchd 输出中有运行中的进程。
2. `daemon-status` 进入 ready，`finishedAt` 更新，且最近成功周期数增加。
3. 状态目录中的 `daemon-latest.json` 有最近成功报告，`diagnostics-daemon.json` 记录该次来源与 AI 使用情况。

仅 installed / loaded 不能证明采集成功。刚启动时 collecting 正常；首次耗时取决于网络。degraded 表示本轮失败，旧报告会保留，不能当作本轮结果。没有可用初始数据时不会编造概率。

daemon 启动立即采集，每轮结束后等待 `TIBO_DAEMON_INTERVAL`，默认 900 秒；这是完成后的间隔，实际启动时间不严格落在每个整刻钟。它不负责把每轮报告发送到群里。

## 更新与重装

在更新后的源码目录中执行：

```bash
bun install
bun run test
bun run service:install
~/.local/lib/tibo/tibo service status
~/.local/lib/tibo/tibo daemon-status
```

安装器等待旧服务注销，再原子替换可执行文件、写入 plist 并重新注册。已有配置、历史、经验、档案和投递记录保留。验证新进程已经运行，以及 `finishedAt` 和成功报告更新时间继续推进。

Lark 服务是另一份二进制，更新核心不等于更新它。已配置 Lark 时执行：

```bash
.tibo/bin/tibo-lark service install
~/.local/lib/tibo/tibo-lark service status
~/.local/lib/tibo/tibo-lark status
```

Lark 完整的首次配置与验收见 [接入文档](lark.md)。只修改文档不需要重装运行程序。

## 重启与卸载

修改共享配置后分别重启两个已安装服务：

```bash
~/.local/lib/tibo/tibo service restart
~/.local/lib/tibo/tibo-lark service restart
```

Lark 未安装时不要执行第二条。重启后重新检查实际运行状态；`daemon-status` 与 `tibo-lark status` 是本地最后状态，不能单独证明进程仍活着。

```bash
~/.local/lib/tibo/tibo-lark service uninstall
~/.local/lib/tibo/tibo service uninstall
```

卸载只停止对应服务并移除 plist，保留二进制、私有配置、历史与日志。launchd 配置了 KeepAlive，单纯 kill 进程可能自动拉起，停止服务应使用 uninstall。不要在同一状态目录同时启动两份核心 daemon 或两份 Lark；前台调试前先停止对应后台服务。

## 备份与恢复

操作前备份私有配置和整个实际状态目录；迁移或恢复前先停止会写它们的两个服务，避免复制出前后不一致的数据。备份包含凭据和用户状态，应保持私有权限，不提交到仓库。

危险命令确认后会先保存 `backup-ID.json`，里面的 `kind` 指明目标，`value` 是原状态。清空预测经验还备份 `forecastJournal`，并清空复盘且关闭旧定点报告重新导入；恢复时需把它单独恢复到 `forecast-journal.json`。失败或未知结果的票据不会自动重试。需要人工恢复时，先停服务、核对目标与当前状态，再把备份的 value 恢复到对应文件；保留原文件和票据作为证据，恢复后重新验收。不要把整个备份包装直接覆盖为 ledger 或 ai 状态。

不要用删除 `ai.json`、确认票据或投递账本解决不明故障。AI 冷却恢复使用管理员 `reset-ai` 申请、固定确认流程。锁只在能确认原 PID 已不存在时自动回收；无法确认所有者时应检查进程，不盲删锁。

具体故障检查见 [故障排查](troubleshooting.md)，变量与优先级见 [配置参考](configuration.md)。
