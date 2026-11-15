const test = require("node:test");
const assert = require("node:assert/strict");
const { managedTagsFor, stripManagedBIOtags, rebuildManagedBIOtags } =
    require("../../BIO相關模組/MC解析器模塊/bio/bio_tags");
const { parseFrontmatter, scanMinecraftBIOs } = require("../../BIO相關模組/MC解析器模塊/bio/bio_scanner");
const { metadataIsAdditive } = require("../../BIO相關模組/MC解析器模塊/bio/bio_update");
const { preservesBIOContent } = require("../../scripts/lib/bio-apply.cjs");

test("managed BIO tags reflect Base and recipe status and always request guide content", () => {
    assert.deepEqual(managedTagsFor({ hasRecipe: true }), ["#未人工檢查", "#需攻略補充"]);
    assert.deepEqual(managedTagsFor({ baseMaterial: true, hasRecipe: true, updated: true }),
        ["#待補充", "#更新需人工解析", "#需攻略補充"]);
    assert.deepEqual(managedTagsFor(), ["#待補充", "#需攻略補充"]);
});

test("managed tag rebuilding is idempotent and preserves custom YAML and body tags", () => {
    for (const yaml of [
        'tags: [待補充, "自訂,標籤", 未人工檢查]\n',
        'tags:\n  - 待補充\n  - "自訂,標籤"\n  - 未人工檢查\n'
    ]) {
        const original = "---\ntype: mc-item\nid: STICK\n" + yaml + "---\n\n#待補充\n#未人工檢查\n#需攻略補充\n#自訂\n![[圖片.png]]\n手寫說明\n";
        const state = { hasRecipe: true, updated: true };
        const candidate = rebuildManagedBIOtags(original, state);
        assert.equal(rebuildManagedBIOtags(candidate, state), candidate);
        assert.deepEqual(parseFrontmatter(candidate).tags, ["自訂,標籤"]);
        assert.equal(metadataIsAdditive(parseFrontmatter(original), parseFrontmatter(candidate)), true);
        assert.equal(preservesBIOContent(original, candidate), true);
        assert.match(candidate, /#未人工檢查\n#更新需人工解析\n#需攻略補充/);
        assert.doesNotMatch(candidate, /^#待補充$/m);
        assert.match(candidate, /#自訂\n!\[\[圖片.png\]\]\n手寫說明/);
        assert.equal(preservesBIOContent(original, candidate.replace("手寫說明\n", "")), false);
        assert.equal(preservesBIOContent(original, candidate.replace("#自訂\n", "")), false);
        assert.equal(preservesBIOContent(original, candidate.replace("![[圖片.png]]\n", "")), false);
    }
});

test("tag stripping preserves code fences, inline examples, comments and distinct tag names", () => {
    const examples = "````md\n<!-- sample\n```\n#待補充\n````\n" +
        "<!-- metadata\n#未人工檢查\n-->\n`#待補充`\n#待補充/自訂\n#未人工檢查完成\n";
    assert.equal(stripManagedBIOtags(examples + "#待補充\n"), examples);
    const mixed = "說明 #待補充 #自訂\n";
    assert.equal(stripManagedBIOtags(mixed), "說明  #自訂\n");
});

test("metadata permits removing managed YAML tags but never a custom tag", () => {
    assert.equal(metadataIsAdditive({ tags: ["待補充", "手動"] }, { tags: ["手動"] }), true);
    assert.equal(metadataIsAdditive({ tags: ["待補充", "手動"] }, { tags: [] }), false);
    assert.equal(metadataIsAdditive({ tags: ["待補充"] }, { tags: ["未人工檢查"] }), false);
    assert.deepEqual(parseFrontmatter("---\ntags: 待補充\n---\n").tags, ["待補充"]);
});

test("scanner keeps collection identities without indexing them as Minecraft items", t => {
    const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "obsf-bio-tags-test-"));
    t.after(() => {
        assert.ok(path.basename(temporary).startsWith("obsf-bio-tags-test-"));
        fs.rmSync(temporary, { recursive: true, force: true });
    });
    const folder = path.join(temporary, "MC");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "任意木材.md"),
        "---\ntype: mc-item\nid: PLANKS\nminecraft_tag: minecraft:planks\ntag_identity: minecraft:item_tag\n---\n");
    fs.writeFileSync(path.join(folder, "任意羊毛.md"),
        "---\ntype: mc-item\nderived_group: obsf:color_family/wool\ntag_identity: obsf:derived_ingredient_group\n---\n");
    fs.writeFileSync(path.join(folder, "橡木材.md"), "---\ntype: mc-item\nid: OAK_PLANKS\n---\n");
    const registry = scanMinecraftBIOs(folder, { vaultRoot: temporary });
    assert.equal(registry.entries.length, 3);
    assert.equal(registry.byNormalizedId.size, 1);
    assert.equal(registry.get("minecraft:planks"), null);
    assert.equal(registry.byLegacyId.has("PLANKS"), false);
    assert.equal(registry.get("minecraft:oak_planks").name, "橡木材");
    assert.equal(registry.entries.find(entry => entry.name === "任意木材").minecraft_tag, "minecraft:planks");
    assert.equal(registry.entries.find(entry => entry.name === "任意羊毛").derived_group, "obsf:color_family/wool");
    assert.deepEqual(registry.warnings, []);
});
