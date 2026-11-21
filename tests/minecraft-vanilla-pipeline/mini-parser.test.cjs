const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RECIPE_MAPPING_FILE } = require('../../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping');
const root = path.resolve(__dirname, '../..');
const template = fs.readFileSync(path.join(root, '模板放置處/!模板-Mini Parser.md'), 'utf8').trim().replace(/^<%\*\s*/, '').replace(/%>$/, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function mapping(name = '表格冶煉爐') {
    return '| provider | machine | section | enabled |\n| --- | --- | --- | --- |\n| | ' + name + ' | 熔煉配方 | true |\n' +
        '<!-- obsf:machine-dictionary:start -->\n| machine_id | machine | enabled |\n| --- | --- | --- |\n' +
        '| SMELTERY | ' + name + ' | true |\n| MAGIC_WORKBENCH | 表格魔法台 | false |\n<!-- obsf:machine-dictionary:end -->\n' +
        '<!-- obsf:provider-headings:start -->\n| provider_folder | provider_id | heading | enabled |\n| --- | --- | --- | --- |\n' +
        '| SF-海曼科技院 | hayman | 海曼科技院 | true |\n<!-- obsf:provider-headings:end -->\n<!-- obsf:formal-bio-roots:start -->\n| MC-物品資料庫 | true | true |\n| SF-基礎機器(原版) | true | true |\n| SF-礦物資源(原版) | true | true |\n<!-- obsf:formal-bio-roots:end -->\n';
}

async function runMini(options = {}) {
    const mode = options.mode || 'manual', notices = [], writes = [], reads = [], outputDefaults = [], machineMenus = [];
    const folder = { path: 'SF-基礎機器(原版)', children: [] };
    const folders = [folder, { path: 'SF-海曼科技院', children: [] }, { path: 'SF-礦物資源(原版)', children: [] }];
    const iron = { path: 'MC-物品資料庫/鐵錠.md', basename: '鐵錠', fm: { type: 'mc-item', id: 'IRON_INGOT', minecraft_id: 'minecraft:iron_ingot' } };
    const target = { path: folder.path + '/測試物品.md', basename: '測試物品', fm: { type: 'sf-item', id: 'TEST_ITEM' } };
    const original = '---\ntype: sf-item\nid: TEST_ITEM\noutput: 9\n---\n\n# 合成/取得\n### 常規\n' +
        '- (Machine:: 舊設備)\n\t- [item:: OLD_ID] (qty:: 1)\n\t- [output:: 2]\n\n# 用途\n![[原圖片.png]]\n人工內容\n';
    const files = [...(options.previewOnly ? [{ ...iron, path: 'MC-自動化BIO/preview/batch/old/鐵錠.preview.md', basename: '鐵錠.preview' }] : [iron]), ...(options.append ? [target] : [])];
    const rawFile = mode === 'java' ? '參考資料/items.java' : '參考資料/items.yml';
    const raw = mode === 'java'
        ? 'new SlimefunItem(itemGroups.resources, SlimefunItems.TEST_ITEM, RecipeType.SMELTERY, new ItemStack[] { new ItemStack(Material.IRON_INGOT, 4) }).register(plugin)'
        : 'TEST_ITEM:\n  item:\n    amount: 7\n  recipe_type: SMELTERY\n  recipe:\n    1:\n      material: IRON_INGOT\n      amount: 4\n';
    const app = {
        metadataCache: { getFileCache: file => ({ frontmatter: file.fm }) },
        workspace: { getActiveFile: () => options.append ? target : null },
        vault: {
            getMarkdownFiles: () => files,
            getAllLoadedFiles: () => folders,
            getAbstractFileByPath: name => [...folders, ...files].find(file => file.path === name) || null,
            read: async () => original,
            createFolder: async () => {},
            create: async (path, content) => writes.push({ path, content }),
            process: async (file, transform) => {
                const content = transform(options.stale ? original + '其他程序修改' : original);
                writes.push({ path: file.path, content });
            },
            adapter: {
                list: async () => ({ files: [rawFile] }),
                read: async name => {
                    reads.push(name);
                    if (name === 'BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping.js') return fs.readFileSync(path.join(root, name), 'utf8');
                    if (name === 'BIO相關模組/搜尋介面模塊/bio_workspace.js') return fs.readFileSync(path.join(root, name), 'utf8');
                    if (name === RECIPE_MAPPING_FILE) return options.mappingText ?? mapping();
                    if (name === '參考資料/Minecraft/zh_tw.json') return JSON.stringify({ 'item.minecraft.iron_ingot': '鐵錠' });
                    if (name === rawFile) return raw;
                    throw new Error('Unexpected read: ' + name);
                }
            }
        }
    };
    const tp = { file: { create_new: async (content, name, open, destination) => writes.push({ path: destination.path + '/' + name + '.md', content }) },
        system: {
            prompt: async (message, initial) => {
                if (message.includes('新物品名稱')) return '測試物品';
                if (message.includes('物品唯一 ID')) return 'TEST_ITEM';
                if (message.includes('輸入 Tag 成員')) return '鐵錠, GOLD_INGOT';
                if (message.includes('幾種材料')) return '1';
                if (message.startsWith('材料 1/')) return '鐵錠';
                if (message.includes('需要幾個')) return '4';
                if (message.includes('每批 OUTPUT')) { outputDefaults.push(initial); return options.output || initial; }
                if (message.includes('三級生產體系')) return options.section || initial;
                if (message.includes('配方 NOTE')) return options.note || initial;
                throw new Error('Unexpected prompt: ' + message);
            },
            suggester: async (labels, values, unused, title) => {
                if (values.includes('create') && values.includes('append')) return options.append ? 'append' : 'create';
                if (values.includes('yaml') && values.includes('java')) return mode;
                if (values.includes('KEEP')) return 'KEEP';
                if (values.includes('NONE') && values.includes('EXISTING')) { machineMenus.push(values); return options.machine || '表格冶煉爐'; }
                if (values.includes('owner') && values.includes('foreign')) return options.foreign ? 'foreign' : 'owner';
                if (values.includes('apply') && values.includes('cancel')) return options.cancel ? 'cancel' : 'apply';
                if (title?.includes('追加配方的正式 BIO')) return target;
                if (title?.includes('新 BIO 建立資料夾')) return folder.path;
                if (title?.includes('提供這條配方的插件資料夾')) return 'SF-海曼科技院';
                if (title?.includes('BIO type')) return 'sf-item';
                if (title?.includes('實際提供此配方')) return 'SF-海曼科技院';
                throw new Error('Unexpected suggester: ' + title);
            }
        } };
    await new AsyncFunction('app', 'tp', 'Notice', 'console', template)(app, tp, function (message) { notices.push(message); }, { log() {}, warn() {}, table() {} });
    return { writes, notices, reads, outputDefaults, machineMenus, original };
}

test('Mini Parser uses editable dictionary for Java, YAML and manual while preserving 常規 structure and per-route output', async () => {
    for (const mode of ['java', 'yaml', 'manual']) {
        const value = await runMini({ mode, output: '3' });
        assert.equal(value.writes.length, 1, value.notices.join('\n'));
        const text = value.writes[0].content;
        assert.match(text, /\(Machine:: 表格冶煉爐\)/);
        assert.match(text, /^### 常規$/m);
        assert.doesNotMatch(text, /^### 熔煉配方$/m);
        assert.doesNotMatch(text, /^output:/m);
        assert.match(text, /\[output:: 3\]/);
        assert.match(text, /qty:: 4/);
        assert.match(text, /<!-- preferred -->\n- \*\*生產設備\*\*：/);
        assert.equal([...text.matchAll(/^<!-- preferred -->$/gm)].length, 1);
        assert.equal(value.reads.filter(name => name === RECIPE_MAPPING_FILE).length, 1);
        assert.equal(value.outputDefaults[0], mode === 'yaml' ? '7' : '1');
    }
});

test('Mini Parser creates only a Preview with explicit provider, chosen section and NOTE', async () => {
    const value = await runMini({ section: '熔煉體系', note: '操作備註' });
    assert.equal(value.writes.length, 1, value.notices.join('\n'));
    const { path, content } = value.writes[0];
    assert.match(path, /^@自動化BIO Preview\/mini\/.*\.preview\.md$/);
    assert.match(content, /^generated_by: obsf-mini-parser$/m);
    assert.match(content, /^#未人工檢查\n#需攻略補充$/m);
    assert.match(content, /preview_source: mini/);
    assert.match(content, /provider_id: "hayman"/);
    assert.match(content, /### 熔煉體系[\s\S]*##### 海曼科技院/);
    assert.match(content, /\[note:: 操作備註\]/);
    assert.doesNotMatch(content, /^output:/m);
});

test('Mini Parser custom Tag defaults to its first member without a preferred-member prompt', async () => {
    const value = await runMini({ mode: 'tag' });
    assert.equal(value.writes.length, 1, value.notices.join('\n'));
    const { content } = value.writes[0];
    assert.match(content, /^type: mc-tag$/m);
    assert.match(content, /^#待補充\n#需攻略補充$/m);
    assert.match(content, /^preview_mode: manual$/m);
    assert.match(content, /### Tag 代表材料\n\n<!-- preferred -->\n- \[item:: \[\[MC-物品資料庫\/鐵錠\|鐵錠\]\]\]\n- \[item:: GOLD_INGOT\]/);
    assert.equal([...content.matchAll(/^<!-- preferred -->$/gm)].length, 1);
    assert.doesNotMatch(content, /Machine::|qty::|output::|recipe_provider:/);
    assert.deepEqual(value.outputDefaults, []);
});

test('dictionary errors stop before writing and a canceled preview never writes', async () => {
    const bad = await runMini({ mappingText: mapping() + mapping() });
    assert.equal(bad.writes.length, 0); assert.ok(bad.notices.some(text => text.includes('Machine Dictionary')));
    const canceled = await runMini({ cancel: true });
    assert.equal(canceled.writes.length, 0);
});

test('unpublished materials remain IDs and dictionary-disabled machines do not leak into manual menu', async () => {
    const value = await runMini({ previewOnly: true });
    assert.equal(value.writes.length, 1, value.notices.join('\n'));
    assert.match(value.writes[0].content, /\[item:: IRON_INGOT\]/);
    assert.doesNotMatch(value.writes[0].content, /\[\[MC-自動化BIO/);
    assert.equal(value.machineMenus[0].includes('表格魔法台'), false);
});

test('disabled Java and YAML machine IDs stay raw rather than falling back to hardcoded Chinese', async () => {
    const disabled = mapping().replace('| SMELTERY | 表格冶煉爐 | true |', '| SMELTERY | 表格冶煉爐 | false |');
    for (const mode of ['java', 'yaml']) {
        const value = await runMini({ mode, mappingText: disabled });
        assert.equal(value.writes.length, 1, value.notices.join('\n'));
        assert.match(value.writes[0].content, /\(Machine:: SMELTERY\)/);
        assert.doesNotMatch(value.writes[0].content, /\(Machine:: (?:冶煉爐|表格冶煉爐)\)/);
    }
});
