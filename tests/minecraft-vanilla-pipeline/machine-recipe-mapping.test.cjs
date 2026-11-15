const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMachineRecipeMappings, classifyMachineRecipe, normalizeMachineRecipeSections } =
    require("../../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping");

const table = rows => "| provider | machine | sourceType | section | enabled |\n" +
    "| --- | --- | --- | --- | --- |\n" + rows.join("\n") + "\n";
const rules = parseMachineRecipeMappings(table([
    "| Minecraft 原版 | [[MC/熔爐|熔爐]] | | 熔煉配方 | true |",
    "| Minecraft 原版 | 高爐 | | 熔煉配方 | true |",
    "| | 工作台 | | 合成配方 | true |"
])).rules;
const route = (machine, item = "鐵原礦", preferred = false) =>
    (preferred ? "<!-- preferred -->\n" : "") + "- **生產設備**：(Machine:: [[" + machine + "]])\n" +
    "\t**合成所需**：\n\t- [item:: [[" + item + "]]] (qty:: 1)\n\t- [output:: 1]\n";

test("mapping table supports provider scope, wikilinks and optional source types", () => {
    assert.equal(rules.length, 3);
    assert.equal(rules[0].machine, "MC/熔爐");
    assert.equal(classifyMachineRecipe({ machine: "[[MC/熔爐|顯示名稱]]", provider: "Minecraft 原版" }, rules).section, "熔煉配方");
    const other = classifyMachineRecipe({ machine: "MC/熔爐", provider: "Slimefun 原版", section: "常規" }, rules);
    assert.equal(other.section, "常規");
    assert.equal(other.diagnostics[0].code, "MISSING_MACHINE_MAPPING");
    const optional = parseMachineRecipeMappings("| provider | machine | section | enabled |\n| --- | --- | --- | --- |\n| | 工作台 | 合成配方 | true |\n");
    assert.equal(optional.rules[0].sourceType, "");
    assert.equal(optional.diagnostics.length, 0);
});

test("only a unique enabled rule changes classification; missing type is never guessed", () => {
    const parsed = parseMachineRecipeMappings(table([
        "| | 工作台 | minecraft:crafting_shaped | 合成配方 | true |",
        "| | 工作台 | | 已停用 | false |"
    ]));
    assert.equal(classifyMachineRecipe({ machine: "工作台", section: "常規" }, parsed.rules).section, "常規");
    assert.equal(classifyMachineRecipe({ machine: "工作台", sourceType: "minecraft:crafting_shaped" }, parsed.rules).section, "合成配方");
    const conflict = classifyMachineRecipe({ machine: "工作台", section: "人工分類" }, [rules[2], rules[2]]);
    assert.equal(conflict.section, "人工分類");
    assert.equal(conflict.diagnostics[0].code, "AMBIGUOUS_MACHINE_MAPPING");
    assert.equal(parseMachineRecipeMappings(table(["| | 工作台 | | 合成配方 | perhaps |"])).diagnostics[0].code, "INVALID_MACHINE_MAPPING");
});

test("normalizer classifies mixed Machine routes and keeps order and preferred markers", () => {
    const source = "# 合成/取得\n\n### 常規\n\n##### Minecraft 原版\n\n" +
        route("MC/熔爐", "鐵原礦", true) + "\n\n" + route("高爐") + "\n" + route("工作台", "木材");
    const result = normalizeMachineRecipeSections(source, { rules });
    assert.equal(result.diagnostics.length, 0);
    assert.equal((result.text.match(/^### 熔煉配方$/gm) || []).length, 1);
    assert.equal((result.text.match(/^##### Minecraft 原版$/gm) || []).length, 2);
    assert.equal((result.text.match(/^### 合成配方$/gm) || []).length, 1);
    assert.match(result.text, /##### Minecraft 原版\n\n<!-- preferred -->\n- \*\*生產設備/);
    assert.ok(result.text.indexOf("[[MC/熔爐]]") < result.text.indexOf("[[高爐]]"));
    assert.ok(result.text.indexOf("[[高爐]]") < result.text.indexOf("[[工作台]]"));
    assert.doesNotMatch(result.text, /### 常規/);
    assert.equal(normalizeMachineRecipeSections(result.text, { rules }).text, result.text);
});

test("normalizer never rewrites manual prose, note Machine examples, external or Tag routes", () => {
    const protectedText = "---\ntype: mc-item\n---\n# 合成/取得\n\n### 外部取得\n\n" + route("工作台") +
        "\n### Tag 代表材料\n\n" + route("工作台") +
        "\n### 人工記錄\n\n- [note:: 範例 (Machine:: 工作台)]\n- `(Machine:: [[工作台]])`\n```md\n" + route("工作台") + "```\n" +
        "<!-- sample\n" + route("工作台") + "-->\n# 用途\n\n" + route("工作台");
    assert.equal(normalizeMachineRecipeSections(protectedText, { rules }).text, protectedText);
    const source = "# 合成/取得\n### 常規\n\n" + route("工作台", "A") +
        "\n人工說明  \n\n\n" + route("工作台", "B");
    const result = normalizeMachineRecipeSections(source, { rules }).text;
    assert.match(result, /人工說明  \n/);
    assert.equal((result.match(/^### 合成配方$/gm) || []).length, 2);
    assert.ok(result.indexOf("[[A]]") < result.indexOf("人工說明"));
    assert.ok(result.indexOf("人工說明") < result.indexOf("[[B]]"));
    assert.equal(normalizeMachineRecipeSections(result, { rules }).text, result);
});

test("unknown Machine sections survive while adjacent recipe gaps have no blank line", () => {
    const source = "### 保留人工分類\n\n" + route("未知設備", "A") + "\n\n\n" + route("未知設備", "B");
    const result = normalizeMachineRecipeSections(source, { rules: [] });
    assert.match(result.text, /^### 保留人工分類\n\n/);
    assert.match(result.text, /\[output:: 1\]\n- \*\*生產設備/);
    assert.equal(result.diagnostics.length, 2);
    assert.equal(normalizeMachineRecipeSections(result.text, { rules: [] }).text, result.text);
});

test("provider resolution only fills absent provider and yields stable normalization", () => {
    const source = "### 常規\n\n" + route("MC/熔爐");
    let resolutions = 0;
    const options = { rules, resolveProvider: () => { resolutions++; return "Minecraft 原版"; } };
    const result = normalizeMachineRecipeSections(source, options).text;
    assert.match(result, /^### 熔煉配方\n\n##### Minecraft 原版\n\n/);
    assert.equal(resolutions, 1);
    assert.equal(normalizeMachineRecipeSections(result, options).text, result);
    assert.equal(resolutions, 1);
});
