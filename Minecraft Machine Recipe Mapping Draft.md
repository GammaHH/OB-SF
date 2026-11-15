---
type: minecraft-machine-recipe-mapping
schemaVersion: 1
---

# Machine 配方分類對照

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
