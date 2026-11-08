// ============================================================
// Minecraft Item Tag → Tag BIO Mapping Draft
// Tag identities are deliberately separate from Minecraft item IDs.
// ============================================================

function normalizeKnownMappings(knownMappings = {}) {
    if (knownMappings instanceof Map) return knownMappings;
    return new Map(Object.entries(knownMappings));
}

function canonicalTagId(value) {
    const text = String(value ?? "").trim().replace(/^#/, "");
    return /^minecraft:[a-z0-9_./-]+$/.test(text) ? text : null;
}

function splitMarkdownRow(line) {
    const source = String(line ?? "").trim();
    if (!source.startsWith("|") || !source.endsWith("|")) return null;
    return source.slice(1, -1).split(/(?<!\\)\|/).map(cell =>
        cell.trim().replaceAll("\\|", "|")
    );
}

function parseTagBIOMappingMarkdown(markdown) {
    const mappings = new Map();
    const diagnostics = [];
    const lines = String(markdown ?? "").split(/\r?\n/);
    const headerIndex = lines.findIndex(line => {
        const cells = splitMarkdownRow(line);
        return cells?.some(cell => cell.toLowerCase() === "tag id");
    });
    if (headerIndex === -1) {
        return {
            mappings,
            diagnostics: [{
                code: "MISSING_TAG_MAPPING_TABLE",
                severity: "WARNING",
                message: "找不到 Minecraft Tag BIO Mapping table"
            }]
        };
    }
    const headers = splitMarkdownRow(lines[headerIndex]).map(value => value.toLowerCase());
    const column = name => headers.indexOf(name.toLowerCase());
    const tagColumn = column("tag id");
    const bioColumn = column("bio id");
    const zhColumn = column("中文名稱");
    const filenameColumn = column("filename");
    const generateColumn = column("generate");
    const representativeColumn = column("representative item id");
    const noteColumn = column("note");
    for (let index = headerIndex + 2; index < lines.length; index++) {
        const cells = splitMarkdownRow(lines[index]);
        if (!cells) break;
        const tagId = canonicalTagId(cells[tagColumn]);
        if (!tagId) continue;
        if (mappings.has(tagId)) {
            diagnostics.push({
                code: "DUPLICATE_TAG_MAPPING",
                severity: "ERROR",
                message: `Tag mapping 重複：#${tagId}`,
                tagId
            });
            continue;
        }
        const representativeItemId = representativeColumn === -1
            ? ""
            : String(cells[representativeColumn] ?? "").replaceAll("`", "").trim();
        if (representativeItemId && !/^minecraft:[a-z0-9_./-]+$/.test(representativeItemId)) {
            diagnostics.push({
                code: "INVALID_TAG_REPRESENTATIVE",
                severity: "ERROR",
                message: `Tag representative item ID 無效：${representativeItemId}`,
                tagId
            });
        }
        mappings.set(tagId, {
            kind: "minecraft:item_tag",
            tagId,
            displayTagId: `#${tagId}`,
            bioId: bioColumn === -1 ? "" : cells[bioColumn] ?? "",
            zhName: zhColumn === -1 ? "" : cells[zhColumn] ?? "",
            filename: filenameColumn === -1 ? "" : cells[filenameColumn] ?? "",
            generate: generateColumn === -1
                ? false
                : String(cells[generateColumn] ?? "").toLowerCase() === "true",
            representativeItemId,
            note: noteColumn === -1 ? "" : cells[noteColumn] ?? ""
        });
    }
    return { mappings, diagnostics };
}

function createTagBIOMappingDraft(dependencyResult, options = {}) {
    const knownMappings = normalizeKnownMappings(options.knownMappings);
    const tags = new Map();

    for (const branch of dependencyResult?.tagBranches ?? []) {
        if (!branch.id) continue;
        if (!tags.has(branch.id)) {
            const known = knownMappings.get(branch.id) ?? {};
            tags.set(branch.id, {
                kind: "minecraft:item_tag",
                tagId: branch.id,
                displayTagId: `#${branch.id}`,
                bioId: known.bioId ?? "",
                zhName: known.zhName ?? "",
                filename: known.filename ?? "",
                generate: known.generate ?? false,
                representativeItemId: known.representativeItemId ?? "",
                note: known.note ?? "",
                occurrences: 0,
                candidateCount: 0
            });
        }
        const row = tags.get(branch.id);
        row.occurrences++;
        row.candidateCount = Math.max(
            row.candidateCount,
            branch.candidates?.length ?? 0
        );
    }

    return [...tags.values()].sort((a, b) =>
        a.tagId.localeCompare(b.tagId)
    );
}

function escapeCell(value) {
    return String(value ?? "").replaceAll("|", "\\|");
}

function renderTagBIOMappingMarkdown(rows) {
    const lines = [
        "| Tag ID | BIO ID | 中文名稱 | filename | generate | Representative Item ID | note |",
        "|---|---|---|---|---|---|---|"
    ];
    for (const row of rows ?? []) {
        lines.push(
            `| ${escapeCell(row.displayTagId)} ` +
            `| ${escapeCell(row.bioId)} ` +
            `| ${escapeCell(row.zhName)} ` +
            `| ${escapeCell(row.filename)} ` +
            `| ${row.generate ? "true" : "false"} ` +
            `| ${escapeCell(row.representativeItemId)} ` +
            `| ${escapeCell(row.note)} |`
        );
    }
    return lines.join("\n");
}

function upsertTagRepresentativeMapping(markdown, tagId, representativeItemId) {
    const canonical = canonicalTagId(tagId);
    if (!canonical) throw new Error(`無效 Minecraft Tag ID：${tagId}`);
    if (!/^minecraft:[a-z0-9_./-]+$/.test(String(representativeItemId ?? ""))) {
        throw new Error(`無效 representative item ID：${representativeItemId}`);
    }
    const lines = String(markdown ?? "").split(/\r?\n/);
    const headerIndex = lines.findIndex(line => {
        const cells = splitMarkdownRow(line);
        return cells?.some(cell => cell.toLowerCase() === "tag id");
    });
    if (headerIndex === -1) throw new Error("找不到 Minecraft Tag BIO Mapping table");
    let headers = splitMarkdownRow(lines[headerIndex]);
    let representativeColumn = headers.findIndex(value =>
        value.toLowerCase() === "representative item id"
    );
    const noteColumn = headers.findIndex(value => value.toLowerCase() === "note");
    if (representativeColumn === -1) {
        representativeColumn = noteColumn === -1 ? headers.length : noteColumn;
        headers.splice(representativeColumn, 0, "Representative Item ID");
        lines[headerIndex] = `| ${headers.join(" | ")} |`;
        const separator = splitMarkdownRow(lines[headerIndex + 1]) ?? [];
        separator.splice(representativeColumn, 0, "---");
        lines[headerIndex + 1] = `| ${separator.join(" | ")} |`;
        for (let index = headerIndex + 2; index < lines.length; index++) {
            const cells = splitMarkdownRow(lines[index]);
            if (!cells) break;
            cells.splice(representativeColumn, 0, "");
            lines[index] = `| ${cells.join(" | ")} |`;
        }
    }
    let found = false;
    let tableEnd = headerIndex + 2;
    for (; tableEnd < lines.length; tableEnd++) {
        const cells = splitMarkdownRow(lines[tableEnd]);
        if (!cells) break;
        if (canonicalTagId(cells[0]) !== canonical) continue;
        cells[representativeColumn] = representativeItemId;
        lines[tableEnd] = `| ${cells.join(" | ")} |`;
        found = true;
    }
    if (!found) {
        const cells = Array(headers.length).fill("");
        cells[0] = `#${canonical}`;
        const generateColumn = headers.findIndex(value => value.toLowerCase() === "generate");
        if (generateColumn !== -1) cells[generateColumn] = "false";
        cells[representativeColumn] = representativeItemId;
        lines.splice(tableEnd, 0, `| ${cells.join(" | ")} |`);
    }
    return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

module.exports = {
    canonicalTagId,
    parseTagBIOMappingMarkdown,
    createTagBIOMappingDraft,
    renderTagBIOMappingMarkdown,
    upsertTagRepresentativeMapping
};
