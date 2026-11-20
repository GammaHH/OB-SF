---
type: mc-tag-bio-mapping-draft
target: minecraft:piston
generated_from: dependency-graph
updated: 2026-11-09 15:31
created: 2026-08-21 16:00
---

# Minecraft Item Tag BIO Mapping Draft

本表記錄 dependency graph 使用到的 item tags。`Tag ID` 是 `minecraft:item_tag` identity，不是普通 Minecraft item ID。`generate=true` 只允許 BIO Generator 建立 preview；不會覆寫正式 BIO。

填寫規則：中文名稱必填；`filename` 留空沿用中文名稱，`BIO ID` 留空沿用 Tag path 大寫。確認代表材料後再啟用 `generate=true`。當次使用到的已啟用列若缺名稱或有無效代表材料，Generator 會停止，不產生不完整的新 preview。修改本表後直接重新執行 Generator preview 即可；不必為了命名重跑 Decision recalculate。

| Tag ID                              | BIO ID   | 中文名稱     | filename  | generate | Representative Item ID | note                                                 |
| ----------------------------------- | -------- | -------- | --------- | -------- | ---------------------- | ---------------------------------------------------- |
| #minecraft:acacia_logs              |          | 任意相思原木   |           | true     | minecraft:acacia_log   |                                                      |
| #minecraft:bamboo_blocks            |          | 任意竹材     |           | true     | minecraft:bamboo_block |                                                      |
| #minecraft:birch_logs               |          | 任意樺木原木   |           | true     | minecraft:birch_log    |                                                      |
| #minecraft:cherry_logs              |          | 任意櫻花木原木  |           | true     | minecraft:cherry_log   |                                                      |
| #minecraft:crimson_stems            |          | 任意緋紅菌柄   |           | true     | minecraft:crimson_stem |                                                      |
| #minecraft:dark_oak_logs            |          | 任意黑橡木原木  |           | true     | minecraft:dark_oak_log |                                                      |
| #minecraft:iron_tool_materials      |          |          |           | false    |                        |                                                      |
| #minecraft:jungle_logs              |          | 任意叢林木原木  |           | true     | minecraft:jungle_log   |                                                      |
| #minecraft:mangrove_logs            |          | 任意紅樹林原木  |           | true     | minecraft:mangrove_log |                                                      |
| #minecraft:oak_logs                 | OAK_LOGS | 任意橡木原木   | 任意橡木原木.md | true     | minecraft:oak_log      | 四種橡木原料集中在 Tag BIO，以 preferred 指定代表物                  |
| #minecraft:pale_oak_logs            |          | 任意蒼白橡木原木 |           | true     | minecraft:pale_oak_log |                                                      |
| #minecraft:planks                   | PLANKS   | 任意木材     | 任意木材.md   | true     | minecraft:oak_planks   | Tag BIO preview 試用；Tag identity 與普通 item identity 分離 |
| #minecraft:spruce_logs              |          | 任意杉木原木   |           | true     | minecraft:spruce_log   |                                                      |
| #minecraft:warped_stems             |          | 任意扭曲菌柄   |           | true     | minecraft:warped_stem  |                                                      |
| #minecraft:wooden_slabs             |          | 任意木半磚    |           | true     | minecraft:oak_slab     |                                                      |
| #minecraft:smelts_to_glass          |          | 任意沙類     |           | true     | minecraft:sand         |                                                      |
| #minecraft:bundles                  |          | 各色束口袋    |           | true     | minecraft:bundle       |                                                      |
| #minecraft:shulker_boxes            |          | 各色界伏盒    |           | true     | minecraft:shulker_box  |                                                      |
| #minecraft:stone_crafting_materials |          | 任意石材     |           | true     | minecraft:cobblestone  |                                                      |
| #minecraft:eggs                     |          | 蛋類       |           | true     | minecraft:egg          |                                                      |
| #minecraft:logs_that_burn           |          | 可燒製木炭原木  |           | true     | minecraft:oak_log      |                                                      |
| #minecraft:leaves                   |          |          |           | false    | minecraft:oak_leaves   |                                                      |
| #minecraft:metal_nuggets            |          |          |           | false    | minecraft:iron_nugget  |                                                      |
| #minecraft:wool                     |          | 任意羊毛     |           | false    | minecraft:white_wool   | 成員一致時共用 obsf:color_family/wool，不另建重複 BIO             |
| #minecraft:logs                     | LOGS     | 任意原木     |           | true     | minecraft:oak_log      |                                                      |
| #minecraft:soul_fire_base_blocks    |          |          |           | false    | minecraft:soul_sand    |                                                      |
| #minecraft:stone_tool_materials     |          |          |           | false    | minecraft:cobblestone  |                                                      |
| #minecraft:wooden_tool_materials    |          | 任意木材     |           | false    | minecraft:oak_planks   | 成員一致時共用 minecraft:planks，不另建重複 BIO                   |
| #minecraft:coals                    |          |          |           | false    | minecraft:coal         |                                                      |
