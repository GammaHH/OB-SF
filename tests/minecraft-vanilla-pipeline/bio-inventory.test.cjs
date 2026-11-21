const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBIOInventory } = require("../../BIO相關模組/MC解析器模塊/bio/bio_inventory");
const { auditPreferred } = require("../../scripts/lib/bio-preferred-audit.cjs");

function doc(path, frontmatter, tags = []) { return { path, frontmatter, cacheReady: true, tags }; }

test('Preferred audit uses valid V4 routes and distinguishes explicit, implicit and detached markers', () => {
    const external = '### 外部取得\n';
    const make = (id, body, metadata = {}) => ({ path: 'MC/' + id + '.md', text: body,
        frontmatter: { type: 'mc-item', id, ...metadata } });
    const audit = auditPreferred([
        make('one', external + '- 採集'),
        make('multiple', external + '- 採集\n##### Addon\n- 交易'),
        make('valid', external + '<!-- preferred -->\n- 採集\n- 交易'),
        make('duplicate', external + '<!-- preferred -->\n- 採集\n<!-- preferred -->\n- 交易'),
        make('detached', '<!-- preferred -->\n### 外部取得\n- 採集'),
        make('invalid-recipe', '### 常規\n<!-- preferred -->\n- (Machine:: 無/手動)\n- [item:: 木材] (qty:: 0)'),
        make('ignored', '```md\n<!-- preferred -->\n```\n' + external + '- 採集\n- 交易', { base_material: true }),
        make('tag', '### Tag 代表材料\n- [item:: 木材]\n- [item:: 鐵錠]', { type: 'mc-tag' }),
        { path: '@自動化BIO Preview/讀取失敗.md', cacheReady: false }
    ]);
    const byId = new Map(audit.rows.map(row => [row.id, row]));
    assert.deepEqual(byId.get('one').statuses, ['SINGLE_ROUTE']);
    assert.deepEqual(byId.get('multiple').providers, ['Addon']);
    assert.deepEqual(byId.get('valid').statuses, ['VALID']);
    assert.deepEqual(byId.get('duplicate').statuses, ['MULTIPLE_PREFERRED']);
    assert.deepEqual(byId.get('detached').statuses, ['INVALID_PREFERRED']);
    assert.ok(byId.get('invalid-recipe').statuses.includes('NO_VALID_RECIPE'));
    assert.ok(byId.get('invalid-recipe').statuses.includes('INVALID_PREFERRED'));
    assert.deepEqual(byId.get('ignored').statuses, ['MISSING_PREFERRED']);
    assert.equal(byId.get('tag').choices, 2);
    assert.deepEqual(byId.get('tag').statuses, ['MISSING_PREFERRED']);
    assert.equal(audit.counts.READ_ERROR, 1);
    assert.equal(audit.complete, false);
});

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
    assert.equal(inventory.get("item", "slimefun:TOOL").presence, "PRESENT");
    assert.equal(inventory.stats.files, 4);
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

test('inventory separates Slimefun actual IDs from Minecraft materials and excludes all Preview artifacts', () => {
    const value = buildBIOInventory([
        { path:'SF-Test/罐頭.md',frontmatter:{type:'sf-item',id:'CAN',minecraft_id:'minecraft:iron_ingot'} },
        { path:'MC-物品資料庫/鐵錠.md',frontmatter:{type:'mc-item',id:'IRON_INGOT'} },
        { path:'@自動化BIO Preview/plugin/罐頭.preview.md',frontmatter:{type:'sf-item',id:'CAN'} },
        { path:'MC/正式候選.formal-candidate.md',frontmatter:{type:'mc-item',id:'IRON_INGOT'} }
    ]);
    assert.equal(value.get('item','slimefun:CAN').presence,'PRESENT');
    assert.equal(value.get('item','minecraft:iron_ingot').presence,'PRESENT');
    assert.equal(value.conflicts.length,0);
    assert.equal(value.stats.previewsExcluded,2);
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
            adapter: { basePath: root, read: async () => '<!-- obsf:formal-bio-roots:start -->\n| MC | true | true |\n<!-- obsf:formal-bio-roots:end -->' },
            getMarkdownFiles: () => [{ path: "MC/鐵錠.md" }],
            getAbstractFileByPath: () => null,
            read: async () => '---\ntype: mc-item\nid: IRON_INGOT\n---\n',
            createFolder: async folder => { assert.equal(folder, "BIO-輸出報告"); },
            create: async (filePath, content) => {
                assert.match(filePath, /^BIO-輸出報告\/BIO Inventory-/);
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
