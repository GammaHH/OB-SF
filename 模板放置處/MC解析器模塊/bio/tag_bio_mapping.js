// ============================================================
// Minecraft Item Tag → Tag BIO Mapping Draft
// Tag identities are deliberately separate from Minecraft item IDs.
// ============================================================

function normalizeKnownMappings(knownMappings = {}) {
    if (knownMappings instanceof Map) return knownMappings;
    return new Map(Object.entries(knownMappings));
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
        "| Tag ID | BIO ID | 中文名稱 | filename | generate | note |",
        "|---|---|---|---|---|---|"
    ];
    for (const row of rows ?? []) {
        lines.push(
            `| ${escapeCell(row.displayTagId)} ` +
            `| ${escapeCell(row.bioId)} ` +
            `| ${escapeCell(row.zhName)} ` +
            `| ${escapeCell(row.filename)} ` +
            `| ${row.generate ? "true" : "false"} ` +
            `| ${escapeCell(row.note)} |`
        );
    }
    return lines.join("\n");
}

module.exports = {
    createTagBIOMappingDraft,
    renderTagBIOMappingMarkdown
};
