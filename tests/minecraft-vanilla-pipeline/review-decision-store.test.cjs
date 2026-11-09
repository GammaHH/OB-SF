const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const vanilla = require("../../模板放置處/MC解析器模塊");
const {
    readReviewDecisionStore,
    writeReviewDecisionStore
} = require("../../scripts/lib/review-decision-store.cjs");

function registryWithTarget(target) {
    const registry = vanilla.dependencies.emptyReviewDecisionRegistry();
    vanilla.dependencies.setReviewDecisionSnapshot(registry, target, {
        sourceFingerprint: "sha256:test",
        baseReview: `# Base Review\n\nTarget: ${target}\n`,
        recipeReview: `# Recipe Review\n\nTarget: ${target}\n`
    });
    return registry;
}

test("decision store migrates a complete legacy Markdown registry to JSON", t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "obsf-registry-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const jsonPath = path.join(directory, "Minecraft Review Decisions.json");
    const summaryMarkdownPath = path.join(
        directory,
        "Minecraft Review Decisions.md"
    );
    const original = registryWithTarget("minecraft:piston");
    fs.writeFileSync(
        summaryMarkdownPath,
        vanilla.dependencies.renderReviewDecisionRegistry(original),
        "utf8"
    );

    const legacy = readReviewDecisionStore({
        jsonPath,
        legacyMarkdownPath: summaryMarkdownPath
    });
    assert.equal(legacy.source, "legacy-markdown");
    writeReviewDecisionStore(legacy.registry, {
        jsonPath,
        summaryMarkdownPath
    });

    const migrated = readReviewDecisionStore({
        jsonPath,
        legacyMarkdownPath: summaryMarkdownPath
    });
    assert.equal(migrated.source, "json");
    assert.deepEqual(Object.keys(migrated.registry.targets), ["minecraft:piston"]);
    assert.match(
        fs.readFileSync(summaryMarkdownPath, "utf8"),
        /Machine source-of-truth：`Minecraft Review Decisions\.json`/
    );
    assert.doesNotMatch(
        fs.readFileSync(summaryMarkdownPath, "utf8"),
        /obsf:review-decision-registry:start/
    );
});

test("decision store preserves the prior valid JSON as a previous backup", t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "obsf-registry-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const jsonPath = path.join(directory, "Minecraft Review Decisions.json");
    const summaryMarkdownPath = path.join(
        directory,
        "Minecraft Review Decisions.md"
    );
    writeReviewDecisionStore(registryWithTarget("minecraft:piston"), {
        jsonPath,
        summaryMarkdownPath
    });
    writeReviewDecisionStore(registryWithTarget("minecraft:stick"), {
        jsonPath,
        summaryMarkdownPath
    });

    const previous = vanilla.dependencies.parseReviewDecisionRegistryJSON(
        fs.readFileSync(`${jsonPath}.previous`, "utf8")
    );
    assert.deepEqual(Object.keys(previous.targets), ["minecraft:piston"]);
    const current = vanilla.dependencies.parseReviewDecisionRegistryJSON(
        fs.readFileSync(jsonPath, "utf8")
    );
    assert.deepEqual(Object.keys(current.targets), ["minecraft:stick"]);
});
