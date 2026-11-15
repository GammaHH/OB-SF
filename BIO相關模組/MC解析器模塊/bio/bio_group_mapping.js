// ============================================================
// Derived ingredient-group BIO mapping
// Keeps OB-SF synthetic groups separate from Minecraft item tags.
// ============================================================

const MINECRAFT_COLORS = [
    "black", "blue", "brown", "cyan", "gray", "green", "light_blue",
    "light_gray", "lime", "magenta", "orange", "pink", "purple", "red",
    "white", "yellow"
];

function splitMarkdownRow(line) {
    const source = String(line ?? "").trim();
    if (!source.startsWith("|") || !source.endsWith("|")) return null;
    return source.slice(1, -1).split(/(?<!\\)\|/).map(cell =>
        cell.trim().replaceAll("\\|", "|")
    );
}

function colorFamily(itemId) {
    const match = String(itemId ?? "").match(/^minecraft:([a-z0-9_]+)$/);
    if (!match) return null;
    for (const color of MINECRAFT_COLORS) {
        const prefix = `${color}_`;
        if (match[1].startsWith(prefix) && match[1].length > prefix.length) {
            return match[1].slice(prefix.length);
        }
    }
    return null;
}

function derivedAlternativeGroupId(ingredient) {
    if (ingredient?.kind !== "alternatives") return null;
    const choices = ingredient.alternatives ?? [];
    if (choices.length < 2 || choices.some(choice => choice?.kind !== "item")) return null;
    const families = choices.map(choice => colorFamily(choice.id));
    if (!families[0] || families.some(family => family !== families[0])) return null;
    return `obsf:color_family/${families[0]}`;
}

// A preview may only contain one recoloring route, whose input excludes its
// output color. Global group membership must not be defined by that subset.
function collectDerivedAlternativeGroups(models, itemRegistry) {
    const groups = new Map();
    function visit(ingredient, collectUsed) {
        if (ingredient?.kind !== "alternatives") return;
        const groupId = derivedAlternativeGroupId(ingredient);
        if (groupId && (collectUsed || groups.has(groupId))) {
            if (!groups.has(groupId)) groups.set(groupId, new Set());
            for (const choice of ingredient.alternatives || []) {
                if (choice?.kind === "item" && choice.id) groups.get(groupId).add(choice.id);
            }
        }
        for (const choice of ingredient.alternatives || []) visit(choice, collectUsed);
    }
    function collect(items, collectUsed) {
        for (const item of items) for (const recipe of item.recipes || []) {
            for (const ingredient of recipe.ingredients || []) visit(ingredient, collectUsed);
        }
    }
    collect(models, true);
    if (groups.size && itemRegistry?.values) collect(itemRegistry.values(), false);
    return [...groups.entries()].map(([groupId, values]) => ({ groupId, values: [...values].sort() }))
        .sort((left, right) => left.groupId.localeCompare(right.groupId));
}

function parseBIOGroupMappingMarkdown(markdown) {
    const mappings = new Map();
    const diagnostics = [];
    const lines = String(markdown ?? "").split(/\r?\n/);
    const headerIndex = lines.findIndex(line =>
        splitMarkdownRow(line)?.some(cell => cell.toLowerCase() === "group id")
    );
    if (headerIndex === -1) return {
        mappings,
        diagnostics: [{
            code: "MISSING_BIO_GROUP_MAPPING_TABLE",
            severity: "WARNING",
            message: "找不到 Derived BIO Group Mapping table"
        }]
    };
    const headers = splitMarkdownRow(lines[headerIndex]).map(cell => cell.toLowerCase());
    const column = name => headers.indexOf(name.toLowerCase());
    for (let index = headerIndex + 2; index < lines.length; index++) {
        const cells = splitMarkdownRow(lines[index]);
        if (!cells) break;
        const groupId = String(cells[column("group id")] ?? "").replaceAll("`", "").trim();
        if (!/^obsf:[a-z0-9_./-]+$/.test(groupId)) continue;
        if (mappings.has(groupId)) {
            diagnostics.push({
                code: "DUPLICATE_BIO_GROUP_MAPPING",
                severity: "ERROR",
                message: `Derived BIO group mapping 重複：${groupId}`
            });
            continue;
        }
        mappings.set(groupId, {
            kind: "obsf:derived_ingredient_group",
            groupId,
            bioId: cells[column("bio id")] ?? "",
            zhName: cells[column("中文名稱")] ?? "",
            filename: cells[column("filename")] ?? "",
            generate: String(cells[column("generate")] ?? "").toLowerCase() === "true",
            representativeItemId: cells[column("representative item id")] ?? "",
            note: cells[column("note")] ?? ""
        });
    }
    return { mappings, diagnostics };
}

module.exports = {
    MINECRAFT_COLORS,
    colorFamily,
    derivedAlternativeGroupId,
    collectDerivedAlternativeGroups,
    parseBIOGroupMappingMarkdown
};
