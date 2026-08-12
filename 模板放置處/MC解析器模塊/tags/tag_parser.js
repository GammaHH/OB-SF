// ============================================================
// Minecraft Tag Parser
// ============================================================


function normalizeTagEntry(raw) {

    // --------------------------------------------------------
    // String
    //
    // minecraft:bamboo_block
    // #minecraft:some_tag
    // --------------------------------------------------------

    if (typeof raw === "string") {

        if (raw.startsWith("#")) {

            return {
                kind: "tag",
                id: raw.slice(1),
                required: true
            };
        }


        return {
            kind: "entry",
            id: raw,
            required: true
        };
    }


    // --------------------------------------------------------
    // Object
    //
    // {
    //     id: "minecraft:xxx",
    //     required: false
    // }
    // --------------------------------------------------------

    if (
        raw &&
        typeof raw === "object"
    ) {

        const rawId =
            raw.id;


        if (typeof rawId !== "string") {

            return {
                kind: "unknown",
                raw
            };
        }


        const required =
            raw.required !== false;


        if (rawId.startsWith("#")) {

            return {
                kind: "tag",
                id: rawId.slice(1),
                required
            };
        }


        return {
            kind: "entry",
            id: rawId,
            required
        };
    }


    return {
        kind: "unknown",
        raw
    };
}


// ============================================================
// Parse Tag JSON
// ============================================================

function parseTag(
    json,
    context
) {

    const {
        tagId,
        registryType,
        sourceFile
    } = context;


    const warnings = [];


    if (
        !json ||
        !Array.isArray(json.values)
    ) {

        return {
            success: false,
            status: "ERROR",

            warnings: [
                "Tag JSON 找不到 values 陣列"
            ]
        };
    }


    const values = [];


    for (
        let i = 0;
        i < json.values.length;
        i++
    ) {

        const entry =
            normalizeTagEntry(
                json.values[i]
            );


        if (
            entry.kind === "unknown"
        ) {

            warnings.push(
                `values[${i}] 無法解析`
            );
        }


        values.push(
            entry
        );
    }


    return {

        success: true,

        status:
            warnings.length > 0
                ? "REVIEW"
                : "OK",

        tag: {

            id:
                tagId,

            registryType,

            replace:
                json.replace === true,

            values,

            sourceFile
        },

        warnings
    };
}


module.exports = {
    normalizeTagEntry,
    parseTag
};