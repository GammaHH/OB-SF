const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const vanilla = require("../../模板放置處/MC解析器模塊");

const vaultRoot = path.resolve(__dirname, "..", "..");

function fixture(relativePath) {
    return JSON.parse(
        fs.readFileSync(
            path.join(vaultRoot, ...relativePath.split("/")),
            "utf8"
        )
    );
}

function tagFixture(name) {
    return {
        tagId: `minecraft:${name.replace(/\.json$/, "")}`,
        registryType: "item",
        sourceFile: `參考資料/Minecraft/tags/item/${name}`,
        json: fixture(`參考資料/Minecraft/tags/item/${name}`)
    };
}

function recipeFixture(name) {
    return {
        sourceFile: `參考資料/Minecraft/recipe/${name}`,
        json: fixture(`參考資料/Minecraft/recipe/${name}`)
    };
}

function shapeless(resultId, ingredients, output = 1) {
    return {
        type: "minecraft:crafting_shapeless",
        ingredients,
        result: {
            id: resultId,
            count: output
        }
    };
}

test("real fixtures preserve every tag branch and recipe output in memory", () => {
    const pipeline = vanilla.createVanillaPipeline({
        tagEntries: [
            tagFixture("oak_logs.json"),
            tagFixture("planks.json"),
            tagFixture("wooden_slabs.json")
        ],
        recipeEntries: [
            recipeFixture("oak_planks.json"),
            recipeFixture("oak_slab.json"),
            recipeFixture("barrel.json"),
            recipeFixture("iron_ingot_from_smelting_iron_ore.json"),
            recipeFixture("andesite_slab_from_andesite_stonecutting.json"),
            recipeFixture("magma_cream.json")
        ]
    });

    const dependency =
        pipeline.resolveDependencies("minecraft:barrel");

    const barrel =
        dependency.graph.get("minecraft:barrel");

    assert.equal(dependency.target, "minecraft:barrel");
    assert.equal(barrel.recipes.length, 1);
    assert.equal(barrel.recipes[0].output, 1);
    assert.equal(barrel.recipes[0].ingredients[0].kind, "tag");
    assert.equal(barrel.recipes[0].ingredients[0].qty, 6);
    assert.equal(barrel.recipes[0].ingredients[0].candidates.length, 12);
    assert.equal(barrel.recipes[0].ingredients[1].qty, 2);
    assert.equal(barrel.recipes[0].ingredients[1].candidates.length, 12);

    // All candidates remain branches; none is auto-selected.
    assert.ok(dependency.graph.has("minecraft:oak_planks"));
    assert.ok(dependency.graph.has("minecraft:spruce_planks"));
    assert.ok(dependency.graph.has("minecraft:oak_slab"));
    assert.ok(dependency.graph.has("minecraft:spruce_slab"));

    assert.equal(
        dependency.graph
            .get("minecraft:oak_planks")
            .recipes[0]
            .output,
        4
    );
    assert.equal(
        dependency.graph
            .get("minecraft:oak_slab")
            .recipes[0]
            .output,
        6
    );
});

test("generation planner produces bottom-up order for nested dependencies", () => {
    const pipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            shapeless("minecraft:a", ["minecraft:b", "minecraft:c"], 2),
            shapeless("minecraft:b", ["minecraft:d", "minecraft:e"], 4),
            shapeless("minecraft:c", ["minecraft:f"])
        ]
    });

    const {
        dependencyResult,
        generationPlan
    } = pipeline.planGeneration("minecraft:a");

    assert.equal(
        dependencyResult.graph.get("minecraft:a").recipes[0].output,
        2
    );
    assert.deepEqual(
        new Set(dependencyResult.leafMaterials),
        new Set(["minecraft:d", "minecraft:e", "minecraft:f"])
    );
    assert.deepEqual(
        generationPlan.generationOrder,
        [
            "minecraft:d",
            "minecraft:e",
            "minecraft:f",
            "minecraft:b",
            "minecraft:c",
            "minecraft:a"
        ]
    );
});

test("an item without a recipe is a leaf/base material", () => {
    const pipeline = vanilla.createVanillaPipeline();
    const dependency =
        pipeline.resolveDependencies("minecraft:diamond");
    const plan =
        pipeline.createGenerationPlan(dependency);

    assert.equal(dependency.graph.get("minecraft:diamond").leaf, true);
    assert.deepEqual(dependency.leafMaterials, ["minecraft:diamond"]);
    assert.deepEqual(plan.generationOrder, ["minecraft:diamond"]);
});

test("alternatives and multiple recipes remain mutually-exclusive branches", () => {
    const pipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            shapeless(
                "minecraft:target",
                [["minecraft:a", "minecraft:b"]]
            ),
            shapeless(
                "minecraft:target",
                ["minecraft:c"]
            )
        ]
    });

    const dependency =
        pipeline.resolveDependencies("minecraft:target");

    const target =
        dependency.graph.get("minecraft:target");

    assert.equal(target.recipes.length, 2);
    assert.equal(dependency.recipeBranches.length, 2);
    assert.equal(dependency.alternativeBranches.length, 1);
    assert.equal(
        pipeline.itemStatuses.get("minecraft:target"),
        "OK_BRANCH"
    );
    assert.equal(pipeline.stats.recipes.review, 0);
    assert.deepEqual(
        dependency.alternativeBranches[0].choices.map(
            choice => choice.ingredient.id
        ),
        ["minecraft:a", "minecraft:b"]
    );
    assert.ok(dependency.graph.has("minecraft:a"));
    assert.ok(dependency.graph.has("minecraft:b"));
    assert.ok(dependency.graph.has("minecraft:c"));
});

test("nested tags resolve to alternative candidates without summing values", () => {
    const pipeline = vanilla.createVanillaPipeline({
        tagEntries: [
            {
                tagId: "minecraft:child",
                registryType: "item",
                json: {
                    values: [
                        "minecraft:stone",
                        "minecraft:granite"
                    ]
                }
            },
            {
                tagId: "minecraft:parent",
                registryType: "item",
                json: {
                    values: [
                        "#minecraft:child",
                        {
                            id: "#minecraft:not_installed",
                            required: false
                        }
                    ]
                }
            }
        ],
        recipeEntries: [
            shapeless("minecraft:target", ["#minecraft:parent"])
        ]
    });

    const dependency =
        pipeline.resolveDependencies("minecraft:target");
    const tagBranch =
        dependency.tagBranches[0];

    assert.equal(
        pipeline.itemStatuses.get("minecraft:target"),
        "OK_BRANCH"
    );

    assert.equal(tagBranch.kind, "tag");
    assert.equal(tagBranch.qty, 1);
    assert.deepEqual(
        tagBranch.candidates.map(candidate => candidate.id),
        ["minecraft:stone", "minecraft:granite"]
    );
    assert.deepEqual(
        new Set(dependency.leafMaterials),
        new Set(["minecraft:stone", "minecraft:granite"])
    );
});

test("cycles are reported and cyclic nodes are blocked from generation order", () => {
    const pipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            shapeless("minecraft:a", ["minecraft:b"]),
            shapeless("minecraft:b", ["minecraft:a"])
        ]
    });

    const {
        dependencyResult,
        generationPlan
    } = pipeline.planGeneration("minecraft:a");

    assert.deepEqual(
        dependencyResult.cycles,
        [["minecraft:a", "minecraft:b", "minecraft:a"]]
    );
    assert.equal(generationPlan.canGenerateInOrder, false);
    assert.deepEqual(generationPlan.generationOrder, []);
    assert.deepEqual(
        generationPlan.blockedByCycle,
        ["minecraft:a", "minecraft:b"]
    );
});

test("BIO scanner maps legacy uppercase IDs and planner separates existing/missing BIO", () => {
    const bioRegistry = vanilla.bio.scanMinecraftBIOs(
        path.join(vaultRoot, "MC-物品資料庫"),
        { vaultRoot }
    );

    assert.equal(
        vanilla.bio.canonicalMinecraftId("PISTON"),
        "minecraft:piston"
    );
    assert.equal(
        vanilla.bio.minecraftIdToBIOId("minecraft:iron_ingot"),
        "IRON_INGOT"
    );
    assert.deepEqual(
        vanilla.bio.minecraftIdToBIOAliases("minecraft:iron_ingot"),
        ["minecraft:iron_ingot"]
    );
    assert.ok(bioRegistry.has("minecraft:piston"));
    assert.equal(
        bioRegistry.get("minecraft:piston").legacyId,
        "PISTON"
    );

    const pipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            shapeless(
                "minecraft:piston",
                ["minecraft:ob_sf_test_missing_material"]
            )
        ]
    });

    const {
        generationPlan
    } = pipeline.planGeneration(
        "minecraft:piston",
        { bioRegistry }
    );

    assert.ok(
        generationPlan.existingBIO.some(entry =>
            entry.id === "minecraft:piston"
        )
    );
    assert.ok(
        generationPlan.missingBIO.includes(
            "minecraft:ob_sf_test_missing_material"
        )
    );
    assert.deepEqual(
        generationPlan.missingGenerationOrder,
        ["minecraft:ob_sf_test_missing_material"]
    );
});

test("Phase 1 cooking family normalizes with the correct machine and metadata", () => {
    const cases = [
        [
            "coal_from_blasting_coal_ore.json",
            "minecraft:blasting",
            "高爐",
            100
        ],
        [
            "baked_potato_from_smoking.json",
            "minecraft:smoking",
            "煙燻爐",
            100
        ],
        [
            "cooked_beef_from_campfire_cooking.json",
            "minecraft:campfire_cooking",
            "營火",
            600
        ]
    ];

    for (const [file, sourceType, machine, cookingTime] of cases) {
        const parsed = vanilla.parseRecipe(
            fixture(`參考資料/Minecraft/recipe/${file}`),
            file
        );

        assert.equal(parsed.success, true);
        assert.equal(parsed.status, "OK");
        assert.equal(parsed.recipe.sourceType, sourceType);
        assert.equal(parsed.recipe.machine, machine);
        assert.equal(parsed.recipe.meta.cookingTime, cookingTime);
    }
});

test("Phase 2 smithing_transform preserves three required slots and tag choice", () => {
    const parsed = vanilla.parseRecipe(
        fixture("參考資料/Minecraft/recipe/netherite_axe_smithing.json"),
        "netherite_axe_smithing.json"
    );

    assert.equal(parsed.success, true);
    assert.equal(parsed.status, "OK_BRANCH");
    assert.equal(parsed.resultId, "minecraft:netherite_axe");
    assert.equal(parsed.recipe.output, 1);
    assert.deepEqual(
        parsed.recipe.meta.ingredientRoles,
        ["template", "base", "addition"]
    );
    assert.deepEqual(
        parsed.recipe.ingredients.map(ingredient => ingredient.kind),
        ["item", "item", "tag"]
    );
});

test("Phase 3 crafting_transmute keeps input/material dependencies and component-copy metadata", () => {
    const parsed = vanilla.parseRecipe(
        fixture("參考資料/Minecraft/recipe/black_bundle.json"),
        "black_bundle.json"
    );

    assert.equal(parsed.success, true);
    assert.equal(parsed.status, "OK_BRANCH");
    assert.equal(parsed.resultId, "minecraft:black_bundle");
    assert.deepEqual(
        parsed.recipe.meta.ingredientRoles,
        ["input", "material"]
    );
    assert.equal(parsed.recipe.meta.copiesInputComponents, true);
    assert.deepEqual(
        parsed.recipe.ingredients.map(ingredient => ingredient.kind),
        ["tag", "item"]
    );
});

test("dynamic Minecraft recipes are SPECIAL rather than REVIEW or UNSUPPORTED", () => {
    const parsed = vanilla.parseRecipe(
        fixture(
            "參考資料/Minecraft/recipe/" +
            "bolt_armor_trim_smithing_template_smithing_trim.json"
        ),
        "smithing_trim.json"
    );

    assert.equal(parsed.success, false);
    assert.equal(parsed.status, "SPECIAL");
    assert.equal(parsed.special, true);
    assert.equal(parsed.unsupported, false);
});

test("unknown raw recipe types are UNSUPPORTED and never enter item registry", () => {
    const pipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            {
                sourceFile: "future.json",
                json: {
                    type: "minecraft:future_recipe_type",
                    result: { id: "minecraft:test" }
                }
            }
        ]
    });

    assert.equal(pipeline.itemRegistry.size, 0);
    assert.equal(pipeline.stats.recipes.unsupported, 1);
    assert.equal(pipeline.stats.recipes.review, 0);
    assert.equal(pipeline.diagnostics[0].status, "UNSUPPORTED");
});
