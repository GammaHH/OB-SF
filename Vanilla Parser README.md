---
created: 2026-08-12 17:37
updated: 2026-11-04 15:13
---

# OB-SF Minecraft Vanilla Pipeline V1.3

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
│  ├─ generation_planner.js
│  ├─ base_dependency_planner.js
│  ├─ base_material_review.js
│  └─ recipe_review.js
├─ bio/
│  ├─ bio_scanner.js
│  └─ tag_bio_mapping.js
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
- `specialBoundaries`: 有固定 result ID 的 SPECIAL recipe 邊界；保留 sourceType/sourceFile/warning，但不向內展開

Graph 中 `recipe.dependencyMode: "all"` 表示 recipe 內各 ingredient 是 AND；`tag.selectionMode: "one"` 與 `alternatives.selectionMode: "one"` 表示候選項是 OR。`recipes[]` 本身也是 production-route choice。

Resolver 不選擇 branch：

- `recipes[]` 全部保留為互斥 routes。
- `kind:tag` 保留一個 tag ingredient 與全部 acceptable candidates。
- `kind:alternatives` 保留全部 choices。
- branches 只代表可能性，不代表同時消耗，不進行數量加總。
- `recipe.output` 保留在每個 recipe branch。
- 沒有 recipe 的 item 標記為 leaf。
- 只有 SPECIAL route、沒有普通 recipe 的 item 標記為 special boundary，而不是 leaf 或 error。

## Generation Planner

```js
const generationPlan =
    pipeline.createGenerationPlan(
        dependencyResult,
        { bioRegistry }
    );
```

Planner 對所有可達 branch 中的 item ID 聯集建立 dependencies-first coverage order；同一 ID 只排序一次。這是 BIO 建立覆蓋順序，不是已選定的生產路線或材料需求計算，因此不會把 tag values、alternatives 或多條 recipes 的 qty 相加。

當 graph 含有 tag、alternatives 或 multiple recipes 時，`branchPlanGraph` 以 item reference 保留 bounded 的 `recipe-choice`、`tag-choice`、`alternative-choice` 結構，`branchPlans` 指向 target plans，不自動選擇其中一條。`hasChoices` 表示 generation order 並非唯一生產計畫；`orderMode` 固定為 `all-branches-coverage`。

結果包含：

- `generationOrder`: cycle-free nodes 的 bottom-up order
- `branchPlans`: 每個 target 的 branch-aware generation plan
- `branchPlanGraph`: 以 canonical item ID 索引的 branch-aware plan Map；依賴使用 reference，避免重複展開大型 DAG
- `hasChoices`: 是否存在多條合法 route/choice
- `orderMode`: `all-branches-coverage`
- `missingGenerationOrder`: 排除 existing BIO 後的建立順序
- `existingBIO` / `missingBIO`
- `blockedByCycle`: cycle 本身及依賴 cycle、無法排序的 nodes
- `cycles` / `warnings`
- `canGenerateInOrder`

Planner 使用 dependency-count topological ordering；所有 leaf 會先於依賴它們的 items。存在循環時仍回傳可安全排序的部分，並將剩餘 nodes 放入 `blockedByCycle`。

## Base Dependency Planning

`createBaseDependencyPlan(dependencyResult)` 以 route 為單位檢查 cycle，另外建立供 BIO bottom-up ordering 使用的 `baseDependencyMap`。完整 registry 與完整 dependency graph 仍保留全部 recipes。

每個 map entry 包含：

- `status`: `LEAF`、`SPECIAL_BOUNDARY`、`EXPLICIT_BASE`、`ROUTES_AVAILABLE` 或 `BLOCKED`
- `candidateRoutes[]`: recipe branch、output、dependency analysis、`ACYCLIC`／`BLOCKED`
- `acyclicRouteIds[]` / `blockedRouteIds[]`
- `safe`: 至少有一條 acyclic route，或本身是 terminal/base boundary

預設 `selectionPolicy: "none"`，不選 multiple recipe、tag 或 alternative。`first-acyclic` 只作 deterministic preview：依 Normalized Registry 與 tag values 的既有順序選第一條 acyclic route/choice，不代表成本最佳化政策。

天然取得物若同時存在可逆加工 recipe（例如 cobblestone ↔ stone），單靠 recipe registry 無法知道哪一端應是 base material。呼叫端可明確傳入 `baseItemIds` 作人工 boundary；Planner 不會硬編碼或自行推測。

本階段沒有新增 quantity schema。Planner 原樣保留 `ingredient.qty` 與 `recipe.output`；需求量 scaling 屬於後續 Calculator／Resolver，不屬於 BIO Generator。

### Obsidian Base Material Review

正式人工流程不要求使用者主要透過 `--base-items`。`base_material_review.js` 會由 target dependency graph 建立 `Minecraft Base Material Review.md`：

- frontmatter 記錄 `schemaVersion`、`target`、`sourceFingerprint`。
- cycle group 與 path 由 route-level blocking cycles 產生。
- 全域候選清單以 Minecraft Item ID 作穩定 ID，同一 item 只出現一次。
- 只解析 `obsf:base-material-selection` markers 內的標準 Markdown Checkbox。
- Checkbox 外的普通 Obsidian task 不會成為設定。
- duplicate、invalid、unknown、stale、missing candidate 都產生明確 diagnostics。
- fingerprint 對完整 in-memory Normalized Registry 計算；來源改變時發出 warning，並用目前 graph 重新驗證所有候選。
- 重新產生時保留有效 checkbox、candidate notes 與 managed section 外的內容。
- 新候選依穩定 canonical 順序追加在既有有效候選之後。
- 不再屬於目前 graph 的 candidate 移到「過期候選」，不會套用。
- `Additional External Base Materials` 用於採掘、掉落或 loot table 等 Recipe JSON 無法表達的取得方式；只接受目前 target dependency graph 內的 item。
- 外部來源可在該 managed section 內直接新增 Checkbox 並填入 `minecraft:redstone`；下一次重算會轉成穩定 ID block，並保留勾選與人工備註。
- 同一 item 不可同時作為 cycle candidate 與 additional external base；unknown、duplicate 或已離開 graph 的項目會明確報錯或移至過期區。

Review Parser 只將通過驗證且被勾選的候選轉為 `explicitBaseItemIds`。正式 `selectionPolicy` 仍為 `none`；CLI 額外輸出的 `first-acyclic` generation order 只是 deterministic preview，Recipe／Tag／Alternative selection 仍是後續獨立審核。

產生或合併 piston review：

```powershell
node scripts/minecraft-base-material-review.cjs generate minecraft:piston
```

在 Obsidian 勾選後重新計算：

```powershell
node scripts/minecraft-base-material-review.cjs recalculate minecraft:piston
```

不寫入 review 的預覽可加 `--dry-run`。兩個命令都只讀 raw recipe/tag JSON 並建立 in-memory registry，不讀三個大型 generated/debug artifacts，也不建立 BIO。

### 統一人工決策入口

日常操作優先使用單一 orchestration CLI；底層兩支 CLI 保留給診斷與分階段測試：

```powershell
node scripts/minecraft-review.cjs start minecraft:piston
```

`start` 會依序驗證／更新 Base Material Review，再進入 Recipe Ambiguity Review。每次在 Obsidian 完成目前階段的勾選後，統一執行：

```powershell
node scripts/minecraft-review.cjs recalculate minecraft:piston
```

若 Base Material 尚未解除 route-level cycle，流程停在 `BASE_MATERIAL`；Base 通過後但仍有 recipe／tag／alternative 未選，停在 `RECIPE_AMBIGUITY`；所有條件通過才顯示 `READY`。可加 `--dry-run` 驗證而不改寫 Review Markdown。

## Route-aware Recipe Ambiguity Review

完成 Base Material Review 後，`recipe_review.js` 只沿 target 目前 active dependency route 找出必須人工收斂的 ambiguity：

- Multiple Recipe：多條 acyclic production routes 擇一。
- Tag：resolved tag values 擇一，不會把 values 相加。
- Alternative：Recipe JSON 直接定義的互斥 ingredients 擇一，與 Tag identity 分開。

Review 採逐層收斂。若上游 recipe 尚未選擇，不會展開各 recipe branch 下游的 Tag／Alternative；選定上游後才產生 selected branch 的下一層 ambiguity。未走 branch 的舊 groups 會移至 inactive/stale 區，不再阻擋 readiness，也不會默默刪除選擇或備註。

穩定 identity 規則：

- Recipe candidate：result item、sourceFile 與 normalized recipe semantics 的 SHA-256 fingerprint，不以 array index 作永久 ID。
- Ingredient context：owner item、recipe identity、ingredient semantics，以及只用於相同 ingredients 的 duplicate ordinal。
- Tag group：owner item、recipe identity、ingredient identity、tag ID。
- Alternative group：owner item、recipe identity、ingredient identity。

每個 active ambiguity 必須 exactly one：0 個勾選是 unresolved，1 個有效，2 個以上是 invalid。正式 selection policy 永遠是 `none`；系統不會自動選第一條 recipe、第一個 tag value 或第一個 alternative。

產生或合併 Review：

```powershell
node scripts/minecraft-recipe-review.cjs generate minecraft:piston
```

讀取人工選擇並重新計算：

```powershell
node scripts/minecraft-recipe-review.cjs recalculate minecraft:piston
```

完整分析但不寫 Markdown：

```powershell
node scripts/minecraft-recipe-review.cjs recalculate minecraft:piston --dry-run
```

CLI 先讀取並驗證 `Minecraft Base Material Review.md`，將勾選結果作為 traversal boundaries。Base material 以下的 recipes 與 ambiguities 不會展開。

Machine-readable readiness 同時要求：

```text
route-aware blocked = 0
unresolved ambiguities = 0
invalid selections = 0
planning cycles = 0
```

任一條件不成立時，`readyForBioGeneration` 為 `false`；本 pipeline 不會因此呼叫或啟動 BIO Generator。

## Tag BIO Mapping Draft

`createTagBIOMappingDraft(dependencyResult)` 只掃描實際 graph 的 `tagBranches`。每列使用 `kind: "minecraft:item_tag"`，與普通 `minecraft:item` identity 分開；未知 BIO ID、中文名與 filename 保持空白，`generate` 預設為 `false`。

目前人工草稿見 `Minecraft Tag BIO Mapping Draft.md`。這只是 mapping input，不會建立 Tag BIO。

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

Obsidian Templater 正式全量 regression 使用 `OB-SF Vanilla Parser V1.3.md`；本階段不由 Resolver 測試自動執行。

Dependency CLI dry-run：

```powershell
node scripts/minecraft-vanilla-dependency-plan.cjs minecraft:piston
```

Route selection preview 與人工 base boundary：

```powershell
node scripts/minecraft-vanilla-dependency-plan.cjs minecraft:piston --base-route-policy=first-acyclic --base-items=minecraft:cobblestone
```

CLI 不建立或覆寫 BIO，並對 tree、lists、warnings 設有輸出上限。
