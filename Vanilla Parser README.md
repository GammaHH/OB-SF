---
created: 2026-08-12 17:37
updated: 2026-08-12 17:39
---

```text
MC解析器模塊/
└─ README.md
```

可以先寫成這麼短：

````md
# OB-SF Minecraft Vanilla Parser

## Purpose

將 Minecraft Vanilla Recipe JSON 轉換成統一的 Normalized Recipe Object，
供後續：

- BIO 自動建立
- Recipe Dependency Analysis
- V3 遞迴材料計算

使用。

---

# Normalized Item

```json
{
  "id": "minecraft:barrel",
  "name": "木桶",
  "recipes": [],
  "warnings": []
}
````

同一 Minecraft Item 可以擁有多條 recipes。

`recipes[]` 之間為不同製作方式，不代表全部都需要執行。

---

# Normalized Recipe

```json
{
  "sourceType": "minecraft:crafting_shaped",
  "section": "常規",
  "machine": "工作台",
  "output": 1,
  "ingredients": [],
  "meta": {}
}
```

## output

單次 Recipe 執行所產生的物品數量。

例如：

```json
"output": 4
```

表示一次配方產生 4 個成品。

---

# Ingredient Types

## item

固定材料。

```json
{
  "kind": "item",
  "id": "minecraft:iron_ingot",
  "qty": 3
}
```

表示需要：

3 × Iron Ingot

---

## tag

Minecraft Item Tag。

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

語意：

需要 6 個屬於 `#minecraft:planks` 的物品。

`values` 中的物品為「可接受的材料」，
不是全部都需要。

例如：

oak_planks ×6

或

spruce_planks ×6

皆可滿足此 Ingredient。

Tag 不應直接轉換成多個同時需要的 Ingredient。

---

## alternatives

Recipe JSON 直接定義的替代材料。

```json
{
  "kind": "alternatives",
  "alternatives": [
    {
      "kind": "item",
      "id": "minecraft:a"
    },
    {
      "kind": "item",
      "id": "minecraft:b"
    }
  ],
  "qty": 1
}
```

語意：

A 或 B 擇一。

與 `kind: "tag"` 不同：

* tag = Minecraft Tag membership
* alternatives = Recipe 本身直接提供多個替代 Ingredient

兩者都具有「擇一」性質，但來源與資料結構不同。

---

# Tag System

Tag Registry 由：

```text
參考資料/Minecraft/tags/item/
參考資料/Minecraft/tags/block/
```

自動建立。

Recipe Ingredient 使用 Item Tag，因此 Recipe Resolution 使用：

```text
registryType = "item"
```

Tag Resolver 支援：

```text
Tag
→ Item

Tag
→ Nested Tag
→ Item
```

並具有：

* Nested Tag Resolution
* Cycle Detection
* required:false
* Duplicate Removal

````

Tag 成功解析後保留原始 Tag：

```json
{
  "kind": "tag",
  "id": "minecraft:planks",
  "resolved": true,
  "values": [...]
}
````

不直接改寫成 alternatives。

---

# Multiple Recipes

例如：

```json
{
  "id": "minecraft:example",
  "recipes": [
    { "sourceType": "..." },
    { "sourceType": "..." }
  ]
}
```

代表同一物品具有多種製作方法。

後續 V3 / BIO Dependency Calculation 必須選擇其中一條 Recipe，
不可將不同 Recipe 的 Ingredients 相加。

---

# qty vs output

```text
ingredient.qty
```

= 單次 Recipe 所需材料數量。

```text
recipe.output
```

= 單次 Recipe 產生成品數量。

例如：

```text
2 Iron Ingot
→
4 Example Item
```

則：

```json
{
  "output": 4,
  "ingredients": [
    {
      "id": "minecraft:iron_ingot",
      "qty": 2
    }
  ]
}
```

後續需求換算必須考慮 output。

---

# Status

OK

Parser 已能正常理解資料。

REVIEW

資料已解析，但存在需要後續處理的語意，例如 alternatives，
或 Recipe Type 尚未支援。

ERROR

JSON 或 Parser 結構錯誤。

---

# Current Parser Architecture

```text
Minecraft Recipe JSON
        ↓
Recipe Parser
        ↓
Normalized Ingredient
        ↓
Tag Resolver
        ↓
Normalized Recipe
        ↓
Normalized Item Registry
        ↓
Minecraft Normalized Recipes.json
```

Tag：

```text
Minecraft Tag JSON
        ↓
Tag Parser
        ↓
Tag Registry
        ↓
Tag Resolver
```

---

# Important Rules for BIO Generation

BIO Generator should treat:

```text
kind:item
```

as fixed material.

```text
kind:tag
```

as one Ingredient with multiple acceptable Item IDs.

```text
kind:alternatives
```

as mutually exclusive Ingredient alternatives.

Multiple `recipes[]` are also mutually exclusive production methods.

Never sum all Tag values together.

Never sum all Alternative values together.

Never sum multiple Recipes together unless explicitly requested.

````

---

這份 README 的價值其實不是「讓我現在看懂」，而是建立一個 **Schema Contract**：

```text
Parser 說：
「我保證輸出的資料代表這個意思。」

BIO Generator 說：
「我按照這個意思讀。」
````

這樣後面 Parser 和 BIO Generator 才不會彼此耦合得亂七八糟。

### 到 BIO 自動生成階段要給我什麼？

那時候我最希望拿到的是：

```text
README.md
Minecraft Normalized Recipes.json
1～3 個你目前正式使用的 BIO.md 範例
```

然後我就可以直接做：

```text
Normalized Recipe
        ↓
判斷 output item 是否已有 BIO
        ↓
判斷 ingredient 是否已有 BIO
        ↓
Tag / Alternatives 處理
        ↓
Dependency ordering
        ↓
建立缺失 BIO
        ↓
寫入 recipes[]
```

**`Minecraft Tag Registry.json` 到時候不一定需要給。**

因為現在 Normalized Recipe 已經有：

```json
{
  "kind": "tag",
  "id": "minecraft:planks",
  "resolved": true,
  "values": [...]
}
```

也就是 BIO Generator 所需要的 Tag 結果已經內嵌進去了。

Tag Registry 比較像是：

> Parser 的基礎資料 / Debug / 重新解析來源。

而不是 BIO Generator 的必要輸入。

所以長期來看會是很漂亮的分層：

```text
原始 Minecraft JSON
        ↓
[ Vanilla Parser ]
        ↓
Normalized Recipes.json
        ↓
========================
        ↑ 這裡是介面邊界
========================
        ↓
[ BIO Generator ]
        ↓
BIO/*.md
```

**README 就是這條介面邊界的說明書。**

我會建議現在就建立，而且保持短小；以後每當我們新增一種真正會影響 BIO 語意的東西，例如 `smithing_transform` 或 `crafting_transmute`，才補 README。不要把它寫成「每支 JS 怎麼運作」的程式文件，那樣很快就會過時。
