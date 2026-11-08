---
type: minecraft-recipe-review
schemaVersion: 1
target: minecraft:piston
sourceFingerprint: sha256:8f687b3c5a89d38f9c8e23285ba2dc5b93c7db76aaf8b8c2834432e8dab49bdd
baseSelectionFingerprint: sha256:e1d7f51b4597cab932403a54143a288911ae0e6212aa45df0927c69fd0ccb3a7
created: 2026-11-04 14:56
updated: 2026-11-08 00:42
---

<!-- obsf:recipe-review:start -->
# Minecraft Recipe Review

- Target: `minecraft:piston`
- Source Fingerprint: `sha256:8f687b3c5a89d38f9c8e23285ba2dc5b93c7db76aaf8b8c2834432e8dab49bdd`
- Base Selection Fingerprint: `sha256:e1d7f51b4597cab932403a54143a288911ae0e6212aa45df0927c69fd0ccb3a7`

<!-- obsf:recipe-review-active:start -->

## Multiple Recipe Selection

- 無 active ambiguity

## Tag Selection

<!-- obsf:ambiguity:start tag-69570e3894a316f9 tag -->
### #minecraft:oak_logs ×1

- Group ID: `tag-69570e3894a316f9`
- Type: `tag`

- [x] `minecraft:oak_log` <!-- obsf:choice-id:minecraft:oak_log --> — minecraft:oak_log
- [ ] `minecraft:oak_wood` <!-- obsf:choice-id:minecraft:oak_wood --> — minecraft:oak_wood
- [ ] `minecraft:stripped_oak_log` <!-- obsf:choice-id:minecraft:stripped_oak_log --> — minecraft:stripped_oak_log
- [ ] `minecraft:stripped_oak_wood` <!-- obsf:choice-id:minecraft:stripped_oak_wood --> — minecraft:stripped_oak_wood

<!-- obsf:notes:start -->
<!-- 在此輸入人工備註 -->
<!-- obsf:notes:end -->
<!-- obsf:ambiguity:end tag-69570e3894a316f9 -->


## Ingredient Alternative Selection

- 無 active ambiguity
<!-- obsf:recipe-review-active:end -->

## Locked Decisions

<!-- obsf:recipe-review-locked:start -->
<!-- obsf:locked-ambiguity:start recipe-group-59a6d04f60d1c3a5 recipe recipe-6585e4f859775cf4 -->
### minecraft:iron_ingot

- Group ID: `recipe-group-59a6d04f60d1c3a5`
- Type: `recipe`
- Selected: `recipe-6585e4f859775cf4` — minecraft:smelting / 熔爐 / output 1 / minecraft:raw_iron ×1 / 參考資料/Minecraft/recipe/iron_ingot_from_smelting_raw_iron.json
- Status: `LOCKED`（不提供 Checkbox，避免誤改）

<!-- obsf:notes:start -->
<!-- 在此輸入人工備註 -->
<!-- obsf:notes:end -->
<!-- obsf:locked-ambiguity:end recipe-group-59a6d04f60d1c3a5 -->

<!-- obsf:locked-ambiguity:start tag-fb92523eb1a5d7e4 tag minecraft:oak_planks -->
### #minecraft:planks ×3

- Group ID: `tag-fb92523eb1a5d7e4`
- Type: `tag`
- Selected: `minecraft:oak_planks` — minecraft:oak_planks
- Status: `LOCKED`（不提供 Checkbox，避免誤改）

<!-- obsf:notes:start -->
<!-- 在此輸入人工備註 -->
<!-- obsf:notes:end -->
<!-- obsf:locked-ambiguity:end tag-fb92523eb1a5d7e4 -->

<!-- obsf:recipe-review-locked:end -->

## Readiness

```json
{
  "readyForBioGeneration": false,
  "blocked": 0,
  "unresolvedAmbiguities": 1,
  "invalidSelections": 0,
  "planningCycles": 0
}
```

## Diagnostics

- **WARNING BASE_SELECTION_FINGERPRINT_CHANGED** — Base Material selections 已變更；active route 與 ambiguities 已重新計算
- **INFO MISSING_SELECTION** — Ambiguity group 尚未選擇：tag-69570e3894a316f9
- **WARNING CANDIDATE_NO_LONGER_ON_ACTIVE_ROUTE** — Ambiguity group 已不在目前 active route：recipe-group-7ebfd79ceaee860b

## Route-aware BLOCKED

- 無

## Planning Cycles

- 無

## Inactive / Stale Ambiguities（需重新審核）

<!-- obsf:inactive-ambiguity:start recipe-group-7ebfd79ceaee860b recipe -->
### `recipe-group-7ebfd79ceaee860b` — inactive / stale

> 此 group 已不在目前 active route，selection 不會套用。

> - [ ] `recipe-5f4833c92958ac29` <!-- obsf:inactive-choice-id:recipe-5f4833c92958ac29 --> — minecraft:blasting / 高爐 / output 1 / minecraft:deepslate_redstone_ore ×1 / 參考資料/Minecraft/recipe/redstone_from_blasting_deepslate_redstone_ore.json
> - [ ] `recipe-da0897d2322efee9` <!-- obsf:inactive-choice-id:recipe-da0897d2322efee9 --> — minecraft:blasting / 高爐 / output 1 / minecraft:redstone_ore ×1 / 參考資料/Minecraft/recipe/redstone_from_blasting_redstone_ore.json
> - [ ] `recipe-352fc6a29380197a` <!-- obsf:inactive-choice-id:recipe-352fc6a29380197a --> — minecraft:smelting / 熔爐 / output 1 / minecraft:deepslate_redstone_ore ×1 / 參考資料/Minecraft/recipe/redstone_from_smelting_deepslate_redstone_ore.json
> - [ ] `recipe-caaea921e2d84c2a` <!-- obsf:inactive-choice-id:recipe-caaea921e2d84c2a --> — minecraft:smelting / 熔爐 / output 1 / minecraft:redstone_ore ×1 / 參考資料/Minecraft/recipe/redstone_from_smelting_redstone_ore.json
<!-- obsf:notes:start -->
<!-- 在此輸入人工備註 -->
<!-- obsf:notes:end -->
<!-- obsf:inactive-ambiguity:end recipe-group-7ebfd79ceaee860b -->

<!-- obsf:recipe-review:end -->
