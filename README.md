# Codex HTTP Relay

讓特定的 Codex WebSocket 重連問題改走 HTTP/SSE 的本機轉接工具。保留內建 `openai` provider，包含相容性檢查、設定備份、使用者常駐服務、真實服務試跑與還原。

**這是非官方 workaround，並非「所有 Reconnecting 都能修好」的保證。** 它避開遠端 Responses WebSocket 路徑；HTTP 仍可能遇到斷網、401、429、服務中斷或逾時。適用於使用 ChatGPT 帳戶登入的官方 Codex；API key、自訂 provider 與複雜路由設定會停止自動安裝。

## 直接交給 AI 助手

複製這段給有本機檔案與終端機操作能力的 AI 助手：

> 請將 https://github.com/alpiex1336-code/codex-http-relay clone 到新的獨立資料夾，先閱讀 AGENTS.md 和 INSTALL_FOR_AGENTS.md，再檢查我的 Codex WebSocket 重連問題是否適用此 workaround。若適用，執行測試與包含真實帳戶試跑的安裝，失敗就安全還原。保留原本 provider 與聊天紀錄，不要替換官方 App。只有實際需要我重啟 App、登入、選擇多個安裝版本或處理不可自動判定的衝突時才停下說明。不要把 CLI 通過當成既有桌面聊天已修好，也不要承諾永久不會斷線。

AI 可以完成檢查、安裝、後端試跑與一般失敗還原。**App 必須重啟才能載入設定；若助手正在該 App 裡工作，應由使用者在工作儲存後重啟，再繼續驗收。** 這是實際邊界，不能用「一鍵」字眼隱藏。

## 原理

```text
官方 Codex（provider 仍為 openai）
    │ 嘗試 WebSocket
    ▼
127.0.0.1 本機 relay 回傳 426
    │ 官方客戶端採用既有 HTTP fallback
    ▼
HTTP/SSE → 本機 relay → 經憑證驗證的 HTTPS → chatgpt.com
```

[`openai_base_url`](https://learn.chatgpt.com/docs/config-file/config-reference) 是內建 provider 的端點覆寫設定。426 fallback 可在[官方客戶端原始碼](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs)查到；**每台電腦仍須用其實際安裝版本通過試跑**，不能只依賴 `main` 分支的行為。

保留 provider 身分，是為了避免自訂別名造成既有聊天沿用舊 provider，以及預設清單按 provider 篩選的問題。這些現象有[既有聊天回報](https://github.com/openai/codex/issues/29156)與[歷史清單回報](https://github.com/openai/codex/issues/24648)；這不是修補封存頁面的程式碼，也不會自動修復其他原因造成的空白清單。

## 支援與驗證範圍

| 項目 | 狀態 |
| --- | --- |
| macOS + Node 24.14.0 | 本機離線測試、實際 LaunchAgent 啟動/停止、新版 relay 真實 HTTP 試跑通過 |
| 原始 macOS 個案 | 官方 CLI `0.166.0-alpha.5.1`；桌面重啟後既有聊天 HTTP、封存頁面及原生生圖已個別驗證 |
| 本 repo 完整安裝器 | 隔離設定的交易/失敗還原測試；未覆寫原個案正在使用的舊安裝器 |
| Windows | 提供使用者 Scheduled Task 安裝路徑；**尚無真實 Windows Codex 桌面驗證，屬實驗支援** |
| GitHub Actions | macOS / Windows / Linux 的離線測試；綠燈不代表真實帳戶、桌面或登入啟動已驗證 |
| Linux | 可跑離線測試；暫不提供自動常駐安裝 |
| 長期穩定、全部功能、未來版本 | 未證實；App 或 Node 更新後應重新驗證 |

詳見 [COMPATIBILITY.md](docs/COMPATIBILITY.md) 與 [驗證紀錄](docs/VALIDATION.md)。

## 手動操作

先安裝官方 [Node.js LTS](https://nodejs.org/en/download)（24 或以上）與 Git，並在官方 Codex 桌面程式登入 ChatGPT 帳戶。工具不會替你安裝其他 App、取得新憑證或要求額外 API key。

```sh
git clone https://github.com/alpiex1336-code/codex-http-relay.git
cd codex-http-relay
npm ci --ignore-scripts
npm test
node bin/codex-http-relay.mjs doctor
node bin/codex-http-relay.mjs setup --live
```

PowerShell 可用同樣的逐行命令。`doctor` 必須顯示 `applicable: true`；否則先處理它指出的原因。`setup --live` 會使用現有帳戶做兩次短文字試跑，消耗少量正常使用額度。任何一次失敗都不能略過。未明確授權安裝的使用者應先用 `doctor`。

找不到唯一桌面 CLI 時，將 **App 實際使用的 bundled executable** 傳給 `--codex-bin "完整路徑"`。不要拿另一個 PATH CLI 的通過結果代替桌面版本。需要指定帳戶可用的模型時使用 `--model MODEL_ID`。使用非預設設定資料夾時，每個命令都傳同一個 `--codex-home "完整路徑"`。

成功安裝只會輸出 `backend_verified_desktop_pending`。儲存工作並完全退出、重開桌面 App 後：

```sh
node bin/codex-http-relay.mjs status
node bin/codex-http-relay.mjs verify --live
```

再讓原本出問題的既有聊天完成一個簡短回覆、打開封存頁面；若平常使用生圖，透過 App 原生工具做一次最小生圖測試。`capabilities.imageGeneration: true` 只代表旗標，不等於已生成圖片。

可選的本機日誌佐證：

```sh
node bin/codex-http-relay.mjs desktop-evidence --thread-id CHAT_UUID --since 2026-10-31T10:00:00Z
```

請換成自己的聊天 UUID 與重啟之後的 UTC 時間。這個命令只讀取有界的本機紀錄並輸出計數，不輸出對話、header 或聊天 ID；不證明 UI、所有網路連線或未來穩定性。新版日誌格式可能不支援。

## 還原與移除

若使用中發現相容性問題，先還原設定，暫時保留服務，讓尚未重啟的 App 仍能完成工作：

```sh
node bin/codex-http-relay.mjs rollback
```

再重啟桌面 App，確認已回到原設定後移除服務：

```sh
node bin/codex-http-relay.mjs uninstall
```

`uninstall` 也會嘗試還原設定；使用前應先關閉仍在用代理的 App。私人備份會保留在帶有 `.removed-UUID` 的資料夾，方便人工查核；不會送到 GitHub。若要再次安裝，可在移除後重新執行 `setup --live`。

還原會保護無關的後續設定變更；若管理區塊遭修改、備份有衝突或服務無法安全移除，工具會保留資料並回報 `recovery_required`，不會以覆蓋檔案來偽裝成功。強制終止安裝程式或電腦斷電後可能需要手動恢復；請見[故障處理](docs/TROUBLESHOOTING.md)。

## 安全與維護

relay 只監聽 `127.0.0.1`，上游固定為 `https://chatgpt.com`；驗證 TLS，不跟隨 redirect，也不自行重送 POST。它會在記憶體處理 Codex 提供的認證 header 與對話串流，**因此它仍是需要信任的本機程式**。同機惡意程式不在它的防護範圍。

認證檔、聊天資料庫、App 二進位檔不需要修改。設定備份可能包含你原本設定內的秘密，必須留在私人 runtime 目錄。請勿貼出完整備份或日誌。完整邊界請讀 [SECURITY.md](SECURITY.md)。

本工具沒有自動更新或背景遙測。常駐服務綁定安裝時的 Node 路徑；移除該 Node 版本前應先還原並重新安裝 relay。App 更新後請重跑驗證；若官方提供並驗證可用的關閉 WebSocket 設定，應優先採用官方方案。

MIT License。這是獨立實作，不是 OpenAI 官方產品，也沒有安裝或打包其他人的 Codex fork。工程依據與相依套件列於 [SOURCES.md](docs/SOURCES.md)。
