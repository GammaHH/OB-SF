const assert = require("node:assert/strict");
const test = require("node:test");
const { planBIOUpdate, routeIsLegalSpecialization, extractLegacyRecipeReviews } = require("../../BIO相關模組/MC解析器模塊/bio/bio_update");
const reader = require("../../BIO相關模組/搜尋介面模塊/bio_reader_v4");
const { addsOnlyLines, preservesBIOContent } = require("../../scripts/lib/bio-apply.cjs");
const { parseMachineRecipeMappings } = require("../../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping");

function route(machine = "工作台", ingredient = "木材", qty = 2, output = 4, note = "") {
    return "### 合成配方\n\n<!-- preferred -->\n- **生產設備**：(Machine:: [[" + machine + "]])\n" +
        "\t**合成所需**：\n\t- [item:: [[" + ingredient + "]]] (qty:: " + qty + ")\n" +
        "\t- [output:: " + output + "]\n" + (note ? "\t- [note:: " + note + "]\n" : "");
}
function bio(body, extras = "") {
    let preferredSeen = false;
    body = body.replace(/<!-- preferred -->/g, marker => {
        if (preferredSeen) return "";
        preferredSeen = true;
        return marker;
    });
    return "---\ntype: mc-item\nid: STICK\n" + extras + "---\n\n# 合成/取得\n\n" + body;
}

test("a concrete glass route is proved against complete linked Tag members and canonicalized without losing source prose", () => {
    const original = bio(route("熔爐", "沙", 1, 1).replace("### 合成配方", "### 常規") + "\n![[玻璃.png]]\n人工說明保留\n");
    const generated = bio(route("熔爐", "任意沙類", 1, 1, "處理時間 200 ticks"));
    const resolveName = value => ({ "沙": "minecraft:sand", "紅沙": "minecraft:red_sand", "任意沙類": "tag:minecraft:smelts_to_glass" }[value] || value);
    const options = { groupExistingRoutes: true, canonicalizeLegacyCollections: true, resolveName,
        resolveIngredientChoices: ingredient => ingredient.name === "任意沙類" ? [{ name: "minecraft:sand", qty: 1 }, { name: "minecraft:red_sand", qty: 1 }] : null };
    const plan = planBIOUpdate(original, generated, options);
    assert.ok(plan.diagnostics.some(value => value.code === "LEGACY_ROUTE_REPRESENTATION_SUPERSEDED"));
    assert.equal(plan.diagnostics.some(value => value.code === "EXISTING_ROUTE_NOT_IN_SOURCE"), false);
    const records = extractLegacyRecipeReviews(plan.candidate);
    assert.equal(records.length, 1); assert.equal(records[0].kind, "representation");
    assert.equal(original.slice(records[0].start, records[0].end), records[0].source);
    assert.doesNotMatch(records[0].source, /玻璃.png|人工說明/);
    const active = reader.parseBIO(plan.candidate).recipes.filter(value => !value.external);
    assert.equal(active.length, 1); assert.equal(active[0].ingredients[0].name, "任意沙類");
    const outside = plan.candidate.slice(0, records[0].envelopeStart) + plan.candidate.slice(records[0].envelopeEnd);
    assert.match(outside, /!\[\[玻璃.png\]\]\n人工說明保留/);
    assert.equal(planBIOUpdate(plan.candidate, generated, options).candidate, plan.candidate);
});

test("furnace and campfire concrete materials match legal choices independent of ingredient order", () => {
    const names = { "鵝卵石": "minecraft:cobblestone", "黑石": "minecraft:blackstone", "橡木原木": "minecraft:oak_log",
        "任意原木": "tag:minecraft:logs", "木棒": "minecraft:stick", "煤炭": "minecraft:coal", "木炭": "minecraft:charcoal" };
    const resolveName = value => names[value] || value;
    const furnaceOld = reader.parseBIO(route("工作台", "鵝卵石", 8, 1)).recipes[0];
    const furnaceNew = { ...furnaceOld, ingredients: [{ name: "鵝卵石", qty: 8,
        choices: [{ name: "鵝卵石", qty: 1 }, { name: "黑石", qty: 1 }] }] };
    assert.equal(routeIsLegalSpecialization(furnaceOld, furnaceNew, { resolveName }), true);
    assert.equal(routeIsLegalSpecialization(furnaceOld, { ...furnaceNew, output: 2 }, { resolveName }), false);
    const oldCampfire = { machine: "工作台", output: 1, ingredients: [
        { name: "橡木原木", qty: 3 }, { name: "木棒", qty: 3 }, { name: "煤炭", qty: 1 }] };
    const newCampfire = { machine: "工作台", output: 1, ingredients: [
        { name: "木棒", qty: 3 }, { name: "煤炭", qty: 1, choices: [{ name: "煤炭", qty: 1 }, { name: "木炭", qty: 1 }] },
        { name: "任意原木", qty: 3 }] };
    const options = { resolveName, resolveIngredientChoices: ingredient => ingredient.name === "任意原木"
        ? [{ name: "minecraft:oak_log", qty: 1 }, { name: "minecraft:birch_log", qty: 1 }] : null };
    assert.equal(routeIsLegalSpecialization(oldCampfire, newCampfire, options), true);
    assert.equal(routeIsLegalSpecialization({ ...oldCampfire, ingredients: [{ name: "橡木原木", qty: 4 }, ...oldCampfire.ingredients.slice(1)] }, newCampfire, options), false);
    assert.equal(routeIsLegalSpecialization(oldCampfire, newCampfire, { resolveName }), false, "display names alone do not prove linked collection members");
});

test("user-reviewed invalid legacy route is retained in verifiable fenced review rather than active V4 recipes", () => {
    const oldRoute = route("熔爐", "地獄磚頭", 1, 1).replace("### 合成配方", "### 常規");
    const original = bio(oldRoute + "\n![[磚圖片.png]]\n人工備註\n#有錯誤配方\n").replace("id: STICK", "id: NETHER_BRICKS");
    const generated = bio(route("工作台", "地獄磚頭", 4, 1)).replace("id: STICK", "id: NETHER_BRICKS");
    const unasserted = planBIOUpdate(original, generated, { groupExistingRoutes: true });
    assert.equal(extractLegacyRecipeReviews(unasserted.candidate).length, 0, "custom tag does not delete/quarantine a route");
    const plan = planBIOUpdate(original, generated, { groupExistingRoutes: true,
        quarantineLegacyRoute: (existing, context) => context.itemId === "minecraft:nether_bricks" && existing.machine === "熔爐"
            ? { reason: "使用者審核指出舊機器／數量錯誤", evidence: "user-review:2026-11-20" } : null });
    const records = extractLegacyRecipeReviews(plan.candidate);
    assert.equal(records.length, 1); assert.equal(records[0].kind, "invalid");
    assert.equal(records[0].source, original.slice(records[0].start, records[0].end));
    assert.doesNotMatch(records[0].source, /圖片|人工備註|有錯誤配方/);
    const active = reader.parseBIO(plan.candidate).recipes.filter(value => !value.external);
    assert.equal(active.length, 1); assert.equal(active[0].machine, "工作台");
    assert.equal(active[0].ingredients[0].qty, 4);
    assert.ok(plan.diagnostics.some(value => value.code === "LEGACY_VANILLA_ROUTE_QUARANTINED"));
    assert.throws(() => extractLegacyRecipeReviews(plan.candidate.replace('```markdown\n', '```markdown\n篡改\n')), /原文與記錄不一致/);
});

test("known plugin routes are never quarantined or canonicalized by Vanilla source assertions", () => {
    const original = bio(route("熔爐", "地獄磚頭", 1, 1).replace("### 合成配方", "### 常規\n##### 海曼科技院"));
    const generated = bio(route("工作台", "地獄磚頭", 4, 1));
    const plan = planBIOUpdate(original, generated, { groupExistingRoutes: true, canonicalizeLegacyCollections: true,
        quarantineLegacyRoute: () => ({ reason: "不應套用", evidence: "test" }) });
    assert.equal(extractLegacyRecipeReviews(plan.candidate).length, 0);
    assert.match(plan.candidate, /##### 海曼科技院/);
    assert.equal(reader.parseBIO(plan.candidate).recipes.filter(value => !value.external).length, 2);
    assert.ok(plan.preservedRoutes.some(value => value.provider === "海曼科技院"));
});

test("interleaved image/manual content makes legacy route quarantine refuse an unsafe source span", () => {
    const original = bio("### 常規\n<!-- preferred -->\n- (Machine:: 熔爐)\n- [item:: 地獄磚頭] (qty:: 1)\n" +
        "![[人工圖片.png]]\n- [item:: 其他材料] (qty:: 1)\n");
    const generated = bio(route("工作台", "地獄磚頭", 4, 1));
    const plan = planBIOUpdate(original, generated, { groupExistingRoutes: true,
        quarantineLegacyRoute: () => ({ reason: "人工指定", evidence: "test" }) });
    assert.equal(extractLegacyRecipeReviews(plan.candidate).length, 0);
    assert.ok(plan.diagnostics.some(value => value.code === "LEGACY_VANILLA_ROUTE_QUARANTINE_UNSAFE"));
    assert.ok(plan.candidate.includes("![[人工圖片.png]]"));
});

test("supplemental notes are appended next to recipe data rather than after trailing manual prose or empty gaps", () => {
    const original = bio(route("熔爐", "沙", 1, 1) + "\n\n\n人工說明\n\n# 用途\n");
    const generated = bio(route("熔爐", "沙", 1, 1, "處理時間 200 ticks"));
    const plan = planBIOUpdate(original, generated, { groupExistingRoutes: true });
    assert.match(plan.candidate, /\[output:: 1\]\n\t- \[note:: 處理時間 200 ticks\]/);
    assert.match(plan.candidate, /\[note:: 處理時間 200 ticks\][\s\S]*人工說明/);
    assert.equal(planBIOUpdate(plan.candidate, generated, { groupExistingRoutes: true }).candidate, plan.candidate);
});

test("stand-alone linked source rows receive provider headings without changing their recipe section", () => {
    const original = bio("### 常規\n\n<!-- preferred -->\n- [[紅石 (Redstone)]]\n" +
        "- [[另一個農耕配方]]\n- [[SF-科技/額外配方|原顯示名稱]]\n");
    const seen = [];
    const plan = planBIOUpdate(original, bio(""), { groupExistingRoutes: true,
        classifyLinkedSource: target => {
            seen.push(target);
            return { provider: target.startsWith("SF-科技/") ? "SF-科技" : "SF-農耕工藝", evidence: target + ".md" };
        } });
    assert.match(plan.candidate, /### 常規\n\n##### SF-農耕工藝\n\n<!-- preferred -->\n- \[\[紅石 \(Redstone\)\]\]/);
    assert.match(plan.candidate, /- \[\[另一個農耕配方\]\]\n\n##### SF-科技\n\n- \[\[SF-科技\/額外配方\|原顯示名稱\]\]/);
    assert.equal((plan.candidate.match(/^##### SF-農耕工藝$/gm) || []).length, 1);
    assert.equal((plan.candidate.match(/^### 常規$/gm) || []).length, 1);
    assert.deepEqual(seen, ["紅石 (Redstone)", "另一個農耕配方", "SF-科技/額外配方"]);
    assert.equal(addsOnlyLines(original, plan.candidate), true);
});

test("unresolved linked sources retain their original row under other while explicit provider headings remain untouched", () => {
    const original = bio("### 常規\n\n- [[已確認]]\n- [[無法唯一確認]]\n\n" +
        "### 常規\n\n##### 原人工科技\n\n<!-- preferred -->\n- [[人工指定配方]]\n");
    const seen = [];
    const plan = planBIOUpdate(original, bio(""), { groupExistingRoutes: true,
        classifyLinkedSource: target => {
            seen.push(target);
            return target === "已確認" ? { provider: "SF-農耕工藝", evidence: "SF-農耕工藝/已確認.md" } : null;
        } });
    assert.match(plan.candidate, /##### 其他\n\n- \[\[無法唯一確認\]\]/);
    assert.match(plan.candidate, /##### 原人工科技\n\n<!-- preferred -->\n- \[\[人工指定配方\]\]/);
    assert.deepEqual(seen, ["已確認", "無法唯一確認"]);
    assert.ok(plan.diagnostics.some(entry => entry.code === "LINKED_SOURCE_UNRESOLVED" && entry.linkTarget === "無法唯一確認"));
});

test("linked-source grouping ignores fences, HTML, inline examples, ingredient rows and other root sections", () => {
    const original = bio("### 常規\n\n```md\n- [[程式範例]]\n```\n" +
        "<!--\n- [[HTML範例]]\n-->\n- `[[行內範例]]`\n" +
        "- 範例 `(Machine:: [[範例設備]])`\n\t- [[縮排材料]]\n" +
        "- [item:: [[材料]]] (qty:: 1)\n- [note:: [[備註]]] \n" +
        "# 用途\n### 常規\n- [[用途連結]]\n# 產物\n### 常規\n- [[產物連結]]\n");
    let calls = 0;
    const plan = planBIOUpdate(original, bio(""), { groupExistingRoutes: true,
        classifyLinkedSource: () => { calls++; return { provider: "SF-不應產生" }; } });
    assert.equal(calls, 0);
    assert.doesNotMatch(plan.candidate, /^##### SF-不應產生$/m);
    for (const row of original.split("\n").filter(line => line.includes("[["))) assert.ok(plan.candidate.includes(row));
});

test("CLI linked-source resolver requires one existing SF BIO and prevents paths escaping the vault", () => {
    const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
    const source = fs.readFileSync(path.resolve(__dirname, "../../scripts/minecraft-bio-generator.cjs"), "utf8");
    const start = source.indexOf("function createLinkedSourceClassifier(");
    const end = source.indexOf("\nfunction loadPlanningContext(", start);
    assert.ok(start >= 0 && end > start);
    const factory = new Function("fs", "path", source.slice(start, end) + "\nreturn createLinkedSourceClassifier;")(fs, path);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "obsf-linked-source-"));
    try {
        const root = path.join(temp, "vault");
        const folders = ["SF-農耕工藝", "SF-其他"];
        for (const folder of folders) fs.mkdirSync(path.join(root, folder), { recursive: true });
        fs.writeFileSync(path.join(root, folders[0], "紅石 (Redstone).md"), "原配方");
        fs.writeFileSync(path.join(temp, "outside.md"), "外部檔案");
        const classify = factory(root, folders);
        assert.deepEqual(classify("紅石 (Redstone)"), { provider: folders[0], evidence: folders[0] + "/紅石 (Redstone).md" });
        assert.deepEqual(classify(folders[0] + "/紅石 (Redstone).md#段落"), { provider: folders[0], evidence: folders[0] + "/紅石 (Redstone).md" });
        assert.equal(classify("不存在"), null);
        assert.equal(classify("../outside"), null);
        assert.equal(classify(path.join(temp, "outside.md")), null);
        assert.equal(classify("C:/Windows/example"), null);
        fs.writeFileSync(path.join(root, folders[1], "紅石 (Redstone).md"), "重複名稱");
        assert.equal(classify("紅石 (Redstone)"), null);
        assert.deepEqual(classify(folders[0] + "/紅石 (Redstone)"), { provider: folders[0], evidence: folders[0] + "/紅石 (Redstone).md" });
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("update classifies Machine routes and removes legacy YAML output without changing manual content", () => {
    const rules = parseMachineRecipeMappings("| provider | machine | section | enabled |\n" +
        "| --- | --- | --- | --- |\n| SF-基礎機器(原版) | 冶煉爐 | 熔煉配方 | true |\n").rules;
    const oldRoute = route("冶煉爐", "鐵粉", 1, 1)
        .replace("### 合成配方", "### 常規\n\n##### SF-基礎機器(原版)");
    const original = bio(oldRoute.replace("\t- [output:: 1]\n", "") +
        "\n# 用途\n![[鐵錠.png]]\n人工說明\n", "output: 7\n");
    const generated = bio(oldRoute.replace("### 常規", "### 熔煉配方"));
    const plan = planBIOUpdate(original, generated, { groupExistingRoutes: true, machineMappings: rules });
    assert.doesNotMatch(plan.candidate, /^output:/m);
    assert.match(plan.candidate, /^### 熔煉配方$/m);
    assert.doesNotMatch(plan.candidate, /^### 常規$/m);
    assert.doesNotMatch(plan.candidate, /\[output:: 7\]/);
    assert.match(plan.candidate, /!\[\[鐵錠.png\]\]\n人工說明/);
    assert.equal(preservesBIOContent(original, plan.candidate, rules), true);
    assert.equal(preservesBIOContent(original, plan.candidate.replace("人工說明\n", ""), rules), false);
    const again = planBIOUpdate(plan.candidate, generated, { groupExistingRoutes: true, machineMappings: rules });
    assert.equal(again.candidate, plan.candidate);
});

test("additive update preserves the complete original including images, notes, YAML and preferred", () => {
    const original = bio(route() + "\n# 用途\n手寫備註\n![[圖片.png]]\n", "custom: 手動維護\n");
    const generated = bio(route() + route("工作台", "竹子", 2, 1));
    const plan = planBIOUpdate(original, generated);
    assert.equal(plan.status, "ADDITIVE_UPDATE");
    assert.ok(addsOnlyLines(original, plan.candidate));
    assert.equal((plan.candidate.match(/!\[\[圖片.png\]\]/g) || []).length, 1);
    assert.equal((plan.candidate.match(/<!-- preferred -->/g) || []).length, 1);
    assert.match(plan.candidate, /竹子/);
    const again = planBIOUpdate(plan.candidate, generated);
    assert.equal(again.status, "UNCHANGED");
    assert.equal(again.candidate, plan.candidate);
});

test("changed ingredient quantities and output require review without adding conflicting routes", () => {
    for (const changed of [route("工作台", "木材", 3, 4), route("工作台", "木材", 2, 8)]) {
        const original = bio(route());
        const plan = planBIOUpdate(original, bio(changed));
        assert.equal(plan.status, "REVIEW");
        assert.equal(plan.candidate, original);
        assert.ok(plan.diagnostics.some(entry => entry.code === "RECIPE_VALUES_DIFFER"));
        const conflict = plan.diagnostics.find(entry => entry.code === "RECIPE_VALUES_DIFFER");
        assert.equal(conflict.existing.output, 4);
        assert.ok(conflict.incoming.ingredients.length > 0);
    }
});

test("different result Components stay separate in review without modifying the original recipe", () => {
    const withEffect = id => bio(route() + "\n```json\n" + JSON.stringify({
        "minecraft:suspicious_stew_effects": [{ id, duration: 100 }]
    }) + "\n```\n");
    const original = withEffect("minecraft:night_vision");
    const plan = planBIOUpdate(original, withEffect("minecraft:fire_resistance"));
    assert.equal(plan.candidate, original);
    assert.equal(plan.status, "REVIEW");
    assert.ok(plan.diagnostics.some(entry => entry.code === "RECIPE_VALUES_DIFFER"));
});

test("an old manual or plugin route is kept and reported when absent from Vanilla source", () => {
    const original = bio(route() + route("鋸木機", "原木", 1, 8));
    const plan = planBIOUpdate(original, bio(route()));
    assert.equal(plan.candidate, original);
    assert.equal(plan.status, "REVIEW");
    assert.ok(plan.diagnostics.some(entry => entry.code === "EXISTING_ROUTE_NOT_IN_SOURCE"));
});

test("confirmed other-provider routes are preserved as information rather than a Vanilla source failure", () => {
    const original = bio(route("冶煉爐", "鐵粉", 1, 1));
    const generated = bio(route("熔爐", "鐵原礦", 1, 1).replace("### 合成配方", "### 熔煉配方\n##### Minecraft 原版"));
    const plan = planBIOUpdate(original, generated, {
        classifyExistingRoute: route => route.machine === "冶煉爐" ? { provider: "Slimefun 原版", evidence: "SF/冶煉爐.md" } : null
    });
    assert.equal(plan.status, "ADDITIVE_UPDATE");
    assert.deepEqual(plan.diagnostics, []);
    assert.equal(plan.preservedRoutes[0].code, "OTHER_SOURCE_PRESERVED");
    assert.ok(addsOnlyLines(original, plan.candidate));
    assert.match(plan.candidate, /### 熔煉配方\n\n##### Minecraft 原版/);
});

test("grouped updates add source-folder headings and a review tag while retaining every original line", () => {
    const original = bio(route("冶煉爐", "鐵粉", 1, 1) + "\n# 用途\n![[圖片.png]]\n人工說明\n");
    const options = { groupExistingRoutes: true, classifyExistingRoute: () => ({
        provider: "Slimefun 原版", evidence: "SF-基礎機器(原版)/冶煉爐.md"
    }) };
    const generated = bio(route("熔爐", "鐵原礦", 1, 1));
    const plan = planBIOUpdate(original, generated, options);
    assert.match(plan.candidate, /##### SF-基礎機器\(原版\)\n\n<!-- preferred -->/);
    assert.equal((plan.candidate.match(/^#更新需人工解析$/gm) || []).length, 1);
    assert.equal(addsOnlyLines(original, plan.candidate), true);
    assert.equal(planBIOUpdate(plan.candidate, generated, options).candidate, plan.candidate);
    const unknown = planBIOUpdate(original, generated, { groupExistingRoutes: true });
    assert.match(unknown.candidate, /##### 其他/);
    assert.match(unknown.candidate, /!\[\[圖片.png\]\]/);
});

test("NOTE differences and incomplete old recipes remain explicit review issues", () => {
    const original = bio(route("工作台", "木材", 2, 4, "人工操作說明"));
    const notePlan = planBIOUpdate(original, bio(route("工作台", "木材", 2, 4, "人工操作說明：不同內容")));
    assert.equal(notePlan.status, "REVIEW");
    assert.equal(notePlan.candidate, original);
    assert.ok(notePlan.diagnostics.some(entry => entry.code === "SUPPLEMENTAL_DATA_DIFFERS"));
    const broken = bio("### 合成配方\n- **生產設備**：(Machine:: 工作台)\n合成所需：擷取失敗\n");
    const brokenPlan = planBIOUpdate(broken, bio(route()));
    assert.ok(addsOnlyLines(broken, brokenPlan.candidate));
    assert.ok(brokenPlan.diagnostics.some(entry => entry.code === "EXISTING_ROUTE_UNPARSED"));
});

test("identity and Base mismatches never silently overwrite frontmatter", () => {
    const original = bio(route(), "base_material: false\n");
    assert.equal(planBIOUpdate(original, bio(route()).replace("STICK", "PISTON")).candidate, original);
    const plan = planBIOUpdate(original, bio(route(), "base_material: true\n"));
    assert.equal(plan.candidate, original);
    assert.ok(plan.diagnostics.some(entry => entry.code === "BASE_DECISION_DIFFERS"));
});

test("CRLF originals remain intact and update candidates reject preview links", () => {
    const original = bio(route()).replace(/\n/g, "\r\n");
    const added = planBIOUpdate(original, bio(route() + route("工作台", "竹子", 2, 1)));
    assert.ok(addsOnlyLines(original, added.candidate));
    assert.doesNotMatch(added.candidate, /(?<!\r)\n/);
    const bad = planBIOUpdate(bio(route()), bio(route() + route("工作台", "MC-自動化BIO/preview/run/竹子.preview", 2, 1)));
    assert.equal(bad.status, "REVIEW");
    assert.ok(bad.diagnostics.some(entry => entry.code === "PREVIEW_LINK_IN_UPDATE"));
    assert.equal(bad.additions.length, 0);
});

test("canonical name resolution avoids adding an existing route under a different link path", () => {
    const old = bio(route("工作台", "MC/木材", 2, 4));
    const plan = planBIOUpdate(old, bio(route()), {
        resolveName: value => ["MC/木材", "木材"].includes(value) ? "minecraft:oak_planks" : value
    });
    assert.equal(plan.status, "UNCHANGED");
    assert.equal(plan.candidate, old);
});

test("redstone update merges full Preview metadata, external preference and four recipes under one heading", () => {
    const vanilla = require("../../BIO相關模組/MC解析器模塊");
    const original = "---\ntype: mc-item\nid: REDSTONE\nlevel:\noutput: 1\naliases:\n  - REDSTONE\ncreated: 2026-08-08\n---\n" +
        "\n#待補充\n![[紅石圖片.png]]\n# 合成/取得\n\n### 常規\n- [[人工來源說明]]\n\n# 用途\n保留手寫文字\n";
    const recipes = ["blasting", "smelting"].flatMap(type => ["deepslate_redstone_ore", "redstone_ore"].map(ore => ({
        sourceType: "minecraft:" + type, machine: type === "blasting" ? "高爐" : "熔爐", output: 1,
        ingredients: [{ kind: "item", id: "minecraft:" + ore, qty: 1 }],
        meta: { sourceFile: type + "-" + ore + ".json", cookingTime: type === "blasting" ? 100 : 200, experience: 0.7 }
    })));
    const model = vanilla.bio.createBIOGenerationModel("minecraft:redstone", {
        externalBase: true, itemRegistry: new Map([["minecraft:redstone", { recipes }]])
    });
    const generated = vanilla.bio.renderBIOPreview(model);
    const plan = planBIOUpdate(original, generated, { groupExistingRoutes: true });
    const candidate = plan.candidate;
    const fm = vanilla.bio.parseFrontmatter(candidate);
    assert.equal(fm.minecraft_id, "minecraft:redstone");
    assert.equal(fm.base_material, "true");
    assert.equal(fm.generator_schema, "2");
    assert.deepEqual(fm.aliases, ["REDSTONE", "minecraft:redstone"]);
    assert.equal(fm.created, "2026-08-08");
    assert.equal(fm.output, undefined);
    assert.equal((candidate.match(/^# 合成\/取得$/gm) || []).length, 1);
    assert.equal((candidate.match(/^### 熔煉配方$/gm) || []).length, 1);
    assert.equal((candidate.match(/^##### Minecraft 原版$/gm) || []).length, 1);
    assert.doesNotMatch(candidate, /追加候選/);
    assert.equal((candidate.match(/Machine::/g) || []).length, 4);
    assert.ok(candidate.indexOf("### 外部取得") < candidate.indexOf("### 熔煉配方"));
    assert.ok(candidate.indexOf("### 熔煉配方") < candidate.indexOf("# 用途"));
    assert.equal(preservesBIOContent(original, candidate), true);
    const parsed = require("../../BIO相關模組/搜尋介面模塊/bio_reader_v4").parseBIO(candidate, { base_material: true });
    assert.equal(parsed.recipes.filter(route => route.external && route.preferred).length, 1);
    assert.equal(parsed.recipes.length, 5);
    assert.equal(plan.status, "ADDITIVE_UPDATE");
    assert.equal(planBIOUpdate(candidate, generated, { groupExistingRoutes: true }).candidate, candidate);
});

test("missing NOTE and preferred enrich an existing recipe without duplicating it", () => {
    const original = bio(route()).replace("<!-- preferred -->\n", "");
    const generated = bio(route("工作台", "木材", 2, 4, "經驗值：0.7"));
    const plan = planBIOUpdate(original, generated);
    assert.equal((plan.candidate.match(/Machine::/g) || []).length, 1);
    assert.match(plan.candidate, /<!-- preferred -->\n- \*\*生產設備/);
    assert.match(plan.candidate, /\[note:: 經驗值 0\.7\]/);
    assert.equal(addsOnlyLines(original, plan.candidate), true);
    assert.equal(planBIOUpdate(plan.candidate, generated).candidate, plan.candidate);
});

test("metadata merge allows new Preview fields and extended aliases but rejects changed existing values", () => {
    const { metadataIsAdditive } = require("../../BIO相關模組/MC解析器模塊/bio/bio_update");
    const before = { id: "IRON_INGOT", aliases: ["IRON_INGOT"], output: "1", created: "manual" };
    assert.equal(metadataIsAdditive(before, { ...before, aliases: ["IRON_INGOT", "minecraft:iron_ingot"],
        minecraft_id: "minecraft:iron_ingot", base_material: "true", generator_schema: "2" }), true);
    assert.equal(metadataIsAdditive(before, { ...before, output: "2" }), false);
    assert.equal(metadataIsAdditive(before, { ...before, aliases: [] }), false);
    assert.equal(metadataIsAdditive(before, { ...before, arbitrary_new_setting: "unsafe" }), false);
});

test("NOTE formatting changes do not duplicate an old note or hide a changed value", () => {
    const original = bio(route("工作台", "木材", 2, 4, "烹調時間（原始 ticks）：200"));
    const same = planBIOUpdate(original, bio(route("工作台", "木材", 2, 4, "烹調時間 200 ticks")));
    assert.equal(same.candidate, original);
    assert.equal(same.status, "UNCHANGED");
    const changed = planBIOUpdate(original, bio(route("工作台", "木材", 2, 4, "烹調時間 100 ticks")));
    assert.equal(changed.candidate, original);
    assert.ok(changed.diagnostics.some(entry => entry.code === "SUPPLEMENTAL_DATA_DIFFERS"));
});

test("NOTE-only component variants retain separate routes during update merging", () => {
    const generated = bio(route("工作台", "相同材料", 1, 1, "效果：抗火；持續時間 60 ticks") +
        route("工作台", "相同材料", 1, 1, "效果：夜視；持續時間 100 ticks"));
    const first = planBIOUpdate(bio(""), generated);
    assert.equal((first.candidate.match(/Machine::/g) || []).length, 2);
    assert.match(first.candidate, /效果：抗火；持續時間 60 ticks/);
    assert.match(first.candidate, /效果：夜視；持續時間 100 ticks/);
    assert.equal(planBIOUpdate(first.candidate, generated).candidate, first.candidate);
});

test("except-self constraints are not silently equated with an unrestricted representative route", () => {
    const original = bio(route("工作台", "黑色羊毛", 1, 1)).replace("id: STICK", "id: WHITE_WOOL");
    const generated = original.replace("\t- [item::", "\t<!-- except self -->\n\t- [item::");
    const plan = planBIOUpdate(original, generated);
    assert.equal(plan.status, "REVIEW");
    assert.ok(plan.diagnostics.some(diagnostic => diagnostic.code === "EXISTING_ROUTE_NOT_IN_SOURCE"));
    assert.match(plan.candidate, /<!-- except self -->/);
    assert.equal(addsOnlyLines(original, plan.candidate), true);
});

test("test-only preview links require an explicit option and stay blocked for formal merging", () => {
    const original = bio("");
    const generated = bio(route("工作台", "MC-自動化BIO/preview/batch/test/橡木材.preview"));
    const formal = planBIOUpdate(original, generated);
    assert.ok(formal.diagnostics.some(diagnostic => diagnostic.code === "PREVIEW_LINK_IN_UPDATE"));
    assert.doesNotMatch(formal.candidate, /橡木材\.preview/);
    const preview = planBIOUpdate(original, generated, { allowPreviewLinks: true });
    assert.match(preview.candidate, /橡木材\.preview/);
    assert.equal(preview.diagnostics.some(diagnostic => diagnostic.code === "PREVIEW_LINK_IN_UPDATE"), false);
    assert.equal(addsOnlyLines(original, preview.candidate), true);
});

test("production update rebuilds managed tags from retained Base status and merged recipes", () => {
    const original = bio("#待補充\n#需攻略補充\n#自訂\n![[圖片.png]]\n" + route(),
        "base_material: false\ntags: [待補充, 手動]\n");
    const incoming = bio(route(), "base_material: true\n");
    const plan = planBIOUpdate(original, incoming, { groupExistingRoutes: true });
    assert.ok(plan.diagnostics.some(entry => entry.code === "BASE_DECISION_DIFFERS"));
    assert.match(plan.candidate, /base_material: false/);
    assert.match(plan.candidate, /#未人工檢查\n#更新需人工解析\n#需攻略補充/);
    assert.doesNotMatch(plan.candidate, /^#待補充$/m);
    assert.match(plan.candidate, /#自訂\n!\[\[圖片.png\]\]/);
    assert.equal(preservesBIOContent(original, plan.candidate), true);
    assert.equal(planBIOUpdate(plan.candidate, incoming, { groupExistingRoutes: true }).candidate, plan.candidate);
});
