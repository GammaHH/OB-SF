---
created: 2026-08-08 22:35
updated: 2026-11-04 15:49
---
# OB-SF — Slimefun Obsidian Database

## 快速開始

1. 將專案資料夾開成 Obsidian Vault，啟用 Templater 和 Dataview，並在 Dataview 設定中啟用 JavaScript 查詢。
2. 開啟 [黏液科技DB 搜尋介面 V4](<黏液科技DB 搜尋介面V4.md>)，選擇資料夾與取得方式後，依檔名、物品 ID 或別名搜尋，再展開配方。
3. 編輯 Slimefun 條目可從 [Mini Parser](<模板放置處/!模板-Mini Parser.md>) 開始。生成或更新 Minecraft 原版 BIO 前，請先看 [BIO 產生流程](BIO產生流程.md)，產生並檢查預覽後再發布。

一套以 **Obsidian** 為核心建立的 Slimefun 配方資料庫系統。

本項目的主要目標，是利用 **Templater、JavaScript、Regex 與 DataviewJS**，
將 Slimefun 及其附加插件中原本分散於原始碼、設定檔與配方檔案中的資料，自動解析並整理成可搜尋、可連結、可遞歸計算的 Obsidian 知識庫。

> 程式負責建立資料骨架，人負責補上實際遊玩經驗。

目前的通用入口是 [[OB-CLI]] 模板與 [OB-CLI 操作手冊](OB-CLI%20操作手冊.md)。Minecraft 與 Slimefun Parser 透過標準化資料接入同一套 Review／Preview／集中發布流程；Slimefun V1 邊界與驗收狀態見 [MASTER NOTE](OB-SF%20Slimefun4%20Java%20Parser%20MASTER%20NOTE.md)。

---

## 核心概念

資料庫中的每個物品都會建立一份獨立的 **BIO（物品簡介）**。

例如：

```yaml
---
type: sf-item
id: MIXED_METAL_INGOT
aliases:
  - MIXED_METAL_INGOT
---
````

並將原始配方：

```java
SlimefunItems.COPPER_DUST.item()
SlimefunItems.IRON_DUST.item()
```

轉換成 Obsidian 可讀取的資料：

```markdown
- **生產設備**：(Machine:: [[冶煉爐]])
  **合成所需**：
  - [item:: [[銅粉]]] (qty:: 1)
  - [item:: [[鐵粉]]] (qty:: 1)
  **批產量**：[output:: 1]
```

---

## 模板解析系統

本項目大量使用 **Obsidian Templater + JavaScript Regex** 自動解析插件資料。

目前可從不同資料來源取得資訊，例如：

* Slimefun Java 原始碼
* `SlimefunItemSetup.java`
* 各物品專用 Java Class
* GEO Resource Java / JSON
* YAML 配方資料
* 插件自訂格式

解析內容包括：

* 物品 ID
* 物品名稱
* Alias
* Item Group
* 解鎖等級
* 生產設備
* 配方材料
* 材料數量
* 每批產量
* GEO 生態域資源分布
* 不同取得方式

解析完成後，由模板自動產生對應 BIO。

---

## Alias / 預連結系統

若配方中出現尚未建立 BIO 的物品，例如：

```text
MIXED_METAL_INGOT
```

系統仍可以先保留 Slimefun ID。

之後建立對應 BIO 並加入：

```yaml
aliases:
  - MIXED_METAL_INGOT
```

即可讓 Obsidian 將原本的 ID 與正式物品頁面建立關聯。

因此不需要等待所有物品建立完成，資料庫可以逐步成長。

---

## 配方依賴網路

Slimefun 的物品通常具有大量巢狀配方：

```text
機器
↓
科技元件
↓
合金
↓
金屬粉
↓
原版資源
```

當每個 BIO 都互相連結後，整個 Vault 就形成一張完整的：

**Slimefun 製作依賴網路**

這也是本項目最主要的用途之一。

---

## 遞歸材料計算器

使用 DataviewJS 建立遞歸搜尋引擎，可以直接搜尋任意 BIO 並一路展開配方。

例如：

```text
目標物品 ×1
├─ 科技元件 ×4
│  ├─ 銅粉 ×8
│  └─ 鐵粉 ×4
└─ 合金 ×2
   └─ ...
```

系統會自動計算：

* 製作批數
* 每批產量
* 中間材料
* 最終基礎材料
* 生產設備
* 建造生產設備所需材料

因此可以回答：

> 製作一個高階 Slimefun 物品，最終到底需要多少基礎資源？

---

## V4 多配方系統

V4 以選定路線的 `[output:: N]` 計算批數。路線未填時按每批 1 個計算，舊筆記的 YAML `output` 不參與計算。符合目前範圍且有合法候選的 Tag／替代材料可以擇一切換。

部分物品可能存在多種取得方式，例如：

```text
常規
碎礦
液體
無限附加
```

也可能在同一取得方式下存在多條配方：

```text
篩礦
├─ 淘金盤
└─ 磨石
```

搜尋介面支援在 **遞歸配方樹中直接切換配方路線**。

每一條配方也可以擁有自己獨立的：

```markdown
[output:: 數量]
```

例如：

```text
淘金盤 → output 2
磨石   → output 4
```

切換配方後，系統會重新計算：

* 配方樹
* 最終材料
* 生產設備
* 設備建造成本

避免不同配方產量造成材料統計錯誤。

---

## 純文字匯出

V4 的「匯出其他格式」提供 Markdown、JSON、PDF 及 Excel CSV。CSV 分為「基礎材料.csv」與「生產設備.csv」，使用 UTF-8 BOM；基礎材料合計成品與設備建造所需的相同 BIO，保留狀態與診斷。CSV 沒有工作表，兩份檔案放在同一個全新時間戳資料夾內，不覆寫既有報告。

主教程的備料與設備準備步驟連到 H5 清單，不重複羅列材料。設備製作另有教程，以 H6 區分 MC 與各 SF 資料夾所屬科技，數字表示底層先做的順序，括號表示上一層設備。科技交錯時可重複分類標題，以保留製作順序。複製 Markdown 時，設備教程僅顯示前 3 層；檔案匯出的 Markdown、PDF 與 JSON 保留所有已分析內容。完整匯出不會補回因分析時間、節點或深度上限而未計算的資料。

遞歸分析結果可以轉換為純文字，例如：

```text
目標物品 ×1

【最終基礎材料】

銅粉 ×32
鐵粉 ×16
金錠 ×8

【生產設備需求】

強化工作台 ×1
冶煉爐 ×1
磨石 ×1
```

方便直接貼到：

* Discord
* Wiki
* 攻略
* 備忘錄
* 玩家聊天群

---

## 自動化與人工資料的分工

自動處理：

* ID
* 配方
* 材料
* 數量
* 生產設備
* 批產量
* 固定資料

人工補充：

* 機器是否值得製作
* 實際用途
* 優先級
* 替代方案
* 遊玩中的坑
* 中後期價值
* 個人使用心得

因此資料庫不只是 Wiki，也能保留真正有價值的玩家經驗。

---

## 技術構成

主要使用：

```text
Obsidian
├─ Templater
│  └─ JavaScript / Regex 原始碼解析
│
├─ Dataview / DataviewJS
│  ├─ BIO 搜尋
│  ├─ 配方解析
│  ├─ 遞歸依賴分析
│  └─ 材料統計
│
├─ YAML Frontmatter
│  ├─ type
│  ├─ id
│  ├─ aliases
│  └─ output
│
└─ Obsidian Wikilink
   └─ 建立物品依賴網路
```

---

## 最終目標

希望最後能同時具備：

### 📖 Slimefun 百科

快速查詢物品、插件、配方與設備。

### 🧮 生產計算器

自動計算完整製作鏈與最終材料。

### 🏭 小型 ERP

追蹤：

* 生產鏈
* 設備需求
* 基礎材料
* 科技依賴

### 📝 個人遊玩知識庫

保存只有實際遊玩才能得到的經驗與評價。

---

## 專案現況

Slimefun Java／Addon YAML 由 Templater 產生 Markdown BIO。Minecraft 原版 Recipe、Tag 與語言 JSON 先在記憶體中正規化，再解析依賴、產生審核與 BIO 預覽，最後依發布流程寫入正式筆記。Normalized JSON、Tag Registry 與 Manifest 可作為診斷產物。V4 從 Vault 的 Markdown BIO 讀取配方。實作與資料契約見 [Vanilla Parser README](<Vanilla Parser README.md>)。

目前仍在持續開發與擴充。

目前提供的功能包括：

* BIO 自動建立
* 特定 Slimefun Java／Addon YAML 格式與 Minecraft 原版 Recipe JSON 解析
* Alias 連結
* GEO Resource 解析
* 多科技資料庫搜尋
* 配方遞歸
* 最終材料統計
* 生產設備成本
* 多取得方式篩選
* 多配方路線
* Recipe-level Output
* 純文字結果輸出

特殊配方解析與早期筆記的 BIO 格式遷移仍在進行。分析若遇到缺少 BIO、無可用配方或達到分析上限，請依診斷確認材料與設備需求是否完整。

