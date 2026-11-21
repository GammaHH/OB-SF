const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const reader = require("../../BIO相關模組/搜尋介面模塊/bio_reader_v4");
const vanilla = require("../../BIO相關模組/MC解析器模塊");

test("route output defaults to one and ignores legacy YAML output", () => {
    const body = "### 常規\n- (Machine:: [[工作台]])\n- [item:: [[材料]]] (qty:: 1)\n";
    assert.equal(reader.parseBIO(body, { output: 64 }).recipes[0].output, 1);
    assert.equal(reader.parseBIO(body + "- [output:: 9]\n", { output: 64 }).recipes[0].output, 9);
});

function select(parsed, routes = new Map(), ingredients = new Map()) {
    return reader.chooseRecipe("item.md", reader.allowedRecipes(parsed, new Set(["常規", "合成配方", "外部取得"])), routes, ingredients);
}

test('Tag representative cycle fallback is owner-scoped and preserves the full legal collection', () => {
    const parsed = reader.parseBIO('### Tag 代表材料\n<!-- preferred -->\n- [item:: [[白色束口袋]]]\n- [item:: [[束口袋]]]\n- [item:: [[紅色束口袋]]]\n', { minecraft_tag: 'minecraft:bundles', tag_identity: 'minecraft:item_tag' });
    const ingredientChoices = new Map(), key = reader.ingredientKey('各色束口袋.md', parsed.recipes[0].key, 0);
    ingredientChoices.set(key, '白色束口袋');
    const choose = owner => reader.chooseRecipe('各色束口袋.md', parsed.recipes, new Map(), ingredientChoices,
        { isChoiceAllowed: choice => choice.name !== owner });
    const white = choose('白色束口袋');
    assert.equal(white.ingredients[0].name, '束口袋');
    assert.deepEqual(white.ingredients[0].cycleFallback, { from: '白色束口袋', to: '束口袋' });
    assert.equal(choose('紅色束口袋').ingredients[0].name, '白色束口袋');
    assert.equal(ingredientChoices.get(key), '白色束口袋');
    assert.equal(parsed.recipes[0].ingredients[0].choices.length, 3);
    assert.equal(reader.chooseRecipe('各色束口袋.md', parsed.recipes, new Map(), ingredientChoices, { isChoiceAllowed: () => false }), null);
});

test('V4 recognizes an mc-tag collection by type alone', () => {
    const parsed = reader.parseBIO("### Tag 代表材料\n- [item:: [[杉木材]]]\n<!-- preferred -->\n- [item:: [[橡木材]]]\n",
        { type: "mc-tag", id: "ANY_PLANKS" });
    const selected = select(parsed);
    assert.equal(selected.tagRepresentative, true);
    assert.equal(selected.ingredients[0].name, "橡木材");
    assert.equal(selected.ingredients[0].choices.length, 2);
});

test('shared collections can recur after concrete progress but item cycles and Tag-only loops remain blocked', () => {
    const tags = new Set(['各色界伏盒.md', '另一集合.md']);
    const collection = path => tags.has(path);
    assert.equal(reader.dependencyWouldCycle('各色界伏盒.md', ['棕色界伏盒.md', '各色界伏盒.md', '白色界伏盒.md'], collection), false);
    assert.equal(reader.dependencyWouldCycle('棕色界伏盒.md', ['棕色界伏盒.md', '各色界伏盒.md', '白色界伏盒.md'], collection), true);
    assert.equal(reader.dependencyWouldCycle('各色界伏盒.md', ['各色界伏盒.md', '另一集合.md'], collection), true);
    assert.equal(reader.dependencyWouldCycle('各色界伏盒.md', ['各色界伏盒.md'], collection), true);
    assert.equal(reader.dependencyWouldCycle('全新材料.md', ['棕色界伏盒.md'], collection), false);
});

test('cycle fallback policy does not silently filter ordinary exact alternatives', () => {
    const parsed = reader.parseBIO('### 常規\n- (Machine:: 工作台)\n- **擇一材料** (qty:: 2)\n\t- [item:: A]\n\t- [item:: B]\n- [output:: 1]\n');
    const selected = reader.chooseRecipe('owner.md', parsed.recipes, new Map(), new Map(), { isChoiceAllowed: () => false });
    assert.equal(selected.ingredients[0].name, 'A');
    assert.equal(selected.ingredients[0].qty, 2);
    assert.equal(selected.ingredients[0].choices.length, 2);
});

test("multiple preferred routes follow document order after section and provider filtering", () => {
    const source = (provider, section, machine, preferred = true) =>
        "### " + section + "\n##### " + provider + "\n" + (preferred ? "<!-- preferred -->\n" : "") +
        "- (Machine:: [[" + machine + "]])\n\t- [item:: [[材料]]] (qty:: 1)\n\t- [output:: 1]\n";
    const parsed = reader.parseBIO(source("Slimefun 原版", "合成配方", "冶煉爐") +
        source("Minecraft 原版", "合成配方", "工作台") + source("Minecraft 原版", "常規", "後備", false));
    assert.deepEqual(parsed.diagnostics, []);
    const choices = new Map();
    const ingredients = new Map();
    const choose = folders => reader.chooseRecipe("item.md", reader.allowedRecipes(parsed,
        new Set(["合成配方", "常規"]), route => reader.providerAllowed(route.provider, folders)), choices, ingredients);
    assert.equal(choose(new Set(["MC-物品資料庫", "SF-基礎機器(原版)"])).machine, "冶煉爐");
    assert.equal(choose(new Set(["MC-物品資料庫"])).machine, "工作台");
    assert.equal(choose(new Set(["MC-物品資料庫", "SF-基礎機器(原版)"])).machine, "冶煉爐");
    assert.equal(choices.size, 0, "automatic fallback must not become a manual override");
    const fallback = reader.allowedRecipes(parsed, new Set(["常規"]), route => reader.providerAllowed(route.provider, new Set(["MC-物品資料庫"])));
    assert.equal(reader.chooseRecipe("item.md", fallback, choices, ingredients).machine, "後備");
    assert.equal(choose(new Set()), null);
    assert.equal(reader.allowedRecipes(parsed, new Set()).length, 0, "preferred must not bypass allowed sections");
    choices.set("item.md", parsed.recipes[1].key);
    assert.equal(choose(new Set(["MC-物品資料庫", "SF-基礎機器(原版)"])).machine, "工作台");
});

test("unmarked routes retain document order and external acquisition obeys its section filter", () => {
    const parsed = reader.parseBIO("### 外部取得\n<!-- preferred -->\n- 採集：自行取得\n" +
        "### 合成配方\n- (Machine:: 工作台)\n- [item:: 材料] (qty:: 1)\n" +
        "### 常規\n- (Machine:: 後備)\n- [item:: 材料] (qty:: 1)");
    const allowed = reader.allowedRecipes(parsed, new Set(["常規", "合成配方"]));
    assert.equal(reader.chooseRecipe("x", allowed, new Map(), new Map()).machine, "工作台");
    assert.equal(reader.allowedRecipes(parsed, new Set()).length, 0);
});

test("multiple preferred Tag members form ordered candidates without a warning", () => {
    const parsed = reader.parseBIO("### Tag 代表材料\n<!-- preferred -->\n- [item:: [[橡木原木]]]\n" +
        "<!-- preferred -->\n- [item:: [[橡木塊]]]", { tag_identity: "minecraft:item_tag" });
    assert.deepEqual(parsed.diagnostics, []);
    assert.equal(select(parsed).ingredients[0].name, "橡木原木");
});

test("compact route labels group by provider and retain differing output information", () => {
    const parsed = reader.parseBIO("### 熔煉配方\n##### Minecraft 原版\n" +
        "- (Machine:: 高爐)\n- [item:: [[紅石礦]]] (qty:: 1)\n- [output:: 1]\n" +
        "- (Machine:: 高爐)\n- [item:: [[紅石礦]]] (qty:: 1)\n- [output:: 2]");
    const values = reader.recipeMenuOptions(parsed.recipes);
    assert.ok(values.every(value => value.group === "Minecraft 原版"));
    assert.ok(values.every(value => !/Minecraft 原版|熔煉配方/.test(value.label)));
    assert.match(values[0].label, /高爐.*紅石礦.*產量 1\/批/);
    assert.match(values[1].label, /高爐.*紅石礦.*產量 2\/批/);
    assert.deepEqual(values.map(value => value.value), parsed.recipes.map(recipe => recipe.key));
    const note = reader.parseBIO("### 常規\n- (Machine:: 工作台)\n- [item:: 材料] (qty:: 1)\n" +
        "- [note:: 烹調時間（原始 ticks）：200]\n- [note:: 經驗值：0.7]");
    assert.deepEqual(note.recipes[0].notes, ["處理時間 200 ticks", "經驗值 0.7"]);
    assert.equal(reader.formatRecipeNote("效果：抗火；持續時間（原始 ticks）：60"), "效果：抗火；持續時間 60 ticks");
    assert.equal(reader.formatRecipeNote("效果：抗火；持續時間 60 ticks"), "效果：抗火；持續時間 60 ticks");
});

test("V4 reads external source text and moving preferred switches back to crafting", () => {
    const text = [
        "### 外部取得", "<!-- preferred -->", "- 採集：砍伐橡木",
        "### 合成配方", "- **生產設備**：(Machine:: [[鋸木機]])",
        "\t- [item:: [[橡木原木]]] (qty:: 1)", "\t- [output:: 8]"
    ].join("\n");
    const parsed = reader.parseBIO(text, { base_material: true });
    assert.equal(parsed.recipes.length, 2);
    assert.equal(select(parsed).description, "砍伐橡木");
    assert.equal(select(parsed).category, "採集");
    const moved = text.replace("<!-- preferred -->\n", "")
        .replace("- **生產設備**", "<!-- preferred -->\n- **生產設備**");
    const selected = select(reader.parseBIO(moved, { base_material: true }));
    assert.equal(selected.machine, "鋸木機");
    assert.equal(selected.output, 8);
});

test("V4 preserves legacy Base YAML and old machine/qty/output fields", () => {
    const parsed = reader.parseBIO([
        "### 常規",
        "- **生產設備**：(Machine:: 強化工作台)",
        "\t- [drop:: [[基礎電路板]]] (qty:: 0.5)",
        "\t- [output:: 2]"
    ].join("\n"), { base_material: true });
    assert.equal(select(parsed).external, true);
    const routes = new Map([["item.md", parsed.recipes.find(route => !route.external).key]]);
    const selected = select(parsed, routes);
    assert.equal(selected.ingredients[0].type, "drop");
    assert.equal(selected.ingredients[0].qty, 0.5);
    assert.equal(selected.output, 2);
});

test("multi-block BIOs retain materials and attach assembly notes to a manual route", () => {
    for (const filename of ["磨石.md", "進階工作台.md"]) {
        const text = fs.readFileSync(path.resolve(__dirname, "../../SF-基礎機器(原版)", filename), "utf8");
        const selected = select(reader.parseBIO(text, { output: 1 }));
        assert.equal(reader.isManualMachine(selected.machine), true);
        assert.equal(selected.preferred, true);
        assert.equal(selected.output, 1);
        assert.equal(selected.ingredients.length, 2);
        assert.match(selected.notes[0], /多方塊結構/);
    }
    const source = select(reader.parseBIO(
        "### 外部取得\n<!-- preferred -->\n- [note:: 採集：砍伐橡木]"
    ));
    assert.equal(source.description, "砍伐橡木");
    assert.equal(source.sourceText, "採集：砍伐橡木");
});

test("V4 picks one legacy alternative and preserves the group quantity", () => {
    const parsed = reader.parseBIO([
        "### 常規", "- (Machine:: [[工作台]])",
        "\t- **擇一材料** (qty:: 2)",
        "\t\t- [item:: [[煤炭]]]", "\t\t- [item:: [[木炭]]]",
        "\t- [item:: [[木棒]]] (qty:: 1)", "\t- [output:: 4]"
    ].join("\n"));
    const choices = new Map();
    const selected = select(parsed, new Map(), choices);
    assert.equal(selected.ingredients.length, 2);
    assert.equal(selected.ingredients[0].name, "煤炭");
    choices.set(selected.ingredients[0].selectionKey, "木炭");
    const changed = select(parsed, new Map(), choices);
    assert.equal(changed.ingredients[0].name, "木炭");
    assert.equal(changed.ingredients[0].qty, 2);
});

test("V4 reads qty-free Tag member rows and moving preferred changes the representative", () => {
    const model = {
        kind: "minecraft:item_tag", tagId: "minecraft:oak_logs", bioId: "OAK_LOGS",
        aliases: ["OAK_LOGS"], values: ["minecraft:oak_log", "minecraft:oak_wood"],
        representativeItemId: "minecraft:oak_log"
    };
    const markdown = vanilla.bio.renderTagBIOPreview(model);
    const parsed = reader.parseBIO(markdown, { tag_identity: "minecraft:item_tag" });
    const choices = new Map();
    const selected = select(parsed, new Map(), choices);
    assert.equal(selected.tagRepresentative, true);
    assert.equal(selected.ingredients[0].choices.length, 2);
    assert.equal(selected.ingredients[0].name, "oak log");
    choices.set(selected.ingredients[0].selectionKey, "oak wood");
    assert.equal(select(parsed, new Map(), choices).ingredients[0].name, "oak wood");
    const moved = markdown.replace("<!-- preferred -->\n", "")
        .replace("- [item:: [[oak wood]]]", "<!-- preferred -->\n- [item:: [[oak wood]]]");
    assert.equal(select(reader.parseBIO(moved, { tag_identity: "minecraft:item_tag" })).ingredients[0].name, "oak wood");
    assert.equal(reader.parseBIO(markdown).recipes.length, 0);
});

test("V4 still reads legacy Tag tables and their separate representative row", () => {
    const markdown = [
        "| Minecraft Item ID | BIO |", "|---|---|",
        "| `minecraft:oak_log` | [[橡木原木]] |",
        "| `minecraft:oak_wood` | [[橡木塊]] |",
        "### Tag 代表材料", "- [item:: [[橡木原木]]]"
    ].join("\n");
    const selected = select(reader.parseBIO(markdown, { tag_identity: "minecraft:item_tag" }));
    assert.equal(selected.ingredients[0].name, "橡木原木");
    assert.equal(selected.ingredients[0].choices.length, 2);
});

test("V4 consumes Generator material choices without reading raw recipes or decision registry", () => {
    const id = "minecraft:oak_planks";
    const sourceRoot = path.resolve(__dirname, "../../參考資料/Minecraft");
    const pipeline = vanilla.createVanillaPipeline({
        recipeEntries: [{
            json: JSON.parse(fs.readFileSync(path.join(sourceRoot, "recipe/oak_planks.json"), "utf8")),
            sourceFile: "recipe/oak_planks.json"
        }],
        tagEntries: [{
            tagId: "minecraft:oak_logs", registryType: "item",
            json: JSON.parse(fs.readFileSync(path.join(sourceRoot, "tags/item/oak_logs.json"), "utf8")),
            sourceFile: "tags/item/oak_logs.json"
        }]
    });
    const model = vanilla.bio.createBIOGenerationModel(id, { itemRegistry: pipeline.itemRegistry });
    model.recipes[0].ingredients[0].values.reverse();
    const markdown = vanilla.bio.renderBIOPreview(model, {
        tagMappings: new Map([["minecraft:oak_logs", { zhName: "任意橡木原木", representativeItemId: "minecraft:oak_log" }]])
    });
    const selected = select(reader.parseBIO(markdown));
    assert.equal(selected.output, 4);
    // No Tag BIO was supplied: the generator writes visible alternatives,
    // with the reviewed representative first, rather than obsf:choices metadata.
    assert.match(markdown, /\*\*擇一材料\*\*/);
    assert.doesNotMatch(markdown, /<!-- obsf:choices /);
    assert.deepEqual(selected.ingredients[0].choices.map(choice => choice.name).sort(), [
        "oak log", "oak wood", "stripped oak log", "stripped oak wood"
    ]);
    assert.equal(selected.ingredients[0].name, "oak log");
    assert.equal(selected.ingredients[0].qty, 1);
});

test("V4 keeps component-dependent stew routes distinct and labels their effects", () => {
    const markdown = [
        "### 合成配方",
        "- (Machine:: [[工作台]])", "\t- [item:: [[紫紅球花]]] (qty:: 1)", "\t- [output:: 1]",
        "```json", '{"minecraft:suspicious_stew_effects":[{"id":"minecraft:fire_resistance","duration":60}]}', "```",
        "- (Machine:: [[工作台]])", "\t- [item:: [[罌粟]]] (qty:: 1)", "\t- [output:: 1]",
        "```json", '{"minecraft:suspicious_stew_effects":[{"id":"minecraft:night_vision","duration":100}]}', "```"
    ].join("\n");
    const parsed = reader.parseBIO(markdown);
    assert.equal(parsed.recipes.length, 2);
    assert.notEqual(parsed.recipes[0].key, parsed.recipes[1].key);
    assert.match(reader.recipeLabel(parsed.recipes[1]), /night_vision 100 ticks/);
});

test("NOTE-only effects keep identical-material routes independently selectable and visibly distinct", () => {
    const route = effect => "- (Machine:: [[工作台]])\n\t- [item:: [[花]]] (qty:: 1)\n" +
        "\t- [output:: 1]\n\t- [note:: " + effect + "]\n";
    const fire = "效果：抗火；持續時間 60 ticks";
    const vision = "效果：夜視；持續時間 100 ticks";
    const first = reader.parseBIO("### 合成配方\n" + route(fire) + route(vision));
    const reversed = reader.parseBIO("### 合成配方\n" + route(vision) + route(fire));
    assert.deepEqual(first.diagnostics, []);
    assert.equal(first.recipes.length, 2);
    assert.equal(first.recipes[0].components, undefined);
    assert.notEqual(first.recipes[0].key, first.recipes[1].key);
    assert.equal(first.recipes[0].key, reversed.recipes[1].key, "effect identity must survive route reordering");
    assert.equal(first.recipes[1].key, reversed.recipes[0].key);
    const options = reader.recipeMenuOptions(first.recipes);
    assert.match(options[0].label, /抗火；持續時間 60 ticks/);
    assert.match(options[1].label, /夜視；持續時間 100 ticks/);
    const other = reader.parseBIO("### 合成配方\n" + route("成品資訊（example:variant）：special"));
    assert.match(reader.recipeLabel(other.recipes[0]), /成品資訊（example:variant）：special/);
});

test("V4 diagnoses malformed choice metadata and excludes the affected recipe", () => {
    const parsed = reader.parseBIO([
        "### 常規", "- (Machine:: [[工作台]])",
        '<!-- obsf:choices {"choices":[]} -->', "\t- [item:: [[未知]]] (qty:: 1)"
    ].join("\n"));
    assert.equal(parsed.recipes.length, 0);
    assert.equal(parsed.diagnostics[0].code, "INVALID_CHOICES");
});

function exceptSelfFixture() {
    const white = page("白色羊毛", { minecraft_id: "minecraft:white_wool" });
    const black = page("黑色羊毛", { minecraft_id: "minecraft:black_wool" });
    const group = page("任意羊毛", { derived_group: "obsf:color_family/wool", tag_identity: "obsf:derived_ingredient_group" });
    const aliases = new Map();
    for (const value of [white, black, group]) for (const key of [value.file.path, value.file.path.replace(/\.md$/, ""), value.file.name]) aliases.set(key, value);
    aliases.set("WHITE_ALIAS", white);
    const groupText = "### Tag 代表材料\n<!-- preferred -->\n- [item:: [[WHITE_ALIAS]]]\n- [item:: [[MC/黑色羊毛|黑羊毛]]]\n";
    const rawGroup = reader.parseBIO(groupText, group);
    const body = "### 合成配方\n<!-- preferred -->\n- (Machine:: [[工作台]])\n" +
        "<!-- except self -->\n- [item:: [[黑色羊毛|任意羊毛]]] (qty:: 3)\n- [output:: 2]\n";
    const raw = reader.parseBIO(body);
    const options = owner => ({ owner, resolvePage: name => aliases.get(name),
        resolveCollection: id => id === group.derived_group ? group : null, parsePage: () => rawGroup });
    return { white, black, group, aliases, rawGroup, raw, body, options };
}

test("except self derives the color group from canonical owner identity rather than its display name", () => {
    assert.equal(reader.inferExceptSelfGroupId({ id: "LIGHT_BLUE_HARNESS" }), "obsf:color_family/harness");
    assert.equal(reader.inferExceptSelfGroupId({ minecraft_id: "minecraft:white_wool", id: "BLACK_HARNESS" }), "obsf:color_family/wool");
    assert.equal(reader.inferExceptSelfGroupId({ id: "白色羊毛" }), null);
    assert.equal(reader.inferExceptSelfGroupId({ id: "IRON_INGOT" }), null);
});

test("except self filters a shared collection per owner and retains the legal original representative", async () => {
    const value = exceptSelfFixture();
    const before = JSON.stringify([value.raw, value.rawGroup]);
    assert.equal(value.raw.recipes[0].ingredients[0].excludeSelf, true);
    const white = await reader.resolveRecipeExclusions(value.raw, value.options(value.white));
    const black = await reader.resolveRecipeExclusions(value.raw, value.options(value.black));
    assert.deepEqual(white.diagnostics, []);
    assert.deepEqual(black.diagnostics, []);
    assert.equal(select(white).ingredients[0].name, "MC/黑色羊毛");
    assert.equal(select(black).ingredients[0].name, "MC/白色羊毛");
    assert.equal(select(white).ingredients[0].qty, 3);
    assert.equal(select(black).ingredients[0].qty, 3);
    assert.equal(JSON.stringify([value.raw, value.rawGroup]), before, "owner filtering must not mutate shared cached parses");
    const ingredient = white.recipes[0].ingredients[0];
    const manual = new Map([[reader.ingredientKey(value.white.file.path, white.recipes[0].key, 0), "MC/白色羊毛"]]);
    const chosen = reader.chooseRecipe(value.white.file.path, white.recipes, new Map(), manual);
    assert.equal(chosen.ingredients[0].name, "MC/黑色羊毛", "an excluded stale manual choice must not be selected");
    assert.equal(ingredient.choices.length, 1);
});

test("except self uses original representative before collection preference and preserves missing BIO candidates", async () => {
    const value = exceptSelfFixture();
    const blue = page("藍色羊毛", { minecraft_id: "minecraft:blue_wool" });
    value.aliases.set("藍色羊毛", blue);
    const rawGroup = reader.parseBIO("### Tag 代表材料\n<!-- preferred -->\n- [item:: [[藍色羊毛]]]\n" +
        "- [item:: [[黑色羊毛]]]\n- [item:: [[尚未建立的黃色羊毛]]]\n", value.group);
    const parsed = await reader.resolveRecipeExclusions(value.raw, { ...value.options(value.white), parsePage: () => rawGroup });
    assert.equal(select(parsed).ingredients[0].name, "MC/黑色羊毛", "do not replace the previously selected representative with group preference");
    assert.ok(parsed.recipes[0].ingredients[0].choices.some(choice => choice.name === "尚未建立的黃色羊毛"));
});

test("except self stops on unknown owner, unavailable collection, wrong-family member or empty legal set", async () => {
    const value = exceptSelfFixture();
    const onlySelf = reader.parseBIO("### Tag 代表材料\n<!-- preferred -->\n- [item:: [[WHITE_ALIAS]]]\n", value.group);
    const iron = page("鐵錠", { minecraft_id: "minecraft:iron_ingot" });
    value.aliases.set("鐵錠", iron);
    const mixed = reader.parseBIO("### Tag 代表材料\n- [item:: [[鐵錠]]]\n", value.group);
    for (const options of [
        { ...value.options({ file: value.white.file }), resolveCollection: () => value.group },
        { ...value.options(value.white), resolveCollection: () => null },
        { ...value.options(value.white), parsePage: () => onlySelf },
        { ...value.options(value.white), parsePage: () => mixed }
    ]) {
        const result = await reader.resolveRecipeExclusions(value.raw, options);
        assert.equal(result.recipes.length, 0);
        assert.equal(result.exclusionFailures, true);
        assert.ok(result.diagnostics.some(diagnostic => diagnostic.code.startsWith("EXCEPT_SELF_")));
    }
});

test("except self remains compatible with inline choices and multiplies quantities only once", async () => {
    const value = exceptSelfFixture();
    const choices = { choices: [{ name: "WHITE_ALIAS", qty: 2 }, { name: "黑色羊毛", qty: 2 }], defaultName: "WHITE_ALIAS" };
    const raw = reader.parseBIO(value.body.replace("<!-- except self -->", "<!-- obsf:choices " + JSON.stringify(choices) + " -->\n<!-- except self -->"));
    const result = await reader.resolveRecipeExclusions(raw, { ...value.options(value.white), resolveCollection: () => { throw new Error("inline choices need no collection lookup"); } });
    assert.equal(select(result).ingredients[0].qty, 6);
    assert.equal(select(result).ingredients[0].name, "MC/黑色羊毛");
});

test("dangling except self markers cannot leak across headings, machines, notes or end of file", () => {
    const base = "### 合成配方\n- (Machine:: 工作台)\n- [item:: [[材料]]] (qty:: 1)\n<!-- except self -->\n";
    for (const boundary of ["### 外部取得\n- 採集：測試", "- (Machine:: 高爐)\n- [item:: [[材料2]]] (qty:: 1)", "- [note:: 備註]", ""]) {
        const result = reader.parseBIO(base + boundary);
        assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "EXCEPT_SELF_DANGLING"));
        assert.ok(result.recipes.every(route => route.ingredients.every(ingredient => !ingredient.excludeSelf)));
    }
    const sample = reader.parseBIO("### 合成配方\n<!-- 說明\n<!-- except self -->\n-->\n- (Machine:: 工作台)\n- [item:: [[材料]]] (qty:: 1)");
    assert.equal(sample.recipes[0].ingredients[0].excludeSelf, undefined);
});

// Minimal DOM/vault adapters exercise the actual DataviewJS entry point in Node.
class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.listeners = {}; this.value = ""; this.textContent = ""; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(event, handler) { this.listeners[event] = handler; }
    set innerHTML(value) { this.children = []; }
}

async function loadView(files, pages) {
    const vaultRoot = path.resolve(__dirname, "../..");
    const page = fs.readFileSync(path.join(vaultRoot, "黏液科技DB 搜尋介面V4.md"), "utf8");
    const code = page.match(/```dataviewjs\r?\n([\s\S]*?)\r?\n```/)[1];
    const notices = [];
    const exportCalls = [];
    const templater = {
        create_running_config: (template_file, target_file, run_mode) => ({ template_file, target_file, run_mode }),
        read_and_parse_template: async config => { exportCalls.push(config); return ""; }
    };
    const app = {
        vault: {
            getName: () => "test",
            getMarkdownFiles: () => [...files.keys()].map(value => ({
                path: value, basename: path.posix.basename(value, ".md")
            })),
            adapter: { read: async relative => fs.readFileSync(path.join(vaultRoot, relative), "utf8") },
            getAbstractFileByPath: value => files.has(value) ||
                ["模板放置處/V4-輸出製作報告.md", "黏液科技DB 搜尋介面V4.md"].includes(value)
                ? { path: value } : null,
            read: async file => files.get(file.path)
        },
        metadataCache: { getFileCache: file => ({ headings: [...String(files.get(file.path) || "").matchAll(/^###\s+(.+)$/gm)]
            .map(match => ({ level: 3, heading: match[1].trim() })) }) },
        commands: { executeCommandById: () => true },
        plugins: { getPlugin: id => id === "templater-obsidian" ? { templater } : null }
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const run = new AsyncFunction("app", "dv", "document", "localStorage", "Notice", "navigator", "require",
        code + "\nreturn { analyzePage, currentTree: () => currentTree, recipeChoices, ingredientChoices, leafTotals, parseCache, resolvedParseCache, buildBioIndex, resolveBio, resolveExceptSelfCollection, buildPlainTextReport, recalculateCurrentAnalysis, analysisContainer, targetQtyInput, limitInputs, latestReport: () => latestReport, reloadButton, reloadStatus, bioPages: () => bioPages, recipeSections: () => recipeSections, selectedFolders: () => selectedFolders, selectedRecipeSections: () => selectedRecipeSections }; ");
    const view = await run(app, {
        pages: () => ({ array: () => pages }),
        el: tag => new Element(tag)
    }, {
        createElement: tag => new Element(tag),
        createTextNode: text => ({ textContent: text })
    }, { getItem: () => null, setItem: () => {} }, function (message) { notices.push(message); }, {},
    name => {
        assert.equal(name, "obsidian");
        // JSON is a YAML subset; fixtures isolate refresh behavior from YAML parsing.
        return { parseYaml: JSON.parse };
    });
    return { view, notices, exportCalls };
}

function page(name, properties = {}) {
    return { type: "mc-item", id: name, ...properties, file: { path: "MC/" + name + ".md", name, folder: "MC" } };
}

test('V4 produces the same Preferred and tree with or without a decision registry in the vault fixture', async () => {
    const target = page('登錄庫獨立測試');
    const files = new Map([[target.file.path,
        '### 外部取得\n<!-- preferred -->\n- 採集：森林\n- 交易：村民']]);
    files.set('BIO Review Decisions.json', '{ deliberately unreadable registry }');
    const first = await loadView(files, [target]);
    await first.view.analyzePage(target);
    files.delete('BIO Review Decisions.json');
    const second = await loadView(files, [target]);
    await second.view.analyzePage(target);
    assert.deepEqual(second.view.latestReport().tree, first.view.latestReport().tree);
    assert.equal(second.view.currentTree().acquisition, '採集：森林');
    assert.deepEqual(second.notices, []);
});

function savedBio(metadata, body) {
    return "---\n" + JSON.stringify(metadata) + "\n---\n" + body;
}

test("RELOAD bypasses stale Dataview metadata, repairs equipment cycles and discovers new BIOs", async () => {
    const target = page("終界水晶");
    const table = page("工作台");
    const targetBody = "### 合成配方\n- (Machine:: [[工作台]])\n- [item:: [[木材]]] (qty:: 1)";
    const files = new Map([
        [target.file.path, savedBio(target, targetBody)],
        [table.file.path, savedBio(table, "### 合成配方\n- (Machine:: [[工作台]])\n- [item:: [[木材]]] (qty:: 4)")]
    ]);
    const { view } = await loadView(files, [target, table]);
    await view.analyzePage(target);
    assert.ok(view.latestReport().warnings.some(warning => /設備建造遇到循環/.test(warning)));
    const wood = page("新木材", { aliases: ["木材"] });
    files.set(wood.file.path, savedBio(wood, "### 外部取得\n- 採集：森林"));
    files.set(table.file.path, savedBio(table,
        "### 手動製作\n- (Machine:: 無/手動)\n- [item:: [[木材]]] (qty:: 4)"));
    view.targetQtyInput.value = "3";
    await view.analyzePage(target);
    await view.reloadButton.listeners.click();
    assert.match(view.reloadStatus.textContent, /已重讀 3 個 BIO/);
    assert.match(view.reloadStatus.textContent, /目前目標已重算/);
    assert.equal(view.reloadButton.disabled, false);
    assert.ok(view.bioPages().some(value => value.file.path === wood.file.path));
    assert.ok(view.recipeSections().includes("手動製作"));
    assert.ok(view.selectedRecipeSections().has("手動製作"));
    assert.equal(view.currentTree().required, 3);
    assert.equal(view.latestReport().warnings.some(warning => /設備建造遇到循環/.test(warning)), false);
    const equipment = view.latestReport().equipmentSteps.find(step => step.name === "工作台");
    assert.ok(equipment);
    assert.equal(equipment.materials[0].name, "新木材");
});

test("equipment cycles identify the intervening Tag and the material recipe requiring the machine", async () => {
    const target = page("終界水晶");
    const table = page("工作台");
    const group = page("任意木材", { type: "mc-tag" });
    const planks = page("橡木材");
    const log = page("橡木原木");
    const files = new Map([
        [target.file.path, "### 合成配方\n- (Machine:: [[工作台]])\n- [item:: [[橡木原木]]] (qty:: 1)"],
        [table.file.path, "### 合成配方\n- (Machine:: 無/手動)\n- [item:: [[任意木材]]] (qty:: 4)"],
        [group.file.path, "### Tag 代表材料\n- [item:: [[橡木材]]]"],
        [planks.file.path, "### 合成配方\n- (Machine:: [[工作台]])\n- [item:: [[橡木原木]]] (qty:: 1)\n- [output:: 4]"],
        [log.file.path, "### 外部取得\n- 採集：森林"]
    ]);
    const { view } = await loadView(files, [target, table, group, planks, log]);
    await view.analyzePage(target);
    const warning = view.latestReport().warnings.find(value => value.startsWith("設備建造遇到循環："));
    assert.equal(warning, "設備建造遇到循環：MC/工作台.md → MC/任意木材.md → MC/橡木材.md → MC/工作台.md（請檢查 MC/橡木材.md 的生產設備設定）");
    assert.ok(view.latestReport().assessment.cycles.includes(warning));
    files.set(planks.file.path, files.get(planks.file.path).replace("(Machine:: [[工作台]])", "(Machine:: 無/手動)"));
    await view.recalculateCurrentAnalysis();
    assert.deepEqual(view.latestReport().assessment.cycles, []);
});

test("RELOAD invalidates the tree and export when the selected BIO is deleted", async () => {
    const target = page("已刪除目標");
    const files = new Map([[target.file.path, savedBio(target, "### 外部取得\n- 採集：測試")]]);
    const { view } = await loadView(files, [target]);
    await view.analyzePage(target);
    files.delete(target.file.path);
    await view.reloadButton.listeners.click();
    assert.equal(view.currentTree(), null);
    assert.equal(view.latestReport(), null);
    assert.match(view.reloadStatus.textContent, /原目標已刪除/);
    assert.equal(view.analysisContainer.children.length, 0);
});

test("RELOAD reports invalid YAML and removes the stale report", async () => {
    const target = page("YAML錯誤");
    const files = new Map([[target.file.path, savedBio(target, "### 外部取得\n- 採集：測試")]]);
    const { view } = await loadView(files, [target]);
    await view.analyzePage(target);
    files.set(target.file.path, "---\n{ broken\n---\n");
    await view.reloadButton.listeners.click();
    assert.equal(view.latestReport(), null);
    assert.equal(view.currentTree(), null);
    assert.match(view.reloadStatus.textContent, /RELOAD 失敗.*YAML 讀取失敗/);
    assert.equal(view.reloadButton.disabled, false);
});

function findSelect(element) {
    if (element.tag === "select") return element;
    for (const child of element.children || []) {
        const found = findSelect(child);
        if (found) return found;
    }
}

function findButton(element, caption) {
    if (element.tag === "button" && element.textContent === caption) return element;
    for (const child of element.children || []) {
        const found = findButton(child, caption);
        if (found) return found;
    }
}

test("actual V4 shows an orange note and retains quantity when all provider routes are excluded", async () => {
    const target = page("範圍測試");
    const files = new Map([[target.file.path, "### 合成配方\n##### Slimefun 原版\n<!-- preferred -->\n" +
        "- (Machine:: 冶煉爐)\n- [item:: [[材料]]] (qty:: 1)\n- [output:: 1]"]]);
    const { view } = await loadView(files, [target]);
    await view.analyzePage(target);
    const tree = view.currentTree();
    assert.equal(tree.unavailable, true);
    assert.equal(tree.leaf, true);
    assert.equal(view.leafTotals.get(target.file.path).qty, 1);
    const elements = [];
    const visit = element => { elements.push(element); for (const child of element.children || []) visit(child); };
    visit(view.analysisContainer);
    assert.ok(elements.some(element => element.style?.color === "#e69532" && /沒有可用配方/.test(element.textContent)));
    assert.equal(view.latestReport().complete, false);
    assert.equal(view.latestReport().assessment.analysisTruncated, false);
    assert.ok(view.latestReport().problems.some(problem => problem.kind === "NO_ALLOWED_RECIPE"));
});

test("actual V4 except self keeps the representative link, filters the material dropdown and scales batches", async () => {
    const value = exceptSelfFixture();
    const files = new Map([[value.white.file.path, value.body], [value.black.file.path, "### 外部取得\n- 採集：黑色羊毛"],
        [value.group.file.path, "### Tag 代表材料\n<!-- preferred -->\n- [item:: [[白色羊毛]]]\n- [item:: [[黑色羊毛]]]"]]);
    const { view, notices } = await loadView(files, [value.white, value.black, value.group]);
    view.targetQtyInput.value = "5";
    await view.analyzePage(value.white);
    assert.deepEqual(notices, []);
    assert.equal(view.currentTree().children[0].name, "黑色羊毛");
    assert.equal(view.leafTotals.get(value.black.file.path).qty, 9);
    assert.equal(view.parseCache.get(value.white.file.path).recipes[0].ingredients[0].name, "黑色羊毛");
    const choices = view.resolvedParseCache.get(value.white.file.path).recipes[0].ingredients[0].choices;
    assert.deepEqual(choices.map(choice => choice.name), ["MC/黑色羊毛"]);
    view.ingredientChoices.set(reader.ingredientKey(value.white.file.path,
        view.parseCache.get(value.white.file.path).recipes[0].key, 0), "MC/白色羊毛");
    await view.recalculateCurrentAnalysis();
    assert.equal(view.currentTree().children[0].name, "黑色羊毛");
    assert.equal(view.leafTotals.get(value.black.file.path).qty, 9);
});

test("V4 collection selection isolates preview batches and rejects ambiguous formal identities", async () => {
    const value = exceptSelfFixture();
    const owner = { ...value.white, file: { ...value.white.file, path: "MC/preview/batch-a/white.preview.md", folder: "MC/preview/batch-a" } };
    const collection = path => ({ ...value.group, file: { ...value.group.file, path, folder: path.replace(/\/[^/]+$/, "") } });
    const local = collection("MC/preview/batch-a/group.preview.md");
    const foreign = collection("MC/preview/batch-b/group.preview.md");
    const formal = collection("MC/任意羊毛.md");
    const { view } = await loadView(new Map(), []);
    const choose = pages => view.resolveExceptSelfCollection("obsf:color_family/wool", owner, view.buildBioIndex(pages));
    assert.equal(choose([foreign]), null);
    assert.equal(choose([local, foreign, formal]), local);
    assert.equal(choose([foreign, formal]), formal);
    assert.equal(choose([local, collection("MC/preview/batch-a/duplicate.preview.md")]), null);
    assert.equal(choose([formal, collection("MC/其他/羊毛.md")]), null);
});

test("actual V4 preserves demand and orange warning when except self cannot resolve its collection", async () => {
    const value = exceptSelfFixture();
    const { view, notices } = await loadView(new Map([[value.white.file.path, value.body]]), [value.white]);
    view.targetQtyInput.value = "4";
    await view.analyzePage(value.white);
    assert.deepEqual(notices, []);
    assert.equal(view.currentTree().unavailable, true);
    assert.equal(view.leafTotals.get(value.white.file.path).qty, 4);
    assert.match(view.currentTree().notes[0], /排除/);
    assert.equal(view.latestReport().complete, false);
    assert.equal(view.latestReport().assessment.analysisTruncated, false);
});

test("equipment material expansion and tutorial use the same owner-scoped except self choice", async () => {
    const value = exceptSelfFixture();
    const target = page("使用羊毛設備的目標", { minecraft_id: "minecraft:test_target" });
    const raw = page("原料", { minecraft_id: "minecraft:stone" });
    const files = new Map([
        [target.file.path, "### 合成配方\n- (Machine:: [[白色羊毛]])\n- [item:: [[原料]]] (qty:: 1)\n- [output:: 1]"],
        [value.white.file.path, value.body.replace("(Machine:: [[工作台]])", "(Machine:: 無/手動)")],
        [value.black.file.path, "### 外部取得\n- 採集：黑色羊毛"], [raw.file.path, "### 外部取得\n- 採集：原料"],
        [value.group.file.path, "### Tag 代表材料\n<!-- preferred -->\n- [item:: [[白色羊毛]]]\n- [item:: [[黑色羊毛]]]"]
    ]);
    const { view, notices } = await loadView(files, [target, raw, value.white, value.black, value.group]);
    await view.analyzePage(target);
    assert.deepEqual(notices, []);
    const step = view.latestReport().equipmentSteps.find(value => value.name === "白色羊毛");
    assert.ok(step);
    assert.deepEqual(step.materials.map(value => [value.name, value.qty]), [["黑色羊毛", 3]]);
});

test("actual V4 renders one technology optgroup for four compact cooking routes", async () => {
    const target = page("紅石選單");
    const body = "### 熔煉配方\n##### Minecraft 原版\n" + ["高爐", "熔爐"].flatMap(machine =>
        ["深板岩紅石礦", "紅石礦"].map(ore => "- (Machine:: " + machine + ")\n- [item:: [[" + ore + "]]] (qty:: 1)\n- [output:: 1]\n")
    ).join("\n");
    const { view } = await loadView(new Map([[target.file.path, body]]), [target]);
    await view.analyzePage(target);
    const select = findSelect(view.analysisContainer);
    assert.ok(select);
    assert.equal(select.children.length, 1);
    const group = select.children[0];
    assert.equal(group.tag, "optgroup");
    assert.equal(group.label, "Minecraft 原版");
    assert.equal(group.children.length, 4);
    assert.ok(group.children.every(option => !/Minecraft 原版|熔煉配方|output/.test(option.textContent)));
    select.value = group.children[3].value;
    await select.listeners.change({ stopPropagation() {} });
    assert.equal(view.currentTree().machine, "熔爐");
    assert.equal(view.currentTree().ingredientOptions[0].name, "紅石礦");
});

test("the export button beside Copy invokes the output-only Templater template", async () => {
    const target = page("按鈕測試");
    const files = new Map([[target.file.path, "### 外部取得\n<!-- preferred -->\n- 採集：測試"]]);
    const { view, notices, exportCalls } = await loadView(files, [target]);
    await view.analyzePage(target);
    const button = findButton(view.analysisContainer, "📤 匯出其他格式");
    assert.ok(button);
    await button.listeners.click();
    assert.equal(exportCalls.length, 1);
    assert.equal(exportCalls[0].template_file.path, "模板放置處/V4-輸出製作報告.md");
    assert.equal(exportCalls[0].target_file.path, "黏液科技DB 搜尋介面V4.md");
    assert.equal(button.disabled, false);
    assert.deepEqual(notices, []);
});

test("V4 keeps multi-block assembly as a note instead of registering an extra device", async () => {
    const target = page("磨石", { type: "sf-item" });
    const source = fs.readFileSync(path.resolve(__dirname, "../../SF-基礎機器(原版)/磨石.md"), "utf8");
    const files = new Map([[target.file.path, source]]);
    const { view, notices } = await loadView(files, [target]);
    await view.analyzePage(target);
    const report = view.latestReport();
    assert.equal(report.machines.some(machine => machine.name === "多方塊結構"), false);
    assert.match(report.tree.notes[0], /多方塊結構/);
    assert.match(view.buildPlainTextReport(target, 1, view.currentTree()), /備註：多方塊結構/);
    assert.deepEqual(notices, []);
});

test("actual V4 view switches an external leaf to a machine route and recalculates quantities", async () => {
    const target = page("橡木材", { base_material: true });
    const log = page("橡木原木");
    const files = new Map([
        [target.file.path, [
            "### 外部取得", "<!-- preferred -->", "- 外部取得：從倉庫取得",
            "### 合成配方", "- (Machine:: [[鋸木機]])",
            "\t- [item:: [[橡木原木]]] (qty:: 1)", "\t- [output:: 8]"
        ].join("\n")],
        [log.file.path, "### 外部取得\n- 採集：砍伐橡木"]
    ]);
    const { view, notices } = await loadView(files, [target, log]);
    view.targetQtyInput.value = "9";
    await view.analyzePage(target);
    assert.deepEqual(notices, []);
    assert.equal(view.currentTree().leaf, true);
    assert.match(view.buildPlainTextReport(target, 1, view.currentTree()), /外部取得：從倉庫取得/);
    // Trigger the actual leaf route dropdown's event handler.
    const control = findSelect(view.analysisContainer);
    assert.ok(control);
    const route = view.parseCache.get(target.file.path).recipes.find(value => !value.external);
    control.value = route.key;
    await control.listeners.change({ stopPropagation() {} });
    assert.equal(view.currentTree().machine, "鋸木機");
    assert.equal(view.currentTree().output, 8);
    assert.equal(view.currentTree().children[0].required, 2);
    assert.equal(view.leafTotals.get(log.file.path).qty, 2);
    assert.deepEqual(notices, []);
});

test("actual V4 material dropdown switches exactly one Tag ingredient and keeps batch scaling", async () => {
    const target = page("橡木材");
    const log = page("橡木原木");
    const wood = page("橡木塊");
    const choices = {
        kind: "tag", id: "minecraft:oak_logs", defaultName: "橡木原木",
        choices: [
            { name: "橡木原木", label: "橡木原木", type: "item", qty: 1 },
            { name: "橡木塊", label: "橡木塊", type: "item", qty: 1 }
        ]
    };
    const files = new Map([
        [target.file.path, [
            "### 合成配方", "<!-- preferred -->", "- (Machine:: 無/手動)",
            "<!-- obsf:choices " + JSON.stringify(choices) + " -->",
            "\t- [item:: [[橡木原木|任意橡木原木]]] (qty:: 1)", "\t- [output:: 4]"
        ].join("\n")],
        [log.file.path, "### 外部取得\n- 採集：砍伐橡木"],
        [wood.file.path, "### 外部取得\n- 外部取得：取自庫存"]
    ]);
    const { view, notices } = await loadView(files, [target, log, wood]);
    view.targetQtyInput.value = "9";
    await view.analyzePage(target);
    assert.equal(view.leafTotals.get(log.file.path).qty, 3);
    const control = findSelect(view.analysisContainer);
    assert.ok(control);
    control.value = "橡木塊";
    await control.listeners.change({ stopPropagation() {} });
    assert.equal(view.leafTotals.has(log.file.path), false);
    assert.equal(view.leafTotals.get(wood.file.path).qty, 3);
    assert.equal(view.currentTree().children.length, 1);
    assert.deepEqual(notices, []);
});

test("actual V4 view displays cycles and respects explicit preview paths", async () => {
    const target = page("A");
    const files = new Map([[target.file.path, "### 合成配方\n<!-- preferred -->\n- (Machine:: 無/手動)\n\t- [item:: [[A]]] (qty:: 1)\n\t- [output:: 1]"]]);
    const { view, notices } = await loadView(files, [target]);
    await view.analyzePage(target);
    assert.deepEqual(notices, []);
    assert.equal(view.currentTree().children[0].cycle, true);
    assert.equal(view.resolveBio("其他批次/A", view.buildBioIndex([target])), null);
});

test("actual V4 follows a Tag BIO link and switches its preferred member without inline JSON", async () => {
    const target = page("活塞");
    const tag = page("任意木材", { tag_identity: "minecraft:item_tag", minecraft_tag: "minecraft:planks" });
    const oak = page("橡木材");
    const spruce = page("杉木材");
    const files = new Map([
        [target.file.path, [
            "### 合成配方", "<!-- preferred -->", "- (Machine:: 無/手動)",
            "\t- [item:: [[任意木材]]] (qty:: 3)", "\t- [output:: 1]"
        ].join("\n")],
        [tag.file.path, [
            "### Tag 代表材料", "- [item:: [[杉木材]]]",
            "<!-- preferred -->", "- [item:: [[橡木材]]]"
        ].join("\n")],
        [oak.file.path, "### 外部取得\n- 外部取得：橡木材庫存"],
        [spruce.file.path, "### 外部取得\n- 外部取得：杉木材庫存"]
    ]);
    const { view, notices } = await loadView(files, [target, tag, oak, spruce]);
    await view.analyzePage(target);
    assert.equal(view.currentTree().children[0].name, "任意木材");
    assert.equal(view.leafTotals.get(oak.file.path).qty, 3);
    const control = findSelect(view.analysisContainer);
    assert.ok(control);
    control.value = "杉木材";
    await control.listeners.change({ stopPropagation() {} });
    assert.equal(view.leafTotals.has(oak.file.path), false);
    assert.equal(view.leafTotals.get(spruce.file.path).qty, 3);
    assert.deepEqual(notices, []);
});

test("V4 stops at the depth limit, flags the report and does not treat the cut branch as a base", async () => {
    const pages = Array.from({ length: 8 }, (_, index) => page("深度" + index));
    const files = new Map(pages.map((value, index) => [
        value.file.path,
        index === pages.length - 1 ? "### 外部取得\n- 採集：終點" :
            "### 合成配方\n<!-- preferred -->\n- (Machine:: 無/手動)\n\t- [item:: [[深度" +
            (index + 1) + "]]] (qty:: 1)\n\t- [output:: 1]"
    ]));
    const { view, notices } = await loadView(files, pages);
    view.limitInputs.maxDepth.input.value = "3";
    await view.analyzePage(pages[0]);
    assert.deepEqual(notices, []);
    assert.equal(view.latestReport().complete, false);
    assert.equal(view.latestReport().budget.truncated, true);
    assert.equal(view.leafTotals.size, 0);
    assert.match(view.buildPlainTextReport(pages[0], 1, view.currentTree()), /截斷|未展開/);
});

test("V4 counts unresolved branches against the node limit and bounds a wide recipe", async () => {
    const target = page("大量材料");
    const ingredients = Array.from({ length: 30 }, (_, index) =>
        "\t- [item:: [[材料" + index + "]]] (qty:: 1)"
    );
    const files = new Map([[target.file.path,
        ["### 合成配方", "<!-- preferred -->", "- (Machine:: 無/手動)", ...ingredients, "\t- [output:: 1]"].join("\n")
    ]]);
    const { view, notices } = await loadView(files, [target]);
    view.limitInputs.maxNodes.input.value = "10";
    await view.analyzePage(target);
    assert.deepEqual(notices, []);
    assert.equal(view.latestReport().budget.visitedNodes, 10);
    assert.equal(view.latestReport().complete, false);
    assert.equal(view.currentTree().children.at(-1).truncated, true);
    assert.ok(view.leafTotals.size < 30);
});

test("equipment dependencies share the same depth budget as product dependencies", async () => {
    const names = ["目標", "設備A", "設備B", "設備C", "設備D"];
    const pages = names.map(name => page(name));
    const files = new Map(pages.map((value, index) => [
        value.file.path,
        index === names.length - 1 ? "### 外部取得\n- 外部取得：設備庫存" :
            "### 合成配方\n<!-- preferred -->\n- (Machine:: [[" + names[index + 1] +
            "]])\n\t- [item:: [[原料]]] (qty:: 1)\n\t- [output:: 1]"
    ]));
    const raw = page("原料");
    pages.push(raw);
    files.set(raw.file.path, "### 外部取得\n- 採集：原料");
    const { view, notices } = await loadView(files, pages);
    view.limitInputs.maxDepth.input.value = "3";
    await view.analyzePage(pages[0]);
    assert.deepEqual(notices, []);
    assert.equal(view.latestReport().complete, false);
    assert.equal(view.latestReport().budget.truncated, true);
    assert.ok(view.latestReport().machines.some(machine => machine.status.includes("未分析")));
});

test("V4 exposes the requested defaults and clamps user settings with seconds-to-milliseconds conversion", async () => {
    const target = page("設定測試");
    const files = new Map([[target.file.path, "### 外部取得\n<!-- preferred -->\n- 採集：測試"]]);
    const { view, notices } = await loadView(files, [target]);
    await view.analyzePage(target);
    const initial = view.latestReport().budget.limits;
    assert.equal(initial.maxDepth, 200);
    assert.equal(initial.maxNodes, 1000);
    assert.equal(initial.maxMilliseconds, 30000);
    assert.equal(view.limitInputs.maxMilliseconds.input.value, "30");

    view.limitInputs.maxDepth.input.value = "9999";
    view.limitInputs.maxNodes.input.value = "9999";
    view.limitInputs.maxMilliseconds.input.value = "9999";
    await view.recalculateCurrentAnalysis();
    const changed = view.latestReport().budget.limits;
    assert.equal(changed.maxDepth, 500);
    assert.equal(changed.maxNodes, 2000);
    assert.equal(changed.maxMilliseconds, 60000);
    assert.equal(view.limitInputs.maxMilliseconds.input.value, "60");
    assert.deepEqual(notices, []);
});
