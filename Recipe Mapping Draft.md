---
type: minecraft-machine-recipe-mapping
schemaVersion: 1
updated: 2026-11-23 00:39:38
created: 2026-11-15 16:08:59
active_preview_manifest:
---
本檔為共用 `Recipe Mapping Draft.md`；執行入口共用同一個路徑設定，不再讀取舊檔名。

`active_preview_manifest` 可填目前批次的 `BIO Publication.json` Vault 相對路徑。留空時，CLI 自動採用唯一批次。有多個批次時，可在命令中用 `--manifest` 指定。
# Machine

只調整有 `Machine::` 的設備配方分類；外部取得與 Tag 代表材料不套用本表。`provider` 是配方的科技來源，`machine` 是設備名稱；可用完整 wikilink。`sourceType` 留空表示不限制原始配方類型，`provider` 留空表示不限制科技。`enabled=false` 停用該列。

只有唯一匹配的啟用規則會套用；無匹配、規則衝突或欄位錯誤會列出診斷並保留原分類。更新候選會記錄本表 SHA256；修改本表後應重新產生更新預覽，舊候選不能直接套用。

| provider     | machine | sourceType | section | enabled |
| ------------ | ------- | ---------- | ------- | ------- |
| Minecraft 原版 | 工作台     |            | 合成配方    | true    |
| Minecraft 原版 | 熔爐      |            | 熔煉配方    | true    |
| Minecraft 原版 | 高爐      |            | 熔煉配方    | true    |
| Minecraft 原版 | 煙燻爐     |            | 煙燻配方    | true    |
| Minecraft 原版 | 營火      |            | 營火料理    | true    |
| Minecraft 原版 | 切石機     |            | 切石加工    | true    |
| Minecraft 原版 | 鍛造台     |            | 鍛造配方    | true    |
| SF-基礎機器(原版)  | 冶煉爐     |            | 熔煉配方    | true    |

新增其他設備前，先確認實際科技來源與用途，再增加對應列；不依設備名稱推測配方功能。

### 與 Mini Parser 的層級關係

Machine Dictionary 轉換設備 ID，Provider Headings 提供五級插件標題，Machine Recipe Mapping 提供三級生產體系的分類規則。Mini Parser 建立單筆 Preview 時由使用者確認三級生產體系，預設為常規。

未來 Plugin Generator 可使用 Machine 分類產生候選，最終三級生產體系由集中 Review 確認。Mini Parser 的單筆目的地與來源會隨 Preview 交給共用 Publisher。


## Provider Headings（Mini Parser 配方歸屬對應）

本表用 provider_id 辨識插件。同插件的不同資料夾共用 ID，五級標題只代表配方的提供者，三級生產體系由 Mini Parser 使用者選擇。

`provider_id` 留空時，英文 `heading` 會轉成小寫，空格和標點會合併成單個連字號，例如 `Fluffy Machines` → `fluffy-machines`。中文標題請手動填 ID。已填的 ID 優先使用，適合之後可能改名的標題。

本表對照目前 Vault 第一層的 `SF-`／`MC-` 資料夾。Mini Parser 的配方來源選單只顯示已啟用的列。預覽輸出與尚未確認插件歸屬的資料夾以停用列保留，供後續核對。

<!-- obsf:provider-headings:start -->

| provider_folder | provider_id     | heading         | enabled |
| --------------- | --------------- | --------------- | ------- |
| MC-物品資料庫        | minecraft       | Minecraft 原版    | true    |
| SF-基礎機器(原版)     | slimefun4       | Slimefun4       | true    |
| SF-科技元件(原版)     | slimefun4       | Slimefun4       | true    |
| SF-工具(原版)       | slimefun4       | Slimefun4       | true    |
| SF-魔法資源(原版)     | slimefun4       | Slimefun4       | true    |
| SF-礦物資源(原版)     | slimefun4       | Slimefun4       | true    |
| SF-武器(原版)       | slimefun4       | Slimefun4       | true    |
| SF-食物(原版)       | slimefun4       | Slimefun4       | true    |
| SF-實用物品(原版)     | slimefun4       | Slimefun4       | true    |
| SF-雜項(原版)       | slimefun4       | Slimefun4       | true    |
| SF-魔法工具(原版)     | slimefun4       | Slimefun4       | true    |
| SF-魔法裝備(原版)     | slimefun4       | Slimefun4       | true    |
| SF-海曼科技院        | hayman          | 海曼科技院           | true    |
| SF-Fluffy機器     | fluffy-machines | Fluffy Machines | true    |
| SF-農耕工藝         | farming         | SF-農耕工藝         | true    |
| SF-合金冶煉(尚未分類    |                 |                 | false   |
| SF-實用物品         |                 | Slimefun4       | true    |
| SF-簡單實用工具       |                 | Slimefun4       | true    |
| MC-自動化BIO       |                 |                 | false   |
<!-- obsf:provider-headings:end -->

### Formal BIO Roots

Mini Parser 和集中 SCAN 只從啟用的正式目錄解析正式材料。子資料夾是否納入由 recursive 控制。

<!-- obsf:formal-bio-roots:start -->

| folder | recursive | enabled |
| --- | --- | --- |
| MC-物品資料庫 | true | true |
| SF-科技元件(原版) | true | true |
| SF-基礎機器(原版) | true | true |
| SF-海曼科技院 | true | true |
| SF-工具(原版) | true | true |
| SF-武器(原版) | true | true |
| SF-食物(原版) | true | true |
| SF-實用物品(原版) | true | true |
| SF-雜項(原版) | true | true |
| SF-礦物資源(原版) | true | true |
| SF-魔法工具(原版) | true | true |
| SF-魔法裝備(原版) | true | true |
| SF-魔法資源(原版) | true | true |
| SF-Fluffy機器 | true | true |
| SF-農耕工藝 | true | true |
<!-- obsf:formal-bio-roots:end -->

### BIO Folder Routing

Java 使用 ItemGroup，YAML 使用物品 ID 前綴。找不到白名單中的目的地時，Mini Parser 會詢問正式資料夾。

<!-- obsf:bio-folder-routing:start -->

| mode | selector | folder | enabled |
| --- | --- | --- | --- |
| java | tools | SF-工具(原版) | true |
| java | weapons | SF-武器(原版) | true |
| java | basicMachines | SF-基礎機器(原版) | true |
| java | usefulItems | SF-實用物品(原版) | true |
| java | resources | SF-礦物資源(原版) | true |
| java | food | SF-食物(原版) | true |
| java | armor | SF-裝備(原版) | true |
| java | magicalArmor | SF-魔法裝備(原版) | true |
| java | magicalResources | SF-魔法資源(原版) | true |
| java | technicalComponents | SF-科技元件(原版) | true |
| java | technicalGadgets | SF-科技工具(原版) | true |
| java | magicalGadgets | SF-魔法工具(原版) | true |
| java | misc | SF-雜項(原版) | true |
| yaml | HM | SF-海曼科技院 | true |
| yaml | SF | SF-黏液科技 | true |
| yaml | SC | SF-科技院 | true |
| yaml | GN | SF-基因科技 | true |
<!-- obsf:bio-folder-routing:end -->

## Machine Dictionary（Mini Parser 設備 ID 對照）

Java 的 `RecipeType.ENHANCED_CRAFTING_TABLE`、YAML 的 `recipe_type: ENHANCED_CRAFTING_TABLE`，都會使用下列表格轉換為顯示名稱。使用者可自行增加新設備；新增一列即可，不必修改 Mini Parser 程式碼。`machine_id` 是來源 ID（不含 `RecipeType.`）、`machine` 是顯示文字（**勿填 Wikilink**）、`enabled` 用 `true` / `false`。已啟用的 `machine_id` 不可重複；不同 ID 可以使用相同設備名稱。若來源 ID 查無對照，會保留原始 ID 並顯示警告，而非臆測。

**注意：**這份表只負責「來源設備 ID → 設備名稱」，與上方 Machine 表的「設備 → BIO 配方分類」是不同用途，請勿混用。

<!-- obsf:machine-dictionary:start -->

| machine_id              | machine | enabled |
| ----------------------- | ------- | ------- |
| ENHANCED_CRAFTING_TABLE | 進階工作台   | true    |
| MAGIC_WORKBENCH         | 魔法工作台   | true    |
| ARMOR_FORGE             | 護甲鍛造台   | true    |
| SMELTERY                | 冶煉爐     | true    |
| ORE_CRUSHER             | 碎礦機     | true    |
| ORE_WASHER              | 洗礦機     | true    |
| COMPRESSOR              | 壓縮機     | true    |
| JUICER                  | 榨汁機     | true    |
| ANCIENT_ALTAR           | 遠古祭壇    | true    |
| PRESSURE_CHAMBER        | 加壓艙     | true    |
| GRIND_STONE             | 磨石      | true    |
| GOLD_PAN                | 淘金盤     | true    |
| HEATED_PRESSURE_CHAMBER | 加熱壓力艙   | true    |
<!-- obsf:machine-dictionary:end -->

> 增加設備時範例：`| CUSTOM_CRAFTING_TABLE | 自訂合成台 | true |`。手動模式的設備選單也會自動加入啟用的名稱；Java / YAML 則使用原始 ID 查表。每次執行 Mini Parser 都會重新讀取本檔，無須重啟 Obsidian。

****
