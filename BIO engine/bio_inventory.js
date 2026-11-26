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
    const { auditPreferred, renderPreferredAudit } = nodeRequire(path.join(root, "scripts", "lib", "bio-preferred-audit.cjs"));
    const mappingTools = load("tag_bio_mapping.js");
    const mappingFile = app.vault.getAbstractFileByPath("BIO Collection Mapping Draft.md") || app.vault.getAbstractFileByPath("Minecraft Tag BIO Mapping Draft.md");
    const mapping = mappingFile ? mappingTools.parseTagBIOMappingMarkdown(await app.vault.read(mappingFile)) : null;
    if (mapping?.diagnostics.some(entry => entry.severity === "ERROR")) {
        throw new Error("Tag Mapping 有錯誤，請先修正後再盤點，避免將 Tag 誤認為 Item");
    }
    const legacyTagIds = mapping ? [...mapping.mappings.entries()].map(([id, row]) =>
        row.bioId || id.split(":").at(-1).toUpperCase()) : ["PLANKS", "OAK_LOGS", "LOGS"];
    const { parseFrontmatter } = load('bio_scanner.js');
    const { formalRoots, isFormalPath } = load('machine_recipe_mapping.js');
    const roots = formalRoots(await app.vault.adapter.read('Recipe Mapping Draft.md'));
    const documents = [];
    for (const file of app.vault.getMarkdownFiles()) {
        if (!isFormalPath(file.path, roots)) continue;
        try {
            const text = await app.vault.read(file);
            documents.push({ path: file.path, cacheReady: true, text, frontmatter: parseFrontmatter(text), scope: 'formal',
                tags: [...text.matchAll(/(?:^|\s)#(待補充|未人工檢查|更新需人工解析)(?=\s|$)/gm)].map(match => match[1]) });
        } catch (error) { documents.push({ path: file.path, scope: 'formal', cacheReady: false, readError: error.message }); }
    }
    const inventory = inventoryTools.buildBIOInventory(documents, { legacyTagIds });
    globalThis.__obsfBIOInventories ||= {};
    globalThis.__obsfBIOInventories[root] = inventory;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const folder = "BIO-輸出報告";
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    const prefix = folder + "/BIO Inventory-" + stamp;
    const lines = ["# BIO 盤點", "", "> PRESENT 表示檔案存在，不等於內容已驗收。涵蓋正式白名單中的 MC／Slimefun BIO；Preview 不列入正式盤點。", "",
        ...Object.entries(inventory.stats).map(([key, value]) => "- " + key + ": " + value),
        "", "完整清單：[[" + prefix + ".json]]", "", "## 重複識別", ""];
    for (const conflict of inventory.conflicts) lines.push("- " + conflict.key + "：" + conflict.paths.join("、"));
    if (!inventory.conflicts.length) lines.push("- 無");
    lines.push("", "## 診斷", "");
    for (const diagnostic of inventory.diagnostics) lines.push("- " + diagnostic.code + "：" + diagnostic.path);
    if (!inventory.diagnostics.length) lines.push("- 無");
    const preferredAudit = auditPreferred(documents);
    lines.push("", renderPreferredAudit(preferredAudit).replace(/^# /, "## "));
    await app.vault.create(prefix + ".json", JSON.stringify({ ...inventory, preferredAudit }, null, 2));
    const summary = await app.vault.create(prefix + ".md", lines.join("\n") + "\n");
    await app.workspace.getLeaf(false).openFile(summary);
    return "";
};
