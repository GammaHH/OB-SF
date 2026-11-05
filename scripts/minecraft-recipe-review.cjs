#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createMinecraftVanillaRuntime } = require("./lib/minecraft-vanilla-runtime.cjs");
const vanilla = require("../模板放置處/MC解析器模塊");

const vaultRoot = path.resolve(__dirname, "..");

function option(name, fallback) {
    const prefix = `--${name}=`;
    const value = process.argv.find(argument => argument.startsWith(prefix));
    return value ? value.slice(prefix.length) : fallback;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function reviewPath(name, fallback) {
    const requested = option(name, fallback);
    const absolutePath = path.resolve(vaultRoot, requested);
    const relative = path.relative(vaultRoot, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`${name} path 必須位於 OB-SF worktree 內`);
    }
    if (path.extname(absolutePath).toLowerCase() !== ".md") {
        throw new Error(`${name} path 必須是 Markdown 檔案`);
    }
    return absolutePath;
}

function vaultPath(absolutePath) {
    return path.relative(vaultRoot, absolutePath).split(path.sep).join("/");
}

function printDiagnostics(diagnostics) {
    if (diagnostics.length === 0) {
        process.stdout.write("Diagnostics: none\n");
        return;
    }
    process.stdout.write("Diagnostics:\n");
    for (const diagnostic of diagnostics) {
        process.stdout.write(
            `- ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}\n`
        );
    }
}

function buildContext(target, baseReviewPath, recipeReviewPath) {
    const runtime = createMinecraftVanillaRuntime(vaultRoot);
    if (runtime.loadErrors.length > 0) {
        const first = runtime.loadErrors[0];
        throw new Error(
            `Raw JSON 載入失敗 (${runtime.loadErrors.length})：${first.path}: ${first.error}`
        );
    }
    const blockingDiagnostics = runtime.pipeline.diagnostics.filter(entry =>
        ["ERROR", "UNSUPPORTED", "REVIEW"].includes(entry.status)
    );
    if (blockingDiagnostics.length > 0) {
        throw new Error(
            `Pipeline 有 ${blockingDiagnostics.length} 個阻斷 diagnostics；拒絕產生可能不完整的 review`
        );
    }

    const sourceFingerprint =
        runtime.vanilla.dependencies.computeNormalizedRegistryFingerprint(
            runtime.pipeline.itemRegistry
        );
    const dependency = runtime.pipeline.resolveDependencies(target);
    const baselinePlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        selectionPolicy: "none"
    });
    const currentBaseReview =
        runtime.vanilla.dependencies.createBaseMaterialReview(
            dependency,
            baselinePlan,
            { sourceFingerprint }
        );
    if (!fs.existsSync(baseReviewPath)) {
        throw new Error(
            `Base Material Review 不存在：${vaultPath(baseReviewPath)}；請先完成 base review`
        );
    }
    const baseMarkdown = fs.readFileSync(baseReviewPath, "utf8");
    const baseSelection =
        runtime.vanilla.dependencies.parseBaseMaterialReview(
            baseMarkdown,
            currentBaseReview
        );
    if (!baseSelection.canApply) {
        const errors = baseSelection.diagnostics
            .filter(entry => entry.severity === "ERROR")
            .map(entry => `${entry.code}: ${entry.message}`)
            .join("; ");
        throw new Error(`Base Material Review 無效：${errors}`);
    }

    const basePlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        baseItemIds: baseSelection.selectedBaseItemIds,
        selectionPolicy: "none"
    });
    const existingMarkdown = fs.existsSync(recipeReviewPath)
        ? fs.readFileSync(recipeReviewPath, "utf8")
        : "";
    const parsedRecipeReview = existingMarkdown
        ? runtime.vanilla.dependencies.parseRecipeReviewMarkdown(existingMarkdown)
        : { groups: new Map(), diagnostics: [], frontmatter: {} };
    const analysis =
        runtime.vanilla.dependencies.createRecipeAmbiguityAnalysis(
            dependency,
            basePlan,
            parsedRecipeReview,
            {
                sourceFingerprint,
                baseItemIds: baseSelection.selectedBaseItemIds
            }
        );
    const markdown = runtime.vanilla.dependencies.renderRecipeReview(
        analysis,
        existingMarkdown
    );
    return {
        runtime,
        dependency,
        baseSelection,
        basePlan,
        analysis,
        markdown,
        existingMarkdown
    };
}

function writeReview(absolutePath, markdown) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, markdown, "utf8");
}

function printSummary(context, recipeReviewPath, dryRun) {
    const { runtime, baseSelection, analysis } = context;
    const typeCounts = { recipe: 0, tag: 0, alternative: 0 };
    const resolvedCounts = { recipe: 0, tag: 0, alternative: 0 };
    for (const group of analysis.groups) {
        typeCounts[group.type]++;
        if (group.status === "RESOLVED") resolvedCounts[group.type]++;
    }
    printDiagnostics([
        ...baseSelection.diagnostics,
        ...analysis.diagnostics
    ]);
    process.stdout.write(`Target: ${analysis.target}\n`);
    process.stdout.write(`Raw JSON Load Errors: ${runtime.loadErrors.length}\n`);
    process.stdout.write(`Base Selections: ${analysis.baseItemIds.length}\n`);
    for (const itemId of analysis.baseItemIds) process.stdout.write(`- ${itemId}\n`);
    process.stdout.write("Ambiguity Groups:\n");
    process.stdout.write(`- recipe: ${typeCounts.recipe}\n`);
    process.stdout.write(`- tag: ${typeCounts.tag}\n`);
    process.stdout.write(`- alternatives: ${typeCounts.alternative}\n`);
    process.stdout.write(`Resolved: ${Object.values(resolvedCounts).reduce((a, b) => a + b, 0)}\n`);
    process.stdout.write(`Unresolved: ${analysis.readiness.unresolvedAmbiguities}\n`);
    process.stdout.write(`Invalid: ${analysis.readiness.invalidSelections}\n`);
    process.stdout.write(`Stale/Inactive: ${analysis.inactiveGroupIds.length}\n`);
    process.stdout.write(`Route-aware Blocked: ${analysis.readiness.blocked}\n`);
    process.stdout.write(`Planning Cycles: ${analysis.readiness.planningCycles}\n`);
    process.stdout.write(`Ready For BIO Generation: ${analysis.readiness.readyForBioGeneration}\n`);
    process.stdout.write("Formal Selection Policy: none\n");
    process.stdout.write("Preview Generation Order:\n");
    for (const itemId of analysis.generationOrder) process.stdout.write(`- ${itemId}\n`);
    process.stdout.write(
        `Review Updated: ${dryRun ? "no (dry-run)" : vaultPath(recipeReviewPath)}\n`
    );
    process.stdout.write("Readiness JSON:\n");
    process.stdout.write(`${JSON.stringify(analysis.readiness, null, 2)}\n`);
}

function main() {
    const command = process.argv[2];
    const rawTarget = process.argv[3];
    if (!["generate", "recalculate"].includes(command) || !rawTarget) {
        process.stderr.write(
            "Usage:\n" +
            "  node scripts/minecraft-recipe-review.cjs generate minecraft:piston [--dry-run]\n" +
            "  node scripts/minecraft-recipe-review.cjs recalculate minecraft:piston [--dry-run]\n"
        );
        process.exitCode = 1;
        return;
    }
    const target = vanilla.bio.canonicalMinecraftId(rawTarget);
    const baseReviewPath = reviewPath(
        "base-review",
        "Minecraft Base Material Review.md"
    );
    const recipeReviewPath = reviewPath(
        "review",
        "Minecraft Recipe Review.md"
    );
    const dryRun = hasFlag("dry-run");
    const context = buildContext(target, baseReviewPath, recipeReviewPath);
    if (!dryRun) writeReview(recipeReviewPath, context.markdown);
    printSummary(context, recipeReviewPath, dryRun);
    if (context.analysis.readiness.invalidSelections > 0) {
        process.exitCode = 2;
    } else if (!context.analysis.readiness.readyForBioGeneration) {
        process.exitCode = 3;
    }
}

try {
    main();
} catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
}
