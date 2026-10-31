# 故障處理

| 現象 | 意義與下一步 |
| --- | --- |
| `doctor` 找不到唯一 executable | 開啟實際桌面 App；確認它使用的 bundled CLI，傳 `--codex-bin`。不要任選 PATH CLI |
| `applicable: false`，已有 route/provider | 保留現有設定並審查；新版不自動覆蓋其他 relay |
| `accountType` 不是 `chatgpt` | 在官方 App 以適用帳戶登入；不要把憑證貼給助手 |
| preflight 失敗 | 尚未切換全域設定；可能版本不支援、登入、限流、上游或網路有問題，不能只怪 WebSocket |
| `backend_verified_desktop_pending` | 後端已通過；桌面必須重啟並驗收既有聊天 |
| CLI 可用，但舊聊天仍顯示 WS 重連 | 檢查是否重開正確的 App、是否用同一 CODEX_HOME、是否該聊天用其他 provider，以及是否有不同配置覆寫 |
| 封存頁空白 | 先確認 provider 與原來一致、App 是否重啟；不可修改或刪除歷史。不是所有空白頁都是相同原因 |
| 健康檢查失敗 | 檢查 Node 路徑、使用者服務是否啟動、埠號是否被別的程序佔用；不殺未知程序 |
| `rolled_back_after_failure` | 原路由已保留/還原、服務已移除，備份保留。先看原因；需要重試可先 `uninstall` 再重新 setup |
| `recovery_required` | 停止自動覆蓋。保留 runtime、journal 與現有服務，對照目前設定/備份確認哪些變更屬於使用者 |
| 修改過 managed block | `rollback` 會拒絕覆寫。人工對照兩個路由欄位，保留其他編輯；不要整份復原舊 config |
| `.lock` 留下 | 前次操作可能仍在跑或被強制終止。查本機 lock 的 PID/時間與程序；只有確認已退出，才移除該操作 lock。不要直接刪所有 lock |
| HTTP 401 / 429 / timeout | 不一定是 transport 問題。401 查官方登入，429 等待額度/服務限制，timeout 查網路/上游；不要無限重試或關掉 TLS |
| Node/App 更新後出問題 | `status`、`verify --live`；不通過就 rollback，重啟並審查版本差異 |

## 私人檔案位置

預設 `CODEX_HOME` 是使用者的 `.codex` 資料夾。指定 `--codex-home` 時，所有管理命令都要保持一致。

- macOS：`~/Library/Application Support/codex-http-relay/<home-hash>/`
- Windows：`%LOCALAPPDATA%/codex-http-relay/<home-hash>/`
- 使用者服務名稱：`local.codex.http-relay.<home-hash>`
- runtime 內含 `install-state.json`、`config.original.toml`、`relay.mjs`；Windows 另有 `run-relay.ps1`。

`home-hash` 是設定資料夾路徑的 SHA-256 前 16 字元，只用於區分同機不同配置，不是加密。這些檔案應留在本機。`uninstall` 會將整個 runtime 改名保留，後綴 `.removed-UUID`。

如果安裝被強制終止，先讀 journal.stage 與目前 config 的管理區塊。可以安全還原時使用 `rollback`；不符合 guard 時先人工對照，避免把有效路由指向已停止的服務。不能確認狀態就明確回報，而不是刪除備份重試。

## 安全回報問題

公開回報提供 `node --version`、Codex 版本、OS、命令名稱與已去識別化錯誤即可。別貼出整份設定、聊天 ID、帳戶 ID、完整路徑、token 或原始日誌。包含這些資料的截圖也不要上傳。
