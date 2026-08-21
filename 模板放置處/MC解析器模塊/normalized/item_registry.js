// ============================================================
// Minecraft Normalized Item Registry (in memory)
// ============================================================

class NormalizedItemRegistry {

    constructor(options = {}) {

        this.items = new Map();

        this.nameResolver =
            typeof options.nameResolver === "function"
                ? options.nameResolver
                : () => null;
    }


    get size() {
        return this.items.size;
    }


    has(itemId) {
        return this.items.has(itemId);
    }


    get(itemId) {
        return this.items.get(itemId) ?? null;
    }


    ensure(itemId) {

        if (
            typeof itemId !== "string" ||
            itemId.length === 0
        ) {
            throw new TypeError("Normalized Item 必須有非空字串 id");
        }


        if (!this.items.has(itemId)) {

            this.items.set(itemId, {
                id: itemId,
                name: this.nameResolver(itemId) ?? null,
                recipes: [],
                warnings: []
            });
        }


        return this.items.get(itemId);
    }


    addRecipe(
        itemId,
        recipe,
        warnings = []
    ) {

        if (
            !recipe ||
            typeof recipe !== "object"
        ) {
            throw new TypeError("Normalized Recipe 必須是 object");
        }


        const item =
            this.ensure(itemId);


        item.recipes.push(recipe);


        for (const warning of warnings) {

            const text =
                String(warning);


            if (!item.warnings.includes(text)) {
                item.warnings.push(text);
            }
        }


        return item;
    }


    values() {
        return this.items.values();
    }


    entries() {
        return this.items.entries();
    }


    toArray() {
        return Array.from(this.items.values());
    }


    // 僅供 debug / generated artifact 使用。
    // 正式 pipeline 不需要先 stringify 再讀回。
    toJSON() {
        return this.toArray();
    }
}


module.exports = {
    NormalizedItemRegistry
};
