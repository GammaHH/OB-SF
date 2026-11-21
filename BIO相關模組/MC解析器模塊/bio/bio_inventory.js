// Pure inventory index shared by Node and Obsidian adapters. No BIO body reads.
function canonicalId(value, namespace = 'minecraft') {
    if (typeof value !== "string" || !value.trim()) return null;
    const id = value.trim().replace(/^#/, "");
    const normalized = id.includes(":") ? id : namespace + ':' + id;
    if (normalized.startsWith('minecraft:')) return /^minecraft:[a-z0-9_./-]+$/i.test(normalized) ? normalized.toLowerCase() : null;
    return /^[a-z][a-z0-9_.-]*:[A-Za-z0-9_./-]+$/.test(normalized) ? normalized : null;
}

function identity(kind, id) { return kind + ":" + id; }

function buildBIOInventory(documents, options = {}) {
    const entries = [];
    const diagnostics = [];
    const byIdentity = new Map();
    let previewsExcluded = 0;
    const legacyTagIds = new Set(options.legacyTagIds || []);
    for (const document of [...documents].sort((a, b) => a.path.localeCompare(b.path, "en"))) {
        const filePath = document.path.replaceAll("\\", "/");
        if (filePath.startsWith('@自動化BIO Preview/') || /(^|\/)preview(\/|$)/i.test(filePath) || /\.(?:preview|update-preview|formal-candidate)\.md$/i.test(filePath)) {
            previewsExcluded++;
            continue;
        }
        if (filePath.split("/").some(part => part.startsWith("."))) continue;
        if (document.cacheReady === false) {
            diagnostics.push({ code: "METADATA_NOT_READY", path: filePath });
            continue;
        }
        const fm = document.frontmatter || {};
        if (!["mc-item", "mc-drop", "mc-tag", "sf-item", "sf-drop", "sf-GEO"].includes(fm.type)) continue;
        let kind = "item";
        let id;
        if (fm.derived_group) {
            kind = "group";
            id = /^obsf:[a-z0-9_./-]+$/.test(fm.derived_group) ? fm.derived_group : null;
        } else if (fm.minecraft_tag || fm.tag_identity === "minecraft:item_tag") {
            kind = "tag";
            id = canonicalId(fm.minecraft_tag);
        } else if (fm.type === "mc-tag") {
            kind = "tag";
            id = /^[A-Za-z0-9_.:-]+$/.test(fm.id || "") ? "custom:" + fm.id.toLowerCase() : null;
        } else {
            id = fm.type.startsWith('sf-') ? canonicalId(fm.id, 'slimefun') : canonicalId(fm.minecraft_id || fm.id);
            // Legacy Tag BIOs such as PLANKS need an explicit tag identity.
            if (fm.type.startsWith('mc-') && !fm.minecraft_id && legacyTagIds.has(String(fm.id || "").toUpperCase())) {
                diagnostics.push({ code: "LEGACY_TAG_ID_REQUIRES_IDENTITY", path: filePath, bioId: fm.id });
                continue;
            }
        }
        if (!id) {
            diagnostics.push({ code: "INVALID_BIO_IDENTITY", path: filePath });
            continue;
        }
        const tags = [...(Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : []), ...(document.tags || [])]
            .map(tag => String(tag).replace(/^#/, ""));
        const entry = {
            kind, id, key: identity(kind, id), bioId: fm.id || "", type: fm.type,
            path: filePath, name: filePath.split("/").at(-1).replace(/\.md$/i, ""),
            manualReview: tags.some(tag => ["待補充", "未人工檢查", "更新需人工解析"].includes(tag)) ? "PENDING" : "UNKNOWN",
            generatorSchema: fm.generator_schema ?? null
        };
        entries.push(entry);
        if (!byIdentity.has(entry.key)) byIdentity.set(entry.key, []);
        byIdentity.get(entry.key).push(entry);
    }
    const conflicts = [...byIdentity.entries()].filter(([, values]) => values.length > 1)
        .map(([key, values]) => ({ key, paths: values.map(value => value.path) }));
    const get = (kind, rawId) => {
        const id = kind === "group" ? rawId
            : kind === "tag" && /^custom:[A-Za-z0-9_.:-]+$/.test(rawId || "") ? rawId.toLowerCase()
            : canonicalId(rawId);
        if (!["item", "tag", "group"].includes(kind) || !id ||
            (kind === "group" && !/^obsf:[a-z0-9_./-]+$/.test(id))) {
            return { kind, id, presence: "INVALID", matches: [] };
        }
        const matches = byIdentity.get(identity(kind, id)) || [];
        return { kind, id, presence: matches.length > 1 ? "CONFLICT" : matches.length ? "PRESENT"
            : diagnostics.length ? "UNCONFIRMED" : "MISSING", matches };
    };
    return {
        inventorySchema: 1,
        entries, conflicts, diagnostics,
        stats: { complete: diagnostics.length === 0, files: entries.length, identities: byIdentity.size, conflicts: conflicts.length,
            previewsExcluded, diagnostics: diagnostics.length,
            items: entries.filter(entry => entry.kind === "item").length,
            tags: entries.filter(entry => entry.kind === "tag").length,
            groups: entries.filter(entry => entry.kind === "group").length },
        get
    };
}

module.exports = { buildBIOInventory };
