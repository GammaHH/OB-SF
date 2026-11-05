const fs = require("node:fs");
const path = require("node:path");

const vanilla = require("../../模板放置處/MC解析器模塊");

function jsonFiles(root) {
    const result = [];
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(absolutePath);
            else if (entry.isFile() && entry.name.endsWith(".json")) {
                result.push(absolutePath);
            }
        }
    }
    visit(root);
    return result.sort();
}

function createMinecraftVanillaRuntime(vaultRoot) {
    const recipeRoot = path.join(vaultRoot, "參考資料", "Minecraft", "recipe");
    const itemTagRoot = path.join(vaultRoot, "參考資料", "Minecraft", "tags", "item");
    const loadErrors = [];

    function vaultPath(absolutePath) {
        return path.relative(vaultRoot, absolutePath).split(path.sep).join("/");
    }

    function readJson(absolutePath) {
        try {
            return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
        } catch (error) {
            loadErrors.push({ path: vaultPath(absolutePath), error: error.message });
            return null;
        }
    }

    const tagEntries = jsonFiles(itemTagRoot).map(absolutePath => ({
        registryType: "item",
        tagId: vanilla.tags.getTagId(vaultPath(absolutePath), vaultPath(itemTagRoot)),
        sourceFile: vaultPath(absolutePath),
        json: readJson(absolutePath)
    })).filter(entry => entry.json !== null);
    const recipeEntries = jsonFiles(recipeRoot).map(absolutePath => ({
        sourceFile: vaultPath(absolutePath),
        json: readJson(absolutePath)
    })).filter(entry => entry.json !== null);

    return {
        vanilla,
        pipeline: vanilla.createVanillaPipeline({ tagEntries, recipeEntries }),
        loadErrors,
        counts: {
            tagFiles: tagEntries.length,
            recipeFiles: recipeEntries.length
        }
    };
}

module.exports = { createMinecraftVanillaRuntime };
