# SlimeFun 5 翻譯計畫

更新：2026-11-21

## 目標與來源

優先沿用 SF5 原生簡體翻譯，轉為繁體中文並接入遊戲。SF5 缺少的內容，再參考 `D:\SF-ZH-CN` 的 SF4 中文原始碼；本階段不做 SF4 全量移植。

- SF5 Fork：`GammaHH/Slimefun5-zhTranslation`
- 本機原始碼：`C:\Users\Owner\Desktop\遊戲相關\Slimefun5-zhTranslation`
- 測試伺服器：`C:\Users\Owner\Desktop\遊戲相關\SlimeFun5`
- 工具、依賴、JDK、YAML、批次資訊、日誌及 JAR：`D:\SF5-Translation`，已從 OB-SF 搬出。
- OB-SF 根目錄只放本計畫與 `配方翻譯對照.md`、`其他翻譯對照.md` 兩份可編輯審查表。

## 模組 1：簡體 → 繁體

入口：`D:\SF5-Translation\Convert-SF5.ps1`，核心為同目錄的 `translation.cjs`。

讀取 SF5 `core/src/main/resources/languages/zh-CN/` 的 YAML，以 OpenCC `cn → tw` 轉換文字值。預期本次涵蓋 7 個檔案：items、menus、messages、categories、recipes、researches、resources。

保留 YAML 鍵、物品 ID、色碼、佔位符及非文字型別；保留既有繁中獨有的鍵。輸出獨立的時間戳資料夾，包含繁中 YAML、簡中來源快照、逐物品名稱對照與雜湊 manifest。轉換模組不改 Fork 或伺服器檔案。

這是簡中既有內容的機械轉換，不代表全部英文都會翻譯，也不代表所有台灣遊戲用語已校訂。

## 模組 2：打包

### 人工審查與採用

在 `D:\SF5-Translation` 執行 `./Review-SF5.ps1 -Action Export -Bundle '轉換批次完整路徑'`，將兩份可編輯 Markdown 送到 OB-SF 根目錄；批次資訊留在工具目錄，若審查表已存在則停止，避免覆寫人工編輯：

- `配方翻譯對照.md`：物品名稱與 recipes.yml 的配方類型／製作方式介面文字，不含完整配方材料、數量和產物關係。
- `其他翻譯對照.md`：其餘物品說明、選單、訊息、研究、分類與資源文字。

表格包含審查 ID、檔案／鍵路徑、英文參考、簡中原文、目前繁中、狀態、核定譯文與備註。英文有但簡中缺少的文字也列入。

只編輯最後三欄：狀態填 `已確認` 才採用。核定譯文留空代表採用目前繁中；沒有目前繁中時必須補填。未確認列保持原結果。保留色碼、佔位符；不要刪除表格列，略過時可填 `略過`。

審查完成後，在工具目錄執行 `./Review-SF5.ps1 -Action Import`，依 `D:\SF5-Translation\active-review.json` 找到此次原始批次與批次資訊，從 OB 根目錄讀取兩份審查表，產生新的核定批次，再用該目錄作為 Build-SF5.ps1 的 Bundle。匯入不改原始批次或審查表，不直接動伺服器。匯出已由使用者驗證（配方 654 列、其他 4,500 列）；匯入與搬遷後的完整打包尚待執行驗證。

入口：`D:\SF5-Translation\Build-SF5.ps1 -Bundle '指定轉換資料夾'`。

先驗證來源、輸出與既有繁中檔案是否和轉換時一致；備份既有繁中，再寫入 Fork。使用已驗證可用的 JDK 8 編譯工具鏈，透過 cmd.exe 執行 `:core:shadowJar`。

檢查程序退出碼、BUILD SUCCESSFUL、全新 JAR，以及每個內嵌繁中 YAML 的 SHA256，通過後保留時間戳產物與獨立 stdout/stderr。模組不自動停服、換插件或啟動伺服器。

## 已驗證與待辦

- **三項冒煙測試已通過**：使用者提供遊戲畫面確認「電池」「碳」「鋼錠」正確顯示，YAML → JAR → 遊戲流程可行。
- 原始測試環境為 Minecraft 26.1.2 / SF5 5.3.3；Fork 預設分支編譯檔名為 `Slimefun-5.0.0-UNOFFICIAL.jar`，不能只看檔名就視為官方 5.3.3。
- 已修正 Fork 引用不存在的 `stable/version.gradle`：改用可讀取的 `master/version.gradle`。
- Temurin 下載曾得到 XML 而非 ZIP；改用 Corretto 8 官方下載，SHA256 通過，使用者成功編譯。
- **模組 1 已由使用者執行通過**：`runs/convert-20261121-223240-947`，7 個 YAML、3,043 個文字值，其中 2,563 個值有簡繁轉換變動。items.yml 包含 553 個文字值；來源、輸出雜湊及結構／佔位符檢查通過。名稱抽查可見「便攜式工作臺」「便攜式垃圾桶」等產出，台灣慣用詞仍待校訂。
- **模組 2 尚未執行**：下一步以該次轉換目錄作為 Bundle 打包，通過後再抽查遊戲內名稱、選單及覆蓋率。
- 整體覆蓋率以遊戲內顯示及缺項檢查為準；不可把成功轉換簡中視為 100% 翻譯完成。

## 執行規則

Codex 撰寫、檢查及修正檔案；使用者在 PowerShell 7 前景執行轉換與編譯。BAT/CMD 一律透過 cmd.exe + Start-Process，保留獨立日誌；失敗先看證據，不自動重試。換核心 JAR 前完整停服，舊版移到 plugins 外備份，plugins 只留一份核心。
