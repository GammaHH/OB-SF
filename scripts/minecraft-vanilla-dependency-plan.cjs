#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const vanilla = require("../模板放置處/MC解析器模塊");

const vaultRoot = path.resolve(__dirname, "..");
const recipeRoot = path.join(vaultRoot, "參考資料", "Minecraft", "recipe");
const itemTagRoot = path.join(vaultRoot, "參考資料", "Minecraft", "tags", "item");
const bioRoot = path.join(vaultRoot, "MC-物品資料庫");

function numericOption(name, fallback) {
    const prefix = `--${name}=`;
    const argument = process.argv.find(value => value.startsWith(prefix));
    if (!argument) return fallback;
    const parsed = Number(argument.slice(prefix.length));
    return Number.isInteger(parsed) && parsed >= 0
        ? parsed
        : fallback;
}

const limits = {
    maxDepth: numericOption("max-depth", 5),
    maxChoices: numericOption("max-choices", 6),
    maxTreeLines: numericOption("max-tree-lines", 180),
    maxListItems: numericOption("max-list-items", 30)
};

function jsonFiles(root) {
    const result = [];

    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(absolutePath);
            if (entry.isFile() && entry.name.endsWith(".json")) {
                result.push(absolutePath);
            }
        }
    }

    visit(root);
    return result.sort();
}

function vaultPath(absolutePath) {
    return path.relative(vaultRoot, absolutePath).split(path.sep).join("/");
}

function loadRawEntries() {
    const loadErrors = [];

    function readJson(absolutePath) {
        try {
            return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
        } catch (error) {
            loadErrors.push({
                path: vaultPath(absolutePath),
                error: error.message
            });
            return null;
        }
    }

    const tagEntries = jsonFiles(itemTagRoot)
        .map(absolutePath => ({
            registryType: "item",
            tagId: vanilla.tags.getTagId(
                vaultPath(absolutePath),
                vaultPath(itemTagRoot)
            ),
            sourceFile: vaultPath(absolutePath),
            json: readJson(absolutePath)
        }))
        .filter(entry => entry.json !== null);

    const recipeEntries = jsonFiles(recipeRoot)
        .map(absolutePath => ({
            sourceFile: vaultPath(absolutePath),
            json: readJson(absolutePath)
        }))
        .filter(entry => entry.json !== null);

    return {
        tagEntries,
        recipeEntries,
        loadErrors
    };
}

function formatList(values, maxItems = limits.maxListItems) {
    const isTruncated = values.length > maxItems;
    const tailCount = isTruncated
        ? Math.min(3, Math.max(0, maxItems - 1))
        : 0;
    const headCount = isTruncated
        ? Math.max(1, maxItems - tailCount)
        : values.length;
    const shown = values.slice(0, headCount);
    const tail = tailCount > 0
        ? values.slice(-tailCount)
        : [];
    const formatValue = value =>
        typeof value === "string"
            ? `- ${value}`
            : `- ${value.id}${value.path ? ` → ${value.path}` : ""}`;
    const lines = shown.map(formatValue);
    if (isTruncated) {
        lines.push(`- … omitted ${values.length - shown.length - tail.length}`);
        lines.push(...tail.map(formatValue));
    }
    return lines.length > 0 ? lines : ["- (none)"];
}

function renderDependencyTree(dependency, bioRegistry) {
    const lines = [];
    let truncated = false;

    function push(line) {
        if (lines.length >= limits.maxTreeLines) {
            truncated = true;
            return false;
        }
        lines.push(line);
        return true;
    }

    function renderItem(itemId, indent, depth, activePath, label = "") {
        if (lines.length >= limits.maxTreeLines) {
            truncated = true;
            return;
        }

        const node = dependency.graph.get(itemId);
        const bioMark = bioRegistry.has(itemId) ? "BIO✓" : "BIO✗";
        const cycle = activePath.includes(itemId);
        const suffix = cycle
            ? " [cycle]"
            : node?.leaf
                ? " [leaf]"
                : ` [${node?.recipes.length ?? 0} recipes]`;

        if (!push(`${indent}${label}${itemId} (${bioMark})${suffix}`)) return;
        if (cycle) return;

        if (depth >= limits.maxDepth) {
            if (!node?.leaf) push(`${indent}  … depth limit`);
            return;
        }

        const nextPath = [...activePath, itemId];

        for (const recipe of node?.recipes ?? []) {
            if (!push(
                `${indent}  [recipe ${recipe.recipeIndex}] ` +
                `${recipe.sourceType} → output ${recipe.output}`
            )) return;

            for (const ingredient of recipe.ingredients) {
                renderIngredient(
                    ingredient,
                    `${indent}    `,
                    depth + 1,
                    nextPath
                );
            }
        }
    }

    function renderIngredient(ingredient, indent, depth, activePath) {
        if (ingredient.kind === "item") {
            renderItem(
                ingredient.id,
                indent,
                depth,
                activePath,
                `[item ×${ingredient.qty}] `
            );
            return;
        }

        if (ingredient.kind === "tag") {
            push(
                `${indent}[tag #${ingredient.id} ×${ingredient.qty}] ` +
                `${ingredient.candidates.length} acceptable branches`
            );
            const shown = ingredient.candidates.slice(0, limits.maxChoices);
            for (const candidate of shown) {
                renderItem(
                    candidate.id,
                    `${indent}  `,
                    depth,
                    activePath,
                    "[candidate] "
                );
            }
            if (ingredient.candidates.length > shown.length) {
                push(
                    `${indent}  … ${ingredient.candidates.length - shown.length} ` +
                    "more candidates"
                );
            }
            return;
        }

        if (ingredient.kind === "alternatives") {
            push(
                `${indent}[alternatives ×${ingredient.qty}] ` +
                `${ingredient.choices.length} mutually-exclusive branches`
            );
            const shown = ingredient.choices.slice(0, limits.maxChoices);
            for (const choice of shown) {
                push(`${indent}  [choice ${choice.choiceIndex}]`);
                renderIngredient(
                    choice.ingredient,
                    `${indent}    `,
                    depth,
                    activePath
                );
            }
            if (ingredient.choices.length > shown.length) {
                push(
                    `${indent}  … ${ingredient.choices.length - shown.length} ` +
                    "more choices"
                );
            }
            return;
        }

        push(`${indent}[unknown ingredient]`);
    }

    for (const target of dependency.targets) {
        renderItem(target, "", 0, []);
    }

    if (truncated) {
        lines.push(`… tree output capped at ${limits.maxTreeLines} lines`);
    }

    return lines;
}

function diagnosticSummary(diagnostics) {
    const counts = {};
    for (const diagnostic of diagnostics) {
        const key = diagnostic.status || "TAG";
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

function main() {
    const rawTarget = process.argv.slice(2).find(value => !value.startsWith("--"));
    if (!rawTarget) {
        process.stderr.write(
            "Usage: node scripts/minecraft-vanilla-dependency-plan.cjs minecraft:piston\n"
        );
        process.exitCode = 1;
        return;
    }

    const target = vanilla.bio.canonicalMinecraftId(rawTarget);
    const raw = loadRawEntries();
    const pipeline = vanilla.createVanillaPipeline({
        tagEntries: raw.tagEntries,
        recipeEntries: raw.recipeEntries
    });
    const bioRegistry = vanilla.bio.scanMinecraftBIOs(
        bioRoot,
        { vaultRoot }
    );
    const {
        dependencyResult,
        generationPlan
    } = pipeline.planGeneration(target, { bioRegistry });

    const targetNode = dependencyResult.graph.get(target);
    const warnings = [
        ...generationPlan.warnings,
        ...bioRegistry.warnings,
        ...raw.loadErrors.map(error => `${error.path}: ${error.error}`)
    ];

    const sections = [
        "Target:",
        `- ${target}`,
        `- BIO: ${bioRegistry.get(target)?.path ?? "missing"}`,
        "",
        "Recipes:",
        `- routes: ${targetNode?.recipes.length ?? 0}`,
        ...((targetNode?.recipes ?? []).slice(0, limits.maxListItems).map(recipe =>
            `- [${recipe.recipeIndex}] ${recipe.sourceType}; ` +
            `output=${recipe.output}; ingredients=${recipe.ingredients.length}`
        )),
        "",
        "Dependency Tree:",
        ...renderDependencyTree(dependencyResult, bioRegistry),
        "",
        "Leaf Materials:",
        `- count: ${dependencyResult.leafMaterials.length}`,
        ...formatList(dependencyResult.leafMaterials),
        "",
        "Branches:",
        `- recipe branches: ${dependencyResult.recipeBranches.length}`,
        `- tag branches: ${dependencyResult.tagBranches.length}`,
        `- alternative branches: ${dependencyResult.alternativeBranches.length}`,
        "",
        "Existing BIO:",
        `- count: ${generationPlan.existingBIO.length}`,
        ...formatList(generationPlan.existingBIO),
        "",
        "Missing BIO:",
        `- count: ${generationPlan.missingBIO.length}`,
        ...formatList(generationPlan.missingBIO),
        "",
        "Generation Order:",
        `- total: ${generationPlan.generationOrder.length}`,
        ...formatList(generationPlan.generationOrder),
        "",
        "Missing BIO Generation Order:",
        `- total: ${generationPlan.missingGenerationOrder.length}`,
        ...formatList(generationPlan.missingGenerationOrder),
        "",
        "Blocked by Cycle:",
        `- count: ${generationPlan.blockedByCycle.length}`,
        ...formatList(generationPlan.blockedByCycle),
        "",
        "Warnings:",
        `- pipeline diagnostics: ${JSON.stringify(diagnosticSummary(pipeline.diagnostics))}`,
        `- BIO scanner: ${JSON.stringify(bioRegistry.stats)}`,
        `- dependency cycles: ${generationPlan.cycles.length}`,
        ...formatList(warnings, 10)
    ];

    process.stdout.write(`${sections.join("\n")}\n`);
}

main();
