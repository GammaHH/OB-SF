#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createMinecraftVanillaRuntime } = require("./lib/minecraft-vanilla-runtime.cjs");
const vanilla = require("../模板放置處/MC解析器模塊");

const vaultRoot = path.resolve(__dirname, "..");
const bioRoot = path.join(vaultRoot, "MC-物品資料庫");

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function option(name, fallback) {
    const prefix = `--${name}=`;
    const value = process.argv.find(argument => argument.startsWith(prefix));
    return value ? value.slice(prefix.length) : fallback;
}

function safeVaultPath(requested, expectedExtension = null) {
    const absolute = path.resolve(vaultRoot, requested);
    const relative = path.relative(vaultRoot, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Path 必須位於 OB-SF worktree：${requested}`);
    }
    if (expectedExtension && path.extname(absolute).toLowerCase() !== expectedExtension) {
        throw new Error(`Path 必須是 ${expectedExtension}：${requested}`);
    }
    return absolute;
}

function vaultPath(absolute) {
    return path.relative(vaultRoot, absolute).split(path.sep).join("/");
}

function readText(absolute) {
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : "";
}

function writeText(absolute, content) {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
}

function runNode(script, args) {
    const result = spawnSync(process.execPath, [path.join(vaultRoot, script), ...args], {
        cwd: vaultRoot,
        stdio: "inherit",
        windowsHide: true
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
}

function queuePaths() {
    return {
        state: safeVaultPath(option("queue-state", "review/minecraft-review-queue.json"), ".json"),
        markdown: safeVaultPath(option("queue-review", "Minecraft Review Queue.md"), ".md")
    };
}

function readQueue() {
    const paths = queuePaths();
    if (!fs.existsSync(paths.state)) return { queue: null, paths };
    return { queue: JSON.parse(fs.readFileSync(paths.state, "utf8")), paths };
}

function writeQueue(queue, paths = queuePaths()) {
    writeText(paths.state, `${JSON.stringify(queue, null, 2)}\n`);
    writeText(paths.markdown, vanilla.dependencies.renderReviewQueueMarkdown(queue));
}

function reviewTargetFromMarkdown(absolute) {
    const markdown = readText(absolute);
    if (!markdown) return null;
    return vanilla.dependencies.parseFrontmatter(markdown).values.target ?? null;
}

function targetFolder(target) {
    return target.replace(/[^a-z0-9._-]+/gi, "__");
}

function reviewPathsForTarget(target) {
    const rootBase = safeVaultPath("Minecraft Base Material Review.md", ".md");
    const rootRecipe = safeVaultPath("Minecraft Recipe Review.md", ".md");
    if (reviewTargetFromMarkdown(rootBase) === target || reviewTargetFromMarkdown(rootRecipe) === target) {
        return { baseReview: vaultPath(rootBase), recipeReview: vaultPath(rootRecipe) };
    }
    const folder = `Minecraft Reviews/${targetFolder(target)}`;
    return {
        baseReview: `${folder}/Base Material Review.md`,
        recipeReview: `${folder}/Recipe Review.md`
    };
}

function loadRuntime() {
    const runtime = createMinecraftVanillaRuntime(vaultRoot);
    if (runtime.loadErrors.length > 0) {
        const first = runtime.loadErrors[0];
        throw new Error(`Raw JSON 載入失敗 (${runtime.loadErrors.length})：${first.path}: ${first.error}`);
    }
    const blocking = runtime.pipeline.diagnostics.filter(entry =>
        ["ERROR", "UNSUPPORTED", "REVIEW"].includes(entry.status)
    );
    if (blocking.length > 0) {
        throw new Error(`Pipeline 有 ${blocking.length} 個阻斷 diagnostics；scan 已停止`);
    }
    return runtime;
}

function sourceFingerprint(runtime) {
    return vanilla.dependencies.computeNormalizedRegistryFingerprint(runtime.pipeline.itemRegistry);
}

function tagMappingPath() {
    return safeVaultPath(
        option("tag-mapping", "Minecraft Tag BIO Mapping Draft.md"),
        ".md"
    );
}

function applyDecisionTransfers(baseAbsolute, recipeAbsolute, dryRun) {
    if (!fs.existsSync(recipeAbsolute)) {
        return { externalBaseItemIds: [], tagMappings: [] };
    }
    const transfers = vanilla.dependencies.collectRecipeDecisionTransfers(
        readText(recipeAbsolute)
    );
    const errors = transfers.diagnostics.filter(entry => entry.severity === "ERROR");
    if (errors.length > 0) {
        throw new Error(`Recipe Review 無法轉入決策：${errors.map(entry => entry.message).join("; ")}`);
    }
    if (dryRun) return transfers;
    let baseMarkdown = readText(baseAbsolute);
    let baseChanged = false;
    for (const itemId of transfers.externalBaseItemIds) {
        const result = vanilla.dependencies.selectExternalBaseMaterial(
            baseMarkdown,
            itemId
        );
        baseMarkdown = result.markdown;
        baseChanged ||= result.changed;
    }
    if (baseChanged) writeText(baseAbsolute, baseMarkdown);

    if (transfers.tagMappings.length > 0) {
        const mappingAbsolute = tagMappingPath();
        if (!fs.existsSync(mappingAbsolute)) {
            throw new Error(`Tag mapping draft 不存在：${vaultPath(mappingAbsolute)}`);
        }
        let mappingMarkdown = readText(mappingAbsolute);
        for (const mapping of transfers.tagMappings) {
            mappingMarkdown = vanilla.bio.upsertTagRepresentativeMapping(
                mappingMarkdown,
                mapping.tagId,
                mapping.representativeItemId
            );
        }
        writeText(mappingAbsolute, mappingMarkdown);
    }
    if (baseChanged || transfers.tagMappings.length > 0) {
        process.stdout.write("Decision Transfers Applied:\n");
        for (const itemId of transfers.externalBaseItemIds) {
            process.stdout.write(`- External Base: ${itemId}\n`);
        }
        for (const mapping of transfers.tagMappings) {
            process.stdout.write(
                `- Global Tag: #${mapping.tagId} -> ${mapping.representativeItemId}\n`
            );
        }
    }
    return transfers;
}

function scanBatchSize() {
    const parsed = Number(option("scan-batch-size", "25"));
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 25;
}

function runScanWorker(targets) {
    const payload = Buffer.from(JSON.stringify(targets), "utf8").toString("base64url");
    const worker = path.join(vaultRoot, "scripts", "lib", "minecraft-review-scan-worker.cjs");
    const result = spawnSync(
        process.execPath,
        ["--max-old-space-size=1024", worker, payload],
        {
            cwd: vaultRoot,
            encoding: "utf8",
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024
        }
    );
    if (result.status === 0) return JSON.parse(result.stdout);
    if (targets.length > 1) {
        const middle = Math.ceil(targets.length / 2);
        return [
            ...runScanWorker(targets.slice(0, middle)),
            ...runScanWorker(targets.slice(middle))
        ];
    }
    const detail = String(result.stderr ?? "").trim().split(/\r?\n/).slice(-8).join(" | ");
    throw new Error(`Target scan 失敗：${targets[0]}${detail ? ` — ${detail}` : ""}`);
}

function scan() {
    const runtime = loadRuntime();
    const fingerprint = sourceFingerprint(runtime);
    const bioRegistry = vanilla.bio.scanMinecraftBIOs(bioRoot, { vaultRoot });
    const { queue: previousQueue, paths } = readQueue();
    const registryTargets = [...runtime.pipeline.itemRegistry.entries()]
        .map(([itemId]) => itemId)
        .sort();
    const requested = new Set(registryTargets.filter(itemId => !bioRegistry.has(itemId)));
    const currentReviewTargets = [];
    for (const reviewFile of [
        safeVaultPath("Minecraft Base Material Review.md", ".md"),
        safeVaultPath("Minecraft Recipe Review.md", ".md")
    ]) {
        const currentTarget = reviewTargetFromMarkdown(reviewFile);
        if (currentTarget && runtime.pipeline.itemRegistry.has(currentTarget)) {
            requested.add(currentTarget);
            currentReviewTargets.push(currentTarget);
        }
    }

    const assessments = [];
    const orderedTargets = [...requested].sort();
    const batchSize = scanBatchSize();
    for (let index = 0; index < orderedTargets.length; index += batchSize) {
        assessments.push(...runScanWorker(orderedTargets.slice(index, index + batchSize)));
    }
    const reviewTargets = [];
    let automaticReady = 0;
    for (const assessment of assessments) {
        if (assessment.requiresReview) {
            reviewTargets.push({
                ...assessment,
                ...reviewPathsForTarget(assessment.target)
            });
        }
        else automaticReady++;
    }
    const queue = vanilla.dependencies.createReviewQueue({
        sourceFingerprint: fingerprint,
        scanScope: "missing-bio+current-review",
        scannedTargets: requested.size,
        existingBIO: bioRegistry.stats.mappedBIOs,
        automaticReady,
        targets: reviewTargets,
        previousQueue
    });
    if (!vanilla.dependencies.currentReviewTarget(queue)) {
        const currentTarget = currentReviewTargets.find(target =>
            queue.targets.some(entry => entry.target === target)
        );
        if (currentTarget) {
            vanilla.dependencies.updateReviewTarget(queue, currentTarget, "IN_REVIEW");
        }
    }
    writeQueue(queue, paths);
    process.stdout.write("Minecraft Decision Review Scan:\n");
    process.stdout.write(`- normalizedTargets: ${registryTargets.length}\n`);
    process.stdout.write(`- scannedTargets: ${requested.size}\n`);
    process.stdout.write(`- existingBIO: ${bioRegistry.stats.mappedBIOs}\n`);
    process.stdout.write(`- automaticReady: ${automaticReady}\n`);
    process.stdout.write(`- pendingReview: ${queue.stats.pendingReview}\n`);
    process.stdout.write(`- scanBatchSize: ${batchSize}\n`);
    process.stdout.write(`- queue: ${vaultPath(paths.markdown)}\n`);
    process.stdout.write(`- rawLoadErrors: ${runtime.loadErrors.length}\n`);
}

function printStage(stage, ready, exitCode, target) {
    process.stdout.write("Unified Decision Workflow:\n");
    process.stdout.write(`- target: ${target}\n`);
    process.stdout.write(`- stage: ${stage}\n`);
    process.stdout.write(`- readyForBioGeneration: ${ready}\n`);
    process.stdout.write(`- exitCode: ${exitCode}\n`);
}

function runWorkflow(command, target, paths, dryRun) {
    const baseAbsolute = safeVaultPath(paths.baseReview, ".md");
    const recipeAbsolute = safeVaultPath(paths.recipeReview, ".md");
    if (!fs.existsSync(baseAbsolute)) {
        if (dryRun) throw new Error("Base Material Review 尚未建立；dry-run 不會建立檔案");
        const exit = runNode("scripts/minecraft-base-material-review.cjs", [
            "generate", target, `--review=${paths.baseReview}`
        ]);
        if (exit !== 0) return { stage: "BASE_MATERIAL", ready: false, exitCode: exit };
    }
    const baseArgs = ["recalculate", target, `--review=${paths.baseReview}`];
    if (dryRun) baseArgs.push("--dry-run");
    const baseExit = runNode("scripts/minecraft-base-material-review.cjs", baseArgs);
    if (baseExit !== 0) return { stage: "BASE_MATERIAL", ready: false, exitCode: baseExit };

    const recipeCommand = command === "recalculate" && fs.existsSync(recipeAbsolute)
        ? "recalculate"
        : "generate";
    const recipeArgs = [
        recipeCommand,
        target,
        `--base-review=${paths.baseReview}`,
        `--review=${paths.recipeReview}`,
        `--tag-mapping=${vaultPath(tagMappingPath())}`
    ];
    if (dryRun) recipeArgs.push("--dry-run");
    let recipeExit = runNode("scripts/minecraft-recipe-review.cjs", recipeArgs);
    if (!dryRun && recipeExit === 3) {
        const transfers = applyDecisionTransfers(baseAbsolute, recipeAbsolute, false);
        const transferred = transfers.externalBaseItemIds.length > 0 ||
            transfers.tagMappings.length > 0;
        if (transferred) {
            const transferBaseExit = runNode(
                "scripts/minecraft-base-material-review.cjs",
                ["recalculate", target, `--review=${paths.baseReview}`]
            );
            if (transferBaseExit !== 0) {
                return {
                    stage: "BASE_MATERIAL",
                    ready: false,
                    exitCode: transferBaseExit
                };
            }
            recipeExit = runNode("scripts/minecraft-recipe-review.cjs", [
                "recalculate",
                target,
                `--base-review=${paths.baseReview}`,
                `--review=${paths.recipeReview}`,
                `--tag-mapping=${vaultPath(tagMappingPath())}`
            ]);
        }
    }
    return recipeExit === 0
        ? { stage: "READY", ready: true, exitCode: 0 }
        : { stage: "RECIPE_AMBIGUITY", ready: false, exitCode: recipeExit };
}

function startExplicit(rawTarget) {
    if (!rawTarget) throw new Error("start 需要明確 target；正式 queue 流程請使用 scan / next");
    const target = vanilla.bio.canonicalMinecraftId(rawTarget);
    const paths = {
        baseReview: option("base-review", "Minecraft Base Material Review.md"),
        recipeReview: option("recipe-review", "Minecraft Recipe Review.md")
    };
    const result = runWorkflow("start", target, paths, hasFlag("dry-run"));
    printStage(result.stage, result.ready, result.exitCode, target);
    process.exitCode = result.exitCode;
}

function next() {
    const loaded = readQueue();
    if (!loaded.queue) throw new Error("Review Queue 不存在；請先執行 scan");
    const entry = vanilla.dependencies.activateNextReviewTarget(loaded.queue);
    if (!entry) {
        process.stdout.write("Review Queue: READY（沒有 pending target）\n");
        return;
    }
    writeQueue(loaded.queue, loaded.paths);
    const result = runWorkflow("start", entry.target, entry, hasFlag("dry-run"));
    printStage(result.stage, result.ready, result.exitCode, entry.target);
    if (result.ready) {
        vanilla.dependencies.updateReviewTarget(loaded.queue, entry.target, "READY");
        writeQueue(loaded.queue, loaded.paths);
    }
    process.exitCode = result.exitCode;
}

function recalculate(rawTarget = null) {
    const loaded = readQueue();
    let entry;
    if (rawTarget) {
        const target = vanilla.bio.canonicalMinecraftId(rawTarget);
        entry = { target, ...reviewPathsForTarget(target) };
    } else {
        if (!loaded.queue) throw new Error("Review Queue 不存在；請先執行 scan / next");
        entry = vanilla.dependencies.currentReviewTarget(loaded.queue);
        if (!entry) throw new Error("目前沒有 IN_REVIEW target；請執行 next");
    }
    const result = runWorkflow("recalculate", entry.target, entry, hasFlag("dry-run"));
    printStage(result.stage, result.ready, result.exitCode, entry.target);
    if (loaded.queue && result.ready && !hasFlag("dry-run")) {
        vanilla.dependencies.updateReviewTarget(loaded.queue, entry.target, "READY");
        writeQueue(loaded.queue, loaded.paths);
        const upcoming = loaded.queue.targets.find(candidate => candidate.status === "PENDING");
        process.stdout.write(`Next Pending Target: ${upcoming?.target ?? "none"}\n`);
    }
    process.exitCode = result.exitCode;
}

function reopen(decisionId) {
    if (!decisionId) throw new Error("reopen 需要 stable decision ID 或 Minecraft Item ID");
    const loaded = readQueue();
    const entry = loaded.queue
        ? vanilla.dependencies.currentReviewTarget(loaded.queue)
        : null;
    if (!entry) throw new Error("目前沒有 IN_REVIEW target；請先執行 next");
    const recipePath = safeVaultPath(entry.recipeReview, ".md");
    const basePath = safeVaultPath(entry.baseReview, ".md");
    const recipeResult = vanilla.dependencies.reopenRecipeDecision(readText(recipePath), decisionId);
    if (recipeResult.reopened) {
        writeText(recipePath, recipeResult.markdown);
        process.stdout.write(`Reopened Recipe Decision: ${decisionId}\n`);
        return recalculate();
    }
    const baseResult = vanilla.dependencies.reopenBaseDecision(
        readText(basePath),
        vanilla.bio.canonicalMinecraftId(decisionId)
    );
    if (!baseResult.reopened) throw new Error(`找不到 locked decision：${decisionId}`);
    writeText(basePath, baseResult.markdown);
    const generateExit = runNode("scripts/minecraft-base-material-review.cjs", [
        "generate", entry.target, `--review=${entry.baseReview}`
    ]);
    if (generateExit !== 0) {
        process.exitCode = generateExit;
        return;
    }
    process.stdout.write(`Reopened Base Decision: ${decisionId}\n`);
    return recalculate();
}

function usage() {
    process.stderr.write(
        "Usage:\n" +
        "  node scripts/minecraft-review.cjs scan\n" +
        "  node scripts/minecraft-review.cjs next\n" +
        "  node scripts/minecraft-review.cjs recalculate\n" +
        "  node scripts/minecraft-review.cjs reopen <decision-id>\n" +
        "  node scripts/minecraft-review.cjs start minecraft:piston\n"
    );
}

function main() {
    const command = process.argv[2];
    const argument = process.argv[3]?.startsWith("--") ? null : process.argv[3];
    if (command === "scan") return scan();
    if (command === "next") return next();
    if (command === "recalculate") return recalculate(argument);
    if (command === "reopen") return reopen(argument);
    if (command === "start") return startExplicit(argument);
    usage();
    process.exitCode = 1;
}

try {
    main();
} catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
}
