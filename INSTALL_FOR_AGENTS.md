# 給 AI 助手的安裝與驗收流程

目標：在適用的官方 Codex 安裝上，安全地試用本機 HTTP workaround。**不能保證未知的網路問題會消失。** 按順序完成以下階段，向使用者報告實際通過的層級。

## 1. 檢查環境與授權

確認使用者確實要求安裝；單純詢問原理不等於要求改設定。辨認 Windows 原生桌面或 macOS；不要在 WSL 內替 Windows App 安裝 Linux 路由。Node 24+、Git 與已登入的官方 Codex 為前提。缺少依賴時用官方來源與使用者允許的安裝方式；不可默默提權。

clone 到新資料夾，閱讀程式與本 repo 規則，執行：

```sh
npm ci --ignore-scripts
npm test
node bin/codex-http-relay.mjs doctor
```

`doctor` 會啟動短暫的官方 `app-server` 查詢有效設定、帳戶類型、capabilities 與封存清單；不做模型推論，不更改路由。Codex 自身可能產生日誌，不能把這描述為完全不碰磁碟。

若 `applicable: false`，依 `reason` 停止依賴安裝，不能繞過。典型原因：已有代理、非 ChatGPT 登入、自訂 provider、profile 路由、不同 provider 的封存紀錄，或不能唯一確認桌面 CLI。先處理真正衝突；不要刪資料庫或改所有聊天的 provider。

環境中出現 `OPENAI_BASE_URL`、API key、`CODEX_CLI_PATH`、`NODE_OPTIONS` 等需單獨審查；只檢查變數名稱，不輸出值。不要自動清除使用者設定。公司管理的要求無法被使用者設定安全覆寫時，停止安裝。

## 2. 試跑、備份與安裝

```sh
node bin/codex-http-relay.mjs setup --live
```

這一次命令已包含 preflight，通常不必再額外跑 `preflight --live`。`--live` 表示使用目前 ChatGPT 帳戶做兩次短文字試跑；沒有另外購買 API 額度。必要時 `--model MODEL_ID` 指定帳戶可用的 Codex 模型。

程式依序：

1. 暫存 relay + 實際 bundled CLI，驗證 426、HTTP 請求、正確短回覆與 `turn.completed`。
2. 建立私人 runtime、原設定備份與 journal，使用全新未佔用連接埠。
3. 建立 macOS 使用者 LaunchAgent 或 Windows 使用者 Scheduled Task，等待健康檢查。Windows 路徑仍屬實驗支援，若 OS 政策拒絕，不以管理員或 ExecutionPolicy Bypass 強行執行。
4. 比較 provider、封存可見集合與 capability，再只修改兩個根層路由設定。
5. 用**不帶 provider/端點覆寫**的新 CLI 做第二次真實試跑；成功只標為 `backend_verified_desktop_pending`。

一般錯誤自動還原新設定與服務。如果後來的路由編輯阻止安全還原，會保留 relay 避免把目前仍指向它的 App 斷開，並標記 `recovery_required`。操作被強制終止不保證自動復原，依 journal 處理。

## 3. 必須重啟桌面

讓使用者先儲存工作並完全退出、重開正在用的 Codex/ChatGPT Work App。若助手就在那個 App 執行，交接時清楚說明：後端已通過，桌面尚未驗證；保留本 repo 路徑與下一條命令。不可偷偷 force quit。

重開後辨認實際版本，執行 `status`、`verify --live`。若升級造成 bundled CLI 路徑變動，重新確認路徑，不直接使用舊 binary。

## 4. 桌面驗收

在原本發生問題的既有聊天做一個簡短回覆，且觀察完整完成。若能合法讀本機日誌，可使用 `desktop-evidence --thread-id UUID --since ISO_TIMESTAMP` 檢查該聊天在重啟後是否出現本機 Responses HTTP 200，以及已知的失敗訊號。該工具不輸出 raw logs，格式不支援時要標為未知。

打開真正的封存頁面並確認原本聊天仍可用。內建清單工具或後端數量只是額外證據；不能代替 UI。若電腦操作工具禁止控制 Codex 自己的視窗，請使用者確認，不可用其他方式繞過限制。

使用者依賴生圖時，透過 App 的原生 image-generation 工具做一張簡單測試圖。不要使用付費 API key 替代原生工具來聲稱原功能正常。使用者不需要的功能可標為未測，不必全做。

沒有問題才保留 workaround。若有功能退化，先執行 `rollback`、請使用者重啟、再移除服務。`verify` 或日誌計數不會自動將 UI 標成成功。

## 5. 最終報告

說明：平台/版本、安裝是否完成、真實試跑結果、桌面是否已重啟、既有聊天/封存/生圖各自的證據，以及還原命令。不要宣稱「所有方面已驗證」「從此不再重連」。若只有後端驗證，明確指出還差甚麼。

不用上傳個人證據到 GitHub；分享摘要即可。未經使用者要求不發 issue、不傳送訊息、不修改其他專案。
