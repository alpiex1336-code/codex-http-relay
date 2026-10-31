# 工程依據與來源

調查日期：2026-10-31。以下是設計依據，不是 upstream 對本工具的認證。Issue 狀態與主分支會變動；工具以使用者實際版本的試跑作為安裝條件。

| 來源 | 用途 |
| --- | --- |
| [官方 config reference](https://learn.chatgpt.com/docs/config-file/config-reference) | 內建 `openai_base_url` 與使用者層級 provider 設定 |
| [官方 client.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs) | 426 → HTTP fallback 的客戶端處理分支 |
| [官方 model provider](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs) | 內建 provider 能力及 override 邊界 |
| [openai/codex #29156](https://github.com/openai/codex/issues/29156) | 既有桌面聊天 provider 綁定相關回報 |
| [openai/codex #24648](https://github.com/openai/codex/issues/24648) | `thread/list` 的預設 provider 篩選，`null` 與 `[]` 差異 |
| [openai/codex #27381](https://github.com/openai/codex/issues/27381) | 官方 HTTPS-only 選項需求 |
| [openai/codex #19821](https://github.com/openai/codex/issues/19821) | 重試與 fallback 時機；不同階段故障不能視為同一問題 |
| [openai/codex #34583](https://github.com/openai/codex/issues/34583) | 自建 CLI 與 macOS 原生能力相容性風險；避免替換 binary |
| [vekil 原作者文件](https://github.com/sozercan/vekil/blob/main/docs/responses-websocket.md) | 426 fallback 模式的另一個實作例；本工具沒有複製或安裝該專案 |
| [Node.js HTTP](https://nodejs.org/api/http.html) / [HTTPS](https://nodejs.org/api/https.html) | 標準串流、headers、TLS client |
| [Microsoft ScheduledTasks](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/register-scheduledtask) | Windows 使用者排程工作機制；文件不能代替實機測試 |

相依套件：[`smol-toml` 1.9.1](https://github.com/squirrelchat/smol-toml)，BSD-3-Clause，精確版本與 registry integrity 位於 `package-lock.json`。僅管理工具解析 TOML 使用；常駐 relay 不載入此套件。執行 `npm ci --ignore-scripts`，不執行套件安裝 scripts。

GitHub Actions 使用固定 commit 的官方 `actions/checkout` 與 `actions/setup-node`。CI 僅執行合成的離線測試，不含私人憑證、真實聊天、模型付費推論或桌面登入測試。
