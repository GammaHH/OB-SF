module.exports = async function bio_inventory(tp) {
    const path = require("node:path");
    const app = tp.app?.vault ? tp.app : globalThis.app;
    const root = app?.vault?.adapter?.basePath;
    if (!root) throw new Error("BIO 盤點需要桌面版 Obsidian Vault");
    const nodeRequire = require("node:module").createRequire(path.join(root, "BIO engine", "bio_inventory.js"));
    const moduleRoot = path.join(root, "BIO相關模組", "MC解析器模塊", "bio");
    const load = name => {
        const absolute = path.join(moduleRoot, name);
        delete nodeRequire.cache[nodeRequire.resolve(absolute)];
        return nodeRequire(absolute);
    };
    const inventoryTools = load("bio_inventory.js");
    const mappingTools = load("tag_bio_mapping.js");
    const mappingFile = app.vault.getAbstractFileByPath("Minecraft Tag BIO Mapping Draft.md");
    const mapping = mappingFile ? mappingTools.parseTagBIOMappingMarkdown(await app.vault.read(mappingFile)) : null;
    if (mapping?.diagnostics.some(entry => entry.severity === "ERROR")) {
        throw new Error("Tag Mapping 有錯誤，請先修正後再盤點，避免將 Tag 誤認為 Item");
    }
    const legacyTagIds = mapping ? [...mapping.mappings.entries()].map(([id, row]) =>
        row.bioId || id.split(":").at(-1).toUpperCase()) : ["PLANKS", "OAK_LOGS", "LOGS"];
    const documents = app.vault.getMarkdownFiles().map(file => {
        const cache = app.metadataCache.getFileCache(file);
        return { path: file.path, cacheReady: Boolean(cache), frontmatter: cache?.frontmatter,
            tags: (cache?.tags || []).map(tag => tag.tag) };
    });
    const inventory = inventoryTools.buildBIOInventory(documents, { legacyTagIds });
    globalThis.__obsfBIOInventories ||= {};
    globalThis.__obsfBIOInventories[root] = inventory;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const folder = "BIO-輸出報告";
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    const prefix = folder + "/Minecraft BIO Inventory-" + stamp;
    const lines = ["# Minecraft BIO 盤點", "", "> PRESENT 表示檔案存在，不等於內容已驗收。preview 不列入正式盤點。", "",
        ...Object.entries(inventory.stats).map(([key, value]) => "- " + key + ": " + value),
        "", "完整清單：[[" + prefix + ".json]]", "", "## 重複識別", ""];
    for (const conflict of inventory.conflicts) lines.push("- " + conflict.key + "：" + conflict.paths.join("、"));
    if (!inventory.conflicts.length) lines.push("- 無");
    lines.push("", "## 診斷", "");
    for (const diagnostic of inventory.diagnostics) lines.push("- " + diagnostic.code + "：" + diagnostic.path);
    if (!inventory.diagnostics.length) lines.push("- 無");
    await app.vault.create(prefix + ".json", JSON.stringify(inventory, null, 2));
    const summary = await app.vault.create(prefix + ".md", lines.join("\n") + "\n");
    await app.workspace.getLeaf(false).openFile(summary);
    return "";
};
