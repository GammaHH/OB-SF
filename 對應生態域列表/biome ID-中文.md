---
created: 2026-08-08 15:54
updated: 2026-08-08 15:56
---
- 目前解析器的「生態域對應表」

### 主世界

| Minecraft biome ID                   | 中文      |
| ------------------------------------ | ------- |
| `minecraft:plains`                   | 平原      |
| `minecraft:sunflower_plains`         | 向日葵平原   |
| `minecraft:snowy_plains`             | 雪原      |
| `minecraft:ice_spikes`               | 冰刺平原    |
| `minecraft:desert`                   | 沙漠      |
| `minecraft:swamp`                    | 沼澤      |
| `minecraft:forest`                   | 森林      |
| `minecraft:flower_forest`            | 繁花森林    |
| `minecraft:birch_forest`             | 樺木森林    |
| `minecraft:dark_forest`              | 黑森林     |
| `minecraft:old_growth_birch_forest`  | 原始樺木森林  |
| `minecraft:old_growth_pine_taiga`    | 原始松木針葉林 |
| `minecraft:old_growth_spruce_taiga`  | 原始杉木針葉林 |
| `minecraft:taiga`                    | 針葉林     |
| `minecraft:snowy_taiga`              | 雪地針葉林   |
| `minecraft:savanna`                  | 莽原      |
| `minecraft:savanna_plateau`          | 莽原高地    |
| `minecraft:windswept_hills`          | 風襲丘陵    |
| `minecraft:windswept_gravelly_hills` | 風襲礫質丘陵  |
| `minecraft:windswept_forest`         | 風襲森林    |
| `minecraft:windswept_savanna`        | 風襲莽原    |
| `minecraft:jungle`                   | 叢林      |
| `minecraft:sparse_jungle`            | 稀疏叢林    |
| `minecraft:bamboo_jungle`            | 竹林      |
| `minecraft:badlands`                 | 惡地      |
| `minecraft:eroded_badlands`          | 侵蝕惡地    |
| `minecraft:wooded_badlands`          | 樹林惡地    |
| `minecraft:meadow`                   | 草甸      |
| `minecraft:grove`                    | 雪林      |
| `minecraft:snowy_slopes`             | 積雪山坡    |
| `minecraft:frozen_peaks`             | 冰封山峰    |
| `minecraft:jagged_peaks`             | 尖峭山峰    |
| `minecraft:stony_peaks`              | 石峰      |
| `minecraft:river`                    | 河流      |
| `minecraft:frozen_river`             | 凍河      |
| `minecraft:beach`                    | 海灘      |
| `minecraft:snowy_beach`              | 積雪沙灘    |
| `minecraft:stony_shore`              | 石岸      |
| `minecraft:ocean`                    | 海洋      |
| `minecraft:deep_ocean`               | 深海      |
| `minecraft:warm_ocean`               | 溫暖海洋    |
| `minecraft:lukewarm_ocean`           | 溫海      |
| `minecraft:deep_lukewarm_ocean`      | 溫暖深海    |
| `minecraft:cold_ocean`               | 冷海      |
| `minecraft:deep_cold_ocean`          | 冷水深海    |
| `minecraft:frozen_ocean`             | 凍洋      |
| `minecraft:deep_frozen_ocean`        | 冰凍深海    |
| `minecraft:mushroom_fields`          | 蘑菇原野    |
| `minecraft:dripstone_caves`          | 鐘乳石洞窟   |
| `minecraft:lush_caves`               | 蒼鬱洞窟    |

### 地獄

| Minecraft biome ID           | 中文     |
| ---------------------------- | ------ |
| `minecraft:nether_wastes`    | 地獄荒地   |
| `minecraft:soul_sand_valley` | 靈魂砂谷   |
| `minecraft:crimson_forest`   | 緋紅森林   |
| `minecraft:warped_forest`    | 扭曲森林   |
| `minecraft:basalt_deltas`    | 玄武岩三角洲 |

### 終界

| Minecraft biome ID            | 中文   |
| ----------------------------- | ---- |
| `minecraft:the_end`           | 終界   |
| `minecraft:end_highlands`     | 終界高地 |
| `minecraft:end_midlands`      | 終界中地 |
| `minecraft:small_end_islands` | 終界小島 |
| `minecraft:end_barrens`       | 終界荒地 |

對應到程式實際儲存的資料就是：

```js
"minecraft:basalt_deltas": {
    name: "玄武岩三角洲",
    environment: "nether"
}
```

因此看到：

```json
{
    "value": 64,
    "biomes": [
        "minecraft:basalt_deltas"
    ]
}
```

最後就會轉成：

```markdown
- **地獄**：[biome:: 玄武岩三角洲] [supply:: 64]
```

目前這份共有 **60 個 biome 對應**：主世界 50、地獄 5、終界 5。
