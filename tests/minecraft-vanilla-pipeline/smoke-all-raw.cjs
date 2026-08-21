const fs = require("node:fs");
const path = require("node:path");

const vanilla = require("../../模板放置處/MC解析器模塊");

const vaultRoot = path.resolve(__dirname, "..", "..");
const recipeRoot = path.join(vaultRoot, "參考資料", "Minecraft", "recipe");
const itemTagRoot = path.join(vaultRoot, "參考資料", "Minecraft", "tags", "item");

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

function readJson(absolutePath) {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function vaultPath(absolutePath) {
    return path.relative(vaultRoot, absolutePath).split(path.sep).join("/");
}

function main() {
    const tagEntries = jsonFiles(itemTagRoot).map(absolutePath => ({
        registryType: "item",
        tagId: vanilla.tags.getTagId(
            vaultPath(absolutePath),
            vaultPath(itemTagRoot)
        ),
        sourceFile: vaultPath(absolutePath),
        json: readJson(absolutePath)
    }));

    const recipeEntries = jsonFiles(recipeRoot).map(absolutePath => ({
        sourceFile: vaultPath(absolutePath),
        json: readJson(absolutePath)
    }));

    const pipeline = vanilla.createVanillaPipeline({
        tagEntries,
        recipeEntries
    });

    const diagnosticCounts = {};
    for (const diagnostic of pipeline.diagnostics) {
        const key = diagnostic.status || diagnostic.warning || "UNKNOWN";
        diagnosticCounts[key] = (diagnosticCounts[key] || 0) + 1;
    }

    process.stdout.write(`${JSON.stringify({
        tagFiles: tagEntries.length,
        recipeFiles: recipeEntries.length,
        normalizedItems: pipeline.itemRegistry.size,
        stats: pipeline.stats,
        diagnosticCounts,
        representativeDiagnostics: pipeline.diagnostics.slice(0, 10),
        diagnosticsOmitted: Math.max(0, pipeline.diagnostics.length - 10)
    }, null, 2)}\n`);
}

main();
