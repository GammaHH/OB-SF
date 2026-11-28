# SlimeFun 5 翻譯計畫

更新：2026-11-22

## 目標與來源

優先沿用 SF5 原生簡體翻譯，轉為繁體中文並接入遊戲。SF5 缺少的內容，再參考 `D:\SF-ZH-CN` 的 SF4 中文原始碼；本階段不做 SF4 全量移植。

- SF5 Fork：`GammaHH/Slimefun5-zhTranslation`
- 本機原始碼：`C:\Users\Owner\Desktop\遊戲相關\Slimefun5-zhTranslation`
- 測試伺服器：`C:\Users\Owner\Desktop\遊戲相關\SlimeFun5`
- 工具、依賴、JDK、YAML、批次資訊、日誌及 JAR：`D:\SF5-Translation`，已從 OB-SF 搬出。
- OB-SF 根目錄只放本計畫與翻譯審查 MD；工具與批次資訊留在 OB 外。審查改為編號核取清單，每份最多 2,000 項，超過時加 `-001`、`-002` 等分檔。

## 模組 1：簡體 → 繁體

入口：`D:\SF5-Translation\Convert-SF5.ps1`，核心為同目錄的 `translation.cjs`。

讀取 SF5 `core/src/main/resources/languages/zh-CN/` 的 YAML，以 OpenCC `cn → tw` 轉換文字值。預期本次涵蓋 7 個檔案：items、menus、messages、categories、recipes、researches、resources。

保留 YAML 鍵、物品 ID、色碼、佔位符及非文字型別；保留既有繁中獨有的鍵。輸出獨立的時間戳資料夾，包含繁中 YAML、簡中來源快照、逐物品名稱對照與雜湊 manifest。轉換模組不改 Fork 或伺服器檔案。

這是簡中既有內容的機械轉換，不代表全部英文都會翻譯，也不代表所有台灣遊戲用語已校訂。

### 共用繁簡詞 DICT

詞彙來源為根目錄 [[@繁簡詞對照]]，正式詞條每行 `來源詞|採用詞`，來源可寫簡體或繁體。EXAMPLE 程式碼區不載入成規則。`D:\SF5-Translation\dictionary.cjs` 提供 `createTranslator` JavaScript API 與 CLI 的 JSON stdin/stdout，可供其他程式使用或指定其他詞表。

來源詞與輸入先統一字形，長詞優先、一次替換，不連鎖重寫譯文；未命中詞彙使用 OpenCC 繁中回退。正規化後重複詞若指定不同譯文會停止。色碼、佔位符和網址不參與替換。

Convert-SF5.ps1 已接入詞表，可用 `-Dictionary` 指定來源。每次保存 dictionary.md 快照及 SHA256，驗證、人工核定匯入與打包沿用快照，後續編輯根目錄詞表不會改變舊批次。舊的無 DICT 批次繼續使用原轉換規則。新介面與整合測試尚待使用者執行。

詞條只做單向對照：左側不論簡體或繁體均先正規化為簡體鍵，輸入以相同形式比對，再輸出右側指定繁體，不做反向詞條替換。字形／詞組處理參考 OpenCC 官方設計，使用本機 opencc-js，不需將內容送到線上轉換網站。

同步目前正在編輯的清單請執行 `./Review-SF5.ps1 -Action Sync`，不必先執行 Convert。已勾選項目以目前實際採用的譯文套用 DICT，只有命中且結果實際改變時才取消勾選；新結果放到「粗譯文」，清空該項舊的「我的譯文」，原採用內容留在轉換前紀錄及備份。人工直接修改新的粗譯文再勾選即可，若另填我的譯文仍優先採用。未命中或轉換結果相同者保留確認。未勾選項目更新粗譯文，保留已填草稿；已轉入 DICT 待重審的項目則以轉換後結果繼續同步。此更新尚待測試。

Sync 另建同時包含語言 YAML、詞表快照、清單及變更報告的新批次，驗證通過後備份舊清單並更新 active-review.json。來源／審查內容若在過程中改動則停止，不覆寫原批次。同步與回歸測試尚待使用者執行。

## 模組 2：打包

### 人工審查與採用

在 `D:\SF5-Translation` 執行 `./Review-SF5.ps1 -Action Export -Bundle '轉換批次完整路徑'`，將可編輯 Markdown 送到 OB-SF 根目錄；批次資訊留在工具目錄，若同名清單已存在則停止，避免覆寫人工編輯：

- `配方翻譯對照.md`：物品名稱與 recipes.yml 的配方類型／製作方式介面文字，不含完整配方材料、數量和產物關係。
- `其他翻譯對照-001.md` 等：其餘物品說明、選單、訊息、研究、分類與資源文字。

最新格式取消表格與備註，以 `- [ ] 編號. 粗譯文：...` 開始，下一欄為「我的譯文」，填在下一行並保留四格縮排。後方附英文參考、簡中原文與來源鍵；隱藏 ID 綁定項目，編號不作為匯入身分。

已放寬直接修改粗譯文：勾選時先採用「我的譯文」，空白就採用目前畫面上的粗譯文，包含直接修改的內容。未勾選不採用。Reformat 保留粗譯文修改；Sync 仍依既定規則更新未勾選的粗譯文，因此未確認的直接修改可能被新的 DICT 結果替換，原內容留在備份。已勾選的粗譯文修改則視為目前採用譯文，DICT 實際改變時取消勾選並提供新結果重審。色碼、佔位符、隱藏 ID 與來源對應仍受檢查。新功能尚待使用者執行回歸及匯入驗證。

勾選 `[x]` 才採用；「我的譯文」下一行留空，不預填色碼，直接輸入文字即可，匯入時自動保留原有顏色／格式前綴。留空就沿用粗譯文，未勾選保持原結果。遷移舊版時僅有預填前綴的內容會清空，已有完整譯文保留。英文有、簡中／繁中缺少的項目也可直接填入我的譯文並勾選；這些項目以英文作為粗譯文，若空白勾選仍沿用英文。內文的其他色碼及佔位符仍需保留，不刪除項目。

舊表遷移請執行 `./Review-SF5.ps1 -Action Reformat`。會先跑格式／匯入回歸測試、核對來源，保留原表內已填譯文與確認狀態，再把舊文件封存至 OB 外的該次 runs/previous-documents/，發布新清單。來源若在過程中變動則停止。原表備註僅保存在舊檔，不帶入新清單。

審查完成後，在工具目錄執行 `./Review-SF5.ps1 -Action Import`，依 `D:\SF5-Translation\active-review.json` 找到此次原始批次與批次資訊，從 OB 根目錄讀取所有分檔清單，產生新的核定批次，再用該目錄作為 Build-SF5.ps1 的 Bundle。匯入不改原始批次或清單，不直接動伺服器。英文說明的清單缺少時，以英文回退補齊索引，避免單行補翻產生 null 空洞。

舊表匯出已由使用者驗證（配方 654 項、其他 4,500 項）；新清單預期為 654／2,000／2,000／500 項四份文件。新格式遷移、人工核定匯入與完整打包尚待使用者執行驗證。

入口：`D:\SF5-Translation\Build-SF5.ps1 -Bundle '指定轉換資料夾'`。

先驗證來源、輸出與既有繁中檔案是否和轉換時一致；備份既有繁中，再寫入 Fork。使用已驗證可用的 JDK 8 編譯工具鏈，透過 cmd.exe 執行 `:core:shadowJar`。

檢查程序退出碼、BUILD SUCCESSFUL、全新 JAR，以及每個內嵌繁中 YAML 的 SHA256，通過後保留時間戳產物與獨立 stdout/stderr。模組不自動停服、換插件或啟動伺服器。

## 已驗證與待辦

- **2026-11-22 人工粗譯審核**：依 V1.1 規範與前段約 200 項已確認譯名，自配方對照原第 2408 行後（第 300 項）處理至檔尾，再處理其他三份對照，共 4,855 項。修改 2,430 項粗譯文；保留所有勾選狀態、我的譯文、英文／簡中來源及識別碼。範圍內已確認的 4 項不改；前段不改。核對全部 5,154 個項目標頭，259 個原勾選均保留，修改行數與粗譯變動數一致，色碼、佔位符與數值保持。
- **審核結果**：PASS 2,385、REVISE 2,430、REVIEW 40。涉及磨石／研磨機、強化工作臺／進階工作臺／進階合成台、食品設備命名、冷凍／冷卻機、史萊姆鋼製系列等衝突時，保留原粗譯，不自行定案。狀態與理由存於 OB 外的 `D:\SF5-Translation\runs\editorial-review-20261122-021852\audit.json`，不加入遊戲文字。原五份文件已備份於同目錄。
- **詞表**：第 50 行起新增通用詞彙區，含 45 條臺灣介面／技術用詞及明確材料用詞，不加入尚未定案的設備候選名稱。解析器已改為只載入「詞條」區，忽略「原則」、候選表格、程式碼範例與分隔線；相關測試已補，待使用者執行。本輪未執行分析、轉換、同步、匯入、編譯或測試腳本，也未替換伺服器插件。

- **三項冒煙測試已通過**：使用者提供遊戲畫面確認「電池」「碳」「鋼錠」正確顯示，YAML → JAR → 遊戲流程可行。
- 原始測試環境為 Minecraft 26.1.2 / SF5 5.3.3；Fork 預設分支編譯檔名為 `Slimefun-5.0.0-UNOFFICIAL.jar`，不能只看檔名就視為官方 5.3.3。
- 已修正 Fork 引用不存在的 `stable/version.gradle`：改用可讀取的 `master/version.gradle`。
- Temurin 下載曾得到 XML 而非 ZIP；改用 Corretto 8 官方下載，SHA256 通過，使用者成功編譯。
- **模組 1 已由使用者執行通過**：`runs/convert-20261121-223240-947`，7 個 YAML、3,043 個文字值，其中 2,563 個值有簡繁轉換變動。items.yml 包含 553 個文字值；來源、輸出雜湊及結構／佔位符檢查通過。名稱抽查可見「便攜式工作臺」「便攜式垃圾桶」等產出，台灣慣用詞仍待校訂。
- **模組 2 尚未執行**：下一步以該次轉換目錄作為 Bundle 打包，通過後再抽查遊戲內名稱、選單及覆蓋率。
- 整體覆蓋率以遊戲內顯示及缺項檢查為準；不可把成功轉換簡中視為 100% 翻譯完成。

## 配方程式碼基礎與靜態交叉核對（2026-11-22）

使用者已取消「從伺服器載入後獨立擷取資料」方案。不建立執行期匯出器、不為盤點啟動或重啟伺服器。保留程式碼分工理解，以及註冊碼、正式 BIO 與翻譯的 ID 交叉核對；不另做物品／配方／翻譯／BIO 數量彙總報告。

### 來源邊界

本機來源為 `C:\Users\Owner\Desktop\遊戲相關\Slimefun5-zhTranslation`，HEAD `efee7864e4821582b6453da9744127cae1648b1c`，是 GammaHH 的 Fork，不將整個工作目錄宣稱為官方原版。已比對以下三檔與官方 v5.3.3，正規化換行後內容一致：

- [SlimefunStartupTask.java](https://github.com/Slimefun5/Slimefun5/blob/v5.3.3/core/src/main/java/io/github/thebusybiscuit/slimefun5/implementation/tasks/SlimefunStartupTask.java)，官方 blob `28d4de97f73397a6d942cba3bf66d272a3c5e502`。
- [RecipeType.java](https://github.com/Slimefun5/Slimefun5/blob/v5.3.3/core/src/main/java/io/github/thebusybiscuit/slimefun5/api/recipes/RecipeType.java)，官方 blob `6694f7fd719ddaaa74490433a80b9dcb14995723`。
- [ElectricDustWasher.java](https://github.com/Slimefun5/Slimefun5/blob/v5.3.3/core/src/main/java/io/github/thebusybiscuit/slimefun5/implementation/items/electric/machines/ElectricDustWasher.java)，官方 blob `7e4aebc4507f3538e4d092f579316cddad4d38b5`。

其他已閱讀檔案以下以本機 Fork 實作為準，尚未逐檔宣稱與官方一致。

### 哪個區塊負責什麼

以下路徑相對於 `core/src/main/java/`；SF 主套件為 `io/github/thebusybiscuit/slimefun5/`。

| 區塊 | 入口／方法 | 可取得的證據與限制 |
| --- | --- | --- |
| 物品身分與模板 | `implementation/SlimefunItems.java`、`api/items/SlimefunItemStack.java` | ID、原版材質及模板；模板顯示名稱不是可靠的玩家譯名來源。 |
| 物品的取得配方宣告 | `implementation/setup/SlimefunItemSetup.java` | 建立物品，指定 RecipeType、輸入格子及特殊輸出；不是全部加工路線唯一來源。 |
| 註冊、啟用及載入 | `api/items/SlimefunItem.java` 的 `register()`、`load()` | register 處理設定及啟用；load 才把物品配方交給 RecipeType.register。 |
| 配方分派 | `api/recipes/RecipeType.java` 的 `register()` | 交給回呼或對應多方塊設備；生物掉落、豬布林易物等不能一概當工作臺合成。 |
| 多方塊配方 | `core/multiblocks/MultiBlockMachine.java`、各多方塊類別 | getRecipes 以輸入陣列／輸出陣列交替儲存，另有設備本身的預設加工路線。 |
| 電動設備固定配方 | `me/mrCookieSlime/Slimefun/Objects/SlimefunItem/abstractItems/AContainer.java` | registerDefaultRecipes、registerRecipe、getMachineRecipes；保留每個輸入／輸出的數量與不同設備等級。 |
| 啟動後補登 | `implementation/setup/PostSetup.java` 的 `loadItems()`、`loadOreGrinderRecipes()`、`loadSmelteryRecipes()` | 根據既有資料補登研磨、製錠、錠粉碎與冶煉路線，只讀初始宣告會漏。 |
| 動態配方 | 各機器的 `findNextRecipe()`，例如 ElectricDustWasher | 可依投入物、設定與隨機結果，執行時才建立 MachineRecipe；固定清單不是完整取得方式。 |
| 隨機取得 | 例如 GoldPan 的 drops／randomizer、OreWasher 的 getRandomDust | 權重和隨機結果另行處理，不可抽一個隨機結果當全部產物或機率。 |
| 指南展示 | `core/attributes/RecipeDisplayItem.java`、`core/guide/wiki/WikiPage.java` | 展示清單可表示配方、資源或其他資訊，不能直接全數計為實際加工配方。 |
| 翻譯 | `core/services/localization/ItemTranslationService.java`、languages 下 YAML | 用 ID 解譯名稱；canonicalizeToId 會把實體模板名稱改成 ID，不可用模板顯示文字當語言資料。 |

### 必須避開的誤判

- `getAllSlimefunItems()` 包含停用物品；`getEnabledSlimefunItems()` 才是當次啟用項目。靜態碼中存在不等於當前伺服器可用。
- `PostSetup.loadItems()` 在呼叫 `SlimefunItemRegistryFinalizedEvent` 後，才執行部分研磨／冶煉補登；事件名稱不能當成所有配方都已完成的保證。執行期擷取方案已取消，這裡只記錄時序理解。
- `MachineRecipe` 裡的 ticks 是設備處理系統的計時單位，建構式先以 seconds × 2 建立，再受機器速度影響；未確認 tick 週期前不可直接當 Minecraft 的 20 ticks/s 換算。
- 堆疊數量與槽位重複是不同表示。可另比對材料總量，但不能因此宣稱有序格子完全一致。
- RecipeDisplayItem 的額外展示不等於可執行配方；GUI 對不代表機器邏輯已驗證。

### 已做的少量獨立核對

以不同的資料來源比對，不執行伺服器：

| 物品 ID | 註冊碼／機器原始碼證據 | BIO／翻譯對照結論 |
| --- | --- | --- |
| BATTERY | SlimefunItemSetup 約 431 行：強化工作臺類型，鋅錠 2、硫酸鹽 2、銅錠 2、紅石 1，保留原 9 格排列。 | `SF-科技元件(原版)/電池.md` 明確記錄 id: BATTERY，材料合計吻合、output: 1。紅石 BIO 有 minecraft_id: minecraft:redstone。但設備連結仍寫「強化工作台」，實際 id: ENHANCED_CRAFTING_TABLE 的 BIO 檔名是「進階工作台」，未找到對應別名，因此設備連結與格子排列仍待核對，不把整條路線判為全部通過。 |
| CARBON | SlimefunItemSetup 約 622 行：煤炭 8 → 碳；另 Compressor.registerDefaultRecipes 約 48 行有煤炭方塊 8 → 碳 9。 | 可由獨立的機器預設路線發現同一物品另有取得方式。尚未找到可按明確前置 ID 連接的正式 CARBON BIO，不憑「碳」的中文連結認定已配對。 |
| STEEL_INGOT | SlimefunItemSetup 約 486 行：AlloyIngot 使用鐵粉、碳、原版鐵錠各 1；AlloyIngot 建構式明確指定 RecipeType.SMELTERY。 | 尚未找到可按明確前置 ID 連接的正式 STEEL_INGOT BIO。舊「合金冶煉-資料庫」有中文配方筆記，但未列於目前正式 BIO roots，亦無可確認的該物品 ID，不能當正式 BIO 配對證據。 |

這些是程式碼與既有文件的靜態證據，不是遊戲內成功製作的紀錄，也不是全部配方的完整性宣告。

### 後續靜態交叉盤點的欄位

逐條保留物品 ID、設備 ID／RecipeType、輸入及槽位、各材料數量、所有產物及數量、原始碼檔案／行號、條件設定、證據類型（初始宣告／機器預設／補登／動態）。以正式 BIO roots 中的明確身分欄位連接文件；同 ID 的不同設備、材料或產量分成不同路線。缺 ID、同 ID 多份 BIO、設備別名不明或動態結果無法判定時標為 REVIEW，不用中文名稱猜配對。

## 執行規則

Codex 撰寫、檢查及修正檔案；使用者在 PowerShell 7 前景執行轉換與編譯。BAT/CMD 一律透過 cmd.exe + Start-Process，保留獨立日誌；失敗先看證據，不自動重試。換核心 JAR 前完整停服，舊版移到 plugins 外備份，plugins 只留一份核心。

## PR note

### Hologram localization

The GEO Miner’s hologram still displays `Idling...`, `GEO-Scan required!`, `Mining:`, and `Finished` in English when zh-TW is selected. These strings are hardcoded in [`GEOMiner.java`](https://github.com/Slimefun5/Slimefun5/blob/main/core/src/main/java/io/github/thebusybiscuit/slimefun5/implementation/items/geo/GEOMiner.java). The item tooltip is already translated. Localizing the hologram requires a code change.

### Block editor localization

The Hologram Projector editor title is localized, but the edit button label is hardcoded. The English default hologram text is also written to block storage when the projector is placed. A localization fix should preserve any text the player has entered. [HologramProjector.java](https://github.com/Slimefun5/Slimefun5/blob/main/core/src/main/java/io/github/thebusybiscuit/slimefun5/implementation/items/blocks/HologramProjector.java#L55-L107)

The Elevator Plate editor has the same gap. Its title and chat prompts use localization keys. The `Floor Name (Click to edit)` label and default `Floor #0` are hardcoded. Player-defined floor names should be preserved. Other block editors have not been audited. [ElevatorPlate.java](https://github.com/Slimefun5/Slimefun5/blob/main/core/src/main/java/io/github/thebusybiscuit/slimefun5/implementation/items/elevator/ElevatorPlate.java)

### Programmable Android menus

With zh-TW selected, the Programmable Android title is localized, but the `Pause` button stays in English. The main menu creates `Start/Continue`, `Memory Core`, its editor hint, and `Pause` at runtime in slots 15–17. These slots are missing from the English menu translation baseline. The script editor also hardcodes buttons such as `Edit Script` and `Create new Script`, even though its title and instruction names use localization keys. [Main menu controls](https://github.com/Slimefun5/Slimefun5/blob/efee7864e4821582b6453da9744127cae1648b1c/core/src/main/java/io/github/thebusybiscuit/slimefun5/implementation/items/androids/ProgrammableAndroid.java#L107-L130) · [Script editor](https://github.com/Slimefun5/Slimefun5/blob/efee7864e4821582b6453da9744127cae1648b1c/core/src/main/java/io/github/thebusybiscuit/slimefun5/implementation/items/androids/ProgrammableAndroid.java#L490-L529)

### Core item coverage

The four chainmail armor pieces, enchanted golden apple, elytra, trident, and totem of undying all display Traditional Chinese names in-game. The core item coverage screen showed `1718/1726`. The eight entries behind that count have yet to be identified individually.

### Debug Fish

The Debug Fish shows its localized name without its usage tooltip. The shipped text uses `usage`, while the unregistered-item renderer reads only `name` and `lore`. The English usage text also says right-clicking any block displays block data. The listener only dumps Slimefun block data when present and may be silent on ordinary blocks. [ItemTranslationService.java](https://github.com/Slimefun5/Slimefun5/blob/main/core/src/main/java/io/github/thebusybiscuit/slimefun5/core/services/localization/ItemTranslationService.java) · [DebugFishListener.java](https://github.com/Slimefun5/Slimefun5/blob/main/core/src/main/java/io/github/thebusybiscuit/slimefun5/implementation/listeners/DebugFishListener.java#L85-L119)

Right-clicking an Output Chest with the Debug Fish produced diagnostic output in-game. The labels `Id`, `Plugin`, `Inventory`, and `Ticking` are hardcoded. Any localization should preserve the raw IDs, coordinates, and JSON payload. [DebugFishListener.java](https://github.com/Slimefun5/Slimefun5/blob/main/core/src/main/java/io/github/thebusybiscuit/slimefun5/implementation/listeners/DebugFishListener.java#L123-L169)

The zh-TW export now also writes the Debug Fish tooltip to `lore`, which the existing renderer can display. The review still uses the original structured fields.

### Dynamic machine menus

InfinityExpansion’s Reinforced Storage menu rebuilds its status slot at runtime. `StorageCache` hardcodes the status, stored-amount, and overflow labels, along with the toggle hint. The static menu translation covers the loading placeholder. Localizing the live status requires localized text templates that retain the current amount, capacity, percentage, and overflow state. [StorageCache.java](https://github.com/Slimefun5/InfinityExpansion/blob/main/src/main/java/io/github/mooy1/infinityexpansion/items/storage/StorageCache.java#L321-L337)
