#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const { createMinecraftVanillaRuntime } = require("./minecraft-vanilla-runtime.cjs");
const vanilla = require("../../模板放置處/MC解析器模塊");

const vaultRoot = path.resolve(__dirname, "..", "..");

function assessTarget(runtime, target, fingerprint, tagMappings) {
    const dependency = runtime.pipeline.resolveDependencies(target);
    const basePlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        selectionPolicy: "none"
    });
    const baseReview = vanilla.dependencies.createBaseMaterialReview(
        dependency,
        basePlan,
        { sourceFingerprint: fingerprint }
    );
    const analysis = vanilla.dependencies.createRecipeAmbiguityAnalysis(
        dependency,
        basePlan,
        { groups: new Map(), diagnostics: [], frontmatter: {} },
        { sourceFingerprint: fingerprint, baseItemIds: [], tagMappings }
    );
    const counts = { recipe: 0, tag: 0, alternative: 0 };
    for (const group of analysis.groups) counts[group.type]++;
    const reasons = {
        blockedCycles: baseReview.cycleGroups.length,
        recipe: counts.recipe,
        tag: counts.tag,
        alternative: counts.alternative
    };
    return {
        target,
        reasons,
        requiresReview: Object.values(reasons).some(value => value > 0)
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
    process.stdout.write(JSON.stringify(
        targets.map(target => assessTarget(
            runtime,
            target,
            fingerprint,
            parsedTagMappings.mappings
        ))
    ));
}

try {
    main();
} catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
}
