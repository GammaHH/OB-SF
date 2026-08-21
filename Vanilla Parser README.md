---
created: 2026-08-12 17:37
updated: 2026-08-21 15:06
---

# OB-SF Minecraft Vanilla Pipeline

## Purpose

將 Minecraft Vanilla recipe/tag JSON 正規化並留在同一個 JavaScript process，供遞迴 dependency analysis、BIO 建立順序，以及未來 BIO Generator 使用。

正式資料流：

```text
Minecraft Raw Recipe / Tag JSON objects
        ↓
Parser Modules + Tag Resolver
        ↓
NormalizedItemRegistry (Map, in memory)
        ↓
Recursive Dependency Resolver
        ↓
Dependency Generation Order
        ↓
Future BIO Generator
```

`Minecraft Normalized Recipes.json`、`Minecraft Tag Registry.json`、`Minecraft Recipe Manifest.md` 是可選的 generated/debug artifacts，不是 pipeline 階段間的必要輸入。正式流程不應先寫 JSON 再重新讀取。

## Modules

```text
模板放置處/MC解析器模塊/
├─ index.js
├─ pipeline.js
├─ shared.js
├─ normalized/
│  └─ item_registry.js
├─ dependencies/
│  ├─ dependency_resolver.js
│  └─ generation_planner.js
├─ bio/
│  └─ bio_scanner.js
├─ recipes/
│  ├─ crafting_shaped.js
│  ├─ crafting_shapeless.js
│  ├─ smelting.js
│  └─ stonecutting.js
└─ tags/
   ├─ tag_parser.js
   └─ tag_registry.js
```

`index.js` 是 public entry point。

## In-memory API

```js
const vanilla = require("./模板放置處/MC解析器模塊");

const pipeline = vanilla.createVanillaPipeline({
    tagEntries: [
        {
            tagId: "minecraft:planks",
            registryType: "item",
            sourceFile: ".../planks.json",
            json: rawPlanksTag
        }
    ],
    recipeEntries: [
        {
            sourceFile: ".../barrel.json",
            json: rawBarrelRecipe
        }
    ]
});

const barrel =
    pipeline.itemRegistry.get("minecraft:barrel");

const dependencyResult =
    pipeline.resolveDependencies("minecraft:barrel");

const generationPlan =
    pipeline.createGenerationPlan(dependencyResult);

console.log(generationPlan.generationOrder);
```

`recipeEntries` 也接受直接傳入 raw JSON object。Wrapper 形式只用來保留 `sourceFile` diagnostics。

## Normalized Item Registry

Registry 使用 `Map` 保存 item，不需要 serialization round-trip。

每個 item 的 contract：

```json
{
  "id": "minecraft:barrel",
  "name": null,
  "recipes": [],
  "warnings": []
}
```

同一 item 可以有多條 recipes。`recipes[]` 是不同製作方式，互相替代，不可相加。

Registry API：

- `get(id)`
- `has(id)`
- `addRecipe(id, recipe, warnings)`
- `values()` / `entries()`
- `toArray()`
- `toJSON()`：只供 debug artifact export，不是正式 pipeline 必要步驟

## Normalized Recipe

```json
{
  "sourceType": "minecraft:crafting_shaped",
  "section": "常規",
  "machine": "工作台",
  "output": 1,
  "ingredients": [],
  "meta": {
    "sourceFile": "recipe/barrel.json"
  }
}
```

`recipe.output` 是執行一次 recipe 的成品數量；`ingredient.qty` 是執行一次 recipe 所需的材料數量。

目前註冊的 recipe types：

- `minecraft:crafting_shaped`
- `minecraft:crafting_shapeless`
- `minecraft:smelting`
- `minecraft:blasting`
- `minecraft:smoking`
- `minecraft:campfire_cooking`
- `minecraft:stonecutting`
- `minecraft:smithing_transform`
- `minecraft:crafting_transmute`

已知不能表示為固定 ingredient → output recipe 的 Minecraft dynamic recipes 分類為 `SPECIAL`；未知且尚未實作的 type 分類為 `UNSUPPORTED`。兩者都不進入 item registry，也不會讓整批 pipeline 中止。

## Ingredient Contract

固定材料：

```json
{
  "kind": "item",
  "id": "minecraft:iron_ingot",
  "qty": 3
}
```

Tag 材料：

```json
{
  "kind": "tag",
  "id": "minecraft:planks",
  "qty": 6,
  "resolved": true,
  "values": [
    "minecraft:oak_planks",
    "minecraft:spruce_planks"
  ]
}
```

`values` 是可接受材料，不是全部同時需要。

Tag 的長期用途包含建立「任意木材」這類索引 BIO。索引 BIO 格式尚未定案；Parser 只保留 canonical tag ID 與 resolved values，不把 values 展開成同時需要的材料。

Recipe alternatives：

```json
{
  "kind": "alternatives",
  "qty": 1,
  "alternatives": [
    { "kind": "item", "id": "minecraft:a" },
    { "kind": "item", "id": "minecraft:b" }
  ]
}
```

Tag 與 alternatives 都是擇一語意，但來源與結構不同。Normalization 保留完整 branch，不把候選材料相加。

## Tag Registry

Pure Node pipeline 使用：

```js
vanilla.tags.buildRegistryFromEntries(tagEntries)
```

原有 Obsidian adapter 入口仍保留：

```js
await vanilla.tags.buildRegistry(app, config)
```

Tag resolver 支援：

- item tag
- nested tag
- cycle detection
- `required: false`
- duplicate removal
- ordered entries 的 `replace` / merge 語意

Recipe ingredient 使用 `registryType: "item"`。解析成功後仍保留原始 `kind: "tag"` 和 tag ID，只在 `values` 中附上解析結果。

## Recursive Dependency Resolver

```js
const dependencyResult = pipeline.resolveDependencies(
    ["minecraft:barrel"]
);
```

結果包含：

- `target` / `targets`
- `dependencyTree`: root references
- `graph`: canonical item nodes 的 `Map`
- `leafMaterials`: registry 中沒有 recipe 的 base items
- `recipeBranches`: 每個 item 的所有互斥 production routes
- `tagBranches`: tag 的所有 acceptable candidates
- `alternativeBranches`: recipe alternatives 的所有 mutually-exclusive choices
- `cycles`: recipe dependency cycles
- `warnings`

Resolver 不選擇 branch：

- `recipes[]` 全部保留為互斥 routes。
- `kind:tag` 保留一個 tag ingredient 與全部 acceptable candidates。
- `kind:alternatives` 保留全部 choices。
- branches 只代表可能性，不代表同時消耗，不進行數量加總。
- `recipe.output` 保留在每個 recipe branch。
- 沒有 recipe 的 item 標記為 leaf。

## Generation Planner

```js
const generationPlan =
    pipeline.createGenerationPlan(
        dependencyResult,
        { bioRegistry }
    );
```

Planner 對所有可達 branch 中的 item ID 聯集建立 dependencies-first order；同一 ID 只排序一次。這是 BIO 建立順序，不是材料需求計算，因此不會把 tag values、alternatives 或多條 recipes 的 qty 相加。

結果包含：

- `generationOrder`: cycle-free nodes 的 bottom-up order
- `missingGenerationOrder`: 排除 existing BIO 後的建立順序
- `existingBIO` / `missingBIO`
- `blockedByCycle`: cycle 本身及依賴 cycle、無法排序的 nodes
- `cycles` / `warnings`
- `canGenerateInOrder`

Planner 使用 dependency-count topological ordering；所有 leaf 會先於依賴它們的 items。存在循環時仍回傳可安全排序的部分，並將剩餘 nodes 放入 `blockedByCycle`。

## BIO Scanner

```js
const bioRegistry = vanilla.bio.scanMinecraftBIOs(
    "MC-物品資料庫",
    { vaultRoot }
);
```

Scanner 只讀每份 Markdown 開頭最多 64 KiB，以第一段 frontmatter 建立：

- normalized ID index
- legacy ID index
- BIO path/name/aliases/type
- collision 與 type warnings（預設接受 `mc-item`、`mc-drop`）

`PISTON` 會正規化為 `minecraft:piston`；若未來加入 `minecraft_id` frontmatter，Scanner 優先使用該欄位。

## BIO Boundary

正式 BIO ID policy：去除 `minecraft:` namespace 後使用原 ID 的大寫版本。

```text
minecraft:iron_ingot
→ BIO id: IRON_INGOT
→ aliases 包含 minecraft:iron_ingot
```

Normalized registry 仍使用 Minecraft canonical ID。BIO Generator 負責 deterministic mapping，不以中文檔名反推 ID。

Tag 索引 BIO（例如 `PLANKS`／任意木材）會使用獨立格式，尚未在本階段定案。

## Status

- `OK`: recipe 完整正規化，沒有 warning。
- `OK_BRANCH`: recipe 已完整正規化，但包含合法的 tag／alternatives 選擇語意。Multiple recipes 在 item-level summary 另行標示；不是 failure。
- `UNSUPPORTED`: recipe type 尚未有 parser。
- `SPECIAL`: Minecraft dynamic/special recipe，不適合固定 dependency schema。
- `REVIEW`: Parser 已取得部分資料，但語意仍真的無法確定，或必要 tag 無法解析。
- `ERROR`: raw structure 或 parser execution 無法產生 normalized recipe。

`OK_BRANCH` 不進入 failure diagnostics。其他非成功狀態會進入 `pipeline.diagnostics`，但不會中止整批處理。

## Tests

```powershell
node --test tests/minecraft-vanilla-pipeline/vanilla-pipeline.test.cjs
```

測試只讀取少量 raw recipe/tag fixtures，直接驗證 in-memory registry 和 resolver；不讀取三個大型 generated/debug artifacts。

全部 raw source 的本地 smoke test（只輸出摘要與前 10 筆 diagnostics）：

```powershell
node tests/minecraft-vanilla-pipeline/smoke-all-raw.cjs
```

Dependency CLI dry-run：

```powershell
node scripts/minecraft-vanilla-dependency-plan.cjs minecraft:piston
```

CLI 不建立或覆寫 BIO，並對 tree、lists、warnings 設有輸出上限。
