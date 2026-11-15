const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const vanilla = require("../../BIO相關模組/MC解析器模塊");
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

function analyze(pipeline, target, markdown = "", baseItemIds = [], options = {}) {
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
        { sourceFingerprint, baseItemIds, ...options }
    );
    return { dependency, basePlan, parsed, analysis };
}

function firstRecipeCandidate(group) {
    return group.candidates.find(candidate => candidate.recipe);
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
    assert.ok(first.groups[0].candidates.filter(candidate => candidate.recipe).every(candidate =>
        /^recipe-[0-9a-f]{16}$/.test(candidate.candidateId)
    ));
    assert.equal(first.groups[0].candidates[0].candidateId, "external-base:minecraft:target");

    let markdown = vanilla.dependencies.renderRecipeReview(first);
    assert.match(markdown, /Base Route for Generation Planning/);
    assert.match(markdown, /GENERATION_PLANNING|bottom-up generation planning/);
    assert.match(markdown, /未來 BIO 會列出全部取得方式/);
    markdown = setChoice(markdown, firstRecipeCandidate(first.groups[0]).candidateId, true);
    const selected = analyze(pipeline, "minecraft:target", markdown).analysis;
    assert.equal(selected.groups[0].status, "RESOLVED");
    assert.equal(selected.readiness.unresolvedAmbiguities, 0);
    assert.equal(selected.readiness.readyForBioGeneration, true);
});

test("suspicious stew recipe choices display preserved effect semantics", () => {
    const stewRecipe = (flower, effect, duration) => ({
        type: "minecraft:crafting_shapeless",
        ingredients: [
            "minecraft:bowl",
            "minecraft:brown_mushroom",
            "minecraft:red_mushroom",
            `minecraft:${flower}`
        ],
        result: {
            id: "minecraft:suspicious_stew",
            components: {
                "minecraft:suspicious_stew_effects": [{
                    id: `minecraft:${effect}`,
                    duration
                }]
            }
        }
    });
    const pipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            stewRecipe("allium", "fire_resistance", 60),
            stewRecipe("poppy", "night_vision", 100)
        ]
    });
    const analysis = analyze(
        pipeline,
        "minecraft:suspicious_stew"
    ).analysis;
    const markdown = vanilla.dependencies.renderRecipeReview(analysis);
    assert.match(
        markdown,
        /minecraft:fire_resistance \(duration 60\)/
    );
    assert.match(
        markdown,
        /minecraft:night_vision \(duration 100\)/
    );
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
    const removedId = firstRecipeCandidate(original.groups[0]).candidateId;
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
        candidate.recipe?.ingredients[0].id === "minecraft:stone"
    );
    let markdown = vanilla.dependencies.renderRecipeReview(initial);
    markdown = setChoice(markdown, stoneRecipe.candidateId, true);
    const selected = analyze(pipeline, "minecraft:target", markdown).analysis;
    assert.equal(selected.groups.some(group => group.type === "tag"), false);
    assert.equal(selected.readiness.readyForBioGeneration, true);
    assert.deepEqual(selected.generationDependencies, [
        { itemId: "minecraft:target", dependencies: ["minecraft:stone"] },
        { itemId: "minecraft:stone", dependencies: [] }
    ]);
});

test("generation dependency graph records selected item, Tag and alternative edges including shared Base leaves", () => {
    const pipeline = vanilla.createVanillaPipeline({
        tagEntries: [{ tagId: "minecraft:choices", registryType: "item",
            json: { values: ["minecraft:tag_unused", "minecraft:tag_selected"] } }],
        recipeEntries: [
            recipe("minecraft:target", ["minecraft:left", "minecraft:right", "#minecraft:choices",
                ["minecraft:alternative_unused", "minecraft:alternative_selected"]]),
            recipe("minecraft:left", ["minecraft:shared"]),
            recipe("minecraft:right", ["minecraft:shared"]),
            recipe("minecraft:shared", ["minecraft:base_recipe_unused"])
        ]
    });
    const baseItemIds = ["minecraft:shared"];
    const options = { tagMappings: new Map([["minecraft:choices", {
        representativeItemId: "minecraft:tag_selected"
    }]]) };
    const initial = analyze(pipeline, "minecraft:target", "", baseItemIds, options).analysis;
    const alternative = initial.groups.find(group => group.type === "alternative");
    const choice = alternative.candidates.find(candidate => candidate.label === "minecraft:alternative_selected");
    const markdown = setChoice(vanilla.dependencies.renderRecipeReview(initial), choice.candidateId, true);
    const selected = analyze(pipeline, "minecraft:target", markdown, baseItemIds, options).analysis;
    assert.equal(selected.readiness.readyForBioGeneration, true);
    const dependencies = new Map(selected.generationDependencies.map(row => [row.itemId, row.dependencies]));
    assert.deepEqual(dependencies.get("minecraft:target"), [
        "minecraft:left", "minecraft:right", "minecraft:tag_selected", "minecraft:alternative_selected"
    ]);
    assert.deepEqual(dependencies.get("minecraft:left"), ["minecraft:shared"]);
    // shared was already generated through left, but right still owns its edge.
    assert.deepEqual(dependencies.get("minecraft:right"), ["minecraft:shared"]);
    assert.deepEqual(dependencies.get("minecraft:shared"), []);
    assert.deepEqual(dependencies.get("minecraft:tag_selected"), []);
    assert.deepEqual(dependencies.get("minecraft:alternative_selected"), []);
    for (const unused of ["minecraft:tag_unused", "minecraft:alternative_unused", "minecraft:base_recipe_unused"]) {
        assert.equal(dependencies.has(unused), false);
    }
    assert.deepEqual([...dependencies.keys()].sort(), [...selected.generationOrder].sort());
    const position = new Map(selected.generationOrder.map((id, index) => [id, index]));
    for (const [itemId, values] of dependencies) {
        for (const dependency of values) assert.ok(position.get(dependency) < position.get(itemId));
    }
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
    assert.deepEqual(
        vanilla.dependencies.collectRecipeDecisionTransfers(markdown).tagMappings,
        [{ tagId: "minecraft:multi", representativeItemId: "minecraft:a" }]
    );
    const selected = analyze(multi, "minecraft:target", markdown).analysis;
    assert.equal(selected.groups[0].status, "RESOLVED");
    assert.equal(selected.readiness.readyForBioGeneration, false);
    assert.deepEqual(selected.requestedTagMappings, [{
        tagId: "minecraft:multi",
        representativeItemId: "minecraft:a"
    }]);
});

test("global tag mapping resolves a tag once and preserves tag identity", () => {
    const pipeline = vanilla.createVanillaPipeline({
        tagEntries: [{
            tagId: "minecraft:oak_logs",
            registryType: "item",
            json: { values: ["minecraft:oak_log", "minecraft:oak_wood"] }
        }],
        recipeEntries: [recipe("minecraft:target", ["#minecraft:oak_logs"])]
    });
    const tagMappings = new Map([["minecraft:oak_logs", {
        tagId: "minecraft:oak_logs",
        bioId: "OAK_LOGS",
        representativeItemId: "minecraft:oak_log"
    }]]);
    const result = analyze(
        pipeline,
        "minecraft:target",
        "",
        [],
        { tagMappings }
    ).analysis;
    assert.equal(result.groups.length, 0);
    assert.deepEqual(result.appliedTagMappings, [{
        tagId: "minecraft:oak_logs",
        representativeItemId: "minecraft:oak_log"
    }]);
    assert.equal(result.readiness.readyForBioGeneration, true);
});

test("recipe External acquisition requests a locked Base transfer without changing Registry", () => {
    const pipeline = multipleRecipePipeline();
    const initial = analyze(pipeline, "minecraft:target").analysis;
    let markdown = vanilla.dependencies.renderRecipeReview(initial);
    markdown = setChoice(markdown, "external-base:minecraft:target", true);
    const selected = analyze(pipeline, "minecraft:target", markdown).analysis;
    assert.deepEqual(selected.requestedExternalBaseItemIds, ["minecraft:target"]);
    assert.equal(selected.readiness.readyForBioGeneration, false);
    assert.equal(pipeline.itemRegistry.get("minecraft:target").recipes.length, 2);
    assert.deepEqual(
        vanilla.dependencies.collectRecipeDecisionTransfers(markdown).externalBaseItemIds,
        ["minecraft:target"]
    );
});

test("stable recipe decision is reused globally across downstream targets", () => {
    const pipeline = multipleRecipePipeline();
    const initial = analyze(pipeline, "minecraft:target").analysis;
    const group = initial.groups[0];
    const selected = firstRecipeCandidate(group);
    const globalAmbiguitySelections = new Map([[group.groupId, {
        groupId: group.groupId,
        type: "recipe",
        candidateId: selected.candidateId,
        targets: ["minecraft:previous_target"]
    }]]);
    const reused = analyze(
        pipeline,
        "minecraft:target",
        "",
        [],
        { globalAmbiguitySelections }
    ).analysis;
    assert.equal(reused.groups[0].status, "RESOLVED");
    assert.equal(
        reused.groups[0].selectionSource,
        "GLOBAL_DECISION_REGISTRY"
    );
    assert.deepEqual(reused.appliedGlobalAmbiguityDecisions, [{
        groupId: group.groupId,
        candidateId: selected.candidateId
    }]);
    assert.equal(reused.readiness.readyForBioGeneration, true);
    assert.match(
        vanilla.dependencies.renderRecipeReview(reused),
        /Selection Source: `GLOBAL_DECISION_REGISTRY`/
    );
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

test("Minecraft color-family alternative preference is reused when the preferred item remains valid", () => {
    const blackPipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            recipe("minecraft:black_wool", [[
                "minecraft:blue_wool",
                "minecraft:white_wool"
            ]])
        ]
    });
    const blackInitial = analyze(blackPipeline, "minecraft:black_wool").analysis;
    const blackGroup = blackInitial.groups[0];
    assert.equal(blackGroup.preferenceKey, "minecraft-color-family:wool");
    const whiteCandidate = blackGroup.candidates.find(candidate =>
        candidate.label === "minecraft:white_wool"
    );
    let blackMarkdown = vanilla.dependencies.renderRecipeReview(blackInitial);
    blackMarkdown = setChoice(blackMarkdown, whiteCandidate.candidateId, true);
    const blackSelected = analyze(
        blackPipeline,
        "minecraft:black_wool",
        blackMarkdown
    ).analysis;
    blackMarkdown = vanilla.dependencies.renderRecipeReview(
        blackSelected,
        blackMarkdown
    );

    const registry = vanilla.dependencies.emptyReviewDecisionRegistry();
    vanilla.dependencies.setReviewDecisionSnapshot(
        registry,
        "minecraft:black_wool",
        {
            sourceFingerprint: "sha256:test",
            baseReview: "",
            recipeReview: blackMarkdown
        }
    );
    const index = vanilla.dependencies.createGlobalAmbiguityDecisionIndex(registry);
    assert.equal(index.diagnostics.length, 0);
    assert.equal(
        index.alternativePreferences.get("minecraft-color-family:wool").candidateId,
        whiteCandidate.candidateId
    );

    const bluePipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            recipe("minecraft:blue_wool", [[
                "minecraft:black_wool",
                "minecraft:white_wool"
            ]])
        ]
    });
    const reused = analyze(
        bluePipeline,
        "minecraft:blue_wool",
        "",
        [],
        { globalAlternativePreferences: index.alternativePreferences }
    ).analysis;
    assert.equal(reused.groups[0].status, "RESOLVED");
    assert.equal(
        reused.groups[0].selectionSource,
        "GLOBAL_ALTERNATIVE_PREFERENCE"
    );
    assert.equal(
        reused.groups[0].candidates.find(candidate =>
            candidate.candidateId === reused.groups[0].selectedCandidateId
        ).label,
        "minecraft:white_wool"
    );
    assert.deepEqual(reused.appliedGlobalAlternativePreferences, [{
        preferenceKey: "minecraft-color-family:wool",
        candidateId: whiteCandidate.candidateId
    }]);

    const whitePipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            recipe("minecraft:white_wool", [[
                "minecraft:black_wool",
                "minecraft:blue_wool"
            ]])
        ]
    });
    const unavailable = analyze(
        whitePipeline,
        "minecraft:white_wool",
        "",
        [],
        { globalAlternativePreferences: index.alternativePreferences }
    ).analysis;
    assert.equal(unavailable.groups[0].status, "UNRESOLVED");
    assert.ok(unavailable.diagnostics.some(entry =>
        entry.code === "GLOBAL_ALTERNATIVE_PREFERENCE_UNAVAILABLE"
    ));

    vanilla.dependencies.addReviewDecisionRevocation(registry, {
        kind: "alternative-preference",
        key: "minecraft-color-family:wool",
        target: "minecraft:blue_wool",
        previousValue: whiteCandidate.candidateId,
        revokedAt: "2026-11-09T00:00:00.000Z"
    });
    const revokedPreferences =
        vanilla.dependencies.createGlobalAmbiguityDecisionIndex(registry);
    assert.equal(
        revokedPreferences.alternativePreferences.has("minecraft-color-family:wool"),
        false
    );
});

test("identical alternative candidate sets reuse one global preference across recipe contexts", () => {
    const firstPipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            recipe("minecraft:first_target", [[
                "minecraft:coal",
                "minecraft:charcoal"
            ]])
        ]
    });
    const firstInitial = analyze(firstPipeline, "minecraft:first_target").analysis;
    const firstGroup = firstInitial.groups[0];
    assert.match(firstGroup.preferenceKey, /^alternative-set-[0-9a-f]{16}$/);
    const coal = firstGroup.candidates.find(candidate =>
        candidate.label === "minecraft:coal"
    );
    let firstMarkdown = vanilla.dependencies.renderRecipeReview(firstInitial);
    firstMarkdown = setChoice(firstMarkdown, coal.candidateId, true);
    const firstSelected = analyze(
        firstPipeline,
        "minecraft:first_target",
        firstMarkdown
    ).analysis;
    firstMarkdown = vanilla.dependencies.renderRecipeReview(
        firstSelected,
        firstMarkdown
    );

    const registry = vanilla.dependencies.emptyReviewDecisionRegistry();
    vanilla.dependencies.setReviewDecisionSnapshot(
        registry,
        "minecraft:first_target",
        {
            sourceFingerprint: "sha256:test",
            baseReview: "",
            recipeReview: firstMarkdown
        }
    );
    const index = vanilla.dependencies.createGlobalAmbiguityDecisionIndex(registry);

    const secondPipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            recipe("minecraft:second_target", [[
                "minecraft:charcoal",
                "minecraft:coal"
            ]])
        ]
    });
    const secondInitial = analyze(secondPipeline, "minecraft:second_target").analysis;
    assert.notEqual(secondInitial.groups[0].groupId, firstGroup.groupId);
    assert.equal(secondInitial.groups[0].preferenceKey, firstGroup.preferenceKey);
    const reused = analyze(
        secondPipeline,
        "minecraft:second_target",
        "",
        [],
        { globalAlternativePreferences: index.alternativePreferences }
    ).analysis;
    assert.equal(reused.groups[0].status, "RESOLVED");
    assert.equal(reused.groups[0].selectionSource, "GLOBAL_ALTERNATIVE_PREFERENCE");
    assert.equal(
        reused.groups[0].candidates.find(candidate =>
            candidate.candidateId === reused.groups[0].selectedCandidateId
        ).label,
        "minecraft:coal"
    );
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
    markdown = setChoice(markdown, firstRecipeCandidate(initial.groups[0]).candidateId, true);
    markdown = markdown.replace(
        "<!-- 在此輸入人工備註 -->",
        "人工備註：選擇此路線。"
    );
    const next = analyze(pipeline, "minecraft:target", markdown).analysis;
    const regenerated = vanilla.dependencies.renderRecipeReview(next, markdown);
    assert.match(regenerated, /ordinary task/);
    assert.match(regenerated, /人工備註：選擇此路線。/);
    assert.doesNotMatch(regenerated, /- \[x\] `recipe-/);
    assert.match(regenerated, /obsf:locked-ambiguity:start recipe-group-/);
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
        candidate.recipe?.ingredients[0].kind === "tag"
    );
    markdown = setChoice(markdown, tagRecipe.candidateId, true);
    const tagStage = analyze(pipeline, "minecraft:target", markdown).analysis;
    markdown = vanilla.dependencies.renderRecipeReview(tagStage, markdown);
    assert.equal(tagStage.groups.some(group => group.type === "tag"), true);

    const stoneRecipe = first.groups[0].candidates.find(candidate =>
        candidate.recipe?.ingredients[0].id === "minecraft:stone"
    );
    const reopened = vanilla.dependencies.reopenRecipeDecision(
        markdown,
        first.groups[0].groupId
    );
    assert.equal(reopened.reopened, true);
    const reopenedStage = analyze(
        pipeline,
        "minecraft:target",
        reopened.markdown
    ).analysis;
    markdown = vanilla.dependencies.renderRecipeReview(
        reopenedStage,
        reopened.markdown
    );
    markdown = setChoice(markdown, stoneRecipe.candidateId, true);
    const stoneStage = analyze(pipeline, "minecraft:target", markdown).analysis;
    const regenerated = vanilla.dependencies.renderRecipeReview(stoneStage, markdown);
    assert.equal(stoneStage.groups.some(group => group.type === "tag"), false);
    assert.match(regenerated, /Inactive \/ Historical Ambiguities/);
});

test("review queue is deterministic and advances only through explicit state changes", () => {
    const queue = vanilla.dependencies.createReviewQueue({
        sourceFingerprint: "sha256:test",
        scannedTargets: 3,
        existingBIO: 1,
        automaticReady: 1,
        targets: [
            {
                target: "minecraft:zeta",
                reasons: { recipe: 1 },
                baseReview: "z/base.md",
                recipeReview: "z/recipe.md"
            },
            {
                target: "minecraft:alpha",
                reasons: { blockedCycles: 1 },
                baseReview: "a/base.md",
                recipeReview: "a/recipe.md"
            }
        ]
    });
    assert.deepEqual(queue.targets.map(entry => entry.target), [
        "minecraft:alpha",
        "minecraft:zeta"
    ]);
    const first = vanilla.dependencies.activateNextReviewTarget(queue);
    assert.equal(first.target, "minecraft:alpha");
    assert.equal(vanilla.dependencies.currentReviewTarget(queue).target, "minecraft:alpha");
    vanilla.dependencies.updateReviewTarget(queue, first.target, "READY");
    const second = vanilla.dependencies.activateNextReviewTarget(queue);
    assert.equal(second.target, "minecraft:zeta");
    assert.match(
        vanilla.dependencies.renderReviewQueueMarkdown(queue),
        /minecraft:zeta/
    );
    const reopened = vanilla.dependencies.focusReviewTarget(
        queue,
        "minecraft:alpha"
    );
    assert.equal(reopened.status, "IN_REVIEW");
    assert.equal(queue.targets.find(entry =>
        entry.target === "minecraft:zeta"
    ).status, "PENDING");
    assert.match(
        vanilla.dependencies.renderReviewQueueMarkdown(queue),
        /\[\[Minecraft Recipe Review\]\]/
    );
});

test("review decision registry round-trips complete target snapshots deterministically", () => {
    const registry = vanilla.dependencies.emptyReviewDecisionRegistry();
    vanilla.dependencies.setReviewDecisionSnapshot(
        registry,
        "minecraft:piston",
        {
            sourceFingerprint: "sha256:test",
            baseReview: "---\ntarget: minecraft:piston\n---\n<!-- obsf:locked-base:start minecraft:redstone external -->\n<!-- obsf:locked-base:end minecraft:redstone -->\n",
            recipeReview: "---\ntarget: minecraft:piston\n---\n<!-- obsf:locked-ambiguity:start recipe-group-test recipe recipe-test -->\n<!-- obsf:locked-ambiguity:end recipe-group-test -->\n"
        }
    );
    const markdown = vanilla.dependencies.renderReviewDecisionRegistry(registry);
    const parsed = vanilla.dependencies.parseReviewDecisionRegistry(markdown);
    assert.deepEqual(
        vanilla.dependencies.getReviewDecisionSnapshot(parsed, "minecraft:piston"),
        registry.targets["minecraft:piston"]
    );
    assert.deepEqual(
        parsed.targets["minecraft:piston"].lockedBaseDecisions,
        [{ itemId: "minecraft:redstone", kind: "external" }]
    );
    assert.deepEqual(
        parsed.targets["minecraft:piston"].lockedAmbiguityDecisions,
        [{
            groupId: "recipe-group-test",
            type: "recipe",
            candidateId: "recipe-test",
            subject: null
        }]
    );
    const globalIndex =
        vanilla.dependencies.createGlobalAmbiguityDecisionIndex(parsed);
    assert.equal(globalIndex.diagnostics.length, 0);
    assert.equal(
        globalIndex.selections.get("recipe-group-test").candidateId,
        "recipe-test"
    );
    assert.equal(
        vanilla.dependencies.renderReviewDecisionRegistry(parsed),
        markdown
    );
    vanilla.dependencies.addReviewDecisionRevocation(parsed, {
        kind: "ambiguity-group",
        key: "recipe-group-test",
        target: "minecraft:piston",
        previousValue: "recipe-test",
        revokedAt: "2026-11-09T00:00:00.000Z"
    });
    assert.equal(
        vanilla.dependencies.createGlobalAmbiguityDecisionIndex(parsed)
            .selections.has("recipe-group-test"),
        false
    );
    const revokedRoundTrip = vanilla.dependencies.parseReviewDecisionRegistry(
        vanilla.dependencies.renderReviewDecisionRegistry(parsed)
    );
    assert.equal(revokedRoundTrip.revocations[0].status, "ACTIVE");
    const stripped = vanilla.dependencies.stripRevokedDecisionsFromSnapshot(
        revokedRoundTrip,
        "minecraft:piston",
        revokedRoundTrip.targets["minecraft:piston"]
    );
    assert.doesNotMatch(stripped.recipeReview, /obsf:locked-ambiguity:start recipe-group-test/);
    assert.deepEqual(stripped.lockedAmbiguityDecisions, []);
    vanilla.dependencies.setReviewDecisionSnapshot(
        revokedRoundTrip,
        "minecraft:piston",
        revokedRoundTrip.targets["minecraft:piston"]
    );
    assert.equal(revokedRoundTrip.revocations[0].status, "SUPERSEDED");
    assert.equal(
        vanilla.dependencies.createGlobalAmbiguityDecisionIndex(revokedRoundTrip)
            .selections.get("recipe-group-test").candidateId,
        "recipe-test"
    );
});

test("locked recipe decision is parsed without an editable checkbox", () => {
    const pipeline = multipleRecipePipeline();
    const initial = analyze(pipeline, "minecraft:target").analysis;
    let markdown = vanilla.dependencies.renderRecipeReview(initial);
    markdown = setChoice(markdown, firstRecipeCandidate(initial.groups[0]).candidateId, true);
    const selected = analyze(pipeline, "minecraft:target", markdown).analysis;
    const locked = vanilla.dependencies.renderRecipeReview(selected, markdown);
    assert.doesNotMatch(locked, /- \[x\] `recipe-/);
    assert.match(locked, /Status: `LOCKED`/);
    assert.match(locked, /Scope: `GENERATION_PLANNING_ONLY`/);
    assert.match(locked, /Other Routes: `PRESERVED_IN_NORMALIZED_REGISTRY`/);
    const reparsed = analyze(pipeline, "minecraft:target", locked).analysis;
    assert.equal(reparsed.groups[0].status, "RESOLVED");
    assert.equal(reparsed.readiness.readyForBioGeneration, true);
});

test("fingerprint changes warn while still-valid identity is revalidated", () => {
    const pipeline = multipleRecipePipeline();
    const initial = analyze(pipeline, "minecraft:target").analysis;
    let markdown = vanilla.dependencies.renderRecipeReview(initial);
    markdown = setChoice(markdown, firstRecipeCandidate(initial.groups[0]).candidateId, true);
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
    assert.ok(ironGroup.candidates.filter(candidate => candidate.recipe).every(candidate =>
        candidate.label.includes("參考資料/Minecraft/recipe/")
    ));
    assert.equal(analysis.groups.some(group =>
        group.title.includes("minecraft:wool")
    ), false);
});
