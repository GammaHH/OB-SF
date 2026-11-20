#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const { createMinecraftVanillaRuntime } = require("./minecraft-vanilla-runtime.cjs");
const { readReviewDecisionStore } = require("./review-decision-store.cjs");
const vanilla = require("../../BIO相關模組/MC解析器模塊");

const vaultRoot = path.resolve(__dirname, "..", "..");

function assessTarget(
    runtime,
    target,
    fingerprint,
    tagMappings,
    globalDecisionIndex,
    globalBaseDecisionIndex
) {
    const dependency = runtime.pipeline.resolveDependencies(target);
    const baselinePlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        selectionPolicy: "none"
    });
    const baselineReview = vanilla.dependencies.createBaseMaterialReview(
        dependency,
        baselinePlan,
        { sourceFingerprint: fingerprint, globalBaseDecisionIndex }
    );
    const globalBaseItemIds = baselineReview.globalBaseDecisions.map(decision =>
        decision.itemId
    );
    const basePlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        baseItemIds: globalBaseItemIds,
        selectionPolicy: "none"
    });
    const baseReview = vanilla.dependencies.createBaseMaterialReview(
        dependency,
        basePlan,
        { sourceFingerprint: fingerprint, globalBaseDecisionIndex }
    );
    const analysis = vanilla.dependencies.createRecipeAmbiguityAnalysis(
        dependency,
        basePlan,
        { groups: new Map(), diagnostics: [], frontmatter: {} },
        {
            sourceFingerprint: fingerprint,
            baseItemIds: globalBaseItemIds,
            tagMappings,
            globalAmbiguitySelections: globalDecisionIndex.selections,
            globalAlternativePreferences:
                globalDecisionIndex.alternativePreferences,
            globalDecisionDiagnostics: globalDecisionIndex.diagnostics
        }
    );
    const counts = { recipe: 0, tag: 0, alternative: 0 };
    for (const group of analysis.groups) {
        if (group.status !== "RESOLVED") counts[group.type]++;
    }
    const reasons = {
        blockedCycles: baseReview.cycleGroups.length,
        recipe: counts.recipe,
        tag: counts.tag,
        alternative: counts.alternative
    };
    return {
        target,
        reasons,
        requiresReview: !analysis.readiness.readyForBioGeneration || Object.values(reasons).some(value => value > 0)
    };
}

function main() {
    const encoded = process.argv[2];
    if (!encoded) throw new Error("scan worker 缺少 targets payload");
    const targets = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const runtime = createMinecraftVanillaRuntime(vaultRoot);
    if (runtime.loadErrors.length > 0) {
        throw new Error(`Raw JSON 載入失敗：${runtime.loadErrors[0].path}`);
    }
    const blocking = runtime.pipeline.diagnostics.filter(entry =>
        ["ERROR", "UNSUPPORTED", "REVIEW"].includes(entry.status)
    );
    if (blocking.length > 0) {
        throw new Error(`Pipeline 有 ${blocking.length} 個阻斷 diagnostics`);
    }
    const fingerprint = vanilla.dependencies.computeNormalizedRegistryFingerprint(
        runtime.pipeline.itemRegistry
    );
    const mappingPath = path.join(vaultRoot, "Minecraft Tag BIO Mapping Draft.md");
    const parsedTagMappings = fs.existsSync(mappingPath)
        ? vanilla.bio.parseTagBIOMappingMarkdown(
            fs.readFileSync(mappingPath, "utf8")
        )
        : { mappings: new Map(), diagnostics: [] };
    const mappingErrors = parsedTagMappings.diagnostics.filter(entry =>
        entry.severity === "ERROR"
    );
    if (mappingErrors.length > 0) {
        throw new Error(`Tag mapping 無效：${mappingErrors[0].message}`);
    }
    const decisionRegistry = readReviewDecisionStore({
        jsonPath: path.join(vaultRoot, "Minecraft Review Decisions.json"),
        legacyMarkdownPath: path.join(
            vaultRoot,
            "Minecraft Review Decisions.md"
        )
    }).registry;
    const globalDecisionIndex =
        vanilla.dependencies.createGlobalAmbiguityDecisionIndex(
            decisionRegistry
        );
    const globalBaseDecisionIndex =
        vanilla.dependencies.createGlobalBaseDecisionIndex(decisionRegistry);
    const decisionErrors = [
        ...globalDecisionIndex.diagnostics,
        ...globalBaseDecisionIndex.diagnostics
    ].filter(entry => entry.severity === "ERROR");
    if (decisionErrors.length > 0) {
        throw new Error(`Decision Registry 無效：${decisionErrors[0].message}`);
    }
    process.stdout.write(JSON.stringify(
        targets.map(target => assessTarget(
            runtime,
            target,
            fingerprint,
            parsedTagMappings.mappings,
            globalDecisionIndex,
            globalBaseDecisionIndex
        ))
    ));
}

try {
    main();
} catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
}
