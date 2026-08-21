// ============================================================
// Minecraft Tag Registry
// ============================================================

const tagParser =
    require("./tag_parser");


function createRegistry() {

    return {
        item: {},
        block: {},
        errors: [],
        warnings: [],
        stats: {
            itemTags: 0,
            blockTags: 0,
            errors: 0
        }
    };
}


function storeParsedTag(
    registry,
    registryType,
    tag
) {

    const bucket =
        registry?.[registryType];


    if (!bucket) {
        throw new Error(
            `不支援的 Tag Registry Type：${registryType}`
        );
    }


    const existing =
        bucket[tag.id];


    if (
        existing &&
        tag.replace !== true
    ) {

        bucket[tag.id] = {
            ...tag,
            values: [
                ...existing.values,
                ...tag.values
            ]
        };

    } else {

        bucket[tag.id] = tag;
    }


    registry.stats.itemTags =
        Object.keys(registry.item).length;

    registry.stats.blockTags =
        Object.keys(registry.block).length;
}


function buildRegistryFromEntries(entries = []) {

    const registry =
        createRegistry();


    for (
        let index = 0;
        index < entries.length;
        index++
    ) {

        const entry =
            entries[index] ?? {};

        const registryType =
            entry.registryType ?? "item";

        const sourceFile =
            entry.sourceFile ??
            `<memory:tag:${index}>`;


        if (
            !entry.tagId ||
            !registry[registryType]
        ) {

            registry.errors.push({
                registryType,
                tagId: entry.tagId ?? null,
                sourceFile,
                warning: "Tag entry 缺少 tagId 或 registryType 無效"
            });

            registry.stats.errors++;
            continue;
        }


        const parsed =
            tagParser.parseTag(
                entry.json,
                {
                    tagId: entry.tagId,
                    registryType,
                    sourceFile
                }
            );


        if (!parsed.success) {

            registry.errors.push({
                registryType,
                tagId: entry.tagId,
                sourceFile,
                warning: parsed.warnings.join("; ")
            });

            registry.stats.errors++;
            continue;
        }


        storeParsedTag(
            registry,
            registryType,
            parsed.tag
        );


        for (const warning of parsed.warnings) {
            registry.warnings.push({
                registryType,
                tagId: entry.tagId,
                sourceFile,
                warning
            });
        }
    }


    return registry;
}


// ============================================================
// Path
// ============================================================

function normalizePath(path) {

    return String(path ?? "")
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/");
}


// ============================================================
// File Path → Tag ID
//
// 參考資料/Minecraft/tags/item/foo/bar.json
//
// ↓
//
// minecraft:foo/bar
// ============================================================

function getTagId(
    filePath,
    root,
    namespace = "minecraft"
) {

    const path =
        normalizePath(filePath);

    const normalizedRoot =
        normalizePath(root);


    if (
        !path.startsWith(
            normalizedRoot + "/"
        )
    ) {

        return null;
    }


    const relative =
        path
            .slice(
                normalizedRoot.length + 1
            )
            .replace(
                /\.json$/i,
                ""
            );


    if (!relative) {
        return null;
    }


    return (
        `${namespace}:${relative}`
    );
}


// ============================================================
// 建立 Registry
// ============================================================

async function buildRegistry(
    app,
    config
) {

    const {
        itemRoot,
        blockRoot,
        namespace = "minecraft"
    } = config;


    const registry =
        createRegistry();


    const registryConfigs = [

        {
            type: "item",
            root: itemRoot
        },

        {
            type: "block",
            root: blockRoot
        }
    ];


    const allFiles =
        app.vault.getFiles();


    for (
        const registryConfig
        of registryConfigs
    ) {

        const {
            type,
            root
        } = registryConfig;


        if (!root) {
            continue;
        }


        const normalizedRoot =
            normalizePath(root);


        const files =
            allFiles.filter(
                file => {

                    const path =
                        normalizePath(
                            file.path
                        );


                    return (
                        path.startsWith(
                            normalizedRoot + "/"
                        ) &&
                        file.extension
                            .toLowerCase() ===
                            "json"
                    );
                }
            );


        for (const file of files) {

            const tagId =
                getTagId(
                    file.path,
                    root,
                    namespace
                );


            if (!tagId) {
                continue;
            }


            let json;


            try {

                const text =
                    await app.vault.read(
                        file
                    );

                json =
                    JSON.parse(text);

            } catch (err) {

                registry.errors.push({

                    registryType:
                        type,

                    tagId,

                    sourceFile:
                        file.path,

                    warning:
                        `JSON 解析失敗：${err.message}`
                });


                registry.stats.errors++;

                continue;
            }


            const parsed =
                tagParser.parseTag(
                    json,
                    {
                        tagId,
                        registryType:
                            type,

                        sourceFile:
                            file.path
                    }
                );


            if (!parsed.success) {

                registry.errors.push({

                    registryType:
                        type,

                    tagId,

                    sourceFile:
                        file.path,

                    warning:
                        parsed.warnings.join(
                            "; "
                        )
                });


                registry.stats.errors++;

                continue;
            }


            storeParsedTag(
                registry,
                type,
                parsed.tag
            );


            for (const warning of parsed.warnings) {
                registry.warnings.push({
                    registryType: type,
                    tagId,
                    sourceFile: file.path,
                    warning
                });
            }
        }
    }


    return registry;
}


// ============================================================
// Resolve Tag
//
// 支援：
//
// #tag
//   ↓
// item
// nested #tag
// nested #tag
//   ↓
// 最終 item IDs
// ============================================================

function resolveTag(
    tagId,
    registry,
    registryType = "item",
    stack = []
) {

    const warnings = [];


    const bucket =
        registry?.[registryType];


    if (!bucket) {

        return {
            success: false,
            values: [],

            warnings: [
                `找不到 Tag Registry：${registryType}`
            ]
        };
    }


    const tag =
        bucket[tagId];


    if (!tag) {

        return {
            success: false,
            values: [],

            warnings: [
                `找不到 ${registryType} Tag：#${tagId}`
            ]
        };
    }


    // --------------------------------------------------------
    // Cycle Detection
    // --------------------------------------------------------

    if (
        stack.includes(tagId)
    ) {

        return {
            success: false,
            values: [],

            warnings: [
                `Tag 循環引用：${[
                    ...stack,
                    tagId
                ].join(" → ")}`
            ]
        };
    }


    const nextStack = [
        ...stack,
        tagId
    ];


    const values = [];


    for (
        const entry
        of tag.values
    ) {

        // ----------------------------------------------------
        // Direct Entry
        // ----------------------------------------------------

        if (
            entry.kind === "entry"
        ) {

            values.push(
                entry.id
            );

            continue;
        }


        // ----------------------------------------------------
        // Nested Tag
        // ----------------------------------------------------

        if (
            entry.kind === "tag"
        ) {

            const nested =
                resolveTag(
                    entry.id,
                    registry,
                    registryType,
                    nextStack
                );


            if (!nested.success) {

                // required:false
                // 找不到時允許忽略
                if (
                    entry.required ===
                    false
                ) {
                    continue;
                }


                warnings.push(
                    ...nested.warnings
                );

                continue;
            }


            values.push(
                ...nested.values
            );


            warnings.push(
                ...nested.warnings
            );


            continue;
        }


        warnings.push(
            `Tag #${tagId} 存在無法解析的 value`
        );
    }


    // --------------------------------------------------------
    // 去重
    // --------------------------------------------------------

    const uniqueValues =
        [...new Set(values)];


    return {

        success:
            warnings.length === 0,

        values:
            uniqueValues,

        warnings
    };
}


// ============================================================
// Resolve Ingredient
// ============================================================

function resolveIngredient(
    ingredient,
    registry,
    registryType = "item"
) {

    if (
        !ingredient ||
        typeof ingredient !== "object"
    ) {

        return {
            ingredient,
            warnings: []
        };
    }


    // --------------------------------------------------------
    // Tag Ingredient
    // --------------------------------------------------------

    if (
        ingredient.kind === "tag"
    ) {

        const resolved =
            resolveTag(
                ingredient.id,
                registry,
                registryType
            );


        return {

            ingredient: {

                ...ingredient,

                resolved:
                    resolved.success,

                values:
                    resolved.values
            },

            warnings:
                resolved.warnings
        };
    }


    // --------------------------------------------------------
    // Alternatives
    //
    // alternatives 裡面也有可能有需要處理的元素
    // --------------------------------------------------------

    if (
        ingredient.kind ===
            "alternatives" &&
        Array.isArray(
            ingredient.alternatives
        )
    ) {

        const alternatives = [];
        const warnings = [];


        for (
            const alternative
            of ingredient.alternatives
        ) {

            const result =
                resolveIngredient(
                    alternative,
                    registry,
                    registryType
                );


            alternatives.push(
                result.ingredient
            );


            warnings.push(
                ...result.warnings
            );
        }


        return {

            ingredient: {
                ...ingredient,
                alternatives
            },

            warnings
        };
    }


    return {
        ingredient,
        warnings: []
    };
}


// ============================================================
// Resolve 整條 Recipe Ingredients
// ============================================================

function resolveIngredients(
    ingredients,
    registry,
    registryType = "item"
) {

    const output = [];
    const warnings = [];


    for (
        const ingredient
        of ingredients ?? []
    ) {

        const result =
            resolveIngredient(
                ingredient,
                registry,
                registryType
            );


        output.push(
            result.ingredient
        );


        warnings.push(
            ...result.warnings
        );
    }


    return {
        ingredients: output,
        warnings
    };
}


module.exports = {
    createRegistry,
    buildRegistryFromEntries,
    buildRegistry,
    getTagId,
    resolveTag,
    resolveIngredient,
    resolveIngredients
};
