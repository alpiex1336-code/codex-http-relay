# AI 助手操作規則

本 repo 用於處理官方 Codex 的特定 WebSocket 重連路徑。使用前讀取 `INSTALL_FOR_AGENTS.md`、`SECURITY.md` 和 `docs/COMPATIBILITY.md`。

- 誠實區分離線測試、真實 CLI 試跑、既有桌面聊天、封存 UI、生圖與長期穩定性。不能聲稱永久修好、適用所有原因或所有平台。
- 使用者已要求安裝時，執行授權範圍內的可逆流程；不必逐步重複詢問。沒有安裝授權時先做 `doctor`。
- 不替換官方 App/CLI、不改聊天資料庫或歷史中的 provider、不改登入檔，不關閉安全或憑證檢查。不擅自更改網路設定。
- `doctor.applicable` 必須為 true；`setup --live` 的真實試跑不可略過或改成假成功。保留內建 `openai` provider。
- 不能用另一個 CLI 或新的聊天成功，推斷原來桌面聊天已生效。版本不明或多個安裝時，使用實際執行中的桌面 bundled CLI；必要時詢問使用者。
- 安裝成功的狀態是 `backend_verified_desktop_pending`。不要關閉正在執行你的 App；請使用者儲存工作並重啟，之後完成桌面檢查。
- 有相容性問題先 `rollback`，讓使用者重啟，再 `uninstall`。遇到管理區塊被修改或 `recovery_required`，不要 force overwrite/kill；保留服務、備份與使用者變更，逐項釐清。
- 禁止上傳完整設定、auth.json、原始日誌、SQLite、聊天、私人路徑、account ID 或 request payload。診斷摘要只包含必要的版本、狀態及計數。
- 只 clone 到獨立資料夾；不要覆蓋使用者既有專案或舊的有效 relay。遇到其他版本安裝，先說明差異，不自動接管。
- 不自動修改此 repo 以跳過失敗檢查。修程式時增加真正重現故障的測試，跑 `npm test`，記錄未驗證平台。
- 使用者新的指示優先於本文件；若需求與安全條件衝突，說明具體原因，不默默改動條件。
