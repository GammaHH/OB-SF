---
created: 2026-08-12 17:37
updated: 2026-11-09 14:50
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
BIO Generator Preview
```

`Minecraft Normalized Recipes.json`、`Minecraft Tag Registry.json`、`Minecraft Recipe Manifest.md` 是可選的 generated/debug artifacts，不是 pipeline 階段間的必要輸入。正式流程不應先寫 JSON 再重新讀取。

## Modules

執行用 JavaScript 統一放在 `BIO相關模組/`，包含 `MC解析器模塊/` 與 `搜尋介面模塊/`；`模板放置處/` 只保留實際要由 Templater 執行的 Markdown 模板。Templater 的 User Scripts folder 仍是 `BIO engine`。模組已移出模板搜尋範圍，避免出現在插入模板選單。

```text
BIO相關模組/MC解析器模塊/
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
const vanilla = require("./BIO相關模組/MC解析器模塊");

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
  "sourceType": "minecraft:crafting_shapeless",
  "section": "常規",
  "machine": "工作台",
  "output": 1,
  "ingredients": [],
  "meta": {
    "resultComponents": {
      "minecraft:suspicious_stew_effects": [
        {
          "duration": 60,
          "id": "minecraft:fire_resistance"
        }
      ]
    },
    "sourceFile": "recipe/suspicious_stew_from_allium.json"
  }
}
```

`recipe.output` 是執行一次 recipe 的成品數量；`ingredient.qty` 是執行一次 recipe 所需的材料數量。

若 raw result 含有 `components`，Parser 會原樣深拷貝到可選的 `recipe.meta.resultComponents`；沒有 components 的既有 recipes 不新增此欄位。這使相同 result item ID 的 component variants（例如不同花對應不同效果與 duration 的 suspicious stew）仍維持為語意不同的 recipes。Base Route／External Base 只影響 generation planning traversal，不會移除這些 routes 或 result components。

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

Route safety 使用 monotone fixed-point rank，並針對每條 candidate route 排除 owner item 後重新驗證。這保留「某 route 自身 cyclic、同 item 另一 route acyclic」的語意，同時避免將完整 DFS active path 當 cache identity 所造成的組合爆炸。真正無法到達 leaf／explicit base 的區域再以 SCC 產生 bounded representative cycle paths；染色羊毛等高度互連 alternative family 不會展開所有路徑排列。

每個 map entry 包含：

- `status`: `LEAF`、`SPECIAL_BOUNDARY`、`EXPLICIT_BASE`、`ROUTES_AVAILABLE` 或 `BLOCKED`
- `candidateRoutes[]`: recipe branch、output、dependency analysis、`ACYCLIC`／`BLOCKED`
- `acyclicRouteIds[]` / `blockedRouteIds[]`
- `safe`: 至少有一條 acyclic route，或本身是 terminal/base boundary

預設 `selectionPolicy: "none"`，不選 multiple recipe、tag 或 alternative。`first-acyclic` 只作 deterministic preview：先依 fixed-point rank 避開 cycle，再以 Normalized Registry／tag values 的既有順序作 tie-break，不代表成本最佳化政策。

天然取得物若同時存在可逆加工 recipe（例如 cobblestone ↔ stone），單靠 recipe registry 無法知道哪一端應是 base material。呼叫端可明確傳入 `baseItemIds` 作人工 boundary；Planner 不會硬編碼或自行推測。

本階段沒有新增 quantity schema。Planner 原樣保留 `ingredient.qty` 與 `recipe.output`；需求量 scaling 屬於後續 Calculator／Resolver，不屬於 BIO Generator。

### Obsidian Base Material Review

正式人工流程不要求使用者主要透過 `--base-items`。`base_material_review.js` 會由 target dependency graph 建立 `Minecraft Base Material Review.md`：

- frontmatter 記錄 `schemaVersion`、`target`、`sourceFingerprint`。
- cycle group 與 path 由 route-level blocking cycles 產生。
- 全域候選清單以 Minecraft Item ID 作穩定 ID，同一 item 只出現一次。
- 若某個 cycle group 只有一個候選，Planner 以 `AUTO_SINGLE_CANDIDATE` 直接將該 item 作為 external acquisition boundary，不產生只有一格的人工 Checkbox；兩個以上候選仍必須人工選擇。
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

Review Parser 將通過驗證且被勾選的候選，以及唯一候選的 `AUTO_SINGLE_CANDIDATE` locked decision，轉為 `explicitBaseItemIds`。正式 `selectionPolicy` 仍為 `none`；CLI 額外輸出的 `first-acyclic` generation order 只是 deterministic preview，Recipe／Tag／Alternative selection 仍是後續獨立審核。

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

日常操作優先使用單一 orchestration CLI；底層兩支 CLI 保留給診斷與分階段測試。正式流程不要求使用者事先知道 target：

```powershell
node scripts/minecraft-review.cjs scan
node scripts/minecraft-review.cjs next
```

`scan` 以 in-memory Normalized Registry 與 BIO Scanner 建立 generation-planning scope：預設掃描 Registry 中尚無正式 MC BIO 的 result items，並保留目前已開啟的開發 Review target。只有 dependency planning 實際遇到 route cycle、multiple recipe、tag 或 alternative 的 target 才進入 `Minecraft Review Queue.md`；合法 branch 本身不會被 Raw Parser 分類為錯誤。

全量 scan 使用固定小批次隔離 process（預設 25 targets／batch、每個 worker 1 GiB V8 heap）；每批結束即釋放 dependency graph。若某批失敗會自動二分定位到具體 target，不以提高單一 process heap 掩蓋不受控的 graph 累積。診斷時可用 `--scan-batch-size=N`（1–100）調整批次，不改變結果順序。

`next` 取得下一個 `PENDING` target，並載入根目錄固定工作檔 `Minecraft Base Material Review.md`／`Minecraft Recipe Review.md`。Queue targets 使用穩定 item ID 排序；切換 target 前，上一個 target 的完整 Review snapshot 會寫入 `Minecraft Review Decisions.json`，因此 Checkbox、Locked decisions 與人工備註不會因根目錄工作檔切換而遺失。

`Minecraft Review Decisions.json` 是機器讀寫的唯一 source-of-truth。Registry 以 target ID 為 key，保存 `sourceFingerprint`、結構化 `lockedBaseDecisions`／`lockedAmbiguityDecisions`，以及可無損還原人工備註的完整 Base／Recipe Review snapshot。每次更新先寫入並驗證 temporary JSON，再保留上一版為 `Minecraft Review Decisions.json.previous`，最後才替換正式檔案。`Minecraft Review Decisions.md` 只是 Obsidian 可讀的小型 target 摘要，不再包含大型 JSON；既有 `Minecraft Reviews/minecraft__*/` 只作一次性 migration source，之後不再建立新的 target 資料夾。

舊版大型 Markdown Registry 必須先遷移；命令會先在 `review/registry-migration-backups/` 建立 timestamped 完整備份、驗證 JSON round-trip，成功後才把根目錄 Markdown 改成小型摘要：

```powershell
node scripts/minecraft-review.cjs migrate-registry
```

遷移期間請停用會在每次編輯時重寫 frontmatter 的 Obsidian 外掛；確認 JSON、備份與 target 數量後，才恢復 `scan`／`next`／`recalculate`。JSON 不應由 Obsidian 日期外掛處理。

既有 target folders 可一次匯入並做完整 snapshot round-trip 驗證：

```powershell
node scripts/minecraft-review.cjs migrate-legacy
```

此命令遇到 Registry 同 target、不同內容時會整批停止，不覆蓋既有決策；驗證成功也不會刪除 legacy files，刪除或封存必須另行人工確認。

每次在 Obsidian 完成目前階段的勾選後，統一執行：

```powershell
node scripts/minecraft-review.cjs recalculate
```

`recalculate` 從 Queue 的 `IN_REVIEW` entry 取得 target，不需再次輸入 item ID。若 Base Material 尚未解除 route-level cycle，流程停在 `BASE_MATERIAL`；Base 通過後但仍有 recipe／tag／alternative 未選，停在 `RECIPE_AMBIGUITY`；所有條件通過才標記 `READY` 並通知下一個 pending target。

Locked ambiguity decision 以 stable Group ID 建立全域索引。同一 recipe／alternative group 在其他 downstream target 再次出現且 candidate identity 仍有效時，系統直接套用 `GLOBAL_DECISION_REGISTRY`；`scan` 不再把它計入 pending ambiguity，`next` 也會自動略過已 READY targets，直到下一個真正需要人工勾選的 group。若同一 Group ID 出現不同 locked candidate，流程以明確 conflict error 停止，不會靜默覆蓋。

Locked Base decision 同樣建立全域索引：cycle candidate 以 stable cycle ID 重用，External acquisition 以 item ID 重用。所有 Base decisions 對 Planner 都是 `external` acquisition boundary；例如 `raw_iron ↔ raw_iron_block` 一旦選擇 `minecraft:raw_iron`，後續相同 cycle 直接以採掘取得的 raw iron 作 Base，不再重問。target-local Review 只保留顯示、人工備註與 readiness。

Multiple Recipe group 會額外提供 `External acquisition：採掘／掉落／loot → 設為 Base`。此選項永遠需要人工勾選；統一 `recalculate` 會把它轉入既有 `Locked Base Decisions`、保留 Registry 原配方，接著重新計算 dependency graph。直接使用底層 Recipe CLI 時只會回報 pending transfer，不會跨檔案套用。

完成的 Base／Recipe／Tag／Alternative selection 會移出可編輯 Checkbox 區，轉為無 Checkbox 的 `LOCKED` 摘要與隱藏穩定 marker。若 source identity 失效會明確報錯；要刻意修改時必須執行：

```powershell
node scripts/minecraft-review.cjs reopen <decision-id>
node scripts/minecraft-review.cjs reopen minecraft:redstone --target=minecraft:piston
node scripts/minecraft-review.cjs reopen '#minecraft:planks' --target=minecraft:piston
```

`reopen` 同時撤銷對應的 Global Decision，不只是移除目前 Markdown 的 locked block。Decision Registry 會保留 `ACTIVE → SUPERSEDED` revocation history，使其他 target 的舊 snapshots 不會立刻把已撤銷的 Base／Recipe／Alternative decision 套回；同一 target 完成新選擇後，舊 revocation 轉為 `SUPERSEDED`。Tag reopen 會清空 Mapping Draft 的 Representative Item ID，並重新產生該 Tag 的人工選擇。

若只要撤銷 Global Decision 並重建整體 Queue，使用 `revoke`。它會清除所有 snapshots 中仍會套用的 locked blocks，保留 revocation history，並在同一個 foreground process 內自動執行完整 `scan`：

```powershell
node scripts/minecraft-review.cjs revoke minecraft:exposed_chiseled_copper
node scripts/minecraft-review.cjs revoke recipe-group-xxxxxxxxxxxxxxxx
node scripts/minecraft-review.cjs revoke '#minecraft:planks'
```

不需要再另外執行 `scan`；下一步直接執行 `node scripts/minecraft-review.cjs next`。

未指定 `--target` 時只重開目前 Queue 的 `IN_REVIEW` target；要重開已標記 `READY` 的舊 target，必須明確指定 target。Queue 會把原本的 `IN_REVIEW` 放回 `PENDING`，並將指定 target 切換為新的 `IN_REVIEW`，避免把決策套到錯誤的 Review 檔案。

指定 target 的舊介面仍保留作單項診斷：

```powershell
node scripts/minecraft-review.cjs start minecraft:piston
node scripts/minecraft-review.cjs recalculate minecraft:piston
```

Queue state 存在 ignored `review/minecraft-review-queue.json`；Obsidian 摘要為 `Minecraft Review Queue.md`，其中 Current Review 固定連到根目錄兩份工作檔。所有命令只做 Planning／Review，不會啟動 BIO Generator。`--dry-run` 不會切換根目錄工作檔；若要求的 target 不是目前 active target，會明確停止而不覆寫內容。

## Route-aware Recipe Ambiguity Review

完成 Base Material Review 後，`recipe_review.js` 只沿 target 目前 active dependency route 找出必須人工收斂的 ambiguity：

- Base Route for Generation Planning：多條 acyclic production routes 中選一條供 BIO bottom-up generation ordering；這不是唯一正式配方，所有合法 recipes 與 External acquisition 仍保留於 Normalized Registry，未來 BIO 顯示全部取得方式。
- Tag：resolved tag values 擇一，不會把 values 相加；選擇會提升為全域 Tag representative mapping，而非 target-local 決策。
- Alternative：Recipe JSON 直接定義的互斥 ingredients 擇一，與 Tag identity 分開。候選集合完全相同時會建立 candidate-set preference（例如 `{coal, charcoal} → coal`）；Minecraft 染色物品則使用 color-family preference（例如 `minecraft-color-family:wool → minecraft:white_wool`）。只有偏好 item 仍存在於目前候選時才重用，否則維持 unresolved 並要求人工選擇。

Review 採逐層收斂。若上游 recipe 尚未選擇，不會展開各 recipe branch 下游的 Tag／Alternative；選定上游後才產生 selected branch 的下一層 ambiguity。未走 branch 的舊 groups 會移至 inactive/stale 區，不再阻擋 readiness，也不會默默刪除選擇或備註。

穩定 identity 規則：

- Recipe candidate：result item、sourceFile 與 normalized recipe semantics 的 SHA-256 fingerprint，不以 array index 作永久 ID。
- Ingredient context：owner item、recipe identity、ingredient semantics，以及只用於相同 ingredients 的 duplicate ordinal。
- Tag group：只以 tag ID 建立全域穩定 identity；相同 Tag 不因 target 或 ingredient 位置不同而重複詢問。
- Alternative group：owner item、recipe identity、ingredient identity；精確 group decision 仍依此 identity 保存。
- Global Alternative Preference：已辨識的 Minecraft color family 使用獨立 preference key。不同顏色 target 即使排除自身顏色、導致完整候選集合不同，仍可重用同一個有效代表；不改寫或刪除 Normalized Registry alternatives。
- Generic Alternative Preference：其餘 alternatives 以排序後的完整 normalized candidate set 建立穩定 key；候選順序不同仍可重用，但候選內容不同不會互相套用。

每個 active ambiguity 必須 exactly one：0 個勾選是 unresolved，1 個有效，2 個以上是 invalid。正式 selection policy 永遠是 `none`；系統不會自動選第一條 recipe、第一個 tag value 或第一個 alternative。Recipe ambiguity 的自動套用來源限於已由使用者確認並保存於 Global Decision Registry／Tag mapping 的既有決策；Base Material 另允許 cycle group 唯一候選使用 `AUTO_SINGLE_CANDIDATE`。

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

目前人工草稿見 `Minecraft Tag BIO Mapping Draft.md`。`Representative Item ID` 只供 deterministic dependency preview 使用，不會把 Tag 改寫成普通 item，也不會刪除 Tag branch。統一 `recalculate` 會把尚未 mapping 的 Tag choice 寫入這份全域草稿；已存在且仍有效的 mapping 會在其他 targets 重用。BIO ID、中文名稱與 filename 不會由程式猜測。`generate=true` 只允許 Generator 建立 Tag BIO preview，不會覆寫正式 BIO。

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

## BIO Generator V1 Preview / Schema V2

Phase 1 Generator 只輸出至 `MC-自動化BIO/preview/`，不建立或覆寫正式 `MC-物品資料庫/`。每次執行建立 timestamped fresh directory；`Minecraft Normalized Recipes.json`、`Minecraft Tag Registry.json` 與舊 Manifest 不再作為輸入。

```powershell
node scripts/minecraft-bio-generator.cjs preview minecraft:piston
node scripts/minecraft-bio-generator.cjs preview minecraft:piston --dry-run
node scripts/minecraft-bio-generator.cjs preview minecraft:stick minecraft:soul_campfire minecraft:suspicious_stew minecraft:red_wool minecraft:painting minecraft:iron_ingot minecraft:piston minecraft:wooden_pickaxe minecraft:stone_pickaxe --update-existing
```

Generator 直接使用同一個 Node process 內的 Normalized Item Registry，並讀取 JSON Decision Registry、Tag Mapping Draft、現有 BIO Scanner 與 `zh_tw.json`。只有 `readyForBioGeneration: true` 的 target 可以產生 preview。

一次指定多個 target 時，整批共用 `preview/batch/<時間戳>/` 資料夾及同一份來源快照，按身份合併 Item、Tag 與衍生群組，只產生一份共享依賴 BIO。批次內連結全部使用同一份路徑對照，避免同一輪測試因 target 分目錄而重複生成材料。Manifest 保存 `targets` 清單，`target` 保留第一個目標以相容原入口；單目標命令仍使用原本的目標／時間戳目錄。

全部目標須先通過 READY、決策及依賴圖合併驗證，才開始寫檔。Recipe analysis 的 `generationDependencies` 只記錄實際選定 Item／Tag 代表／Alternative 路線的直接依賴；批次僅根據這些邊進行拓樸排序，各目標原有排列只用於穩定排序，不將相鄰但無關的材料當成依賴。獨立材料順序相反仍可合併；真實依賴循環、同物品依賴選擇不一致或缺少依賴資料則停止。不同執行批次仍隔離，不覆寫舊 preview；以迴圈分別呼叫多次命令仍是多個獨立批次，應改用一次多目標命令。

- BIO ID：移除 `minecraft:` 後轉成大寫，例如 `IRON_INGOT`。
- aliases：同時保留 BIO ID 與 canonical `minecraft:*` ID。
- generation order：使用已確認的 Base Route／Tag／Alternative 決策建立 bottom-up preview 順序。
- BIO 內容：仍列出該 item 的全部合法 recipes，不刪除未選為 Base Route 的取得方式。
- quantity：原樣保存 `ingredient.qty` 與每條 route 的 `recipe.output`，不做需求量 scaling。
- Base Material：已鎖定為外部取得的物品會輸出 `base_material: true`。天然原木和蕈柄的採集資訊寫在「外部取得」段落。
- Base Route Decision：編譯為緊貼路線列點前的 `<!-- preferred -->`；首選路線和所在小節排在最前，其他已解析的取得方式仍保留。
- `generator_schema: 2` 表示 BIO Markdown 的格式版本；`generated_by` 記錄產生工具。
- 每份新產生的 BIO 都會明確標示一個 preferred。既有決策優先，唯一可用的非循環 route 也會被標記；沒有配方時標記外部取得列點。純渲染呼叫未傳入決策時，以穩定排序的第一條路線提供顯示預設值。
- Tag：保留 Tag identity，不把 values 全部相加。
- Alternative：同色系材料統合成 `obsf:color_family/*` 衍生群組，與 Minecraft item tag 分開。
- 配方補充資訊：以 `- [note:: 說明]` 顯示經驗、處理時間、材料角色與其他非依賴欄位；未知 metadata 使用原始 key 與值，不靜默丟棄。sourceFile/category/group 為來源或分類資訊，不列為操作備註。
- result components：Normalized Registry 與生成模型保留原始資料，BIO 正文只以 NOTE 顯示差異，不再輸出「成品 Components」JSON 區塊。例如燉湯顯示 `效果：抗火；持續時間 60 ticks`，效果透過 `zh_tw.json` 的 `effect.*` 翻譯，缺翻譯時保留原 ID；不換算原始 ticks 或猜測缺失值。
- 人工補充標籤在產生 Preview 時加入。Base 或無生產配方使用 `#待補充`，其餘有配方的 BIO 使用 `#未人工檢查`。所有新產生的 Preview 加入 `#需攻略補充`，更新既有 BIO 另加 `#更新需人工解析`。審查完成後，移除前三種發布阻擋標籤並重跑 SCAN。SCAN 和 PUBLISH 保留審查結果。攻略補充標籤可保留。
- Preview Manifest 只顯示 Planned Items 數量，不再列出完整 Generation Order；實際產生順序仍採既有 bottom-up planning。
- existing BIO：只在 preview 目錄產生比較稿，不覆寫正式檔案。
- leaf／External Base：不自動推測為 `mc-drop`；若沒有既有 type mapping，輸出 `TYPE_REVIEW_REQUIRED` warning。

V3 不直接讀取 Decision Registry。Generator 將決策編譯進 BIO：`base_material: true` 會在 V3 建立虛擬「外部取得」路線，`<!-- preferred -->` 決定第一次展開的配方。V3 當次人工切換仍優先，不會刪除其他 routes。

Tag BIO preview 由 `Minecraft Tag BIO Mapping Draft.md` 控制。中文名稱必填，filename 留空時沿用中文名稱，BIO ID 留空時沿用 Tag path 的大寫；representative 必須有效，且 `generate=true` 才會產生。當次用到且啟用的 mapping 若有 ERROR（例如缺名稱或代表物無效），Generator 在建立 preview 目錄前停止。未啟用的列可繼續作為草稿；當次使用到的 tags 會摘要到 preview 目錄內的 `Tag BIO Name Review.md`。

Normalized Registry 保留 Minecraft ID，不在 parser 階段套用中文。Generator 讀取 `參考資料/Minecraft/zh_tw.json`：物品／方塊以 `item.*`／`block.*` 查找，名稱優先沿用現有 BIO。Tag 與衍生集合名稱由人工 mapping 提供，無法用單一物品翻譯推算。CLI 產生比較 preview；既有 BIO 可由 Templater 在人工確認與 Git 還原點驗證後套用。

### 既有 BIO 追加更新預覽

`node scripts/minecraft-bio-generator.cjs preview minecraft:piston --update-existing` 會在新時間戳 preview 目錄額外產生 `BIO Update Review.md`、`BIO Update Review.json` 及 `updates/*.update-preview.md`。加上 `--dry-run` 則僅輸出統計，不寫檔。它仍是預覽模式，沒有正式 BIO 寫回操作。

共用純模組 `bio/bio_update.js` 的 `planBIOUpdate(existingText, generatedText, options)` 在原有 `# 合成/取得` 內合併路線。同一三級取得方式與五級提供科技共用標題，不另建「追加候選」區段，也不把路線放到用途／產物後面。缺少的外部取得、preferred、NOTE、Preview 標籤及標準 YAML 欄位會補入；標準逐行 aliases 清單合併缺少值。允許四種管理標籤重建、刪除 YAML output、依 Mapping 修正機器分類與收緊配方間過多空行；其餘既有欄位、人工文字、圖片與 preferred 不刪改。

配方材料順序不影響比較；同設備／材料的 qty、output 或 Components 不同時不追加衝突路線，列為 REVIEW。同一 NOTE 欄位值不同、既有 YAML 值不同、非標準 aliases 格式、舊路線未出現在新來源及解析失敗也會列出。缺少 `base_material` 可依 Preview 補入；明確設定的原值則保留。來源未列出的舊路線可能是人工或插件內容，不能直接認定錯誤或刪除。Tag／衍生群組整份更新先維持人工審核。

更新狀態為 `NEW`、`UNCHANGED`、`ADDITIVE_UPDATE` 或 `REVIEW`。JSON 記錄原檔與候選 SHA-256 供寫回前驗證；不會將任何候選自動套用。CLI 的既有檔案範圍仍是 `MC-物品資料庫`，完整 Vault 盤點接入尚未完成。正式套用使用下方 Templater 入口；更新候選禁止追加指向暫存 preview 的配方連結。

### Templater 正式套用既有 BIO 更新

以 `preview <target> --update-existing` 產生更新預覽。審查完成後，在更新 Preview 移除阻擋標籤，再走集中 SCAN → PUBLISH。舊版 Templater 的 `MC-BIO套用更新` 只接受雜湊一致且已清除阻擋標籤的正式候選。可用 Templater 開啟原有候選檢視。

更新模式有兩個獨立輸出接口：`updates/*.update-preview.md` 保留原圖片／人工內容並連到同批 Preview，供測試 V4 與新排版；`formal-candidates/*.formal-candidate.md` 使用正式連結，是唯一可套用的內容。即使正式候選沒有變動，也可產生測試更新預覽。Manifest 的 previewFilename／previewSHA256 與 candidateFilename／candidateSHA256 分開記錄，預覽不能冒充正式候選。

測試更新預覽會重綁已有配方的材料連結；已證明完整且等價的 Tag 清單可收為同批索引連結，未證明者保留精確候選並只重綁可用成員。正式套用明確拒絕 updates 中的測試稿，也拒絕正式候選配方內殘留的 Preview 材料路徑，避免把時間戳測試依賴寫進正式 BIO。

更新候選會為既有未標明來源的機器路線補上五級標題：與本次 Vanilla 路線相符者標 `Minecraft 原版`；有唯一設備 BIO 可參考者標其來源資料夾；其餘標「其他」。獨立的 `- [[來源 BIO]]` 引用也會依唯一找到的 SF 檔案補來源資料夾標題，保留原三級分類，不套用 Machine Mapping。既有明確的五級標題不改寫。保留圖片、人工 YAML（output 除外）、preferred 及舊配方，管理標籤依新規則重建並加上 `#更新需人工解析`。衝突數值不自動取代；套用 REVIEW 仍需人工解析。

每次正式寫回前，`scripts/lib/bio-apply.cjs` 會檢查原檔與候選的 SHA-256，並建立 `refs/obsf/bio-checkpoints/<timestamp>-<uuid>` Git 還原點。還原點使用獨立暫存 index 和 commit-tree 保存這一份 BIO 的當下內容；不移動分支、不修改使用者暫存區、不將其他未提交檔案一起提交。此 ref 是本機還原點，不會隨一般分支 push 自動上傳。沒有 Git、Git identity 不完整、位於 main/master、原檔過期或還原點驗證失敗時停止，不寫回。

Git 還原點建立成功後，再透過 `app.vault.process` 二次驗證原文並寫入；寫後驗證內容雜湊。成功時顯示 ref，並在 `BIO-輸出報告/BIO Apply-<timestamp>.json` 記錄來源、原檔 hash、候選 hash 與 checkpoint。原檔被其他插件修改時不自動重試或回滾。需要復原時，以報告中的 ref 和 sourcePath 執行 `git restore --source <ref> --worktree -- <sourcePath>`，只復原該份 BIO。

舊版 Templater 入口僅支援既有 Minecraft Item BIO。Templater Script folder 維持 `BIO engine`。套用後可重新執行 MC-BIO盤點。

### 盤點使用方式

Templater User Script folder 維持 `BIO engine`，執行模板 `模板放置處/MC-BIO盤點.md`。`tp.user.bio_inventory(tp)` 每次重新取得 Vault 的 Markdown 檔案清單與 metadata cache，不讀取所有 BIO 正文。輸出時間戳摘要與 JSON 至 `BIO-輸出報告`，不修改 BIO。

盤點以 Item／Tag／衍生群組的 identity 區分，排除 preview 目錄與 `.preview.md`。查詢回傳 `PRESENT`、`MISSING`、`CONFLICT`、`INVALID` 或 `UNCONFIRMED`；cache 未就緒或身份資料不完整時，不能把查不到直接當成可新增。舊 `PLANKS` 等只有 uppercase ID、沒有 `minecraft_tag` 的集合 BIO 會列為需補 identity，不猜成普通物品。檔案存在與人工驗收分開；沒有待檢查標籤也不代表已驗收。

共用純模組為 `bio/bio_inventory.js`，API `buildBIOInventory(documents, options).get(kind, id)`。Templater 當次盤點也保存於 `globalThis.__obsfBIOInventories[vaultRoot]`；檔案異動後需重新執行盤點。這個入口提供新建／更新的前置索引，目前尚未加入正式 Generator 的自動跳過或覆寫模式。

`### Tag 代表材料` 下逐行列出 `- [item:: [[橡木材]]]` 等候選，用 `<!-- preferred -->` 指定下一個列點為預設代表物。V4 直接把 Tag 的需求量交給被選成員，沿用該成員自己的取得路線。

預覽中的連結優先指向同批產物。Tag BIO 尚未產生或建立時，配方用 Tag 名稱顯示，連結指向已選的代表物。Normalized Recipe 仍保留原本的 Tag ID 與成員。

外部取得段落使用 `- 分類：說明`，例如 `- 採集：砍伐天然生成的橡木原木。`。已確認的 Base，以及只有外部取得的 BIO，都在列點前輸出 `<!-- preferred -->`。來源尚未確認時輸出 `- 外部取得：具體來源待人工確認。`。

V4 在 `### 外部取得` 中逐行讀取列點，以第一個全形冒號拆成分類和說明，保留完整文字供介面顯示。建議分類為「採集」「採掘」「掉落」「戰利品」「外部取得」。`<!-- preferred -->` 套用到下一個列點，選定外部取得路線時作為遞歸終點。自由文字列點以原文顯示並歸入「外部取得」。人工可直接維護列點文字和 preferred 位置。

### BIO 搜尋介面 V4

衍生色系 BIO 的成員集合由完整的記憶體 Normalized Registry 收集，不以單一 target 的生成路線子集合驗證全域代表物。例如白羊毛染色路線排除白羊毛作為輸入，不代表全域「任意羊毛」也要排除白羊毛。只為當次用到的群組產生索引，每條 recipe 的合法 alternatives 仍保留原本範圍，不因全域索引擴充而放寬。

路線下拉選單以提供科技作 optgroup 標題，同組選項僅顯示「機器 ｜ 材料」。不同產量造成重複標籤時補上產量，燉湯等效果差異保留；完整來源、取得方式與產量可在選項 tooltip 查看。顯示分組不改變正文 preferred 的選擇順序，材料下拉仍保留原有行為。

新生成的 NOTE 使用 `處理時間 200 ticks`、`經驗值 0.7`；底層仍保留原始 `cookingTime` 欄位。V4 讀取舊的「烹調時間（原始 ticks）：200」「烹調時間 200 ticks」「經驗值：0.7」時，也以新格式呈現；不直接修改舊 BIO。更新比較會辨識相同欄位及值，單純排版差異不重複加 NOTE，實際數值不同仍列入審核。

`generate=false` 只停用獨立 Tag BIO 的生成，配方中的 Tag 仍保留合法材料下拉。已有確認身份的正式 Tag BIO 或當次生成的 Tag preview 時，材料改連到該索引並由 V4 導航，不重複內嵌清單。染色的 alternatives 必須保留該配方的精確成員，不能因存在「任意羊毛」就放入原配方不接受的顏色。

染色集合可使用 `<!-- except self -->` 緊接下一個材料行，保留 `[[黑色羊毛|任意羊毛]]` 這類代表材料連結；此時不再重複列出長篇 `obsf:choices`。只有已驗證可讀集合的完整成員恰等於原配方候選加成品自身、且各候選數量一致時才輸出此格式，否則保留原清單。self 是配方成品的 canonical Minecraft identity，並非代表材料或集合 BIO。

V4 依成品顏色 family 尋找對應 `derived_group` 集合，同一批次資料夾優先，再使用唯一正式集合；不借用其他 preview 批次。讀取成員後排除成品自身，在合法候選內優先使用材料行的代表連結，仍可手動切換；每個成品的排除與選擇分開，不修改共享集合或原配方 preferred。缺少集合／身份不明／排除後無候選需列診斷並保留需求，不能退回不合法成員。

完整 Tag 與衍生集合的成員完全一致時，可以共用同一個實體 BIO。例如繪畫的 `#minecraft:wool` 直接連到「任意羊毛」，使用完整 16 色；染色則保留代表材料連結並用 `except self` 排除成品自身。Tag 身份仍保留於來源 Registry，不因共用顯示索引而改寫。只有唯一且已驗證可讀的集合可共用；原 Tag 有自身可用 BIO 時優先沿用，否則無法證明等價就保留精確清單。

原生 Tag 之間也可依相同規則共用，例如 `wooden_tool_materials` 展開後與 `planks` 完整成員一致，就共用「任意木材」，保留木製工具的一條配方與材料下拉。候選原生／衍生索引依實際路徑去重，只有唯一完整目標才共用；正式集合須驗證正文，不能只憑 YAML identity 或檔案存在判定完整。不同批次 preview 不作正式候選的依據。

指定的小集合於 BIO 顯示階段展開為完整機器配方：`minecraft:soul_fire_base_blocks` 確認恰為靈魂砂／靈魂土時列兩條；`minecraft:stone_tool_materials` 確認恰為鵝卵石／黑石／深板岩碎石時列三條。每條路線只使用一種材料，保留原材料數量與產量，僅代表材料所屬路線繼承 preferred，不另列任意材料或混搭路線。成員變更、同條配方出現多個需展開的集合或其他未指定 Tag 時，不猜測展開組合，保留原集合格式；Registry 不變。

測試 preview 使用當次批次的預覽路徑，正式更新候選則使用正式 BIO 名稱。原 Templater 仍限既有 Item／Drop。11/16 新增 `preview --all` 與獨立 `publish --manifest=...` 批次入口：先產生全物品預覽，人工調整 type／排版，再檢查並以 `--write` 發布 NEW Item／集合與更新既有 BIO；會轉正式連結並建立 Git 還原點。REVIEW、原內容保留、身份與集合完整性仍須驗證。新入口尚待使用者執行測試；完整指令與失敗處理見根目錄 `BIO產生流程.md`。

根目錄 `Recipe Mapping Draft.md` 管理設備到三級配方分類的對應；Generator、Publisher 與單檔套用入口共用 `RECIPE_MAPPING_FILE`，改名後不再讀取舊檔名。只分類含 Machine 的配方，外部取得與 Tag 代表材料維持原樣；唯一匹配的啟用規則才修正標題，缺少或衝突規則列入診斷。預覽後若修改 Mapping，正式套用會停止並要求重建候選。同組設備配方條目緊貼、不留空行；標題與配方之間保留一行空白。分類修正不改材料、產量、NOTE、preferred 或設備配方順序。

Mini Parser 另讀取同檔的 Machine Dictionary 與 Provider Headings，每次執行使用同一份表格快照，不保留寫死的設備中文 fallback。重複已啟用設備 ID 或錯誤表格會停止；未知／停用的來源設備 ID 原樣保留並警告。Mini Parser 的新 BIO 不寫 YAML output，Java／YAML／手動仍各自產生配方內 `[output:: N]`；追加既有 BIO 不修改其原 YAML。Mini Parser 仍維持 `### 常規` 和跨插件 `#####` 層級，不自動接入 Machine 分類搬移。11/20 新增相關 mock 與路徑回歸案例，尚待使用者執行與 Obsidian 實測。

新生及更新候選不保留 YAML `output`，舊數值直接移除，不轉為配方產量。V4 只使用選定路線的 `[output:: n]`；未填預設為 1，忽略舊 YAML `output`。解析器仍須明確輸出非 1 的產量。

配方的 `### 取得方式` 可包含 `##### 提供科技`。Generator 的 Vanilla 機器路線使用 `##### Minecraft 原版`，V4 保留三級取得方式並另外讀取五級 provider。`Minecraft 原版` 對應已勾選的 MC 資料夾，`Slimefun 原版` 對應已勾選的 `SF-*(原版)` 資料夾，其他 provider 名稱須與範圍資料夾一致。舊 BIO 沒有 provider 時仍相容，不自行推測來源。

多個 `<!-- preferred -->` 是合法的有序優先候選，不再產生 MULTIPLE_PREFERRED／MULTIPLE_TAG_PREFERRED 警告。選擇次序為：當次有效的手動選擇 → 過濾後正文最前面的 preferred → 過濾後正文第一條路線。preferred 不再繞過取得方式篩選，也不特別把「常規」排到正文前。自動 fallback 不寫入當次手動選擇 Map，所以恢復範圍後可以回到首選；正式 BIO 標記不變。Tag 的候選仍是擇一，不會相加。

全數路線不可用時保留需求量，在遞歸樹用橘字備註「目前科技／取得方式範圍沒有可用配方」，不自動設為 Base。報告列為 NO_ALLOWED_RECIPE 且 complete=false，與分析上限截斷、缺少 BIO 分開。

更新預覽可依明確的 Slimefun／SF provider，或唯一且 type 為 sf-* 的設備 BIO，辨識其他科技路線。這些路線以 OTHER_SOURCE_PRESERVED 記錄，保留而不要求存在於 Vanilla JSON。這只是來源辨識，並非宣告所有配方數值已驗收；無法確認來源者仍需審核。

在 Obsidian 開啟 `黏液科技DB 搜尋介面V4.md`，以 DataviewJS 執行搜尋介面。頁面從 Vault 讀取 `BIO相關模組/搜尋介面模塊/bio_reader_v4.js`，沿用 V3 的搜尋、資料夾範圍、材料統計與設備需求介面。

- 取得路線下拉同時顯示外部取得和機器配方；葉節點也可切換到另一條配方。
- 首次開啟預設納入所有取得小節，選取後可用原有的小節篩選縮小範圍。
- 外部取得的原文會顯示在依賴樹、最終材料表與純文字報告。
- `preferred` 提供初次展開的預設值。當次手動切換會優先，換目標時清空當次選擇。
- Tag 和 alternatives 的下拉每次選一個候選，切換後重新計算產量、需求量與最終材料。
- 舊 BIO 的 Machine、qty、output、Base YAML，以及 qty-free Tag 代表列仍可讀取。
- 配方的 result components 保留，用於區分可疑燉湯等效果不同的路線。
- 路線下的 `- [note:: 說明]` 會附加到配方樹、Mermaid、製作教程與輸出檔案。多方塊結構使用 `Machine:: 無/手動`，並以 NOTE 提供搭建說明。
- 循環、缺少 BIO 和無效候選資料會顯示診斷。

Generator 對已連結到 Tag BIO 的材料，只輸出材料連結和需求數量。候選集中在 Tag BIO 的逐行 item 列中，由 preferred 決定預設值，V4 沿文件連結展開。舊版 Tag 成員表和獨立代表列仍可讀取。Tag BIO 尚未建立時，以及配方特有的 alternatives，暫以 `<!-- obsf:choices {...} -->` 保存確切候選範圍。

Node 測試涵蓋純讀取模組及使用 Vault／DOM 替身的 V4 頁面入口。實際 Obsidian 整合仍需在 DEV Vault 手動驗證。

### V4 報告、製作教程與分析保護

「複製 Markdown＋製作教程」輸出 Mermaid 配方樹、三類編號 Checklist，以及由底層備料、設備製作到成品的製作教程。每條教程最多列出五種材料，超過五種時拆成備料步驟。批數與產量沿用目前選中的路線；重複需求合併時保留原先計算的批數和材料成本。

預設深度上限 200、總展開節點 1000（含設備依賴），並有 30 秒分析時間保護與每 50 節點讓出 UI 的處理。V4 的「分析保護」可自行調整，最多 500 層、2000 節點、60 秒；時間欄位直接以秒輸入。觸及限制的分支標成未展開，保留部分結果並標示統計可能不完整。Mermaid 預設最多顯示 200 節點；圖表截斷與分析截斷分別記錄。

報告較大或分析被截斷時，V4 提示改用 Templater 輸出 JSON／PDF。JSON 保留目前已分析的資料、選中路線與完成狀態；輸出格式切換不會自動補跑被截斷的依賴。

報告警告逐項區分「分析已截斷」「缺少物品 BIO」「缺少設備 BIO」「循環依賴」「缺少可用配方」「取得說明待確認」和「BIO 格式錯誤」，多種原因可並列。Mermaid 的圖表顯示上限另行提示。JSON 的 `assessment` 保存各類原因與受影響項目。

Templater 設定與操作：

1. Template folder location 保持 `模板放置處`。
2. Script files folder location 設為 `BIO engine`，重新整理 User script functions，確認可偵測 `export_report_v4`。
3. 在 V4 完成一次分析。
4. 點選分析標題旁、複製按鈕右邊的「📤 匯出其他格式」。也可以手動執行 `Templater: Open insert template modal`，選擇 `V4-輸出製作報告`。
5. 選 Markdown、JSON 或 PDF。檔案寫入 `BIO-輸出報告/`，每次使用新的時間戳檔名。

輸出腳本為 `BIO engine/export_report_v4.js`，模板呼叫 `tp.user.export_report_v4(tp)`。PDF 透過桌面 Obsidian 的 Electron 隱藏列印視窗產生，列印版使用縮排依賴樹與可列印 Checklist。若目前 Obsidian 無法建立列印視窗，腳本會回報錯誤，可改選 JSON。PDF 的真實桌面輸出仍需手動驗證。

染色 alternatives 的衍生群組名稱由 `Minecraft BIO Group Mapping Draft.md` 維護，當次摘要為 `Derived BIO Group Name Review.md`。可疑的燉湯不依 result item 去重；不同 `result.components` 仍是不同效果 route。

## Deferred Optimizations

- **Potion／Brewing component-aware normalization（低優先級）**：Minecraft 藥水 variants 共用 `minecraft:potion`、`minecraft:splash_potion`、`minecraft:lingering_potion` 等 item ID，實際 identity 與效果存在 `minecraft:potion_contents`。未來若納入 Brewing Registry，需保存 base potion component、釀造材料、output component，以及 copy／replace transform semantics；不可將所有藥水壓成同一普通 item recipe。
- 目前 raw recipe/tag source 不含完整 Brewing Registry；`minecraft:crafting_imbue`（例如 tipped arrow）繼續作為 component-copying `SPECIAL` boundary。
- 此項不阻擋目前 Slimefun 主流程、Vanilla dependency review 或 BIO Generator 第一階段；待實際需要解析藥水取得鏈時再實作，不在目前階段擴充 schema。

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
