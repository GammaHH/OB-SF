const assert = require("node:assert/strict");
const test = require("node:test");
const { mergeGenerationOrders, mergeBIOPreviewContexts } = require("../../scripts/lib/bio-preview-batch.cjs");

function context(target, generationOrder, overrides = {}) {
    return {
        target, fingerprint: "sha256:shared-source", machineMappingSHA256: "shared-machine-mapping",
        runtime: { snapshot: "shared" }, baseItemIds: [], preferredRecipeByItem: new Map(),
        dependency: { graph: new Map(generationOrder.map(id => [id, { id }])) },
        basePlan: { baseDependencyMap: new Map(generationOrder.map(id => [id, { itemId: id }])) },
        analysis: { generationOrder, generationDependencies: generationOrder.map(itemId => ({ itemId, dependencies: [] })),
            groups: [], readiness: { readyForBioGeneration: true } },
        ...overrides
    };
}

test("batch overlap creates one deterministic generation entry and unions dependency maps", () => {
    const left = context("minecraft:stick", ["minecraft:oak_log", "minecraft:oak_planks", "minecraft:stick"]);
    const right = context("minecraft:soul_campfire", ["minecraft:oak_log", "minecraft:oak_planks", "minecraft:soul_campfire"]);
    const merged = mergeBIOPreviewContexts([left, right]);
    assert.deepEqual(merged.targets, [left.target, right.target]);
    assert.equal(merged.target, left.target);
    assert.deepEqual(merged.analysis.generationOrder, ["minecraft:oak_log", "minecraft:oak_planks", "minecraft:stick", "minecraft:soul_campfire"]);
    assert.equal(merged.dependency.graph.size, 4);
    assert.equal(merged.basePlan.baseDependencyMap.size, 4);
    assert.equal(merged.runtime, left.runtime);
    assert.equal(merged.fingerprint, left.fingerprint);
});

test("batch topology follows actual selected dependencies while source order only breaks ties", () => {
    assert.deepEqual(mergeGenerationOrders([["parent", "one"], ["child", "two"]], [
        { itemId: "parent", dependencies: ["child"] }, { itemId: "one", dependencies: ["parent"] },
        { itemId: "child", dependencies: [] }, { itemId: "two", dependencies: ["child"] }
    ]), ["child", "parent", "one", "two"]);
    assert.deepEqual(mergeGenerationOrders([["a", "b", "one"], ["b", "a", "two"]]), ["a", "b", "one", "two"]);
    assert.throws(() => mergeGenerationOrders([["same", "same"]]), /BATCH_INVALID_GENERATION_ORDER/);
});

test("opposite independent material traversal orders merge successfully with their real parent edges", () => {
    const left = context("one", ["a", "b", "one"]);
    left.analysis.generationDependencies.find(row => row.itemId === "one").dependencies = ["a", "b"];
    const right = context("two", ["b", "a", "two"]);
    right.analysis.generationDependencies.find(row => row.itemId === "two").dependencies = ["b", "a"];
    const merged = mergeBIOPreviewContexts([left, right]);
    assert.deepEqual(merged.analysis.generationOrder, ["a", "b", "one", "two"]);
    assert.deepEqual(merged.analysis.generationDependencies, [
        { itemId: "a", dependencies: [] }, { itemId: "b", dependencies: [] },
        { itemId: "one", dependencies: ["a", "b"] }, { itemId: "two", dependencies: ["a", "b"] }
    ]);
});

test("unused cyclic graph routes do not create batch dependencies", () => {
    const selected = context("one", ["base", "one"]);
    selected.analysis.generationDependencies.find(row => row.itemId === "one").dependencies = ["base"];
    selected.dependency.graph.set("unused-one", { recipes: [{ ingredients: [{ id: "unused-two" }] }] });
    selected.dependency.graph.set("unused-two", { recipes: [{ ingredients: [{ id: "unused-one" }] }] });
    const merged = mergeBIOPreviewContexts([selected]);
    assert.deepEqual(merged.analysis.generationOrder, ["base", "one"]);
    assert.equal(merged.dependency.graph.has("unused-one"), true, "the full graph is retained without using its unselected edges for ordering");
});

test("a real selected dependency cycle fails with remaining item identities", () => {
    const selected = context("one", ["a", "b", "one"]);
    selected.analysis.generationDependencies.find(row => row.itemId === "a").dependencies = ["b"];
    selected.analysis.generationDependencies.find(row => row.itemId === "b").dependencies = ["a"];
    selected.analysis.generationDependencies.find(row => row.itemId === "one").dependencies = ["b"];
    assert.throws(() => mergeBIOPreviewContexts([selected]), /BATCH_DEPENDENCY_CYCLE.*a、b、one/);
    assert.throws(() => mergeGenerationOrders([["self"]], [{ itemId: "self", dependencies: ["self"] }]), /BATCH_DEPENDENCY_CYCLE.*self/);
});

test("fresh dependency records are mandatory and every selected edge endpoint must be generated", () => {
    const original = context("one", ["base", "one"]);
    for (const value of [undefined, null, {}]) assert.throws(() => mergeBIOPreviewContexts([{ ...original,
        analysis: { ...original.analysis, generationDependencies: value } }]), /BATCH_GENERATION_DEPENDENCIES_REQUIRED/);
    assert.throws(() => mergeBIOPreviewContexts([{ ...original, analysis: { ...original.analysis,
        generationDependencies: [{ itemId: "base", dependencies: [] }] } }]), /BATCH_GENERATION_DEPENDENCIES_INCOMPLETE.*one/);
    assert.throws(() => mergeGenerationOrders([["one"]], [{ itemId: "one", dependencies: ["missing"] }]),
        /BATCH_DEPENDENCY_ENDPOINT_MISSING.*missing → one/);
    assert.throws(() => mergeGenerationOrders([["one"]], [{ itemId: "missing", dependencies: [] }]),
        /BATCH_DEPENDENCY_ENDPOINT_MISSING.*missing/);
    assert.throws(() => mergeBIOPreviewContexts([{ ...original, analysis: { ...original.analysis,
        generationDependencies: [{ itemId: "base", dependencies: [] }, { itemId: "one", dependencies: ["missing"] }] } }]),
    /BATCH_DEPENDENCY_ENDPOINT_MISSING.*missing → one/);
    assert.throws(() => mergeGenerationOrders([["one"]], [{ itemId: "one", dependencies: "not an array" }]),
        /BATCH_INVALID_GENERATION_DEPENDENCIES.*one/);
});

test("same-item dependency sets are normalized and conflicting selected sets fail explicitly", () => {
    const left = context("one", ["a", "b", "shared", "one"]);
    left.analysis.generationDependencies.find(row => row.itemId === "shared").dependencies = ["a", "b", "a"];
    const right = context("two", ["b", "a", "shared", "two"]);
    right.analysis.generationDependencies.find(row => row.itemId === "shared").dependencies = ["b", "a"];
    const merged = mergeBIOPreviewContexts([left, right]);
    assert.deepEqual(merged.analysis.generationDependencies.find(row => row.itemId === "shared").dependencies, ["a", "b"]);
    right.analysis.generationDependencies.find(row => row.itemId === "shared").dependencies = ["b"];
    assert.throws(() => mergeBIOPreviewContexts([left, right]), /BATCH_DEPENDENCY_SELECTION_CONFLICT.*shared.*\["a","b"\].*\["b"\]/);
});

test("batch rejects any blocked target or snapshot mismatch before a merged plan can be returned", () => {
    const first = context("minecraft:stick", ["base", "minecraft:stick"]);
    const next = context("minecraft:piston", ["base", "minecraft:piston"]);
    assert.throws(() => mergeBIOPreviewContexts([first, { ...next, analysis: { ...next.analysis,
        readiness: { readyForBioGeneration: false, unresolvedAmbiguities: 1 } } }]), /BATCH_TARGET_NOT_READY.*minecraft:piston/);
    assert.throws(() => mergeBIOPreviewContexts([first, { ...next, fingerprint: "different" }]), /BATCH_SOURCE_FINGERPRINT_MISMATCH/);
    assert.throws(() => mergeBIOPreviewContexts([first, { ...next, machineMappingSHA256: "different" }]), /BATCH_MACHINE_MAPPING_MISMATCH/);
    assert.throws(() => mergeBIOPreviewContexts([]), /BATCH_TARGETS_REQUIRED/);
});

test("a non-ready target reports exact readiness counters and unresolved tag identity", () => {
    const value = context("minecraft:campfire", ["minecraft:campfire"]);
    value.analysis.readiness = { readyForBioGeneration: false, blocked: 0, unresolvedAmbiguities: 1, invalidSelections: 0, planningCycles: 0 };
    value.analysis.unresolvedGroupIds = ["coals-group"];
    value.analysis.groups = [{ groupId: "coals-group", type: "tag", tagId: "minecraft:coals", status: "UNRESOLVED" }];
    assert.throws(() => mergeBIOPreviewContexts([value]), /BATCH_TARGET_NOT_READY.*minecraft:campfire.*unresolvedAmbiguities=1.*minecraft:coals/);
});

test("batch keeps resolved groups from every target while deduplicating shared stable identities", () => {
    const shared = { groupId: "tag-global-planks", type: "tag", selectedCandidateId: "minecraft:oak_planks", status: "RESOLVED" };
    const left = context("one", ["base", "one"]);
    const right = context("two", ["base", "two"]);
    left.analysis.groups = [shared, { groupId: "alternative-one", type: "alternative", recipeId: "recipe-one", selectedCandidateId: "choice-one" }];
    right.analysis.groups = [{ ...shared }, { groupId: "alternative-two", type: "alternative", recipeId: "recipe-two", selectedCandidateId: "choice-two" }];
    const merged = mergeBIOPreviewContexts([left, right]);
    assert.equal(merged.analysis.groups.length, 3);
    assert.deepEqual(merged.analysis.groups.filter(group => group.type === "alternative").map(group => group.recipeId), ["recipe-one", "recipe-two"]);
    right.analysis.groups[0].selectedCandidateId = "minecraft:birch_planks";
    assert.throws(() => mergeBIOPreviewContexts([left, right]), /BATCH_DECISION_CONFLICT/);
});

test("batch validates shared Base decisions and fallback preferred routes instead of silently using the first", () => {
    const left = context("one", ["base", "one"], { baseItemIds: ["base"], preferredRecipeByItem: new Map([["one", "recipe-one"]]) });
    const right = context("two", ["base", "two"], { baseItemIds: ["base"], preferredRecipeByItem: new Map([["two", "recipe-two"]]) });
    const merged = mergeBIOPreviewContexts([left, right]);
    assert.deepEqual(merged.baseItemIds, ["base"]);
    assert.deepEqual([...merged.preferredRecipeByItem], [["one", "recipe-one"], ["two", "recipe-two"]]);
    assert.throws(() => mergeBIOPreviewContexts([left, { ...right, baseItemIds: [] }]), /BATCH_BASE_DECISION_CONFLICT/);
    assert.throws(() => mergeBIOPreviewContexts([left, { ...right, preferredRecipeByItem: new Map([["one", "different"]]) }]), /BATCH_PREFERRED_ROUTE_CONFLICT/);
});

test("single-target merge preserves the original order and does not mutate caller-owned groups or maps", () => {
    const original = context("one", ["base", "one"]);
    original.analysis.generationDependencies.find(row => row.itemId === "one").dependencies = ["base"];
    const merged = mergeBIOPreviewContexts([original]);
    assert.deepEqual(merged.targets, ["one"]);
    assert.deepEqual(merged.analysis.generationOrder, original.analysis.generationOrder);
    merged.dependency.graph.set("new", {});
    merged.basePlan.baseDependencyMap.set("new", {});
    merged.analysis.groups.push({ groupId: "new" });
    merged.analysis.generationDependencies.find(row => row.itemId === "one").dependencies.push("new");
    assert.equal(original.dependency.graph.size, 2);
    assert.equal(original.basePlan.baseDependencyMap.size, 2);
    assert.equal(original.analysis.groups.length, 0);
    assert.deepEqual(original.analysis.generationDependencies.find(row => row.itemId === "one").dependencies, ["base"]);
});
