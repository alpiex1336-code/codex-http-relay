# 安全邊界

本工具是一個具備讀取請求內容能力的本機轉接程式，必須先審閱與信任再使用。它在同機 HTTP 連線中收到 Codex 本次提供的 Bearer header 與請求串流，再透過有憑證驗證的 HTTPS 轉送到固定官方主機。它並未讓所有軟體或所有 Codex 功能的網路連線都經過代理。

## 已實作的限制

- 只 bind `127.0.0.1`，檢查實際連接埠的 Host，拒絕帶 Origin 的瀏覽器要求。
- 只接受 `/backend-api/codex/` 下的 GET/POST 與帶認證的 WebSocket 握手；拒絕 CONNECT、其他方法、外部 URL、明顯路徑穿越。
- 上游固定 `https://chatgpt.com:443`，`rejectUnauthorized: true`；不提供外部目的地設定、不跟隨 redirect。
- 不自行 retry POST，以免重複執行模型/工具。HTTP 狀態原樣回傳給官方客戶端。
- 串流保持原始位元組，包括壓縮內容，使用 backpressure，不將 SSE 解析成自製的「成功」訊號。
- 不讀取登入檔或儲存憑證。runtime 不記錄 headers、query、prompt、回應內容或 raw exceptions。
- 使用者層級服務，不要求管理員、不更改 App 簽章、TLS、防火牆或系統代理。
- 私人 runtime 與備份位於使用者資料目錄；Unix 用私人權限，Windows 新 runtime 目錄限制為目前使用者與 SYSTEM。
- 設定修改先備份、檢查 hash 與 TOML 語義；管理區塊以外的設定要保持等價。歧義或衝突會拒絕修改。

## 不提供的保證

同機具有足夠權限的惡意程式可能讀取程序記憶體、監看 loopback、冒佔埠號或修改使用者檔案。Origin/Host 檢查不是本機惡意程式的完整認證機制。本程式不會強化已被入侵的電腦。

本機到官方服務仍依賴 DNS、TLS、網路及上游可用性。Node 與原本客戶端的網路行為可能不同；需要公司特定 proxy/憑證政策的環境應獨立審查。不要以關閉安全檢查來讓 preflight 通過。

正在執行的桌面程序可能已載入舊設定。還原預設先保留服務，待桌面重新啟動才停止；強制立即停止可能令尚未重啟的聊天中斷。設定檔原子替換可避免半個檔案，但不代表斷電、SIGKILL 或同時多程式寫入時有完整跨程序交易保證。

## 私人資料

備份與 journal 可能包含原始 config 的其他設定或秘密。它們不在 repo，切勿上傳。官方 Codex 自己可能產生日誌；本工具不能保證第三方程序的日誌內容。公開問題回報只提供 OS、Node/Codex 版本、簡化錯誤與合成重現例。切勿附 auth.json、資料庫、完整設定、原始對話或 access token。

本 repo 沒有遙測、遠端設定下載、自動更新或憑證收集。npm 唯一執行階段相依套件是精確鎖定的 TOML parser；常駐 relay 本身無第三方相依套件。`npm audit` 無回報不等於完整安全審計。
