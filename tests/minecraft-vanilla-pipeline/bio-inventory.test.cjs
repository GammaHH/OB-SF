const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBIOInventory } = require("../../BIO相關模組/MC解析器模塊/bio/bio_inventory");

function doc(path, frontmatter, tags = []) { return { path, frontmatter, cacheReady: true, tags }; }

test("BIO inventory separates item, Tag and derived identities and excludes previews", () => {
    const inventory = buildBIOInventory([
        doc("MC/鐵錠.md", { type: "mc-item", id: "IRON_INGOT" }),
        doc("MC/任意木材.md", { type: "mc-item", id: "PLANKS", minecraft_tag: "minecraft:planks" }),
        doc("MC/任意羊毛.md", { type: "mc-item", derived_group: "obsf:color_family/wool" }),
        doc("MC-自動化BIO/preview/run/鐵錠.md", { type: "mc-item", id: "IRON_INGOT" }),
        doc("MC/鐵錠.preview.md", { type: "mc-item", id: "IRON_INGOT" }),
        doc("SF/工具.md", { type: "sf-item", id: "TOOL" })
    ]);
    assert.equal(inventory.get("item", "minecraft:iron_ingot").presence, "PRESENT");
    assert.equal(inventory.get("tag", "#minecraft:planks").presence, "PRESENT");
    assert.equal(inventory.get("item", "minecraft:planks").presence, "MISSING");
    assert.equal(inventory.get("group", "obsf:color_family/wool").presence, "PRESENT");
    assert.equal(inventory.stats.files, 3);
    assert.equal(inventory.stats.previewsExcluded, 2);
});

test("duplicate IDs are conflicts rather than an arbitrary existing BIO", () => {
    const inventory = buildBIOInventory([
        doc("MC/A.md", { type: "mc-item", id: "IRON_INGOT" }),
        doc("MC/B.md", { type: "mc-drop", minecraft_id: "minecraft:iron_ingot" })
    ]);
    assert.equal(inventory.get("item", "IRON_INGOT").presence, "CONFLICT");
    assert.equal(inventory.conflicts.length, 1);
    assert.equal(inventory.get("item", "wrong id").presence, "INVALID");
});

test("incomplete cache and legacy Tag IDs require confirmation instead of a false missing result", () => {
    const inventory = buildBIOInventory([
        { path: "MC/new.md", cacheReady: false },
        doc("MC/任意木材.md", { type: "mc-item", id: "PLANKS" }),
        doc("MC/broken.md", { type: "mc-item" })
    ], { legacyTagIds: ["PLANKS"] });
    assert.equal(inventory.stats.complete, false);
    assert.equal(inventory.get("item", "minecraft:iron_ingot").presence, "UNCONFIRMED");
    assert.deepEqual(inventory.diagnostics.map(entry => entry.code).sort(),
        ["METADATA_NOT_READY", "LEGACY_TAG_ID_REQUIRES_IDENTITY", "INVALID_BIO_IDENTITY"].sort());
});

test("a fresh inventory reflects renamed and removed files without treating tag absence as manual approval", () => {
    const fm = { type: "mc-item", id: "IRON_INGOT" };
    const first = buildBIOInventory([doc("MC/舊名.md", fm, ["#未人工檢查"])]);
    assert.equal(first.get("item", "IRON_INGOT").matches[0].manualReview, "PENDING");
    const moved = buildBIOInventory([doc("新的資料夾/鐵錠.md", fm)]);
    assert.equal(moved.get("item", "IRON_INGOT").matches[0].path, "新的資料夾/鐵錠.md");
    assert.equal(moved.get("item", "IRON_INGOT").matches[0].manualReview, "UNKNOWN");
    const updated = buildBIOInventory([doc("新的資料夾/鐵錠.md", fm, ["#更新需人工解析"])]);
    assert.equal(updated.get("item", "IRON_INGOT").matches[0].manualReview, "PENDING");
    assert.equal(buildBIOInventory([]).get("item", "IRON_INGOT").presence, "MISSING");
    assert.doesNotThrow(() => JSON.stringify(moved));
});

test("Templater inventory supports a require without resolve or cache and only writes inventory reports", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const vm = require("node:vm");
    const root = path.resolve(__dirname, "../..");
    const source = fs.readFileSync(path.join(root, "BIO engine/bio_inventory.js"), "utf8");
    const module = { exports: {} };
    const templaterRequire = name => require(name);
    assert.equal(templaterRequire.resolve, undefined);
    assert.equal(templaterRequire.cache, undefined);
    const runtime = { module, require: templaterRequire, globalThis: {} };
    vm.runInNewContext(source, runtime);
    const created = new Map();
    let opened;
    const app = {
        vault: {
            adapter: { basePath: root },
            getMarkdownFiles: () => [{ path: "MC/鐵錠.md" }],
            getAbstractFileByPath: () => null,
            read: () => { throw new Error("BIO bodies must not be read"); },
            createFolder: async folder => { assert.equal(folder, "BIO-輸出報告"); },
            create: async (filePath, content) => {
                assert.match(filePath, /^BIO-輸出報告\/Minecraft BIO Inventory-/);
                assert.equal(created.has(filePath), false);
                created.set(filePath, content);
                return { path: filePath };
            }
        },
        metadataCache: { getFileCache: () => ({ frontmatter: { type: "mc-item", id: "IRON_INGOT" } }) },
        workspace: { getLeaf: () => ({ openFile: async file => { opened = file.path; } }) }
    };
    assert.equal(await module.exports({ app }), "");
    assert.equal(created.size, 2);
    const inventoryJSON = [...created.entries()].find(([filePath]) => filePath.endsWith(".json"))[1];
    assert.equal(JSON.parse(inventoryJSON).stats.items, 1);
    assert.ok(opened.endsWith(".md"));
    assert.equal(runtime.globalThis.__obsfBIOInventories[root].get("item", "IRON_INGOT").presence, "PRESENT");
});
