---
type: minecraft-base-material-review
schemaVersion: 1
target: minecraft:piston
sourceFingerprint: sha256:8f687b3c5a89d38f9c8e23285ba2dc5b93c7db76aaf8b8c2834432e8dab49bdd
created: 2026-11-04 13:31
updated: 2026-11-08 00:43
---

<!-- obsf:base-material-review:start -->
# Minecraft Base Material Review

- Target Item ID: `minecraft:piston`
- Schema Version: `1`
- Source Fingerprint: `sha256:8f687b3c5a89d38f9c8e23285ba2dc5b93c7db76aaf8b8c2834432e8dab49bdd`

## 循環群組

### `cycle-946b2c92528a`

- 候選：`minecraft:cobblestone`, `minecraft:stone`
- 路徑：`minecraft:cobblestone` → `minecraft:stone` → `minecraft:cobblestone`

### `cycle-cd127ce01c79`

- 候選：`minecraft:raw_iron`, `minecraft:raw_iron_block`
- 路徑：`minecraft:raw_iron_block` → `minecraft:raw_iron` → `minecraft:raw_iron_block`

## Base Material Selection

> 只解析下列 marker 內的 Checkbox。請自行勾選外部取得來源；系統不會自動全選。

<!-- obsf:base-material-selection:start -->
- 無候選
<!-- obsf:base-material-selection:end -->

## Additional External Base Materials

> 用於採掘、掉落、loot table 等 Recipe JSON 無法表達的外部來源。
> 只有下列 markers 內的 Checkbox 會被解析；可直接新增一行，不必手寫內部 block markers。

<!-- obsf:external-base-materials:start -->
> 尚無項目。請複製下一行、移除開頭的 `>`，再填入實際 ID：
> - [ ] `minecraft:item_id`
<!-- obsf:external-base-materials:end -->

## Locked Base Decisions

<!-- obsf:base-material-locked:start -->
<!-- obsf:locked-base:start minecraft:cobblestone candidate -->
- Item: `minecraft:cobblestone`
- Source: `candidate`
- Status: `LOCKED`（不提供 Checkbox，避免誤改）
<!-- obsf:notes:start -->
<!-- 在此輸入人工備註 -->
<!-- obsf:notes:end -->
<!-- obsf:locked-base:end minecraft:cobblestone -->

<!-- obsf:locked-base:start minecraft:raw_iron candidate -->
- Item: `minecraft:raw_iron`
- Source: `candidate`
- Status: `LOCKED`（不提供 Checkbox，避免誤改）
<!-- obsf:notes:start -->
<!-- 在此輸入人工備註 -->
<!-- obsf:notes:end -->
<!-- obsf:locked-base:end minecraft:raw_iron -->

<!-- obsf:locked-base:start minecraft:redstone external -->
- Item: `minecraft:redstone`
- Source: `external`
- Status: `LOCKED`（不提供 Checkbox，避免誤改）
<!-- obsf:notes:start -->
<!-- 在此輸入人工備註，例如：挖掘掉落 -->
<!-- obsf:notes:end -->
<!-- obsf:locked-base:end minecraft:redstone -->

<!-- obsf:base-material-locked:end -->

## 未解決的循環

- 無
<!-- obsf:base-material-review:end -->
