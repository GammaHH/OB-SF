# Slimefun Java/YAML Parser Boundaries

這份文件記錄現行行為，目的不是把 Regex parser 改寫成 Java 或 YAML parser。

## Java template

正式檔案：`模板放置處/!模板-解析常規插件物品.md`

純 parsing／轉換邏輯：

1. 將每個 source 切成 `register(...);` research blocks，依 `SlimefunItems.<ID>` 找到第四個參數 `levelCost`。
2. 將 Java source 切成以 `.register(plugin);` 結束的 item blocks。
3. registration 必須符合 `new <Class>(itemGroups.<group>, SlimefunItems.<ID>, ...)`，避免把配方材料誤認為目標物品。
4. 從 block 擷取 `itemGroups`、`RecipeType`、第一個 `new ItemStack[] {...}`。
5. 材料 Regex 分三類累加：指定數量 `SlimefunItemStack`、一般 `SlimefunItems.<ID>.item()`、原版 `ItemStack(Material.<ID>[, amount])`。
6. 若 recipe array 後方有同 ID 的 `new SlimefunItemStack(..., amount).item()`，將其視為明確 output；否則沿用 `1` 並發 Notice。
7. 使用 machine dictionary、folder dictionary 與 Alias index，組合既有 Markdown／Dataview inline-field 格式。

Obsidian／Templater 邊界：

- `tp.system.prompt` 取得名稱與 ID。
- `app.vault.adapter.list/read` 只掃描 `參考資料`頂層 source。
- `getMarkdownFiles()` + `metadataCache` 建立 Alias 到檔名／BIO type 的索引。
- `getAllLoadedFiles()` + `TFolder` 解析或人工選擇目標資料夾。
- `tp.file.create_new` 建立 BIO；`Notice` 顯示 warning。

## YAML template

正式檔案：`模板放置處/!模板-描述機器or工具.md`

純 parsing／轉換邏輯：

1. 以頂層 key 切 research source，依 `- <ID>` 找 `levelCost`。
2. 以 `^<ID>:` 起點及下一個無縮排 key 作為 item block 邊界。
3. 擷取並去除 YAML name 的 `&` 色碼；必要時加入 Alias。
4. 只在 `item:` 縮排區間內找 output `amount`。
5. 擷取 `recipe_type`、`per`、`tickRate`、`capacity`。
6. 從 `recipe:` 後方依相鄰的 `material:`／`amount:` 行累加材料。
7. 使用與 Java template 相同概念的 machine dictionary、Alias index 與 Markdown formatter。

Obsidian／Templater 邊界與 Java template 相同；YAML template 的 addon folder 主要由 ID prefix dictionary 決定，未命中時呼叫 suggester。

## Node characterization boundary

`templater-harness.cjs`直接抽出並執行上述正式模板的 `<%* ... %>` 程式。Harness 不包含 Java/YAML 配方 Regex；它只提供最小 API mock 並攔截 `create_new`，因此不會寫入 Vault。

比較範圍是 parser 管理的 frontmatter（`type/id/level/output/aliases`）與 `### 常規`中的 Dataview inline fields。`created/updated`、圖片、人工補充說明不作為 parser regression。

批次比較的 `no-direct-source` 代表 ID 不在現行模板會掃描的 `參考資料`頂層 source；這類案例不會自動猜測其他檔案或 parser。
