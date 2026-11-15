const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const vanilla = require("../../BIO相關模組/MC解析器模塊");

function registry(entries) {
    return new Map(entries);
}

function bioRegistry(entries = []) {
    const values = new Map(entries);
    return { get(itemId) { return values.get(itemId) ?? null; } };
}

function recipe(overrides = {}) {
    return {
        sourceType: "minecraft:crafting_shaped",
        section: "常規",
        machine: "工作台",
        output: 1,
        ingredients: [],
        meta: { sourceFile: "recipe/test.json" },
        ...overrides
    };
}

test("BIO identity uses uppercase path ID and canonical Minecraft alias", () => {
    assert.equal(vanilla.bio.bioIdForItem("minecraft:iron_ingot"), "IRON_INGOT");
    assert.deepEqual(
        vanilla.bio.aliasesForItem("minecraft:iron_ingot"),
        ["IRON_INGOT", "minecraft:iron_ingot"]
    );
});

test("BIO name resolver supports both item and block translation keys", () => {
    const translations = {
        "item.minecraft.iron_ingot": "鐵錠",
        "block.minecraft.piston": "活塞"
    };
    assert.equal(
        vanilla.bio.resolveTranslatedName("minecraft:iron_ingot", translations),
        "鐵錠"
    );
    assert.equal(
        vanilla.bio.resolveTranslatedName("minecraft:piston", translations),
        "活塞"
    );
});

test("BIO preview preserves tag identity, ingredient qty, and recipe output", () => {
    const itemRegistry = registry([["minecraft:piston", {
        id: "minecraft:piston",
        recipes: [recipe({
            output: 2,
            ingredients: [{
                kind: "tag",
                id: "minecraft:planks",
                qty: 3,
                resolved: true,
                values: ["minecraft:oak_planks"]
            }]
        })]
    }]]);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:piston", {
        itemRegistry,
        translations: { "block.minecraft.piston": "活塞" },
        bioRegistry: bioRegistry()
    });
    const markdown = vanilla.bio.renderBIOPreview(model, {
        bioRegistry: { entries: [{ tag_identity: "minecraft:item_tag", minecraft_tag: "minecraft:planks",
            path: "MC-物品資料庫/任意木材.md", name: "任意木材" }] },
        tagMappings: new Map([["minecraft:planks", {
            filename: "任意木材.md",
            zhName: "任意木材"
        }]])
    });
    assert.match(markdown, /\[item:: \[\[MC-物品資料庫\/任意木材\|任意木材\]\]\] \(qty:: 3\)/);
    assert.doesNotMatch(markdown, /obsf:choices/);
    assert.equal(model.recipes[0].ingredients[0].id, "minecraft:planks");
    assert.match(markdown, /\[output:: 2\]/);
});

test("BIO preview keeps alternatives mutually exclusive without summing choices", () => {
    const itemRegistry = registry([["minecraft:torch", {
        id: "minecraft:torch",
        recipes: [recipe({
            output: 4,
            ingredients: [{
                kind: "alternatives",
                qty: 1,
                alternatives: [
                    { kind: "item", id: "minecraft:coal" },
                    { kind: "item", id: "minecraft:charcoal" }
                ]
            }]
        })]
    }]]);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:torch", {
        itemRegistry,
        translations: {
            "block.minecraft.torch": "火把",
            "item.minecraft.coal": "煤炭",
            "item.minecraft.charcoal": "木炭"
        },
        bioRegistry: bioRegistry()
    });
    const markdown = vanilla.bio.renderBIOPreview(model, {
        translations: {
            "item.minecraft.coal": "煤炭",
            "item.minecraft.charcoal": "木炭"
        }
    });
    assert.match(markdown, /擇一材料.*qty:: 1/);
    assert.match(markdown, /\[item:: \[\[煤炭\]\]\]/);
    assert.match(markdown, /\[item:: \[\[木炭\]\]\]/);
    assert.equal((markdown.match(/qty:: 1/g) ?? []).length, 1);
});

test("BIO preview renders every legal recipe route and each route output", () => {
    const itemRegistry = registry([["minecraft:stick", {
        id: "minecraft:stick",
        recipes: [
            recipe({
                output: 4,
                meta: { sourceFile: "recipe/stick.json" },
                ingredients: [{ kind: "tag", id: "minecraft:planks", qty: 2 }]
            }),
            recipe({
                output: 1,
                meta: { sourceFile: "recipe/stick_from_bamboo_item.json" },
                ingredients: [{ kind: "item", id: "minecraft:bamboo", qty: 2 }]
            })
        ]
    }]]);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:stick", {
        itemRegistry,
        translations: { "item.minecraft.stick": "木棒" },
        bioRegistry: bioRegistry()
    });
    const markdown = vanilla.bio.renderBIOPreview(model);
    assert.equal(model.recipes.length, 2);
    assert.deepEqual(
        new Map(model.recipes.map(route => [route.meta.sourceFile, route.output])),
        new Map([
            ["recipe/stick.json", 4],
            ["recipe/stick_from_bamboo_item.json", 1]
        ])
    );
    assert.doesNotMatch(markdown, /Recipe Type|來源/);
    assert.doesNotMatch(markdown, /^output:/m, "BIO frontmatter must not override route-specific batch output");
    assert.equal((markdown.match(/\[output:: /g) ?? []).length, 2, "each Machine route owns its output field");
    assert.equal((markdown.match(/<!-- preferred -->/g) ?? []).length, 1);
    assert.match(markdown, /\[item:: #minecraft:planks\] \(qty:: 2\)\n\t- \[output:: 4\]/);
    assert.match(markdown, /\[item:: \[\[bamboo\]\]\] \(qty:: 2\)\n\t- \[output:: 1\]/);
});

test("BIO preview retains raw component metadata internally and renders only readable NOTE fields", () => {
    const itemRegistry = registry([["minecraft:suspicious_stew", {
        id: "minecraft:suspicious_stew",
        recipes: [recipe({
            meta: {
                sourceFile: "recipe/suspicious_stew_from_allium.json",
                resultComponents: {
                    "minecraft:suspicious_stew_effects": [{
                        id: "minecraft:fire_resistance",
                        duration: 80
                    }]
                }
            }
        })]
    }]]);
    const model = vanilla.bio.createBIOGenerationModel(
        "minecraft:suspicious_stew",
        { itemRegistry, bioRegistry: bioRegistry() }
    );
    const markdown = vanilla.bio.renderBIOPreview(model, { translations: { "effect.minecraft.fire_resistance": "抗火" } });
    assert.doesNotMatch(markdown, /成品 Components|```json|"duration"/);
    assert.match(markdown, /\[note:: 效果：抗火；持續時間 80 ticks\]/);
    assert.deepEqual(model.recipes[0].meta.resultComponents["minecraft:suspicious_stew_effects"],
        [{ id: "minecraft:fire_resistance", duration: 80 }]);
});

test("supplemental recipe data uses NOTE and translates effect IDs without changing components", () => {
    const components = { "minecraft:suspicious_stew_effects": [{ id: "minecraft:night_vision", duration: 100 }],
        "example:future_component": { enabled: true } };
    const meta = { sourceFile: "recipe/test.json", cookingTime: 200, experience: 0,
        futureMetadata: "keep me", resultComponents: components };
    const model = vanilla.bio.createBIOGenerationModel("minecraft:suspicious_stew", {
        itemRegistry: registry([["minecraft:suspicious_stew", { recipes: [recipe({ meta,
            ingredients: [{ kind: "item", id: "minecraft:bowl", qty: 1 }]
        })] }]])
    });
    const markdown = vanilla.bio.renderBIOPreview(model, {
        translations: { "effect.minecraft.night_vision": "夜視" }
    });
    assert.match(markdown, /\[note:: 效果：夜視；持續時間 100 ticks\]/);
    assert.match(markdown, /\[note:: 經驗值 0\]/);
    assert.match(markdown, /\[note:: 處理時間 200 ticks\]/);
    assert.match(markdown, /補充資訊（futureMetadata）：keep me/);
    assert.match(markdown, /成品資訊（example:future_component）/);
    assert.deepEqual(model.recipes[0].meta.resultComponents, components);
    const reader = require("../../BIO相關模組/搜尋介面模塊/bio_reader_v4");
    const parsed = reader.parseBIO(markdown, {});
    assert.deepEqual(parsed.diagnostics, []);
    assert.equal(parsed.recipes.length, 1, "NOTE round-trip requires a valid recipe with an ingredient");
    assert.equal(parsed.recipes[0].ingredients.length, 1);
    assert.ok(parsed.recipes[0].notes.some(note => note.includes("效果：夜視")));
    assert.equal(parsed.recipes[0].components, undefined);
    assert.ok(parsed.recipes[0].notes.some(note => note.includes("example:future_component")));
    assert.doesNotMatch(markdown, /成品 Components|```json/);
});

test("enabled Tag previews require a Chinese name while disabled drafts remain warnings", () => {
    const make = generate => vanilla.bio.createTagBIOGenerationModel("minecraft:oak_logs", {
        tagMappings: new Map([["minecraft:oak_logs", { generate, representativeItemId: "minecraft:oak_log" }]]),
        resolveTag: () => ({ values: ["minecraft:oak_log"], warnings: [] })
    });
    assert.equal(make(true).diagnostics.find(entry => entry.code === "TAG_BIO_NAME_REQUIRED").severity, "ERROR");
    assert.equal(make(false).diagnostics.find(entry => entry.code === "TAG_BIO_NAME_REQUIRED").severity, "WARNING");
    for (const generate of [true, false]) {
        const derived = vanilla.bio.createDerivedGroupBIOGenerationModel("obsf:color_family/wool", ["minecraft:white_wool"], {
            groupMappings: new Map([["obsf:color_family/wool", { generate, representativeItemId: "minecraft:white_wool" }]])
        });
        assert.equal(derived.diagnostics.find(entry => entry.code === "DERIVED_GROUP_NAME_REQUIRED").severity,
            generate ? "ERROR" : "WARNING");
    }
});

test("preview Manifest retains summary counts without a long generation-order listing", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../scripts/minecraft-bio-generator.cjs"), "utf8");
    const start = source.indexOf("function renderManifest(context)");
    const end = source.indexOf("\nfunction preview(", start);
    assert.ok(start >= 0 && end > start);
    const render = require("node:vm").runInNewContext(source.slice(start, end) + "\nrenderManifest;");
    const result = render({ target: "minecraft:piston", fingerprint: "test", ready: true,
        models: [{ itemId: "minecraft:piston", diagnostics: [] }], existingCount: 0,
        tagModels: [], generatedTagModels: [], groupModels: [], generatedGroupModels: [],
        entries: [{ itemId: "minecraft:piston", filename: "活塞.preview.md" }],
        tagEntries: [], groupEntries: [], warningCount: 0 });
    assert.match(result, /Planned Items: \*\*1\*\*/);
    assert.doesNotMatch(result, /## Generation Order|活塞\.preview/);
});

test("suspicious stew routes stay separate when result effects differ", () => {
    const allium = recipe({
        meta: {
            sourceFile: "recipe/suspicious_stew_from_allium.json",
            resultComponents: {
                "minecraft:suspicious_stew_effects": [{
                    id: "minecraft:fire_resistance",
                    duration: 60
                }]
            }
        },
        ingredients: [{ kind: "item", id: "minecraft:allium", qty: 1 }]
    });
    const poppy = recipe({
        meta: {
            sourceFile: "recipe/suspicious_stew_from_poppy.json",
            resultComponents: {
                "minecraft:suspicious_stew_effects": [{
                    id: "minecraft:night_vision",
                    duration: 100
                }]
            }
        },
        ingredients: [{ kind: "item", id: "minecraft:poppy", qty: 1 }]
    });
    const model = vanilla.bio.createBIOGenerationModel(
        "minecraft:suspicious_stew",
        {
            itemRegistry: registry([["minecraft:suspicious_stew", {
                id: "minecraft:suspicious_stew",
                recipes: [allium, poppy]
            }]]),
            bioRegistry: bioRegistry(),
            preferredRecipeId: vanilla.dependencies.recipeIdentity(
                "minecraft:suspicious_stew",
                poppy
            )
        }
    );
    const markdown = vanilla.bio.renderBIOPreview(model);
    assert.equal(model.recipes.length, 2);
    assert.doesNotMatch(markdown, /minecraft:suspicious_stew_effects|成品 Components|```json/);
    assert.match(markdown, /\[note:: 效果：minecraft:fire_resistance；持續時間 60 ticks\]/);
    assert.match(markdown, /\[note:: 效果：minecraft:night_vision；持續時間 100 ticks\]/);
    assert.equal((markdown.match(/<!-- preferred -->/g) ?? []).length, 1);
});

test("leaf previews request type review while existing mc-drop type is preserved", () => {
    const itemRegistry = registry([]);
    const unknown = vanilla.bio.createBIOGenerationModel("minecraft:raw_iron", {
        itemRegistry,
        bioRegistry: bioRegistry()
    });
    assert.equal(unknown.type, "mc-item");
    assert.equal(unknown.diagnostics[0].code, "TYPE_REVIEW_REQUIRED");
    const existing = vanilla.bio.createBIOGenerationModel("minecraft:rotten_flesh", {
        itemRegistry,
        bioRegistry: bioRegistry([["minecraft:rotten_flesh", {
            name: "腐肉",
            type: "mc-drop"
        }]])
    });
    assert.equal(existing.type, "mc-drop");
    assert.equal(existing.name, "腐肉");
});

test("preview filenames are deterministic and Windows-safe", () => {
    assert.equal(
        vanilla.bio.safeFilename("測試:物品/名稱*", "TEST_ITEM"),
        "測試_物品_名稱_"
    );
});

test("BIO recipe dictionary groups smelting and blasting under one section", () => {
    const smelting = vanilla.bio.bioRecipeTypeInfo({
        sourceType: "minecraft:smelting"
    });
    const blasting = vanilla.bio.bioRecipeTypeInfo({
        sourceType: "minecraft:blasting"
    });
    assert.equal(smelting.section, "熔煉配方");
    assert.equal(blasting.section, "熔煉配方");
    assert.equal(smelting.machine, "熔爐");
    assert.equal(blasting.machine, "高爐");

    const itemRegistry = registry([["minecraft:iron_ingot", {
        id: "minecraft:iron_ingot",
        recipes: [
            recipe({
                sourceType: "minecraft:smelting",
                machine: "熔爐",
                meta: { sourceFile: "recipe/iron_ingot_from_smelting.json" }
            }),
            recipe({
                sourceType: "minecraft:blasting",
                machine: "高爐",
                meta: { sourceFile: "recipe/iron_ingot_from_blasting.json" }
            })
        ]
    }]]);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:iron_ingot", {
        itemRegistry,
        bioRegistry: bioRegistry()
    });
    const markdown = vanilla.bio.renderBIOPreview(model);
    assert.equal(model.recipes.length, 2);
    assert.equal(model.recipes.every(route => route.section === "熔煉配方"), true);
    assert.match(markdown, /Machine:: \[\[熔爐\]\]/);
    assert.match(markdown, /Machine:: \[\[高爐\]\]/);
    assert.equal((markdown.match(/### 熔煉配方/g) ?? []).length, 1);
});

test("Machine mapping changes only recipe classification while preserving external and Tag bodies", () => {
    const { parseMachineRecipeMappings } = require("../../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping");
    const { rules, diagnostics } = parseMachineRecipeMappings([
        "| provider | machine | sourceType | section | enabled |",
        "| --- | --- | --- | --- | --- |",
        "| Minecraft 原版 | 熔爐 | minecraft:smelting | 自訂熔煉分類 | true |"
    ].join("\n"));
    assert.deepEqual(diagnostics, []);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:iron_ingot", {
        externalBase: true,
        itemRegistry: registry([["minecraft:iron_ingot", { recipes: [recipe({
            sourceType: "minecraft:smelting", machine: "熔爐",
            ingredients: [{ kind: "item", id: "minecraft:raw_iron", qty: 1 }]
        })] }]])
    });
    const machineMappingDiagnostics = [];
    const mapped = vanilla.bio.renderBIOPreview(model, { machineMappings: rules, machineMappingDiagnostics });
    assert.deepEqual(machineMappingDiagnostics, []);
    assert.match(mapped, /### 自訂熔煉分類\n\n##### Minecraft 原版\n\n- .*Machine:: \[\[熔爐\]\]/);
    assert.equal(model.recipes[0].section, "熔煉配方", "presentation mapping must not mutate normalized recipes");
    assert.match(mapped, /### 外部取得\n\n<!-- preferred -->\n- 外部取得：具體來源待人工確認。/);
    const tag = vanilla.bio.createTagBIOGenerationModel("minecraft:planks", {
        tagMappings: new Map([["minecraft:planks", { zhName: "任意木材", generate: true }]]),
        resolveTag: () => ({ values: ["minecraft:oak_planks"], warnings: [] })
    });
    assert.equal(vanilla.bio.renderTagBIOPreview(tag, { machineMappings: rules }), vanilla.bio.renderTagBIOPreview(tag));
    const missingDiagnostics = [];
    const fallback = vanilla.bio.renderBIOPreview(model, { machineMappings: [], machineMappingDiagnostics: missingDiagnostics });
    assert.match(fallback, /### 熔煉配方/);
    assert.ok(missingDiagnostics.length > 0, "unmatched Machine classification must be visible to the caller");
});

test("Machine routes retain heading spacing and have no blank separator with NOTE-only component display", () => {
    const model = vanilla.bio.createBIOGenerationModel("minecraft:suspicious_stew", {
        itemRegistry: registry([["minecraft:suspicious_stew", { recipes: [
            recipe({ ingredients: [{ kind: "item", id: "minecraft:allium", qty: 1 }],
                meta: { sourceFile: "a.json", resultComponents: { effect: "one" } } }),
            recipe({ ingredients: [{ kind: "item", id: "minecraft:poppy", qty: 1 }],
                meta: { sourceFile: "b.json", resultComponents: { effect: "two" } } })
        ] }]])
    });
    const markdown = vanilla.bio.renderBIOPreview(model);
    assert.match(markdown, /### 合成配方\n\n##### Minecraft 原版\n\n<!-- preferred -->\n- .*Machine::/);
    assert.match(markdown, /\[note:: 成品資訊（effect）：one\]\n- .*Machine::/);
    assert.doesNotMatch(markdown, /\[note:: 成品資訊（effect）：one\]\n\n+- .*Machine::/);
    assert.doesNotMatch(markdown, /成品 Components|```/);
});

test("ingredient fields reuse existing BIO type as item or drop", () => {
    const itemRegistry = registry([["minecraft:test", {
        id: "minecraft:test",
        recipes: [recipe({
            ingredients: [
                { kind: "item", id: "minecraft:iron_ingot", qty: 1 },
                { kind: "item", id: "minecraft:rotten_flesh", qty: 2 }
            ]
        })]
    }]]);
    const knownBIOs = bioRegistry([
        ["minecraft:iron_ingot", { name: "鐵錠", type: "mc-item" }],
        ["minecraft:rotten_flesh", { name: "腐肉", type: "mc-drop" }]
    ]);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:test", {
        itemRegistry,
        bioRegistry: knownBIOs
    });
    const markdown = vanilla.bio.renderBIOPreview(model, {
        bioRegistry: knownBIOs
    });
    assert.match(markdown, /\[item:: \[\[鐵錠\]\]\] \(qty:: 1\)/);
    assert.match(markdown, /\[drop:: \[\[腐肉\]\]\] \(qty:: 2\)/);
});

test("explicit base material is rendered as primary external acquisition while recipes remain", () => {
    const itemRegistry = registry([["minecraft:cobblestone", {
        id: "minecraft:cobblestone",
        recipes: [recipe({
            sourceType: "minecraft:smelting",
            machine: "熔爐",
            ingredients: [{ kind: "item", id: "minecraft:stone", qty: 1 }]
        })]
    }]]);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:cobblestone", {
        itemRegistry,
        bioRegistry: bioRegistry(),
        externalBase: true
    });
    const markdown = vanilla.bio.renderBIOPreview(model);
    assert.match(markdown, /^base_material: true$/m);
    assert.doesNotMatch(markdown, /^output:/m);
    assert.match(markdown, /^#待補充$/m);
    assert.doesNotMatch(markdown, /^#未人工檢查$/m);
    assert.match(markdown, /### 外部取得/);
    assert.match(markdown, /### 外部取得\n\n<!-- preferred -->\n- 外部取得：具體來源待人工確認。/);
    assert.equal((markdown.match(/<!-- preferred -->/g) ?? []).length, 1);
    assert.match(markdown, /### 熔煉配方/);
    assert.doesNotMatch(markdown, /minecraft:smelting/);
});

test("preferred planning route is compiled immediately before its Machine row", () => {
    const recipes = [
        recipe({
            meta: { sourceFile: "recipe/stick.json" },
            output: 4,
            ingredients: [{ kind: "tag", id: "minecraft:planks", qty: 2 }]
        }),
        recipe({
            meta: { sourceFile: "recipe/stick_from_bamboo_item.json" },
            output: 1,
            ingredients: [{ kind: "item", id: "minecraft:bamboo", qty: 2 }]
        })
    ];
    const preferredRecipeId = vanilla.dependencies.recipeIdentity(
        "minecraft:stick",
        recipes[1]
    );
    const model = vanilla.bio.createBIOGenerationModel("minecraft:stick", {
        itemRegistry: registry([["minecraft:stick", {
            id: "minecraft:stick",
            recipes
        }]]),
        bioRegistry: bioRegistry(),
        preferredRecipeId
    });
    const markdown = vanilla.bio.renderBIOPreview(model);
    assert.equal((markdown.match(/<!-- preferred -->/g) ?? []).length, 1);
    assert.match(
        markdown,
        /<!-- preferred -->\n- \*\*生產設備\*\*：\(Machine:: \[\[工作台\]\]\)[\s\S]*?\[item:: \[\[bamboo\]\]\] \(qty:: 2\)/
    );
});

test("the preferred route and its heading come first while every parsed route remains", () => {
    const recipes = [
        recipe({ meta: { sourceFile: "a.json" } }),
        recipe({ sourceType: "minecraft:blasting", machine: "高爐", meta: { sourceFile: "b.json" } }),
        recipe({ sourceType: "minecraft:smelting", machine: "熔爐", meta: { sourceFile: "c.json" } })
    ];
    const itemId = "minecraft:iron_ingot";
    const model = vanilla.bio.createBIOGenerationModel(itemId, {
        itemRegistry: registry([[itemId, { recipes }]]),
        preferredRecipeId: vanilla.dependencies.recipeIdentity(itemId, recipes[2])
    });
    const markdown = vanilla.bio.renderBIOPreview(model);
    assert.match(markdown, /# 合成\/取得\n\n### 熔煉配方\n\n##### Minecraft 原版\n\n<!-- preferred -->\n- .*Machine:: \[\[熔爐\]\]/);
    assert.match(markdown, /Machine:: \[\[高爐\]\]/);
    assert.match(markdown, /### 合成配方\n\n##### Minecraft 原版\n\n- .*Machine:: \[\[工作台\]\]/);
    assert.equal((markdown.match(/Machine::/g) ?? []).length, 3);
});

test("oak planks link to the reviewed log when the oak_logs Tag BIO is unavailable", () => {
    const itemId = "minecraft:oak_planks";
    const model = vanilla.bio.createBIOGenerationModel(itemId, {
        itemRegistry: registry([[itemId, { recipes: [recipe({
            output: 4,
            ingredients: [{
                kind: "tag",
                id: "minecraft:oak_logs",
                qty: 1,
                values: ["minecraft:oak_log", "minecraft:stripped_oak_log"]
            }]
        })] }]])
    });
    const markdown = vanilla.bio.renderBIOPreview(model, {
        itemPreviewTargets: new Map([["minecraft:oak_log", "preview/橡木原木.preview"]]),
        tagPreviewTargets: new Map(),
        tagMappings: new Map([["minecraft:oak_logs", {
            zhName: "任意橡木原木",
            representativeItemId: "minecraft:oak_log",
            generate: false
        }]])
    });
    assert.match(markdown, /\[item:: \[\[preview\/橡木原木\.preview\|任意橡木原木\]\]\] \(qty:: 1\)/);
    assert.match(markdown, /\[output:: 4\]/);
    assert.equal(model.recipes[0].ingredients[0].kind, "tag");

    const oakLog = vanilla.bio.createBIOGenerationModel("minecraft:oak_log", { naturalLog: true });
    const oakLogMarkdown = vanilla.bio.renderBIOPreview(oakLog);
    assert.doesNotMatch(oakLogMarkdown, /^base_material:/m);
    assert.match(oakLogMarkdown, /^#待補充$/m);
    assert.doesNotMatch(oakLogMarkdown, /^#未人工檢查$/m);
    assert.match(oakLogMarkdown, /### 外部取得\n\n<!-- preferred -->\n- 採集：砍伐天然生成的oak log。/);
    assert.equal((oakLogMarkdown.match(/<!-- preferred -->/g) ?? []).length, 1);
    const stripped = vanilla.bio.createBIOGenerationModel("minecraft:stripped_oak_log");
    assert.doesNotMatch(vanilla.bio.renderBIOPreview(stripped), /^base_material:/m);
});

test("a confirmed Base without recipes requests acquisition details without changing its Base decision", () => {
    const model = vanilla.bio.createBIOGenerationModel("minecraft:raw_iron", { externalBase: true });
    const markdown = vanilla.bio.renderBIOPreview(model);
    assert.match(markdown, /^base_material: true$/m);
    assert.match(markdown, /^#待補充$/m);
    assert.doesNotMatch(markdown, /^#未人工檢查$/m);
    assert.match(markdown, /<!-- preferred -->\n- 外部取得：具體來源待人工確認。/);
});

test("all generated ordinary, Tag and derived BIOs receive the guide tag and their applicable review tag", () => {
    const ordinary = vanilla.bio.createBIOGenerationModel("minecraft:stick", {
        itemRegistry: registry([["minecraft:stick", { recipes: [recipe({
            ingredients: [{ kind: "item", id: "minecraft:bamboo", qty: 2 }]
        })] }]])
    });
    const leaf = vanilla.bio.createBIOGenerationModel("minecraft:oak_log");
    const base = vanilla.bio.createBIOGenerationModel("minecraft:stick", {
        itemRegistry: registry([["minecraft:stick", { recipes: [recipe()] }]]), externalBase: true
    });
    const tag = vanilla.bio.createTagBIOGenerationModel("minecraft:planks", {
        tagMappings: new Map([["minecraft:planks", { zhName: "任意木材", generate: true }]]),
        resolveTag: () => ({ values: ["minecraft:oak_planks"], warnings: [] })
    });
    const group = vanilla.bio.createDerivedGroupBIOGenerationModel("obsf:color_family/wool", ["minecraft:white_wool"], {
        groupMappings: new Map([["obsf:color_family/wool", { zhName: "任意羊毛", generate: true }]])
    });
    for (const [model, renderer, primary] of [
        [ordinary, vanilla.bio.renderBIOPreview, "未人工檢查"],
        [leaf, vanilla.bio.renderBIOPreview, "待補充"],
        [base, vanilla.bio.renderBIOPreview, "待補充"],
        [tag, vanilla.bio.renderTagBIOPreview, "待補充"],
        [group, vanilla.bio.renderTagBIOPreview, "待補充"]
    ]) {
        const markdown = renderer(model);
        const statusTags = markdown.split("\n").filter(line => /^#(?:待補充|未人工檢查|更新需人工解析|需攻略補充)$/.test(line));
        assert.deepEqual(statusTags, ["#" + primary, "#需攻略補充"], model.kind || model.itemId);
    }
});

test("disabled Tag generation preserves choices and resolves only actual uniquely identified Tag BIOs", () => {
    const tagId = "minecraft:test_fire_materials";
    const values = ["minecraft:soul_sand", "minecraft:soul_soil"];
    const tagMappings = new Map([[tagId, {
        generate: false, filename: "", zhName: "任意靈魂營火基材", representativeItemId: values[0]
    }]]);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:soul_campfire", {
        itemRegistry: registry([["minecraft:soul_campfire", { recipes: [recipe({ ingredients: [
            { kind: "tag", id: tagId, qty: 1, values },
            { kind: "item", id: "minecraft:stick", qty: 3 }
        ] })] }]])
    });
    const translations = { "block.minecraft.soul_sand": "靈魂砂", "block.minecraft.soul_soil": "靈魂土", "item.minecraft.stick": "木棒" };
    const previewRoot = "MC-自動化BIO/preview/minecraft__soul_campfire/test";
    const previewOptions = { tagMappings, translations, tagPreviewTargets: new Map(),
        itemPreviewTargets: new Map([[values[0], previewRoot + "/靈魂砂.preview"], ["minecraft:stick", previewRoot + "/木棒.preview"]]) };
    const disabled = vanilla.bio.createTagBIOGenerationModel(tagId, {
        tagMappings, resolveTag: () => ({ values, warnings: [] })
    });
    assert.equal(disabled.generate, false);
    const preview = vanilla.bio.renderBIOPreview(model, previewOptions);
    assert.equal((preview.match(/Machine::/g) || []).length, 1, "other two-member Tags must not be expanded by the soul-fire allowlist");
    const choices = JSON.parse(preview.match(/<!-- obsf:choices (.+) -->/)[1]);
    assert.deepEqual(choices.choices.map(choice => choice.label), ["靈魂砂", "靈魂土"]);
    assert.equal(choices.defaultName, previewRoot + "/靈魂砂.preview");
    assert.match(preview, /木棒\.preview\|木棒\]\]\] \(qty:: 3\)/);

    // A configured filename or an ordinary same-name item is not a Tag identity.
    const configuredOnly = new Map([[tagId, { ...tagMappings.get(tagId), filename: "任意靈魂營火基材.md" }]]);
    const plainItem = { name: "任意靈魂營火基材", path: "MC-物品資料庫/任意靈魂營火基材.md", normalizedId: "minecraft:soul_sand" };
    const unbuilt = vanilla.bio.renderBIOPreview(model, { translations, tagMappings: configuredOnly, bioRegistry: { entries: [plainItem] } });
    assert.match(unbuilt, /obsf:choices/);
    assert.doesNotMatch(unbuilt, /\[\[MC-物品資料庫\/任意靈魂營火基材/);

    // Formal links use the stored path, even when filename is blank or the BIO was renamed.
    const formalTag = { tag_identity: "minecraft:item_tag", minecraft_tag: tagId,
        name: "靈魂營火材料", path: "MC-物品資料庫/靈魂營火材料.md" };
    const formal = vanilla.bio.renderBIOPreview(model, { translations, tagMappings, bioRegistry: { entries: [formalTag] } });
    assert.match(formal, /\[item:: \[\[MC-物品資料庫\/靈魂營火材料\|任意靈魂營火基材\]\]\] \(qty:: 1\)/);
    assert.match(formal, /\[item:: \[\[木棒\]\]\] \(qty:: 3\)/);
    assert.doesNotMatch(formal, /obsf:choices|preview\//);

    const conflicting = vanilla.bio.renderBIOPreview(model, { translations, tagMappings,
        bioRegistry: { entries: [formalTag, { ...formalTag, path: "其他/靈魂營火材料.md" }] } });
    assert.match(conflicting, /obsf:choices/, "ambiguous formal Tag identities must retain exact inline choices");
    const generated = vanilla.bio.renderBIOPreview(model, { ...previewOptions, bioRegistry: { entries: [formalTag] },
        tagPreviewTargets: new Map([[tagId, previewRoot + "/任意靈魂營火基材.preview"]]) });
    assert.match(generated, /任意靈魂營火基材\.preview\|任意靈魂營火基材/);
    assert.doesNotMatch(generated, /obsf:choices|MC-物品資料庫\//);
});

test("color-family alternatives collapse to one derived BIO link", () => {
    const model = vanilla.bio.createBIOGenerationModel("minecraft:red_wool", {
        itemRegistry: registry([["minecraft:red_wool", {
            id: "minecraft:red_wool",
            recipes: [recipe({
                ingredients: [
                    { kind: "item", id: "minecraft:red_dye", qty: 1 },
                    {
                        kind: "alternatives",
                        qty: 1,
                        alternatives: [
                            { kind: "item", id: "minecraft:white_wool" },
                            { kind: "item", id: "minecraft:blue_wool" },
                            { kind: "item", id: "minecraft:black_wool" }
                        ]
                    }
                ]
            })]
        }]]),
        bioRegistry: bioRegistry()
    });
    const markdown = vanilla.bio.renderBIOPreview(model, {
        alternativeGroupMappings: new Map([["obsf:color_family/wool", {
            zhName: "任意其他顏色羊毛",
            representativeItemId: "minecraft:white_wool"
        }]])
    });
    assert.match(markdown, /\[item:: \[\[white wool\|任意其他顏色羊毛\]\]\] \(qty:: 1\)/);
    assert.doesNotMatch(markdown, /擇一材料|blue_wool|black_wool/);
});

test("global color groups use full registry membership while keeping each route's excluded color", () => {
    const alternatives = ids => ({ kind: "alternatives", qty: 1,
        alternatives: ids.map(id => ({ kind: "item", id: "minecraft:" + id })) });
    const whiteInput = alternatives(["blue_wool", "brown_wool"]);
    const itemRegistry = new Map([
        ["minecraft:white_wool", { recipes: [recipe({ ingredients: [whiteInput] })] }],
        ["minecraft:blue_wool", { recipes: [recipe({ ingredients: [alternatives(["white_wool", "brown_wool"])] })] }],
        ["minecraft:white_bed", { recipes: [recipe({ ingredients: [alternatives(["blue_bed", "brown_bed"])] })] }]
    ]);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:white_wool", { itemRegistry });
    const local = vanilla.bio.collectDerivedAlternativeGroups([model]);
    assert.deepEqual(local[0].values, ["minecraft:blue_wool", "minecraft:brown_wool"]);
    const groups = vanilla.bio.collectDerivedAlternativeGroups([model], itemRegistry);
    assert.equal(groups.length, 1, "unused bed groups should not be generated");
    assert.deepEqual(groups[0].values, ["minecraft:blue_wool", "minecraft:brown_wool", "minecraft:white_wool"]);
    const groupMappings = new Map([["obsf:color_family/wool", {
        bioId: "ANY_WOOL", zhName: "任意羊毛", generate: true, representativeItemId: "minecraft:white_wool"
    }]]);
    const group = vanilla.bio.createDerivedGroupBIOGenerationModel(groups[0].groupId, groups[0].values, { groupMappings });
    assert.equal(group.diagnostics.some(entry => entry.severity === "ERROR"), false);
    assert.equal(group.representativeItemId, "minecraft:white_wool");
    const markdown = vanilla.bio.renderBIOPreview(model, { alternativeGroupMappings: groupMappings });
    const choices = JSON.parse(markdown.match(/<!-- obsf:choices (.+) -->/)[1]);
    assert.deepEqual(choices.choices.map(choice => choice.name).sort(), ["blue wool", "brown wool"]);
    assert.equal(model.recipes[0].ingredients[0].alternatives.some(choice => choice.id === "minecraft:white_wool"), false);
    const invalid = vanilla.bio.createDerivedGroupBIOGenerationModel(groups[0].groupId, groups[0].values, {
        groupMappings: new Map([[groups[0].groupId, { generate: true, zhName: "任意羊毛", representativeItemId: "minecraft:iron_ingot" }]])
    });
    assert.ok(invalid.diagnostics.some(entry => entry.code === "DERIVED_GROUP_REPRESENTATIVE_REQUIRED"));
});

test("white wool recoloring retains its exact inline list when a formal index lacks verified membership proof", () => {
    const colors = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray",
        "cyan", "purple", "blue", "brown", "green", "red", "black"];
    const allowed = colors.filter(color => color !== "white").map(color => "minecraft:" + color + "_wool");
    const model = vanilla.bio.createBIOGenerationModel("minecraft:white_wool", {
        itemRegistry: registry([["minecraft:white_wool", { recipes: [recipe({ ingredients: [
            { kind: "item", id: "minecraft:white_dye", qty: 1 },
            { kind: "alternatives", qty: 1, alternatives: allowed.map(id => ({ kind: "item", id })) }
        ] })] }]])
    });
    const markdown = vanilla.bio.renderBIOPreview(model, {
        alternativeGroupMappings: new Map([["obsf:color_family/wool", {
            zhName: "任意羊毛", representativeItemId: "minecraft:white_wool", generate: true
        }]]),
        bioRegistry: { entries: [{ derived_group: "obsf:color_family/wool", tag_identity: "obsf:derived_ingredient_group",
            name: "任意羊毛", path: "MC-物品資料庫/任意羊毛.md" }] }
    });
    const choices = JSON.parse(markdown.match(/<!-- obsf:choices (.+) -->/)[1]);
    assert.equal(choices.choices.length, 15);
    assert.deepEqual(choices.choices.map(choice => choice.name).sort(), allowed.map(id => id.slice(10).replaceAll("_", " ")).sort());
    assert.equal(choices.choices.some(choice => choice.name === "white wool"), false);
    assert.ok(markdown.includes(`[[${choices.choices[0].name}|任意羊毛]]`),
        "an excluded Mapping representative falls back to the first legal candidate");
    assert.doesNotMatch(markdown, /<!-- except self -->/);
    assert.doesNotMatch(markdown, /\[\[MC-物品資料庫\/任意羊毛/, "a sixteen-color index must not replace a constrained recipe ingredient");
});

function recoloringFixture(family, ownerColor, factor = 1, qty = 1) {
    const colors = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray",
        "cyan", "purple", "blue", "brown", "green", "red", "black"];
    const values = colors.map(color => `minecraft:${color}_${family}`);
    const owner = `minecraft:${ownerColor}_${family}`, groupId = `obsf:color_family/${family}`;
    const name = family === "wool" ? "羊毛" : "韁繩";
    const model = vanilla.bio.createBIOGenerationModel(owner, {
        itemRegistry: registry([[owner, { recipes: [recipe({ ingredients: [
            { kind: "item", id: `minecraft:${ownerColor}_dye`, qty: 1 },
            { kind: "alternatives", qty, alternatives: values.filter(id => id !== owner).map(id => ({ kind: "item", id, qty: factor })) }
        ] })] }]])
    });
    model.recipes[0].ingredients[1].selectedRepresentative = { kind: "item", id: `minecraft:black_${family}` };
    const options = {
        translations: { [`item.minecraft.black_${family}`]: "黑色" + name },
        alternativeGroupMappings: new Map([[groupId, { zhName: "任意" + name, generate: false, representativeItemId: `minecraft:white_${family}` }]]),
        alternativeGroupValues: new Map([[groupId, values]]),
        availableAlternativeGroups: new Set([groupId])
    };
    return { model, options, values, owner, groupId, name };
}

test("except-self compacts complete recoloring alternatives while preserving the reviewed representative link", () => {
    for (const [family, color] of [["wool", "white"], ["harness", "brown"]]) {
        const fixture = recoloringFixture(family, color);
        const markdown = vanilla.bio.renderBIOPreview(fixture.model, fixture.options);
        assert.match(markdown, new RegExp("<!-- except self -->\\n\\t- \\[item:: \\[\\[黑色" + fixture.name + "\\|任意" + fixture.name + "\\]\\]\\] \\(qty:: 1\\)"));
        assert.doesNotMatch(markdown, /obsf:choices/);
        assert.equal(fixture.model.recipes[0].ingredients[1].alternatives.length, 15);
        assert.equal(fixture.model.recipes[0].ingredients[1].selectedRepresentative.id, `minecraft:black_${family}`);
        const group = vanilla.bio.createDerivedGroupBIOGenerationModel(fixture.groupId, fixture.values, {
            groupMappings: fixture.options.alternativeGroupMappings
        });
        const groupMarkdown = vanilla.bio.renderTagBIOPreview(group);
        assert.equal((groupMarkdown.match(/^- \[item::/gm) || []).length, 16);
        assert.match(groupMarkdown, new RegExp("<!-- preferred -->\\n- \\[item:: \\[\\[white " + family + "\\]\\]\\]"));
    }
});

test("except-self requires an exact complete set and equal positive quantities", () => {
    for (const alter of [
        fixture => fixture.model.recipes[0].ingredients[1].alternatives.pop(),
        fixture => { fixture.model.recipes[0].ingredients[1].alternatives[0].qty = 2; },
        fixture => { fixture.model.recipes[0].ingredients[1].alternatives[0].id = fixture.owner; },
        fixture => { fixture.options.alternativeGroupValues = new Map(); },
        fixture => { fixture.options.availableAlternativeGroups = new Set(); }
    ]) {
        const fixture = recoloringFixture("wool", "white"); alter(fixture);
        const markdown = vanilla.bio.renderBIOPreview(fixture.model, fixture.options);
        assert.doesNotMatch(markdown, /<!-- except self -->/);
        assert.match(markdown, /obsf:choices/, "unproved or non-equivalent groups keep precise inline choices");
    }
    const fixture = recoloringFixture("wool", "white", 2, 3);
    const compact = vanilla.bio.renderBIOPreview(fixture.model, fixture.options);
    assert.match(compact, /<!-- except self -->\n\t- \[item:: \[\[黑色羊毛\|任意羊毛\]\]\] \(qty:: 6\)/);
});

test("except-self preserves preview representative paths while formal candidates use formal names", () => {
    const fixture = recoloringFixture("wool", "white");
    const preview = vanilla.bio.renderBIOPreview(fixture.model, { ...fixture.options,
        groupPreviewTargets: new Map([[fixture.groupId, "MC-自動化BIO/preview/batch/test/任意羊毛.preview"]]),
        itemPreviewTargets: new Map([["minecraft:black_wool", "MC-自動化BIO/preview/batch/test/黑色羊毛.preview"]]) });
    assert.match(preview, /<!-- except self -->\n\t- \[item:: \[\[MC-自動化BIO\/preview\/batch\/test\/黑色羊毛\.preview\|任意羊毛\]\]\]/);
    const formal = vanilla.bio.renderBIOPreview(fixture.model, fixture.options);
    assert.match(formal, /<!-- except self -->\n\t- \[item:: \[\[黑色羊毛\|任意羊毛\]\]\]/);
    assert.doesNotMatch(formal, /\/preview\/|\.preview/);
    assert.doesNotMatch(formal, /\[\[任意羊毛/, "the group label must not replace the real representative target");
});

test("a native wool Tag reuses one verified full derived group without generating a duplicate Tag BIO", () => {
    const fixture = recoloringFixture("wool", "white");
    fixture.options.alternativeGroupMappings.get(fixture.groupId).generate = true;
    const tagMappings = new Map([["minecraft:wool", {
        zhName: "任意羊毛", representativeItemId: "minecraft:white_wool", generate: false
    }]]);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:painting", {
        itemRegistry: registry([["minecraft:painting", { recipes: [recipe({ ingredients: [
            { kind: "tag", id: "minecraft:wool", qty: 1, values: fixture.values },
            { kind: "item", id: "minecraft:stick", qty: 8 }
        ] })] }]])
    });
    const previewTarget = "MC-自動化BIO/preview/batch/test/任意羊毛.preview";
    const options = { ...fixture.options, tagMappings, groupPreviewTargets: new Map([[fixture.groupId, previewTarget]]) };
    const markdown = vanilla.bio.renderBIOPreview(model, options);
    assert.match(markdown, /\[item:: \[\[MC-自動化BIO\/preview\/batch\/test\/任意羊毛\.preview\|任意羊毛\]\]\] \(qty:: 1\)/);
    assert.doesNotMatch(markdown, /obsf:choices|<!-- except self -->/);
    const native = vanilla.bio.createTagBIOGenerationModel("minecraft:wool", {
        tagMappings, resolveTag: () => ({ values: fixture.values, warnings: [] })
    });
    assert.equal(native.generate, false);
    const derived = vanilla.bio.createDerivedGroupBIOGenerationModel(fixture.groupId, fixture.values, {
        groupMappings: fixture.options.alternativeGroupMappings
    });
    assert.equal(derived.generate, true, "only the existing full derived collection is enabled for preview generation");
    const formalEntry = { tag_identity: "obsf:derived_ingredient_group", derived_group: fixture.groupId,
        path: "MC-物品資料庫/任意羊毛.md", name: "任意羊毛" };
    const formal = vanilla.bio.renderBIOPreview(model, { ...fixture.options, tagMappings, bioRegistry: { entries: [formalEntry] } });
    assert.match(formal, /\[item:: \[\[MC-物品資料庫\/任意羊毛\|任意羊毛\]\]\] \(qty:: 1\)/);
    assert.doesNotMatch(formal, /obsf:choices|\/preview\/|\.preview/);
    assert.match(vanilla.bio.renderBIOPreview(model, { ...fixture.options, tagMappings,
        bioRegistry: { entries: [formalEntry, { ...formalEntry, path: "其他/任意羊毛.md" }] }
    }), /obsf:choices/, "duplicate formal collection identities are not a unique reusable target");
    const previewWithFormal = vanilla.bio.renderBIOPreview(model, { ...options, bioRegistry: { entries: [formalEntry] } });
    assert.match(previewWithFormal, /\/preview\/batch\/test\/任意羊毛\.preview/);
    assert.doesNotMatch(previewWithFormal, /MC-物品資料庫\//);

    const subset = { ...model, recipes: model.recipes.map(route => ({ ...route,
        ingredients: route.ingredients.map(ingredient => ingredient.kind === "tag" ? { ...ingredient, values: fixture.values.slice(0, 14) } : ingredient)
    })) };
    assert.match(vanilla.bio.renderBIOPreview(subset, options), /obsf:choices/);
    assert.match(vanilla.bio.renderBIOPreview(model, { ...options, availableAlternativeGroups: new Set() }), /obsf:choices/);
    assert.match(vanilla.bio.renderBIOPreview(model, { ...fixture.options, tagMappings }), /obsf:choices/,
        "verified values alone cannot substitute for an actual preview or formal group target");
    const otherGroup = "obsf:color_family/another_wool";
    assert.match(vanilla.bio.renderBIOPreview(model, { ...options,
        alternativeGroupValues: new Map([[fixture.groupId, fixture.values], [otherGroup, fixture.values]]),
        availableAlternativeGroups: new Set([fixture.groupId, otherGroup]),
        groupPreviewTargets: new Map([[fixture.groupId, previewTarget], [otherGroup, "preview/另一個任意羊毛.preview"]])
    }), /obsf:choices/, "two equally matching collections must not be chosen arbitrarily");
});

test("stone tools render three complete material routes with unchanged quantities and one preferred", () => {
    const reader = require("../../BIO相關模組/搜尋介面模塊/bio_reader_v4");
    const tagId = "minecraft:stone_tool_materials";
    const values = ["minecraft:cobblestone", "minecraft:blackstone", "minecraft:cobbled_deepslate"];
    for (const [tool, count, sticks] of [["pickaxe", 3, 2], ["sword", 2, 1], ["shovel", 1, 2]]) {
        const owner = "minecraft:stone_" + tool;
        const model = vanilla.bio.createBIOGenerationModel(owner, { itemRegistry: registry([[owner, { recipes: [recipe({ ingredients: [
            { kind: "tag", id: tagId, qty: count, values },
            { kind: "item", id: "minecraft:stick", qty: sticks }
        ] })] }]]) });
        const original = JSON.stringify(model);
        const markdown = vanilla.bio.renderBIOPreview(model, {
            tagMappings: new Map([[tagId, { representativeItemId: "minecraft:cobblestone", generate: false }]])
        });
        const parsed = reader.parseBIO(markdown);
        assert.equal(parsed.recipes.length, 3);
        assert.equal(parsed.recipes.filter(route => route.preferred).length, 1);
        assert.equal(parsed.recipes[0].preferred, true);
        assert.deepEqual(parsed.recipes.map(route => route.ingredients[0].name), values.map(id => id.slice(10).replaceAll("_", " ")));
        for (const route of parsed.recipes) {
            assert.equal(route.ingredients[0].qty, count);
            assert.equal(route.ingredients[1].qty, sticks);
            assert.equal(route.output, 1);
        }
        assert.doesNotMatch(markdown, /obsf:choices|except self|#minecraft:stone_tool_materials/);
        assert.equal(JSON.stringify(model), original);
        const incomplete = JSON.parse(original);
        incomplete.recipes[0].ingredients[0].values.pop();
        assert.match(vanilla.bio.renderBIOPreview(incomplete), /obsf:choices/,
            "changed membership must fall back instead of inventing an explicit route");
    }
});

function nativePlanksFixture() {
    const values = ["acacia", "bamboo", "birch", "cherry", "crimson", "dark_oak", "jungle", "mangrove", "oak", "pale_oak", "spruce", "warped"]
        .map(wood => `minecraft:${wood}_planks`);
    const sourceTag = "minecraft:wooden_tool_materials", targetTag = "minecraft:planks";
    const tagMappings = new Map([
        [sourceTag, { zhName: "任意木材", generate: false, representativeItemId: "minecraft:oak_planks" }],
        [targetTag, { zhName: "任意木材", generate: true, representativeItemId: "minecraft:oak_planks" }]
    ]);
    const tagRegistry = vanilla.tags.buildRegistryFromEntries([
        { registryType: "item", tagId: targetTag, sourceFile: "tags/item/planks.json", json: { values } },
        { registryType: "item", tagId: sourceTag, sourceFile: "tags/item/wooden_tool_materials.json", json: { values: ["#" + targetTag] } }
    ]);
    const model = vanilla.bio.createBIOGenerationModel("minecraft:wooden_pickaxe", {
        itemRegistry: registry([["minecraft:wooden_pickaxe", { recipes: [recipe({ ingredients: [
            { kind: "tag", id: sourceTag, qty: 3, values },
            { kind: "item", id: "minecraft:stick", qty: 2 }
        ] })] }]])
    });
    const target = "MC-自動化BIO/preview/batch/test/任意木材.preview";
    const options = { tagMappings, nativeTagValues: new Map([[sourceTag, values], [targetTag, values]]),
        availableNativeTags: new Set([targetTag]), tagPreviewTargets: new Map([[targetTag, target]]) };
    return { values, sourceTag, targetTag, tagMappings, tagRegistry, model, options, target };
}

test("wooden tool materials reuse the verified twelve-member planks BIO and preserve quantity and representative", () => {
    const fixture = nativePlanksFixture();
    const before = JSON.stringify(fixture.model);
    const markdown = vanilla.bio.renderBIOPreview(fixture.model, fixture.options);
    assert.match(markdown, /\[item:: \[\[MC-自動化BIO\/preview\/batch\/test\/任意木材\.preview\|任意木材\]\]\] \(qty:: 3\)/);
    assert.doesNotMatch(markdown, /obsf:choices/);
    assert.equal(JSON.stringify(fixture.model), before);
    assert.equal(fixture.tagMappings.get(fixture.sourceTag).representativeItemId, "minecraft:oak_planks");
    const source = fs.readFileSync(path.resolve(__dirname, "../../scripts/minecraft-bio-generator.cjs"), "utf8");
    const start = source.indexOf("function collectUsedTagIds(");
    const end = source.indexOf("\nfunction renderTagNameReview(", start);
    assert.ok(start >= 0 && end > start);
    const collect = new Function("vanilla", source.slice(start, end) + "\nreturn collectPreviewTagModels;")(vanilla);
    const tags = collect([fixture.model], fixture.tagRegistry, fixture.tagMappings, { entries: [] });
    assert.deepEqual(tags.map(tag => tag.tagId), [fixture.sourceTag, fixture.targetTag]);
    assert.deepEqual(tags.filter(tag => tag.generate).map(tag => tag.tagId), [fixture.targetTag]);
    const planks = tags.find(tag => tag.tagId === fixture.targetTag);
    assert.equal(planks.values.length, 12);
    assert.equal(planks.representativeItemId, "minecraft:oak_planks");
    assert.match(vanilla.bio.renderTagBIOPreview(planks), /<!-- preferred -->\n- \[item:: \[\[oak planks\]\]\]/);
});

test("native Tag alias reuse rejects subsets, missing proof or targets, and conflicting equivalent BIOs", () => {
    const fixture = nativePlanksFixture();
    const subset = { ...fixture.model, recipes: fixture.model.recipes.map(route => ({ ...route,
        ingredients: route.ingredients.map(ingredient => ingredient.kind === "tag" ? { ...ingredient, values: fixture.values.slice(0, 11) } : ingredient)
    })) };
    assert.match(vanilla.bio.renderBIOPreview(subset, fixture.options), /obsf:choices/);
    for (const options of [
        { ...fixture.options, availableNativeTags: new Set() },
        { ...fixture.options, nativeTagValues: new Map() },
        { ...fixture.options, tagPreviewTargets: new Map() }
    ]) assert.match(vanilla.bio.renderBIOPreview(fixture.model, options), /obsf:choices/);
    const formal = { tag_identity: "minecraft:item_tag", minecraft_tag: fixture.targetTag,
        path: "MC-物品資料庫/任意木材.md", name: "任意木材" };
    assert.match(vanilla.bio.renderBIOPreview(fixture.model, { ...fixture.options, tagPreviewTargets: undefined,
        bioRegistry: { entries: [formal, { ...formal, path: "其他/任意木材.md" }] }
    }), /obsf:choices/);
    const groupId = "obsf:equivalent_planks";
    const competing = { ...fixture.options, alternativeGroupValues: new Map([[groupId, fixture.values]]),
        availableAlternativeGroups: new Set([groupId]), groupPreviewTargets: new Map([[groupId, "preview/另一份任意木材.preview"]]) };
    assert.match(vanilla.bio.renderBIOPreview(fixture.model, competing), /obsf:choices/);
    assert.doesNotMatch(vanilla.bio.renderBIOPreview(fixture.model, { ...competing,
        groupPreviewTargets: new Map([[groupId, fixture.target]]) }), /obsf:choices/,
    "different identities pointing to the same verified physical target must not create false ambiguity");
});

test("native own preview and verified own formal BIOs take precedence over equivalent collections", () => {
    const fixture = nativePlanksFixture();
    const ownPreview = vanilla.bio.renderBIOPreview(fixture.model, { ...fixture.options,
        tagPreviewTargets: new Map([[fixture.targetTag, fixture.target], [fixture.sourceTag, "preview/木製工具專用.preview"]]) });
    assert.match(ownPreview, /\[\[preview\/木製工具專用\.preview\|任意木材\]\]/);
    const own = { tag_identity: "minecraft:item_tag", minecraft_tag: fixture.sourceTag, path: "MC-物品資料庫/木製工具專用.md" };
    const planks = { tag_identity: "minecraft:item_tag", minecraft_tag: fixture.targetTag, path: "MC-物品資料庫/任意木材.md" };
    const formalOptions = { ...fixture.options, tagPreviewTargets: undefined,
        availableNativeTags: new Set([fixture.sourceTag, fixture.targetTag]), bioRegistry: { entries: [own, planks] } };
    const ownFormal = vanilla.bio.renderBIOPreview(fixture.model, formalOptions);
    assert.match(ownFormal, /\[\[MC-物品資料庫\/木製工具專用\|任意木材\]\]/);
    assert.doesNotMatch(ownFormal, /obsf:choices|\/preview\/|\.preview/);
    const validAlias = vanilla.bio.renderBIOPreview(fixture.model, { ...formalOptions,
        availableNativeTags: new Set([fixture.targetTag]) });
    assert.match(validAlias, /\[\[MC-物品資料庫\/任意木材\|任意木材\]\]/,
        "an unverified own formal stub must not override a verified complete equivalent Tag");
    const rejected = vanilla.bio.renderBIOPreview(fixture.model, { ...formalOptions, availableNativeTags: new Set() });
    assert.match(rejected, /obsf:choices/);
    assert.doesNotMatch(rejected, /\[\[MC-物品資料庫\//);
});

test("formal native Tag reuse requires actual complete membership and rejects identity-only legacy stubs", () => {
    const os = require("node:os"), reader = require("../../BIO相關模組/搜尋介面模塊/bio_reader_v4");
    const source = fs.readFileSync(path.resolve(__dirname, "../../scripts/minecraft-bio-generator.cjs"), "utf8");
    const start = source.indexOf("function verifyFormalAlternativeGroups(");
    const end = source.indexOf("\nfunction preferredPlanningRecipes(", start);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsf-native-tag-proof-"));
    try {
        const verify = new Function("fs", "path", "vaultRoot", "vanilla", "bioReader", "safeVaultPath",
            source.slice(start, end) + "\nreturn verifyFormalNativeTags;")(
                fs, path, root, vanilla, reader, filename => path.resolve(root, filename));
        const fixture = nativePlanksFixture();
        const tag = vanilla.bio.createTagBIOGenerationModel(fixture.targetTag, {
            tagMappings: fixture.tagMappings, tagRegistry: fixture.tagRegistry, resolveTag: vanilla.tags.resolveTag
        });
        const entry = { name: "任意木材", path: "任意木材.md", tag_identity: "minecraft:item_tag", minecraft_tag: fixture.targetTag };
        const items = fixture.values.map(id => ({ normalizedId: id, name: id.slice(10).replaceAll("_", " "), aliases: [id] }));
        const body = vanilla.bio.renderTagBIOPreview(tag);
        fs.writeFileSync(path.join(root, entry.path), body);
        let proof = verify([tag], { entries: [entry, ...items] }, {});
        assert.equal(proof.available.has(fixture.targetTag), true);
        assert.deepEqual(proof.diagnostics, []);
        const formal = vanilla.bio.renderBIOPreview(fixture.model, { ...fixture.options, tagPreviewTargets: undefined,
            availableNativeTags: proof.available, bioRegistry: { entries: [entry, ...items] } });
        assert.match(formal, /\[\[任意木材\|任意木材\]\]/);
        assert.doesNotMatch(formal, /obsf:choices|\/preview\/|\.preview/);
        for (const incomplete of [
            body.replace(/^- \[item:: \[\[acacia planks\]\]\]\r?\n/m, ""),
            "---\ntype: mc-item\nminecraft_tag: minecraft:planks\ntag_identity: minecraft:item_tag\n---\n" +
                "# 合成/取得\n### 常規\n- **生產設備**：(Machine:: [[無/手動]])\n\t**合成所需**：\n"
        ]) {
            fs.writeFileSync(path.join(root, entry.path), incomplete);
            proof = verify([tag], { entries: [entry, ...items] }, {});
            assert.equal(proof.available.has(fixture.targetTag), false);
            assert.equal(proof.diagnostics[0].code, "FORMAL_TAG_MEMBERSHIP_UNCONFIRMED");
            const fallback = vanilla.bio.renderBIOPreview(fixture.model, { ...fixture.options,
                availableNativeTags: proof.available, tagPreviewTargets: undefined, bioRegistry: { entries: [entry, ...items] } });
            assert.match(fallback, /obsf:choices/);
            const ownModel = { ...fixture.model, recipes: fixture.model.recipes.map(route => ({ ...route,
                ingredients: route.ingredients.map(ingredient => ingredient.kind === "tag" ? { ...ingredient, id: fixture.targetTag } : ingredient)
            })) };
            assert.match(vanilla.bio.renderBIOPreview(ownModel, { ...fixture.options,
                availableNativeTags: proof.available, tagPreviewTargets: undefined, bioRegistry: { entries: [entry, ...items] } }), /obsf:choices/,
            "strict CLI proof also rejects a direct native reference to the incomplete legacy Tag stub");
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("soul campfire renders its two exact base-block alternatives as separate Machine routes", () => {
    const tagId = "minecraft:soul_fire_base_blocks";
    const model = vanilla.bio.createBIOGenerationModel("minecraft:soul_campfire", {
        itemRegistry: registry([["minecraft:soul_campfire", { recipes: [recipe({ output: 2, ingredients: [
            { kind: "item", id: "minecraft:stick", qty: 3 },
            { kind: "tag", id: tagId, qty: 1, values: ["minecraft:soul_sand", "minecraft:soul_soil"] },
            { kind: "tag", id: "minecraft:logs", qty: 3, values: ["minecraft:oak_log", "minecraft:birch_log"] }
        ] })] }]])
    });
    const original = JSON.stringify(model);
    const options = { translations: { "item.minecraft.stick": "木棒", "block.minecraft.soul_sand": "靈魂砂", "block.minecraft.soul_soil": "靈魂土" },
        tagMappings: new Map([[tagId, { generate: false, representativeItemId: "minecraft:soul_soil" }],
            ["minecraft:logs", { zhName: "任意原木" }]]),
        tagPreviewTargets: new Map([["minecraft:logs", "preview/任意原木.preview"]]) };
    const markdown = vanilla.bio.renderBIOPreview(model, options);
    assert.equal((markdown.match(/Machine::/g) || []).length, 2);
    assert.equal((markdown.match(/<!-- preferred -->/g) || []).length, 1);
    assert.doesNotMatch(markdown, /soul_fire_base_blocks|obsf:choices/);
    assert.equal((markdown.match(/\[output:: 2\]/g) || []).length, 2);
    const reader = require("../../BIO相關模組/搜尋介面模塊/bio_reader_v4");
    const parsed = reader.parseBIO(markdown);
    assert.equal(parsed.recipes.length, 2);
    assert.deepEqual(parsed.recipes.map(route => route.ingredients[1].name), ["靈魂土", "靈魂砂"]);
    assert.deepEqual(parsed.recipes.map(route => route.preferred), [true, false]);
    for (const route of parsed.recipes) {
        assert.equal(route.output, 2);
        assert.deepEqual(route.ingredients.map(ingredient => ingredient.qty), [3, 1, 3]);
        assert.equal(route.ingredients[0].name, "木棒");
        assert.equal(route.ingredients[2].name, "preview/任意原木.preview");
    }
    assert.equal(JSON.stringify(model), original, "render expansion must preserve the generation model and normalized recipe");
    const invalidRepresentative = vanilla.bio.renderBIOPreview(model, { ...options,
        tagMappings: new Map([[tagId, { representativeItemId: "minecraft:stone" }]]) });
    assert.equal(reader.parseBIO(invalidRepresentative).recipes[0].ingredients[1].name, "靈魂砂");
    for (const values of [["minecraft:soul_sand"], ["minecraft:soul_sand", "minecraft:soul_sand"],
        ["minecraft:soul_sand", "minecraft:soul_soil", "minecraft:stone"]]) {
        const uncertain = { ...model, recipes: model.recipes.map(route => ({ ...route,
            ingredients: route.ingredients.map(ingredient => ingredient.id === tagId ? { ...ingredient, values } : ingredient)
        })) };
        const fallback = vanilla.bio.renderBIOPreview(uncertain, options);
        assert.equal((fallback.match(/Machine::/g) || []).length, 1);
        assert.match(fallback, /obsf:choices/);
    }
});

test("formal alternative groups require readable actual membership matching the complete normalized set", () => {
    const os = require("node:os"), reader = require("../../BIO相關模組/搜尋介面模塊/bio_reader_v4");
    const source = fs.readFileSync(path.resolve(__dirname, "../../scripts/minecraft-bio-generator.cjs"), "utf8");
    const start = source.indexOf("function verifyFormalAlternativeGroups(");
    const end = source.indexOf("\nfunction preferredPlanningRecipes(", start);
    assert.ok(start >= 0 && end > start);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsf-formal-group-proof-"));
    try {
        const verify = new Function("fs", "path", "vaultRoot", "vanilla", "bioReader", "safeVaultPath",
            source.slice(start, end) + "\nreturn verifyFormalAlternativeGroups;")(
                fs, path, root, vanilla, reader, filename => path.resolve(root, filename));
        const fixture = recoloringFixture("wool", "white");
        const group = vanilla.bio.createDerivedGroupBIOGenerationModel(fixture.groupId, fixture.values, {
            groupMappings: fixture.options.alternativeGroupMappings
        });
        const body = vanilla.bio.renderTagBIOPreview(group);
        const entry = { path: "任意羊毛.md", name: "任意羊毛", tag_identity: "obsf:derived_ingredient_group", derived_group: fixture.groupId };
        const knownItems = fixture.values.map(id => ({ normalizedId: id, name: id.slice(10).replaceAll("_", " "), aliases: [id] }));
        fs.writeFileSync(path.join(root, entry.path), body);
        let proof = verify([group], { entries: [entry, ...knownItems] }, {});
        assert.equal(proof.available.has(fixture.groupId), true, "generate=false does not invalidate an existing verified group");
        assert.deepEqual(proof.diagnostics, []);
        const formal = vanilla.bio.renderBIOPreview(fixture.model, { ...fixture.options, availableAlternativeGroups: proof.available });
        assert.match(formal, /<!-- except self -->/);
        assert.doesNotMatch(formal, /obsf:choices/);
        const officialNames = Object.fromEntries(fixture.values.map((id, index) => ["block." + id.replace(":", "."), "官方羊毛" + index]));
        fs.writeFileSync(path.join(root, entry.path), vanilla.bio.renderTagBIOPreview(group, { translations: officialNames }));
        assert.equal(verify([group], { entries: [entry] }, officialNames).available.has(fixture.groupId), true,
            "official translation identity can prove members even when individual item BIOs are not built yet");
        fs.writeFileSync(path.join(root, entry.path), body.replace(/^- \[item:: \[\[black wool\]\]\]\r?\n/m, ""));
        proof = verify([group], { entries: [entry, ...knownItems] }, {});
        assert.equal(proof.available.has(fixture.groupId), false);
        assert.equal(proof.diagnostics[0].code, "FORMAL_GROUP_MEMBERSHIP_UNCONFIRMED");
        const fallback = vanilla.bio.renderBIOPreview(fixture.model, { ...fixture.options, availableAlternativeGroups: proof.available });
        assert.match(fallback, /obsf:choices/);
        assert.doesNotMatch(fallback, /<!-- except self -->/);
        assert.equal(verify([group], { entries: [] }, {}).available.size, 0);
        assert.equal(verify([group], { entries: [entry, { ...entry, path: "重複.md" }, ...knownItems] }, {}).available.size, 0);
        fs.writeFileSync(path.join(root, entry.path), body);
        assert.equal(verify([group], { entries: [entry, ...knownItems,
            { normalizedId: "minecraft:redstone", name: "black wool", aliases: [] }] }, {}).available.size, 0,
        "ambiguous names must not be guessed when proving formal group membership");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("V3 reads the Tag BIO representative row without machine, qty, or output fields", async () => {
    const tagRegistry = vanilla.tags.buildRegistryFromEntries([{
        registryType: "item",
        tagId: "minecraft:planks",
        sourceFile: "tags/item/planks.json",
        json: { values: ["minecraft:oak_planks", "minecraft:bamboo_planks"] }
    }]);
    const tagMappings = new Map([["minecraft:planks", {
        bioId: "PLANKS",
        zhName: "任意木材",
        filename: "任意木材.md",
        generate: true,
        representativeItemId: "minecraft:oak_planks"
    }]]);
    const model = vanilla.bio.createTagBIOGenerationModel("minecraft:planks", {
        tagRegistry,
        resolveTag: vanilla.tags.resolveTag,
        tagMappings
    });
    const markdown = vanilla.bio.renderTagBIOPreview(model);
    assert.match(markdown, /^minecraft_tag: minecraft:planks$/m);
    assert.match(markdown, /^tag_identity: minecraft:item_tag$/m);
    assert.match(markdown, /### Tag 代表材料\n\n<!-- preferred -->\n- \[item:: \[\[oak planks\]\]\]$/m);
    assert.match(markdown, /^- \[item:: \[\[bamboo planks\]\]\]$/m);
    assert.doesNotMatch(markdown, /\| Minecraft Item ID \|/);
    assert.doesNotMatch(markdown, /Machine::|qty::|output::|^output:/m);
    assert.doesNotMatch(markdown, /^representative_item:/m);
    assert.equal(model.values.length, 2);

    const itemModel = vanilla.bio.createBIOGenerationModel("minecraft:test", {
        itemRegistry: registry([["minecraft:test", { recipes: [recipe({
            ingredients: [{ kind: "tag", id: "minecraft:planks", qty: 3, values: model.values }]
        })] }]])
    });
    const linked = vanilla.bio.renderBIOPreview(itemModel, {
        tagMappings,
        tagPreviewTargets: new Map([["minecraft:planks", "preview/任意木材.preview"]])
    });
    assert.match(linked, /\[item:: \[\[preview\/任意木材.preview\|任意木材\]\]\] \(qty:: 3\)/);
    assert.doesNotMatch(linked, /obsf:choices/);

    const v3 = fs.readFileSync(
        path.join(__dirname, "../../黏液科技DB 搜尋介面V3.md"),
        "utf8"
    );
    const parser = v3.match(/const parseCache\s*=[\s\S]*?(?=\/\/ ={5,}\r?\n\/\/ 18\.)/);
    assert.ok(parser, "V3 BIO parser section");
    const loadParser = new Function(
        "app",
        "selectedRecipeSections",
        parser[0] + "\nreturn { parseBio, chooseRecipe };"
    );
    const { parseBio, chooseRecipe } = loadParser({
        vault: {
            getAbstractFileByPath: filePath => ({ path: filePath }),
            read: async () => markdown
        }
    }, new Set(["常規"]));
    const page = { file: { path: "任意木材.md" }, tag_identity: "minecraft:item_tag" };
    const selected = chooseRecipe(page, await parseBio(page));
    assert.equal(selected.tagRepresentative, true);
    assert.equal(selected.machine, "");
    assert.deepEqual(selected.ingredients, [{ type: "item", name: "oak planks", qty: 1 }]);

    const regularPage = { file: { path: "一般 BIO.md" } };
    assert.deepEqual((await parseBio(regularPage)).recipes, []);
});
