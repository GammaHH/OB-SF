const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const vaultRoot = path.resolve(__dirname, "..", "..");
const generatedRoot = path.join(vaultRoot, "MC-自動化實作");

function generatedFile(name) {
    return path.join(generatedRoot, name);
}

test("generated Manifest exposes the refined V1.1 status summary", () => {
    const manifest = fs.readFileSync(
        generatedFile("Minecraft Recipe Manifest.md"),
        "utf8"
    );

    assert.match(manifest, /- JSON files：1515/);
    assert.match(manifest, /- Parsed recipes：1466/);
    assert.match(manifest, /- ✅↗ OK_BRANCH：225/);
    assert.match(manifest, /- ⛔ UNSUPPORTED：0/);
    assert.match(manifest, /- 🧩 SPECIAL：49/);
    assert.match(manifest, /- ⚠ REVIEW：0/);
    assert.match(manifest, /- ❌ ERROR：0/);
    assert.match(manifest, /## Legal Branch Semantics/);
    assert.match(manifest, /## Requires Attention/);
});

test("normalized core schema remains V1 while Phase 1-3 types are present", () => {
    const normalized = JSON.parse(
        fs.readFileSync(
            generatedFile("Minecraft Normalized Recipes.json"),
            "utf8"
        )
    );

    assert.equal(
        normalized.schema,
        "OB-SF Minecraft Normalized Recipe V1"
    );
    assert.equal(normalized.recipeCount, 1466);
    assert.deepEqual(
        Object.keys(normalized.items[0]).sort(),
        ["id", "name", "recipes", "warnings"]
    );

    const recipes = normalized.items.flatMap(item => item.recipes);
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
