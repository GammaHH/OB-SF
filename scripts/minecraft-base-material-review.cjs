#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createMinecraftVanillaRuntime } = require("./lib/minecraft-vanilla-runtime.cjs");
const vanilla = require("../模板放置處/MC解析器模塊");

const vaultRoot = path.resolve(__dirname, "..");

function option(name, fallback = null) {
    const prefix = `--${name}=`;
    const value = process.argv.find(argument => argument.startsWith(prefix));
    return value ? value.slice(prefix.length) : fallback;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function resolveReviewPath() {
    const requested = option("review", "Minecraft Base Material Review.md");
    const absolutePath = path.resolve(vaultRoot, requested);
    const relative = path.relative(vaultRoot, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Review path 必須位於 OB-SF worktree 內");
    }
    if (path.extname(absolutePath).toLowerCase() !== ".md") {
        throw new Error("Review path 必須是 Markdown 檔案");
    }
    return absolutePath;
}

function relativeVaultPath(absolutePath) {
    return path.relative(vaultRoot, absolutePath).split(path.sep).join("/");
}

function writeReview(absolutePath, markdown) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, markdown, "utf8");
}

function printDiagnostics(diagnostics) {
    if (diagnostics.length === 0) {
        process.stdout.write("Diagnostics: none\n");
        return;
    }
    process.stdout.write("Diagnostics:\n");
    for (const entry of diagnostics) {
        process.stdout.write(
            `- ${entry.severity} ${entry.code}: ${entry.message}\n`
        );
    }
}

function createContext(target) {
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
    const dependency = runtime.pipeline.resolveDependencies(target);
    const baselinePlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        selectionPolicy: "none"
    });
    const review = runtime.vanilla.dependencies.createBaseMaterialReview(
        dependency,
        baselinePlan,
        {
            sourceFingerprint:
                runtime.vanilla.dependencies.computeNormalizedRegistryFingerprint(
                    runtime.pipeline.itemRegistry
                )
        }
    );
    return { runtime, dependency, baselinePlan, review };
}

function generate(target, reviewPath, dryRun) {
    const { runtime, review } = createContext(target);
    const existing = fs.existsSync(reviewPath)
        ? fs.readFileSync(reviewPath, "utf8")
        : "";
    const markdown = runtime.vanilla.dependencies.renderBaseMaterialReview(
        review,
        existing
    );
    if (dryRun) {
        process.stdout.write(markdown);
        return;
    }
    writeReview(reviewPath, markdown);
    process.stdout.write(`Review: ${relativeVaultPath(reviewPath)}\n`);
    process.stdout.write(`Target: ${review.target}\n`);
    process.stdout.write(`Source Fingerprint: ${review.sourceFingerprint}\n`);
    process.stdout.write(`Cycle Groups: ${review.cycleGroups.length}\n`);
    process.stdout.write(`Candidates: ${review.candidates.length}\n`);
    process.stdout.write(`Load Errors: ${runtime.loadErrors.length}\n`);
}

function recalculate(target, reviewPath, dryRun) {
    if (!fs.existsSync(reviewPath)) {
        throw new Error(`Review 不存在：${relativeVaultPath(reviewPath)}`);
    }
    const existing = fs.readFileSync(reviewPath, "utf8");
    const { runtime, dependency, review } = createContext(target);
    const parsed = runtime.vanilla.dependencies.parseBaseMaterialReview(
        existing,
        review
    );
    printDiagnostics(parsed.diagnostics);
    if (!parsed.canApply) {
        process.exitCode = 2;
        return;
    }

    const formalPlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        baseItemIds: parsed.selectedBaseItemIds,
        selectionPolicy: "none"
    });
    const previewPlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        baseItemIds: parsed.selectedBaseItemIds,
        selectionPolicy: "first-acyclic"
    });

    review.unresolvedItemIds = [...formalPlan.routeAwareBlockedItems].sort();
    const merged = runtime.vanilla.dependencies.renderBaseMaterialReview(
        review,
        existing
    );
    if (!dryRun) writeReview(reviewPath, merged);

    process.stdout.write(`Target: ${target}\n`);
    process.stdout.write(`Selected Base Materials: ${parsed.selectedBaseItemIds.length}\n`);
    for (const itemId of parsed.selectedBaseItemIds) {
        process.stdout.write(`- ${itemId}\n`);
    }
    process.stdout.write(`Route-aware BLOCKED: ${formalPlan.routeAwareBlockedItems.length}\n`);
    for (const itemId of formalPlan.routeAwareBlockedItems) {
        process.stdout.write(`- ${itemId}\n`);
    }
    process.stdout.write("Formal Selection Policy: none\n");
    process.stdout.write("Deterministic Preview Policy: first-acyclic\n");
    process.stdout.write(`Preview Complete: ${previewPlan.canPlanTargets}\n`);
    process.stdout.write("Preview Generation Order:\n");
    for (const itemId of previewPlan.generationOrder) {
        process.stdout.write(`- ${itemId}\n`);
    }
    process.stdout.write(
        `Cycle Validation: ${formalPlan.routeAwareBlockedItems.length === 0 && previewPlan.planningCycles.length === 0 ? "PASS" : "BLOCKED"}\n`
    );
    process.stdout.write(`Review Updated: ${dryRun ? "no (dry-run)" : relativeVaultPath(reviewPath)}\n`);
    process.stdout.write(`Load Errors: ${runtime.loadErrors.length}\n`);
    if (formalPlan.routeAwareBlockedItems.length > 0) process.exitCode = 3;
}

function main() {
    const command = process.argv[2];
    const rawTarget = process.argv[3];
    if (!["generate", "recalculate"].includes(command) || !rawTarget) {
        process.stderr.write(
            "Usage:\n" +
            "  node scripts/minecraft-base-material-review.cjs generate minecraft:piston [--review=path] [--dry-run]\n" +
            "  node scripts/minecraft-base-material-review.cjs recalculate minecraft:piston [--review=path] [--dry-run]\n"
        );
        process.exitCode = 1;
        return;
    }
    const target = vanilla.bio.canonicalMinecraftId(rawTarget);
    const reviewPath = resolveReviewPath();
    if (command === "generate") generate(target, reviewPath, hasFlag("dry-run"));
    else recalculate(target, reviewPath, hasFlag("dry-run"));
}

try {
    main();
} catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
}
