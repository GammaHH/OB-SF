#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const vaultRoot = path.resolve(__dirname, "..");

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function option(name, fallback) {
    const prefix = `--${name}=`;
    const value = process.argv.find(argument => argument.startsWith(prefix));
    return value ? value.slice(prefix.length) : fallback;
}

function runNode(script, args) {
    const result = spawnSync(
        process.execPath,
        [path.join(vaultRoot, script), ...args],
        {
            cwd: vaultRoot,
            stdio: "inherit",
            windowsHide: true
        }
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
}

function printStage(stage, ready, exitCode) {
    process.stdout.write("Unified Decision Workflow:\n");
    process.stdout.write(`- stage: ${stage}\n`);
    process.stdout.write(`- readyForBioGeneration: ${ready}\n`);
    process.stdout.write(`- exitCode: ${exitCode}\n`);
}

function main() {
    const command = process.argv[2];
    const target = process.argv[3];
    if (!["start", "recalculate"].includes(command) || !target) {
        process.stderr.write(
            "Usage:\n" +
            "  node scripts/minecraft-review.cjs start minecraft:piston\n" +
            "  node scripts/minecraft-review.cjs recalculate minecraft:piston [--dry-run]\n"
        );
        process.exitCode = 1;
        return;
    }

    const dryRun = hasFlag("dry-run");
    const baseReview = option(
        "base-review",
        "Minecraft Base Material Review.md"
    );
    const recipeReview = option(
        "recipe-review",
        "Minecraft Recipe Review.md"
    );
    const baseAbsolute = path.resolve(vaultRoot, baseReview);
    const recipeAbsolute = path.resolve(vaultRoot, recipeReview);

    if (!fs.existsSync(baseAbsolute)) {
        if (dryRun) {
            throw new Error("Base Material Review 尚未建立；dry-run 不會建立檔案");
        }
        const generateBaseExit = runNode(
            "scripts/minecraft-base-material-review.cjs",
            ["generate", target, `--review=${baseReview}`]
        );
        if (generateBaseExit !== 0) {
            printStage("BASE_MATERIAL", false, generateBaseExit);
            process.exitCode = generateBaseExit;
            return;
        }
    }

    const baseArgs = [
        "recalculate",
        target,
        `--review=${baseReview}`
    ];
    if (dryRun) baseArgs.push("--dry-run");
    const baseExit = runNode(
        "scripts/minecraft-base-material-review.cjs",
        baseArgs
    );
    if (baseExit !== 0) {
        printStage("BASE_MATERIAL", false, baseExit);
        process.exitCode = baseExit;
        return;
    }

    const recipeCommand =
        command === "recalculate" && fs.existsSync(recipeAbsolute)
            ? "recalculate"
            : "generate";
    const recipeArgs = [
        recipeCommand,
        target,
        `--base-review=${baseReview}`,
        `--review=${recipeReview}`
    ];
    if (dryRun) recipeArgs.push("--dry-run");
    const recipeExit = runNode(
        "scripts/minecraft-recipe-review.cjs",
        recipeArgs
    );
    if (recipeExit === 0) {
        printStage("READY", true, 0);
        return;
    }
    printStage("RECIPE_AMBIGUITY", false, recipeExit);
    process.exitCode = recipeExit;
}

try {
    main();
} catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
}
