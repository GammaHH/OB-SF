const assert = require("node:assert/strict");
const test = require("node:test");

const vanilla = require("../../模板放置處/MC解析器模塊");

function recipe(resultId, ingredients, output = 1) {
    return {
        type: "minecraft:crafting_shapeless",
        ingredients,
        result: { id: resultId, count: output }
    };
}

function fixture() {
    const pipeline = vanilla.createVanillaPipeline({
        recipeEntries: [
            recipe("minecraft:piston", [
                "minecraft:cobblestone",
                "minecraft:iron_ingot",
                "minecraft:redstone"
            ]),
            recipe("minecraft:cobblestone", ["minecraft:stone"]),
            recipe("minecraft:stone", ["minecraft:cobblestone"]),
            recipe("minecraft:iron_ingot", ["minecraft:raw_iron"]),
            recipe("minecraft:iron_ingot", ["minecraft:iron_ore"]),
            recipe("minecraft:raw_iron", ["minecraft:raw_iron_block"], 9),
            recipe("minecraft:raw_iron_block", [
                "minecraft:raw_iron", "minecraft:raw_iron", "minecraft:raw_iron",
                "minecraft:raw_iron", "minecraft:raw_iron", "minecraft:raw_iron",
                "minecraft:raw_iron", "minecraft:raw_iron", "minecraft:raw_iron"
            ])
        ]
    });
    const dependency = pipeline.resolveDependencies("minecraft:piston");
    const baseline = pipeline.createBaseDependencyPlan(dependency, {
        selectionPolicy: "none"
    });
    const review = vanilla.dependencies.createBaseMaterialReview(
        dependency,
        baseline
    );
    return { pipeline, dependency, baseline, review };
}

function setChecked(markdown, itemId, checked) {
    const value = checked ? "x" : " ";
    const suffix = ` \`${itemId}\` <!-- obsf:candidate-id:${itemId} -->`;
    for (const current of [" ", "x", "X"]) {
        const source = `- [${current}]${suffix}`;
        if (markdown.includes(source)) {
            return markdown.replace(source, `- [${value}]${suffix}`);
        }
    }
    throw new Error(`找不到 Checkbox：${itemId}`);
}

function addExternalBase(markdown, itemId, checked = true) {
    const value = checked ? "x" : " ";
    return markdown.replace(
        vanilla.dependencies.EXTERNAL_END,
        `- [${value}] \`${itemId}\`\n${vanilla.dependencies.EXTERNAL_END}`
    );
}

test("piston review emits stable unique candidates from blocking cycle groups", () => {
    const { review } = fixture();
    assert.equal(review.schemaVersion, 1);
    assert.equal(review.target, "minecraft:piston");
    assert.match(review.sourceFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(
        review.candidates.map(candidate => candidate.itemId),
        [
            "minecraft:cobblestone",
            "minecraft:stone",
            "minecraft:raw_iron",
            "minecraft:raw_iron_block"
        ]
    );
    assert.equal(new Set(review.candidates.map(candidate => candidate.itemId)).size, 4);
    assert.equal(review.cycleGroups.length, 2);
});

test("blank review selects no explicit base materials and ignores outside checkboxes", () => {
    const { review } = fixture();
    const markdown = vanilla.dependencies.renderBaseMaterialReview(review) +
        "\n\n## Ordinary note\n- [x] `minecraft:not_a_setting`\n";
    const parsed = vanilla.dependencies.parseBaseMaterialReview(markdown, review);
    assert.equal(parsed.canApply, true);
    assert.deepEqual(parsed.selectedBaseItemIds, []);
    assert.deepEqual(parsed.diagnostics, []);
});

test("multiple checked candidates round-trip in stable candidate order", () => {
    const { review } = fixture();
    let markdown = vanilla.dependencies.renderBaseMaterialReview(review);
    markdown = setChecked(markdown, "minecraft:raw_iron", true);
    markdown = setChecked(markdown, "minecraft:cobblestone", true);
    const parsed = vanilla.dependencies.parseBaseMaterialReview(markdown, review);
    assert.deepEqual(parsed.selectedBaseItemIds, [
        "minecraft:cobblestone",
        "minecraft:raw_iron"
    ]);
});

test("unchecked candidate cancels a previous selection", () => {
    const { review } = fixture();
    let markdown = vanilla.dependencies.renderBaseMaterialReview(review);
    markdown = setChecked(markdown, "minecraft:cobblestone", true);
    markdown = vanilla.dependencies.renderBaseMaterialReview(review, markdown);
    markdown = setChecked(markdown, "minecraft:cobblestone", false);
    const parsed = vanilla.dependencies.parseBaseMaterialReview(markdown, review);
    assert.equal(parsed.canApply, true);
    assert.deepEqual(parsed.selectedBaseItemIds, []);
});

test("unknown, stale, duplicate, missing, and malformed candidates are explicit errors", () => {
    const { review } = fixture();
    const original = vanilla.dependencies.renderBaseMaterialReview(review);
    const unknown = original.replaceAll(
        "minecraft:cobblestone",
        "minecraft:unknown_material"
    );
    const unknownParsed = vanilla.dependencies.parseBaseMaterialReview(unknown, review);
    assert.equal(unknownParsed.canApply, false);
    assert.ok(unknownParsed.diagnostics.some(entry =>
        entry.code === "UNKNOWN_OR_STALE_CANDIDATE"
    ));
    assert.ok(unknownParsed.diagnostics.some(entry =>
        entry.code === "MISSING_CANDIDATE"
    ));

    const invalid = original.replace(
        "- [ ] `minecraft:stone` <!-- obsf:candidate-id:minecraft:stone -->",
        "- [ ] `MINECRAFT:Stone` <!-- obsf:candidate-id:MINECRAFT:Stone -->"
    );
    const invalidParsed = vanilla.dependencies.parseBaseMaterialReview(invalid, review);
    assert.ok(invalidParsed.diagnostics.some(entry =>
        entry.code === "INVALID_ITEM_ID"
    ));

    const block = original.match(
        /<!-- obsf:candidate:start minecraft:stone -->[\s\S]*?<!-- obsf:candidate:end minecraft:stone -->/
    )[0];
    const duplicate = original.replace(
        vanilla.dependencies.SELECTION_END,
        `${block}\n${vanilla.dependencies.SELECTION_END}`
    );
    const duplicateParsed = vanilla.dependencies.parseBaseMaterialReview(duplicate, review);
    assert.ok(duplicateParsed.diagnostics.some(entry =>
        entry.code === "DUPLICATE_CANDIDATE"
    ));

    const malformed = original.replace(
        "- [ ] `minecraft:stone` <!-- obsf:candidate-id:minecraft:stone -->",
        "- [x] minecraft:stone"
    );
    const malformedParsed = vanilla.dependencies.parseBaseMaterialReview(malformed, review);
    assert.ok(malformedParsed.diagnostics.some(entry =>
        entry.code === "MALFORMED_CANDIDATE"
    ));
});

test("fingerprint change warns and revalidates current candidates", () => {
    const { review } = fixture();
    const markdown = vanilla.dependencies
        .renderBaseMaterialReview(review)
        .replace(review.sourceFingerprint, "sha256:" + "0".repeat(64));
    const parsed = vanilla.dependencies.parseBaseMaterialReview(markdown, review);
    assert.equal(parsed.canApply, true);
    assert.ok(parsed.diagnostics.some(entry =>
        entry.code === "SOURCE_FINGERPRINT_MISMATCH" &&
        entry.severity === "WARNING"
    ));
});

test("regeneration preserves checkbox state, candidate notes, and outside content", () => {
    const { review } = fixture();
    let markdown = vanilla.dependencies.renderBaseMaterialReview(review) +
        "\n\n# User content\n\nKeep this paragraph.\n";
    markdown = setChecked(markdown, "minecraft:cobblestone", true);
    markdown = markdown.replace(
        "<!-- 在此輸入人工備註 -->",
        "人工備註：鵝卵石由世界取得。"
    );
    const regenerated = vanilla.dependencies.renderBaseMaterialReview(review, markdown);
    assert.match(regenerated, /Keep this paragraph\./);
    assert.match(regenerated, /- \[x\] `minecraft:cobblestone`/);
    assert.match(regenerated, /人工備註：鵝卵石由世界取得。/);
    assert.equal(
        vanilla.dependencies.renderBaseMaterialReview(review, regenerated),
        regenerated
    );
});

test("removed candidates move to expired review section and are not applied", () => {
    const { review } = fixture();
    let markdown = vanilla.dependencies.renderBaseMaterialReview(review);
    markdown = setChecked(markdown, "minecraft:raw_iron", true);
    const nextReview = {
        ...review,
        candidates: review.candidates.filter(candidate =>
            candidate.itemId !== "minecraft:raw_iron"
        )
    };
    const regenerated = vanilla.dependencies.renderBaseMaterialReview(
        nextReview,
        markdown
    );
    assert.match(regenerated, /過期候選（需重新審核）/);
    assert.match(regenerated, /過期候選，需重新審核；不會套用/);
    const parsed = vanilla.dependencies.parseBaseMaterialReview(
        regenerated,
        nextReview
    );
    assert.equal(parsed.canApply, true);
    assert.ok(!parsed.selectedBaseItemIds.includes("minecraft:raw_iron"));
});

test("review selections become explicit bases and clear both cycle groups", () => {
    const { pipeline, dependency, review } = fixture();
    let markdown = vanilla.dependencies.renderBaseMaterialReview(review);
    markdown = setChecked(markdown, "minecraft:cobblestone", true);
    markdown = setChecked(markdown, "minecraft:raw_iron", true);
    const parsed = vanilla.dependencies.parseBaseMaterialReview(markdown, review);
    const formal = pipeline.createBaseDependencyPlan(dependency, {
        baseItemIds: parsed.selectedBaseItemIds,
        selectionPolicy: "none"
    });
    const preview = pipeline.createBaseDependencyPlan(dependency, {
        baseItemIds: parsed.selectedBaseItemIds,
        selectionPolicy: "first-acyclic"
    });
    assert.deepEqual(formal.routeAwareBlockedItems, []);
    assert.equal(preview.canPlanTargets, true);
    assert.deepEqual(preview.planningCycles, []);
    assert.equal(preview.generationOrder.at(-1), "minecraft:piston");
});

test("external acquisition checkbox makes a graph item an explicit base", () => {
    const { pipeline, dependency, review } = fixture();
    let markdown = vanilla.dependencies.renderBaseMaterialReview(review);
    markdown = setChecked(markdown, "minecraft:cobblestone", true);
    markdown = setChecked(markdown, "minecraft:raw_iron", true);
    markdown = addExternalBase(markdown, "minecraft:redstone");

    const parsed = vanilla.dependencies.parseBaseMaterialReview(markdown, review);
    assert.equal(parsed.canApply, true);
    assert.deepEqual(parsed.selectedBaseItemIds, [
        "minecraft:cobblestone",
        "minecraft:raw_iron",
        "minecraft:redstone"
    ]);

    const formal = pipeline.createBaseDependencyPlan(dependency, {
        baseItemIds: parsed.selectedBaseItemIds,
        selectionPolicy: "none"
    });
    assert.deepEqual(formal.routeAwareBlockedItems, []);
});

test("external acquisition must be a current graph item and cannot duplicate a cycle candidate", () => {
    const { review } = fixture();
    const original = vanilla.dependencies.renderBaseMaterialReview(review);

    const unknown = addExternalBase(original, "minecraft:not_in_target_graph");
    const unknownParsed = vanilla.dependencies.parseBaseMaterialReview(
        unknown,
        review
    );
    assert.equal(unknownParsed.canApply, false);
    assert.ok(unknownParsed.diagnostics.some(entry =>
        entry.code === "UNKNOWN_OR_STALE_EXTERNAL_BASE"
    ));

    const duplicate = addExternalBase(original, "minecraft:cobblestone");
    const duplicateParsed = vanilla.dependencies.parseBaseMaterialReview(
        duplicate,
        review
    );
    assert.equal(duplicateParsed.canApply, false);
    assert.ok(duplicateParsed.diagnostics.some(entry =>
        entry.code === "DUPLICATE_BASE_ITEM"
    ));
});

test("external acquisition survives regeneration with stable markers and notes", () => {
    const { review } = fixture();
    let markdown = vanilla.dependencies.renderBaseMaterialReview(review);
    markdown = addExternalBase(markdown, "minecraft:redstone");

    let regenerated = vanilla.dependencies.renderBaseMaterialReview(
        review,
        markdown
    );
    assert.match(
        regenerated,
        /<!-- obsf:external-base:start minecraft:redstone -->/
    );
    assert.match(regenerated, /- \[x\] `minecraft:redstone`/);

    regenerated = regenerated.replace(
        "<!-- 在此輸入人工備註，例如：挖掘掉落 -->",
        "人工備註：紅石粉以直接挖礦取得。"
    );
    const second = vanilla.dependencies.renderBaseMaterialReview(
        review,
        regenerated
    );
    assert.match(second, /人工備註：紅石粉以直接挖礦取得。/);
    assert.equal(
        vanilla.dependencies.renderBaseMaterialReview(review, second),
        second
    );
});

test("external acquisition removed from the target graph becomes stale and is not applied", () => {
    const { review } = fixture();
    let markdown = vanilla.dependencies.renderBaseMaterialReview(review);
    markdown = addExternalBase(markdown, "minecraft:redstone");
    markdown = vanilla.dependencies.renderBaseMaterialReview(review, markdown);

    const nextReview = {
        ...review,
        graphItemIds: review.graphItemIds.filter(itemId =>
            itemId !== "minecraft:redstone"
        )
    };
    const regenerated = vanilla.dependencies.renderBaseMaterialReview(
        nextReview,
        markdown
    );
    assert.match(regenerated, /過期外部基礎材料（需重新審核）/);
    assert.match(regenerated, /已不在目前 target dependency graph；不會套用/);

    const parsed = vanilla.dependencies.parseBaseMaterialReview(
        regenerated,
        nextReview
    );
    assert.equal(parsed.canApply, true);
    assert.ok(!parsed.selectedBaseItemIds.includes("minecraft:redstone"));
});

test("external checkbox outside the managed section is ignored", () => {
    const { review } = fixture();
    const markdown = vanilla.dependencies.renderBaseMaterialReview(review) +
        "\n\n## Ordinary tasks\n- [x] `minecraft:redstone`\n";
    const parsed = vanilla.dependencies.parseBaseMaterialReview(markdown, review);
    assert.equal(parsed.canApply, true);
    assert.deepEqual(parsed.selectedBaseItemIds, []);
});
