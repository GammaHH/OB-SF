---
type: minecraft-recipe-review
schemaVersion: 1
target: minecraft:granite_slab
sourceFingerprint: sha256:8f687b3c5a89d38f9c8e23285ba2dc5b93c7db76aaf8b8c2834432e8dab49bdd
baseSelectionFingerprint: sha256:b1c47797302d16d52604e4149ea4a2769f4225d7050201101becb762f3606b86
created: 2026-11-04 14:56
updated: 2026-11-09 01:13
---

<!-- obsf:recipe-review:start -->
# Minecraft Recipe Review

- Target: `minecraft:granite_slab`
- Source Fingerprint: `sha256:8f687b3c5a89d38f9c8e23285ba2dc5b93c7db76aaf8b8c2834432e8dab49bdd`
- Base Selection Fingerprint: `sha256:b1c47797302d16d52604e4149ea4a2769f4225d7050201101becb762f3606b86`

<!-- obsf:recipe-review-active:start -->

## Base Route for Generation Planning

<!-- obsf:ambiguity:start recipe-group-20c8a0764f9b4e9a recipe -->
### minecraft:granite_slab

- Group ID: `recipe-group-20c8a0764f9b4e9a`
- Type: `recipe`

> 此處只選擇 BIO bottom-up generation planning 使用的 Base Route。
> 所有合法 recipes 與 External acquisition 仍保留於 Normalized Registry，未來 BIO 會列出全部取得方式。

- [ ] `external-base:minecraft:granite_slab` <!-- obsf:choice-id:external-base:minecraft:granite_slab --> — External acquisition：採掘／掉落／loot → 設為 Base
- [ ] `recipe-3d606b0d0e1996e6` <!-- obsf:choice-id:recipe-3d606b0d0e1996e6 --> — minecraft:crafting_shaped / 工作台 / output 6 / minecraft:granite ×3 / 參考資料/Minecraft/recipe/granite_slab.json
- [ ] `recipe-ac65ab98b38b172d` <!-- obsf:choice-id:recipe-ac65ab98b38b172d --> — minecraft:stonecutting / 切石機 / output 2 / minecraft:granite ×1 / 參考資料/Minecraft/recipe/granite_slab_from_granite_stonecutting.json

<!-- obsf:notes:start -->
<!-- 在此輸入人工備註 -->
<!-- obsf:notes:end -->
<!-- obsf:ambiguity:end recipe-group-20c8a0764f9b4e9a -->


## Tag Selection

- 無 active ambiguity

## Ingredient Alternative Selection

- 無 active ambiguity
<!-- obsf:recipe-review-active:end -->

## Locked Decisions

<!-- obsf:recipe-review-locked:start -->
- 無
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

- **WARNING MISSING_ACTIVE_SECTION** — 找不到 Recipe Review active managed section；視為尚未產生 selection
- **INFO MISSING_SELECTION** — Ambiguity group 尚未選擇：recipe-group-20c8a0764f9b4e9a

## Route-aware BLOCKED

- 無

## Planning Cycles

- 無
<!-- obsf:recipe-review:end -->
