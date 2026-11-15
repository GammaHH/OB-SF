const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
    createMinecraftVanillaRuntime
} = require("../../scripts/lib/minecraft-vanilla-runtime.cjs");

const vaultRoot = path.resolve(__dirname, "..", "..");
let cachedRuntime = null;

function runtime() {
    if (!cachedRuntime) cachedRuntime = createMinecraftVanillaRuntime(vaultRoot);
    return cachedRuntime;
}

test("in-memory V1.3 runtime exposes the refined status summary", () => {
    const current = runtime();
    const stats = current.pipeline.stats.recipes;
    assert.equal(current.loadErrors.length, 0);
    assert.equal(current.counts.recipeFiles, 1515);
    assert.equal(stats.inputRecipes, 1515);
    assert.equal(stats.normalizedRecipes, 1466);
    assert.equal(stats.statusCounts.OK_BRANCH, 225);
    assert.equal(stats.statusCounts.UNSUPPORTED, 0);
    assert.equal(stats.statusCounts.SPECIAL, 49);
    assert.equal(stats.statusCounts.REVIEW, 0);
    assert.equal(stats.statusCounts.ERROR, 0);
});

test("normalized core schema remains V1 while Phase 1-3 types are present", () => {
    const normalizedItems = runtime().pipeline.itemRegistry.toArray();
    assert.equal(
        normalizedItems.reduce((sum, item) => sum + item.recipes.length, 0),
        1466
    );
    assert.deepEqual(
        Object.keys(normalizedItems[0]).sort(),
        ["id", "name", "recipes", "warnings"]
    );

    const recipes = normalizedItems.flatMap(item => item.recipes);
    const recipeKeys = new Set(
        recipes.flatMap(recipe => Object.keys(recipe))
    );
    assert.deepEqual(
        [...recipeKeys].sort(),
        [
            "ingredients",
            "machine",
            "meta",
            "output",
            "section",
            "sourceType"
        ]
    );

    const expectedCounts = {
        "minecraft:blasting": 25,
        "minecraft:smoking": 9,
        "minecraft:campfire_cooking": 9,
        "minecraft:smithing_transform": 12,
        "minecraft:crafting_transmute": 33
    };

    for (const [sourceType, expected] of Object.entries(expectedCounts)) {
        assert.equal(
            recipes.filter(recipe => recipe.sourceType === sourceType).length,
            expected
        );
    }
});
