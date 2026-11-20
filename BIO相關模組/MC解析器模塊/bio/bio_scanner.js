// ============================================================
// Minecraft BIO Frontmatter Scanner
// Reads only a bounded file prefix; never loads BIO body content.
// ============================================================

const fs = require("node:fs");
const path = require("node:path");
const { parseTagList } = require("./bio_tags");


function canonicalMinecraftId(rawId) {

    if (
        typeof rawId !== "string" ||
        rawId.trim() === ""
    ) {
        return null;
    }


    const trimmed =
        rawId.trim();


    return trimmed.includes(":")
        ? trimmed.toLowerCase()
        : `minecraft:${trimmed.toLowerCase()}`;
}


function minecraftIdToBIOId(rawId) {

    const canonical =
        canonicalMinecraftId(rawId);

    if (!canonical) {
        return null;
    }


    return canonical
        .slice(canonical.indexOf(":") + 1)
        .toUpperCase();
}


function minecraftIdToBIOAliases(rawId) {

    const canonical =
        canonicalMinecraftId(rawId);

    return canonical
        ? [canonical]
        : [];
}


function unquote(value) {

    if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }

    return value;
}


function parseFrontmatter(text) {

    const normalized =
        text
            .replace(/^\uFEFF/, "")
            .replace(/\r\n/g, "\n");

    const match =
        normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);

    if (!match) {
        return null;
    }


    const result = {};
    const lines = match[1].split("\n");


    for (
        let index = 0;
        index < lines.length;
        index++
    ) {

        const keyMatch =
            lines[index].match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);

        if (!keyMatch) {
            continue;
        }


        const key = keyMatch[1];
        const rawValue = (keyMatch[2] ?? "").trim();


        if ((key === "aliases" || key === "tags") && rawValue === "") {

            const aliases = [];

            while (index + 1 < lines.length) {

                const alias =
                    lines[index + 1].match(/^\s+-\s*(.*)$/);

                if (!alias) break;

                aliases.push(unquote(alias[1].trim()));
                index++;
            }

            result[key] = aliases;
            continue;
        }

        if (key === "tags") { result.tags = parseTagList(rawValue); continue; }


        if (
            key === "aliases" &&
            rawValue.startsWith("[")
        ) {
            try {
                result.aliases = JSON.parse(rawValue);
                continue;
            } catch {
                // Keep raw YAML when it is not JSON-compatible.
            }
        }


        result[key] =
            unquote(rawValue);
    }


    return result;
}


function readFrontmatterPrefix(
    filePath,
    maxBytes = 65536
) {

    const descriptor =
        fs.openSync(filePath, "r");

    try {

        const buffer =
            Buffer.alloc(maxBytes);

        const bytesRead =
            fs.readSync(
                descriptor,
                buffer,
                0,
                maxBytes,
                0
            );

        return parseFrontmatter(
            buffer.subarray(0, bytesRead).toString("utf8")
        );

    } finally {
        fs.closeSync(descriptor);
    }
}


function markdownFiles(rootDirectory) {

    const files = [];


    function visit(directory) {

        for (
            const entry
            of fs.readdirSync(directory, {
                withFileTypes: true
            })
        ) {

            const absolutePath =
                path.join(directory, entry.name);

            if (entry.isDirectory()) {
                visit(absolutePath);
            } else if (
                entry.isFile() &&
                entry.name.toLowerCase().endsWith(".md")
            ) {
                files.push(absolutePath);
            }
        }
    }


    visit(rootDirectory);
    return files.sort();
}


function scanMinecraftBIOs(
    rootDirectory,
    options = {}
) {

    const resolvedRoot =
        path.resolve(rootDirectory);

    const vaultRoot =
        path.resolve(
            options.vaultRoot ??
            path.dirname(resolvedRoot)
        );

    const byNormalizedId = new Map();
    const byLegacyId = new Map();
    const entries = [];
    const warnings = [];
    const collisions = [];
    let invalidType = 0;

    const files =
        markdownFiles(resolvedRoot);

    const acceptedTypes =
        new Set(
            options.acceptedTypes ??
            ["mc-item", "mc-drop", "mc-tag"]
        );


    for (const filePath of files) {

        const frontmatter =
            readFrontmatterPrefix(
                filePath,
                options.maxBytes ?? 65536
            );

        if (!frontmatter) {
            warnings.push(`找不到 frontmatter：${filePath}`);
            continue;
        }


        const legacyId =
            frontmatter.id ?? null;

        const collection = Boolean(frontmatter.type === "mc-tag" || frontmatter.minecraft_tag || frontmatter.derived_group ||
            frontmatter.tag_identity === "minecraft:item_tag" ||
            frontmatter.tag_identity === "obsf:derived_ingredient_group");
        const normalizedId = collection ? null :
            canonicalMinecraftId(
                frontmatter.minecraft_id ??
                legacyId
            );

        if (!normalizedId && !collection) {
            warnings.push(`BIO 缺少 id：${filePath}`);
            continue;
        }


        const type =
            frontmatter.type ?? null;

        if (!acceptedTypes.has(type)) {
            invalidType++;
            warnings.push(
                `MC BIO type 不在允許清單：${filePath} (${type ?? "missing"})`
            );
        }


        const entry = {
            normalizedId,
            legacyId,
            type,
            level: frontmatter.level,
            minecraft_tag: frontmatter.minecraft_tag,
            tag_identity: frontmatter.tag_identity,
            derived_group: frontmatter.derived_group,
            aliases:
                Array.isArray(frontmatter.aliases)
                    ? frontmatter.aliases
                    : frontmatter.aliases
                        ? [frontmatter.aliases]
                        : [],
            name:
                path.basename(filePath, path.extname(filePath)),
            path:
                path.relative(vaultRoot, filePath)
                    .split(path.sep)
                    .join("/")
        };


        entries.push(entry);

        // Collections are navigable BIOs but never ordinary Minecraft item IDs.
        // A Tag with legacy id PLANKS must not claim minecraft:planks.
        if (collection) continue;


        if (byNormalizedId.has(normalizedId)) {

            const collision = {
                normalizedId,
                first:
                    byNormalizedId.get(normalizedId).path,
                duplicate:
                    entry.path
            };

            collisions.push(collision);
            warnings.push(
                `BIO ID collision：${normalizedId} (${collision.first}, ${collision.duplicate})`
            );

        } else {
            byNormalizedId.set(normalizedId, entry);
        }


        if (legacyId && !byLegacyId.has(legacyId)) {
            byLegacyId.set(legacyId, entry);
        }
    }


    return {
        entries,
        byNormalizedId,
        byLegacyId,
        collisions,
        warnings,
        stats: {
            markdownFiles:
                files.length,
            mappedBIOs:
                byNormalizedId.size,
            invalidType,
            collisions:
                collisions.length
        },
        has(normalizedId) {
            return byNormalizedId.has(
                canonicalMinecraftId(normalizedId)
            );
        },
        get(normalizedId) {
            return byNormalizedId.get(
                canonicalMinecraftId(normalizedId)
            ) ?? null;
        }
    };
}


module.exports = {
    canonicalMinecraftId,
    minecraftIdToBIOId,
    minecraftIdToBIOAliases,
    parseFrontmatter,
    readFrontmatterPrefix,
    scanMinecraftBIOs
};
