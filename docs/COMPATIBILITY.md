# 相容性

這個 workaround 依賴三個實際條件：官方客戶端允許內建 `openai_base_url` 覆寫；WebSocket 握手 426 能觸發 HTTP fallback；帳戶的官方 HTTP endpoint 可正常回覆。任何一項不成立，應停止安裝。

| 平台/情況 | 處理 |
| --- | --- |
| macOS 原生桌面 + ChatGPT 登入 | 已有原始個案的正式桌面驗證；新安裝仍必須試跑 |
| Windows 原生桌面 + ChatGPT 登入 | 實驗支援；提供 PowerShell Scheduled Task，無真實 Windows 桌面成功證據 |
| WSL | 不替 Windows 桌面安裝；請在 Windows 原生終端機執行 |
| Linux | 不提供自動服務安裝；CI 測試不能當成桌面支援 |
| API key / Azure / 第三方模型服務 | 不支援此固定 ChatGPT endpoint 路徑 |
| 已有 relay / custom provider / profile 路由 | 不自動接管；避免覆蓋有效設定或隱藏聊天 |
| 公司管理政策、特定 HTTP proxy | 需獨立查核；不要繞過安全政策 |
| 舊/未來 Codex 版本 | 以當地 preflight 判斷；沒有永遠有效的版本保證 |

原始已驗證桌面版本：macOS App `26.1027.30824`（build `22943`），官方 bundled CLI `0.166.0-alpha.5.1`。保留內建 provider 後，既有聊天 HTTP、封存 UI、原生生圖各有個別證據。這些結果來自單一使用環境，不等同完整功能矩陣。

Node 最低 24，維護時使用 24.14.0。新版 Node 的 SQLite API 可能改變，因此 `desktop-evidence` 是可選證據工具，失敗時不應改成憑空通過。常駐 relay 只用標準 HTTP/HTTPS 功能。

macOS 使用登入使用者的 LaunchAgent；Windows 使用 Interactive/Limited Scheduled Task。需在有桌面登入的使用者工作階段執行。Node 路徑由安裝時固定；刪除或移動它會令服務無法啟動。Windows Task Scheduler 或 PowerShell 受政策限制時，安裝應失敗還原，不要求放寬政策。

原個案的舊版私人工具使用不同 runtime 名稱。新版 `doctor` 會把那類既有端點視為衝突，不會自動遷移。這是保護已有效安裝的預期行為。
