const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const vanilla = require("../../模板放置處/MC解析器模塊");
const {
    createMinecraftVanillaRuntime
} = require("../../scripts/lib/minecraft-vanilla-runtime.cjs");

function recipe(resultId, ingredients, output = 1) {
    return {
        type: "minecraft:crafting_shapeless",
        ingredients,
        result: { id: resultId, count: output }
    };
}

function emptyReview() {
    return { groups: new Map(), diagnostics: [], frontmatter: {} };
}

function analyze(pipeline, target, markdown = "", baseItemIds = []) {
    const dependency = pipeline.resolveDependencies(target);
    const basePlan = pipeline.createBaseDependencyPlan(dependency, {
        baseItemIds,
        selectionPolicy: "none"
    });
    const parsed = markdown
        ? vanilla.dependencies.parseRecipeReviewMarkdown(markdown)
        : emptyReview();
    const sourceFingerprint =
        vanilla.dependencies.computeNormalizedRegistryFingerprint(
            pipeline.itemRegistry
        );
    const analysis = vanilla.dependencies.createRecipeAmbiguityAnalysis(
        dependency,
        basePlan,
        parsed,
        { sourceFingerprint, baseItemIds }
    );
    return { dependency, basePlan, parsed, analysis };
}

function setChoice(markdown, candidateId, checked) {
    const suffix = ` \`${candidateId}\` <!-- obsf:choice-id:${candidateId} -->`;
    for (const current of [" ", "x", "X"]) {
        const source = `- [${current}]${suffix}`;
        if (markdown.includes(source)) {
            return markdown.replace(source, `- [${checked ? "x" : " "}]${suffix}`);
        }
    }
    throw new Error(`找不到 choice：${candidateId}`);
}

function multipleRecipePipeline() {
    return vanilla.createVanillaPipeline({
        recipeEntries: [
            recipe("minecraft:target", ["minecraft:a"]),
            recipe("minecraft:target", ["minecraft:b"])
        ]
    });
}

test("multiple recipes require exactly one stable recipe identity", () => {
    const pipeline = multipleRecipePipeline();
    const first = analyze(pipeline, "minecraft:target").analysis;
    assert.equal(first.groups.length, 1);
    assert.equal(first.groups[0].type, "recipe");
    assert.equal(first.groups[0].status, "UNRESOLVED");
    assert.equal(first.readiness.unresolvedAmbiguities, 1);
    assert.ok(first.groups[0].candidates.every(candidate =>
        /^recipe-[0-9a-f]{16}$/.test(candidate.candidateId)
    ));

    let markdown = vanilla.dependencies.renderRecipeReview(first);
    markdown = setChoice(markdown, first.groups[0].candidates[0].candidateId, true);
    const selected = analyze(pipeline, "minecraft:target", markdown).analysis;
    assert.equal(selected.groups[0].status, "RESOLVED");
    assert.equal(selected.readiness.unresolvedAmbiguities, 0);
    assert.equal(selected.readiness.readyForBioGeneration, true);
});

test("multiple checked recipes are invalid and never auto-select first", () => {
    const pipeline = multipleRecipePipeline();
    const initial = analyze(pipeline, "minecraft:target").analysis;
    let markdown = vanilla.dependencies.renderRecipeReview(initial);
    for (const candidate of initial.groups[0].candidates) {
        markdown = setChoice(markdown, candidate.candidateId, true);
    }
    const result = analyze(pipeline, "minecraft:target", markdown).analysis;
    assert.ok(result.diagnostics.some(entry =>
        entry.code === "MULTIPLE_SELECTED" && entry.severity === "ERROR"
    ));
    assert.equal(result.readiness.invalidSelections > 0, true);
    assert.equal(result.readiness.readyForBioGeneration, false);
});

test("removed selected recipe becomes stale when the item remains ambiguous", () => {
    const originalPipeline = multipleRecipePipeline();
    const original = analyze(originalPipeline, "minecraft:target").analysis;
    const removedId = original.groups[0].candidates[0].candidateId;
    let markdown = vanilla.dependencies.renderRecipeReview(original);
    markdown = setChoice(markdown, removedId, true);

    const changedPipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            recipe("minecraft:target", ["minecraft:b"]),
            recipe("minecraft:target", ["minecraft:c"])
        ]
    });
    const changed = analyze(changedPipeline, "minecraft:target", markdown).analysis;
    assert.ok(changed.diagnostics.some(entry =>
        entry.code === "RECIPE_NO_LONGER_EXISTS"
    ));
    assert.equal(changed.readiness.readyForBioGeneration, false);
});

test("ambiguity below an unselected recipe branch is not active or blocking", () => {
    const pipeline = vanilla.createVanillaPipeline({
        tagEntries: [{
            tagId: "minecraft:woods",
            registryType: "item",
            json: { values: ["minecraft:oak", "minecraft:spruce"] }
        }],
        recipeEntries: [
            recipe("minecraft:target", ["#minecraft:woods"]),
            recipe("minecraft:target", ["minecraft:stone"])
        ]
    });
    const initial = analyze(pipeline, "minecraft:target").analysis;
    assert.deepEqual(initial.groups.map(group => group.type), ["recipe"]);
    const stoneRecipe = initial.groups[0].candidates.find(candidate =>
        candidate.recipe.ingredients[0].id === "minecraft:stone"
    );
    let markdown = vanilla.dependencies.renderRecipeReview(initial);
    markdown = setChoice(markdown, stoneRecipe.candidateId, true);
    const selected = analyze(pipeline, "minecraft:target", markdown).analysis;
    assert.equal(selected.groups.some(group => group.type === "tag"), false);
    assert.equal(selected.readiness.readyForBioGeneration, true);
});

test("single-value tag auto-resolves while multi-value tag requires selection", () => {
    const single = vanilla.createVanillaPipeline({
        tagEntries: [{
            tagId: "minecraft:single",
            registryType: "item",
            json: { values: ["minecraft:a"] }
        }],
        recipeEntries: [recipe("minecraft:target", ["#minecraft:single"])]
    });
    assert.equal(
        analyze(single, "minecraft:target").analysis.groups.length,
        0
    );

    const multi = vanilla.createVanillaPipeline({
        tagEntries: [{
            tagId: "minecraft:multi",
            registryType: "item",
            json: { values: ["minecraft:a", "minecraft:b"] }
        }],
        recipeEntries: [recipe("minecraft:target", ["#minecraft:multi"])]
    });
    const initial = analyze(multi, "minecraft:target").analysis;
    assert.equal(initial.groups[0].type, "tag");
    assert.equal(initial.groups[0].status, "UNRESOLVED");
    let markdown = vanilla.dependencies.renderRecipeReview(initial);
    markdown = setChoice(markdown, "minecraft:a", true);
    const selected = analyze(multi, "minecraft:target", markdown).analysis;
    assert.equal(selected.groups[0].status, "RESOLVED");
    assert.equal(selected.readiness.readyForBioGeneration, true);
});

test("tag multiple selection and stale value produce explicit diagnostics", () => {
    const originalPipeline = vanilla.createVanillaPipeline({
        tagEntries: [{
            tagId: "minecraft:multi",
            registryType: "item",
            json: { values: ["minecraft:a", "minecraft:b"] }
        }],
        recipeEntries: [recipe("minecraft:target", ["#minecraft:multi"])]
    });
    const original = analyze(originalPipeline, "minecraft:target").analysis;
    let multiple = vanilla.dependencies.renderRecipeReview(original);
    multiple = setChoice(multiple, "minecraft:a", true);
    multiple = setChoice(multiple, "minecraft:b", true);
    const invalid = analyze(originalPipeline, "minecraft:target", multiple).analysis;
    assert.ok(invalid.diagnostics.some(entry => entry.code === "MULTIPLE_SELECTED"));

    let selected = vanilla.dependencies.renderRecipeReview(original);
    selected = setChoice(selected, "minecraft:a", true);
    const changedPipeline = vanilla.createVanillaPipeline({
        tagEntries: [{
            tagId: "minecraft:multi",
            registryType: "item",
            json: { values: ["minecraft:b", "minecraft:c"] }
        }],
        recipeEntries: [recipe("minecraft:target", ["#minecraft:multi"])]
    });
    const stale = analyze(changedPipeline, "minecraft:target", selected).analysis;
    assert.ok(stale.diagnostics.some(entry =>
        entry.code === "TAG_VALUE_NO_LONGER_EXISTS"
    ));
});

test("nested tags expose final resolved values and unrelated tags stay absent", () => {
    const pipeline = vanilla.createVanillaPipeline({
        tagEntries: [
            {
                tagId: "minecraft:child",
                registryType: "item",
                json: { values: ["minecraft:a", "minecraft:b"] }
            },
            {
                tagId: "minecraft:parent",
                registryType: "item",
                json: { values: ["#minecraft:child"] }
            },
            {
                tagId: "minecraft:unrelated",
                registryType: "item",
                json: { values: ["minecraft:x", "minecraft:y"] }
            }
        ],
        recipeEntries: [recipe("minecraft:target", ["#minecraft:parent"])]
    });
    const result = analyze(pipeline, "minecraft:target").analysis;
    assert.deepEqual(
        result.groups[0].candidates.map(candidate => candidate.candidateId),
        ["minecraft:a", "minecraft:b"]
    );
    assert.equal(result.groups.some(group =>
        group.title.includes("unrelated")
    ), false);
});

test("alternatives require exactly one and stale choices do not apply", () => {
    const pipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            recipe("minecraft:target", [["minecraft:a", "minecraft:b"]])
        ]
    });
    const initial = analyze(pipeline, "minecraft:target").analysis;
    assert.equal(initial.groups[0].type, "alternative");
    let markdown = vanilla.dependencies.renderRecipeReview(initial);
    markdown = setChoice(markdown, initial.groups[0].candidates[0].candidateId, true);
    const selected = analyze(pipeline, "minecraft:target", markdown).analysis;
    assert.equal(selected.groups[0].status, "RESOLVED");

    const changed = vanilla.createVanillaPipeline({
        recipeEntries: [
            recipe("minecraft:target", [["minecraft:b", "minecraft:c"]])
        ]
    });
    const stale = analyze(changed, "minecraft:target", markdown).analysis;
    assert.ok(stale.diagnostics.some(entry =>
        entry.code === "ALTERNATIVE_NO_LONGER_EXISTS"
    ));
});

test("unselected alternative branch ambiguity does not remain blocking", () => {
    const pipeline = vanilla.createVanillaPipeline({
        tagEntries: [{
            tagId: "minecraft:choices",
            registryType: "item",
            json: { values: ["minecraft:a", "minecraft:b"] }
        }],
        recipeEntries: [
            recipe("minecraft:target", [["#minecraft:choices", "minecraft:stone"]])
        ]
    });
    const first = analyze(pipeline, "minecraft:target").analysis;
    const alternative = first.groups[0];
    const stone = alternative.candidates.find(candidate =>
        candidate.label === "minecraft:stone"
    );
    let markdown = vanilla.dependencies.renderRecipeReview(first);
    markdown = setChoice(markdown, stone.candidateId, true);
    const selected = analyze(pipeline, "minecraft:target", markdown).analysis;
    assert.equal(selected.groups.some(group => group.type === "tag"), false);
    assert.equal(selected.readiness.readyForBioGeneration, true);
});

test("Markdown round-trip preserves text, notes, valid selection, and is idempotent", () => {
    const pipeline = multipleRecipePipeline();
    const initial = analyze(pipeline, "minecraft:target").analysis;
    let markdown = vanilla.dependencies.renderRecipeReview(initial) +
        "\n\n## User text\n- [x] ordinary task\n";
    markdown = setChoice(markdown, initial.groups[0].candidates[0].candidateId, true);
    markdown = markdown.replace(
        "<!-- 在此輸入人工備註 -->",
        "人工備註：選擇此路線。"
    );
    const next = analyze(pipeline, "minecraft:target", markdown).analysis;
    const regenerated = vanilla.dependencies.renderRecipeReview(next, markdown);
    assert.match(regenerated, /ordinary task/);
    assert.match(regenerated, /人工備註：選擇此路線。/);
    assert.match(regenerated, /- \[x\] `recipe-/);
    assert.equal(
        vanilla.dependencies.renderRecipeReview(next, regenerated),
        regenerated
    );
});

test("upstream route change moves downstream ambiguity to inactive area", () => {
    const pipeline = vanilla.createVanillaPipeline({
        tagEntries: [{
            tagId: "minecraft:woods",
            registryType: "item",
            json: { values: ["minecraft:oak", "minecraft:spruce"] }
        }],
        recipeEntries: [
            recipe("minecraft:target", ["#minecraft:woods"]),
            recipe("minecraft:target", ["minecraft:stone"])
        ]
    });
    const first = analyze(pipeline, "minecraft:target").analysis;
    let markdown = vanilla.dependencies.renderRecipeReview(first);
    const tagRecipe = first.groups[0].candidates.find(candidate =>
        candidate.recipe.ingredients[0].kind === "tag"
    );
    markdown = setChoice(markdown, tagRecipe.candidateId, true);
    const tagStage = analyze(pipeline, "minecraft:target", markdown).analysis;
    markdown = vanilla.dependencies.renderRecipeReview(tagStage, markdown);
    assert.equal(tagStage.groups.some(group => group.type === "tag"), true);

    const stoneRecipe = first.groups[0].candidates.find(candidate =>
        candidate.recipe.ingredients[0].id === "minecraft:stone"
    );
    markdown = setChoice(markdown, tagRecipe.candidateId, false);
    markdown = setChoice(markdown, stoneRecipe.candidateId, true);
    const stoneStage = analyze(pipeline, "minecraft:target", markdown).analysis;
    const regenerated = vanilla.dependencies.renderRecipeReview(stoneStage, markdown);
    assert.equal(stoneStage.groups.some(group => group.type === "tag"), false);
    assert.match(regenerated, /Inactive \/ Stale Ambiguities/);
    assert.ok(stoneStage.diagnostics.some(entry =>
        entry.code === "CANDIDATE_NO_LONGER_ON_ACTIVE_ROUTE"
    ));
});

test("fingerprint changes warn while still-valid identity is revalidated", () => {
    const pipeline = multipleRecipePipeline();
    const initial = analyze(pipeline, "minecraft:target").analysis;
    let markdown = vanilla.dependencies.renderRecipeReview(initial);
    markdown = setChoice(markdown, initial.groups[0].candidates[0].candidateId, true);
    markdown = markdown.replace(
        initial.sourceFingerprint,
        "sha256:" + "0".repeat(64)
    );
    const changed = analyze(pipeline, "minecraft:target", markdown).analysis;
    assert.ok(changed.diagnostics.some(entry =>
        entry.code === "STALE_FINGERPRINT"
    ));
    assert.equal(changed.groups[0].status, "RESOLVED");
});

test("real Vanilla piston integration is target-closure scoped", () => {
    const vaultRoot = path.resolve(__dirname, "..", "..");
    const runtime = createMinecraftVanillaRuntime(vaultRoot);
    assert.deepEqual(runtime.loadErrors, []);
    const dependency = runtime.pipeline.resolveDependencies("minecraft:piston");
    const baseItemIds = ["minecraft:cobblestone", "minecraft:raw_iron"];
    const basePlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        baseItemIds,
        selectionPolicy: "none"
    });
    const analysis = vanilla.dependencies.createRecipeAmbiguityAnalysis(
        dependency,
        basePlan,
        emptyReview(),
        {
            baseItemIds,
            sourceFingerprint:
                vanilla.dependencies.computeNormalizedRegistryFingerprint(
                    runtime.pipeline.itemRegistry
                )
        }
    );
    assert.equal(analysis.target, "minecraft:piston");
    assert.ok(analysis.groups.some(group =>
        group.type === "tag" && group.title.includes("minecraft:planks")
    ));
    assert.ok(analysis.groups.some(group =>
        group.type === "recipe" && group.ownerItemId === "minecraft:iron_ingot"
    ));
    const ironGroup = analysis.groups.find(group =>
        group.type === "recipe" && group.ownerItemId === "minecraft:iron_ingot"
    );
    assert.equal(
        new Set(ironGroup.candidates.map(candidate => candidate.label)).size,
        ironGroup.candidates.length
    );
    assert.ok(ironGroup.candidates.every(candidate =>
        candidate.label.includes("參考資料/Minecraft/recipe/")
    ));
    assert.equal(analysis.groups.some(group =>
        group.title.includes("minecraft:wool")
    ), false);
});
