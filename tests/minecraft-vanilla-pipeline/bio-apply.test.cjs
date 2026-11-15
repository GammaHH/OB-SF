const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { applyReviewedBIO, BIO_UPDATE_MERGE_VERSION } = require("../../scripts/lib/bio-apply.cjs");
const { rebuildManagedBIOtags } = require("../../BIO相關模組/MC解析器模塊/bio/bio_tags");
const { parseMachineRecipeMappings, normalizeMachineRecipeSections } =
    require("../../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping");
const { normalizeBIOOutput } = require("../../BIO相關模組/MC解析器模塊/bio/bio_output");
const hash = text => createHash("sha256").update(text).digest("hex");

function git(root, ...args) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    return result.stdout.trim();
}

async function fixture(t, worktree = false, addMetadata = false, legacyTags = false) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "obsf-bio-apply-test-"));
    t.after(async () => {
        assert.ok(path.basename(temporary).startsWith("obsf-bio-apply-test-"));
        await fs.rm(temporary, { recursive: true, force: true });
    });
    const repository = path.join(temporary, "repository");
    await fs.mkdir(repository);
    git(repository, "init", "-b", "codex/test");
    git(repository, "config", "user.name", "BIO Test");
    git(repository, "config", "user.email", "bio-test@example.invalid");
    git(repository, "config", "core.autocrlf", "false");
    await fs.writeFile(path.join(repository, "unrelated.txt"), "HEAD content");
    git(repository, "add", "unrelated.txt");
    git(repository, "commit", "-m", "test baseline");
    let root = repository;
    if (worktree) {
        root = path.join(temporary, "worktree");
        git(repository, "worktree", "add", "-b", "codex/worktree", root);
    }
    const sourcePath = "MC-物品資料庫/鐵錠.md";
    await fs.mkdir(path.dirname(path.join(root, sourcePath)), { recursive: true });
    let original = "---\ntype: mc-item\nid: IRON_INGOT\n---\n\n# 合成/取得\n### 常規\n" +
        "<!-- preferred -->\n- (Machine:: 冶煉爐)\n- [item:: 鐵粉] (qty:: 1)\n![[圖片.png]]\n人工備註\n";
    if (legacyTags) original = original.replace("id: IRON_INGOT\n", "id: IRON_INGOT\ntags: [待補充, 手動]\n")
        .replace("# 合成/取得", "#待補充\n#自訂\n# 合成/取得") +
        "\n```md\n#待補充\n```\n<!-- sample\n#未人工檢查\n-->\n";
    let candidate = original.replace("# 合成/取得", "#更新需人工解析\n# 合成/取得")
        .replace("### 常規", "### 常規\n##### SF-基礎機器(原版)");
    if (addMetadata) candidate = candidate.replace("id: IRON_INGOT\n", "id: IRON_INGOT\nminecraft_id: minecraft:iron_ingot\n" +
        "base_material: true\ngenerator_schema: 2\naliases:\n  - IRON_INGOT\n  - minecraft:iron_ingot\n");
    candidate = rebuildManagedBIOtags(candidate, { baseMaterial: addMetadata, hasRecipe: true, updated: true });
    await fs.writeFile(path.join(root, sourcePath), original);
    const folder = "MC-自動化BIO/preview/test";
    await fs.mkdir(path.join(root, folder, "formal-candidates"), { recursive: true });
    await fs.writeFile(path.join(root, folder, "formal-candidates/candidate.formal-candidate.md"), candidate);
    const manifestPath = folder + "/BIO Update Review.json";
    const manifest = { schemaVersion: 1, mergeVersion: BIO_UPDATE_MERGE_VERSION, machineMappingSHA256: null, plans: [{ itemId: "minecraft:iron_ingot", status: "REVIEW",
        sourcePath, sourceSHA256: hash(original), candidateSHA256: hash(candidate), candidateFilename: "formal-candidates/candidate.formal-candidate.md" }] };
    await fs.writeFile(path.join(root, manifestPath), JSON.stringify(manifest));
    let writes = 0;
    const options = { vaultRoot: root, manifestPath, itemId: "minecraft:iron_ingot", confirmReview: true,
        write: async (relative, transform) => {
            writes++;
            const file = path.join(root, relative);
            const current = await fs.readFile(file, "utf8");
            await fs.writeFile(file, transform(current));
        } };
    return { root, sourcePath, original, candidate, manifest, options, writes: () => writes,
        refs: () => git(root, "for-each-ref", "--format=%(refname)", "refs/obsf/bio-checkpoints/") };
}

test("apply creates a verified Git restore point and leaves HEAD, staged and unrelated edits intact", async t => {
    const value = await fixture(t);
    await fs.writeFile(path.join(value.root, "unrelated.txt"), "staged content");
    git(value.root, "add", "unrelated.txt");
    await fs.writeFile(path.join(value.root, "unrelated.txt"), "unstaged content");
    const head = git(value.root, "rev-parse", "HEAD");
    const index = git(value.root, "write-tree");
    const indexFile = path.resolve(value.root, git(value.root, "rev-parse", "--git-path", "index"));
    const indexBytes = hash(await fs.readFile(indexFile));
    const result = await applyReviewedBIO(value.options);
    assert.equal(result.updated, true);
    assert.match(result.ref, /^refs\/obsf\/bio-checkpoints\//);
    assert.equal(git(value.root, "show", result.ref + ":" + value.sourcePath), value.original.trim());
    assert.equal(git(value.root, "rev-parse", "HEAD"), head);
    assert.equal(hash(await fs.readFile(indexFile)), indexBytes);
    assert.equal(git(value.root, "write-tree"), index);
    assert.equal(await fs.readFile(path.join(value.root, "unrelated.txt"), "utf8"), "unstaged content");
    assert.equal(await fs.readFile(path.join(value.root, value.sourcePath), "utf8"), value.candidate);
    git(value.root, "restore", "--source", result.ref, "--worktree", "--", value.sourcePath);
    assert.equal(await fs.readFile(path.join(value.root, value.sourcePath), "utf8"), value.original);
});

test("stale original and edited candidates stop before checkpoints or writes", async t => {
    const value = await fixture(t);
    const file = path.join(value.root, value.sourcePath);
    await fs.writeFile(file, value.original + "new edit");
    await assert.rejects(applyReviewedBIO(value.options), /原 BIO 已變更/);
    await fs.writeFile(file, value.original);
    await fs.appendFile(path.join(value.root, "MC-自動化BIO/preview/test/formal-candidates/candidate.formal-candidate.md"), "edited");
    await assert.rejects(applyReviewedBIO(value.options), /候選稿已變更/);
    assert.equal(value.writes(), 0);
    assert.equal(value.refs(), "");
});

test("verified additive Preview metadata can be written after a Git checkpoint", async t => {
    const value = await fixture(t, false, true);
    const result = await applyReviewedBIO(value.options);
    assert.equal(result.updated, true);
    assert.equal(await fs.readFile(path.join(value.root, value.sourcePath), "utf8"), value.candidate);
    assert.equal(git(value.root, "show", result.ref + ":" + value.sourcePath), value.original.trim());
});

test("old incomplete merge batches must be regenerated before applying", async t => {
    const value = await fixture(t);
    delete value.manifest.mergeVersion;
    await fs.writeFile(path.join(value.root, value.options.manifestPath), JSON.stringify(value.manifest));
    await assert.rejects(applyReviewedBIO(value.options), /舊版更新合併結果/);
    assert.equal(value.writes(), 0);
    assert.equal(value.refs(), "");
});

test("test preview filenames and preview-only plans cannot be used as formal candidates", async t => {
    const value = await fixture(t);
    value.manifest.plans[0].candidateFilename = "updates/鐵錠.update-preview.md";
    await fs.writeFile(path.join(value.root, value.options.manifestPath), JSON.stringify(value.manifest));
    await assert.rejects(applyReviewedBIO(value.options), /測試預覽不可作為正式候選/);
    value.manifest.plans[0].candidateFilename = null;
    value.manifest.plans[0].previewFilename = "updates/鐵錠.update-preview.md";
    await fs.writeFile(path.join(value.root, value.options.manifestPath), JSON.stringify(value.manifest));
    await assert.rejects(applyReviewedBIO(value.options), /沒有可套用的更新候選/);
    assert.equal(value.writes(), 0);
    assert.equal(value.refs(), "");
});

test("formal candidate bodies cannot publish preview ingredient links even with a refreshed hash", async t => {
    const value = await fixture(t);
    const candidate = value.candidate + "\n- (Machine:: 工作台)\n" +
        "- [item:: [[MC-自動化BIO/preview/batch/test/材料.preview]]] (qty:: 1)\n- [output:: 1]\n";
    value.manifest.plans[0].candidateSHA256 = hash(candidate);
    await fs.writeFile(path.join(value.root, "MC-自動化BIO/preview/test/formal-candidates/candidate.formal-candidate.md"), candidate);
    await fs.writeFile(path.join(value.root, value.options.manifestPath), JSON.stringify(value.manifest));
    await assert.rejects(applyReviewedBIO(value.options), /正式候選仍含測試 BIO 連結/);
    assert.equal(value.writes(), 0);
    assert.equal(value.refs(), "");
});

test("mapped Machine classification and legacy output removal retain a verified restore point", async t => {
    const value = await fixture(t);
    const mapping = "| provider | machine | section | enabled |\n| --- | --- | --- | --- |\n" +
        "| SF-基礎機器(原版) | 冶煉爐 | 熔煉配方 | true |\n";
    const rules = parseMachineRecipeMappings(mapping).rules;
    value.original = value.original.replace("id: IRON_INGOT\n", "id: IRON_INGOT\noutput: 7\n");
    const candidate = normalizeMachineRecipeSections(normalizeBIOOutput(value.candidate).text, { rules }).text;
    value.manifest.machineMappingSHA256 = hash(mapping);
    value.manifest.plans[0].sourceSHA256 = hash(value.original);
    value.manifest.plans[0].candidateSHA256 = hash(candidate);
    await fs.writeFile(path.join(value.root, "Minecraft Machine Recipe Mapping Draft.md"), mapping);
    await fs.writeFile(path.join(value.root, value.sourcePath), value.original);
    await fs.writeFile(path.join(value.root, "MC-自動化BIO/preview/test/formal-candidates/candidate.formal-candidate.md"), candidate);
    await fs.writeFile(path.join(value.root, value.options.manifestPath), JSON.stringify(value.manifest));
    const result = await applyReviewedBIO(value.options);
    assert.equal(git(value.root, "show", result.ref + ":" + value.sourcePath), value.original.trim());
    const written = await fs.readFile(path.join(value.root, value.sourcePath), "utf8");
    assert.match(written, /^### 熔煉配方$/m);
    assert.doesNotMatch(written, /^output:/m);
    assert.match(written, /!\[\[圖片.png\]\]\n人工備註/);
});

test("changed Machine Mapping blocks stale updates before any Git checkpoint or write", async t => {
    const value = await fixture(t);
    await fs.writeFile(path.join(value.root, "Minecraft Machine Recipe Mapping Draft.md"), "changed mapping\n");
    await assert.rejects(applyReviewedBIO(value.options), /Machine Mapping 已變更/);
    assert.equal(value.writes(), 0);
    assert.equal(value.refs(), "");
});

test("managed status resets preserve custom tags, examples and the exact Git restore point", async t => {
    const value = await fixture(t, false, false, true);
    const result = await applyReviewedBIO(value.options);
    const written = await fs.readFile(path.join(value.root, value.sourcePath), "utf8");
    assert.equal(written, value.candidate);
    assert.match(written, /#未人工檢查\n#更新需人工解析\n#需攻略補充/);
    assert.match(written, /tags: \[ 手動\]/);
    assert.match(written, /#自訂/);
    assert.match(written, /```md\n#待補充\n```\n<!-- sample\n#未人工檢查\n-->/);
    assert.equal(git(value.root, "show", result.ref + ":" + value.sourcePath), value.original.trim());
});

test("a candidate with missing or contradictory managed tags stops before checkpointing", async t => {
    const value = await fixture(t);
    const invalid = value.candidate.replace("#需攻略補充\n", "#待補充\n");
    await fs.writeFile(path.join(value.root, "MC-自動化BIO/preview/test/formal-candidates/candidate.formal-candidate.md"), invalid);
    value.manifest.plans[0].candidateSHA256 = hash(invalid);
    await fs.writeFile(path.join(value.root, value.options.manifestPath), JSON.stringify(value.manifest));
    await assert.rejects(applyReviewedBIO(value.options), /管理標籤不符合/);
    assert.equal(value.writes(), 0);
    assert.equal(value.refs(), "");
});

test("main branch and unconfirmed REVIEW cannot write a BIO", async t => {
    const value = await fixture(t);
    await assert.rejects(applyReviewedBIO({ ...value.options, confirmReview: false }), /尚未人工確認/);
    git(value.root, "branch", "-m", "main");
    await assert.rejects(applyReviewedBIO(value.options), /禁止在 main/);
    assert.equal(value.writes(), 0);
    assert.equal(value.refs(), "");
});

test("a failed Git checkpoint prevents every BIO write", async t => {
    const value = await fixture(t);
    git(value.root, "config", "user.name", "");
    await assert.rejects(applyReviewedBIO(value.options), /Git 還原點操作失敗/);
    assert.equal(value.writes(), 0);
    assert.equal(value.refs(), "");
    assert.equal(await fs.readFile(path.join(value.root, value.sourcePath), "utf8"), value.original);
});

test("a concurrent edit is not overwritten after creating the checkpoint", async t => {
    const value = await fixture(t);
    await assert.rejects(applyReviewedBIO({ ...value.options, write: async (relative, transform) => {
        await fs.writeFile(path.join(value.root, relative), value.original + "concurrent edit");
        transform(value.original + "concurrent edit");
    } }), /Git 還原點：refs\/obsf/);
    assert.match(value.refs(), /bio-checkpoints/);
    assert.equal(await fs.readFile(path.join(value.root, value.sourcePath), "utf8"), value.original + "concurrent edit");
});

test("deleted original lines are rejected even if the manifest hash was refreshed", async t => {
    const value = await fixture(t);
    const deleted = value.candidate.replace("![[圖片.png]]\n", "");
    await fs.writeFile(path.join(value.root, "MC-自動化BIO/preview/test/formal-candidates/candidate.formal-candidate.md"), deleted);
    value.manifest.plans[0].candidateSHA256 = hash(deleted);
    await fs.writeFile(path.join(value.root, value.options.manifestPath), JSON.stringify(value.manifest));
    await assert.rejects(applyReviewedBIO(value.options), /刪改原文/);
    assert.equal(value.refs(), "");
});

test("worktree .git files are supported and a second apply requires a fresh preview", async t => {
    const value = await fixture(t, true);
    assert.equal((await fs.stat(path.join(value.root, ".git"))).isFile(), true);
    await applyReviewedBIO(value.options);
    await assert.rejects(applyReviewedBIO(value.options), /原 BIO 已變更/);
    assert.equal(value.writes(), 1);
    assert.equal(value.refs().split("\n").length, 1);
});

test("Templater cancellation never reaches a write operation", async () => {
    const vm = require("node:vm");
    const root = path.resolve(__dirname, "../..");
    const source = await fs.readFile(path.join(root, "BIO engine/apply_bio_update.js"), "utf8");
    const manifestFile = { name: "BIO Update Review.json", path: "MC-自動化BIO/preview/test/BIO Update Review.json" };
    const plan = { status: "REVIEW", itemId: "minecraft:iron_ingot", sourcePath: "MC-物品資料庫/鐵錠.md", candidateFilename: "formal-candidates/candidate.formal-candidate.md" };
    let writes = 0;
    const app = { vault: { adapter: { basePath: root }, getFiles: () => [manifestFile],
        read: async () => JSON.stringify({ schemaVersion: 1, mergeVersion: BIO_UPDATE_MERGE_VERSION, plans: [plan] }), process: async () => { writes++; } } };
    const answers = [manifestFile, plan, "apply", false];
    const tp = { app, obsidian: { Notice: function () {} }, system: { suggester: async () => answers.shift() } };
    const module = { exports: {} };
    vm.runInNewContext(source, { module, require: name => {
        if (name === "obsidian") throw new Error("Cannot find module 'obsidian'");
        return require(name);
    } });
    assert.equal(await module.exports(tp), "");
    assert.equal(writes, 0);
    assert.equal(answers.length, 0);
});

async function templaterPreviewHarness(plan, action) {
    const vm = require("node:vm");
    const root = path.resolve(__dirname, "../..");
    const source = await fs.readFile(path.join(root, "BIO engine/apply_bio_update.js"), "utf8");
    const manifestFile = { name: "BIO Update Review.json", path: "MC-自動化BIO/preview/ui-test/BIO Update Review.json" };
    const answers = [manifestFile, plan, action];
    const opened = [], lookedUp = [], prompts = [];
    let writes = 0, applyCalls = 0;
    const app = {
        vault: {
            adapter: { basePath: root }, getFiles: () => [manifestFile],
            read: async () => JSON.stringify({ schemaVersion: 1, mergeVersion: BIO_UPDATE_MERGE_VERSION, plans: [plan] }),
            process: async () => { writes++; },
            getAbstractFileByPath: relative => { lookedUp.push(relative); return { path: relative, extension: "md" }; }
        },
        workspace: { getLeaf: () => ({ openFile: async file => { opened.push(file.path); } }) }
    };
    const tp = { app, obsidian: { Notice: function () {} }, system: { suggester: async (_labels, values) => {
        prompts.push([...values]);
        assert.ok(answers.length, "Preview or inspection must not request apply confirmation");
        return answers.shift();
    } } };
    const module = { exports: {} };
    vm.runInNewContext(source, { module, require: name => {
        if (name === "obsidian") throw new Error("Cannot find module 'obsidian'");
        if (name === "node:module") {
            const nativeModule = require(name);
            return { ...nativeModule, createRequire: filename => {
                const actualRequire = nativeModule.createRequire(filename);
                const trackedRequire = request => {
                    const loaded = actualRequire(request);
                    if (request !== filename) return loaded;
                    return { ...loaded, applyReviewedBIO: async () => {
                        applyCalls++;
                        throw new Error("Preview and inspection must never reach Git checkpoint or apply");
                    } };
                };
                trackedRequire.cache = actualRequire.cache;
                trackedRequire.resolve = actualRequire.resolve;
                return trackedRequire;
            } };
        }
        return require(name);
    } });
    return { run: () => module.exports(tp), opened, lookedUp, prompts, answers,
        writes: () => writes, applyCalls: () => applyCalls };
}

test("Templater opens an UNCHANGED preview-only plan without confirmation, Git or writes", async () => {
    const plan = { status: "UNCHANGED", itemId: "minecraft:iron_ingot", sourcePath: "MC-物品資料庫/鐵錠.md",
        previewFilename: "updates/鐵錠.update-preview.md", candidateFilename: null };
    const ui = await templaterPreviewHarness(plan, "preview");
    assert.equal(await ui.run(), "");
    assert.deepEqual(ui.opened, ["MC-自動化BIO/preview/ui-test/updates/鐵錠.update-preview.md"]);
    assert.deepEqual(ui.prompts[2], ["preview"]);
    assert.equal(ui.prompts.length, 3);
    assert.equal(ui.answers.length, 0);
    assert.equal(ui.applyCalls(), 0);
    assert.equal(ui.writes(), 0);
});

test("Templater preview and inspection open distinct preview and formal-candidate paths", async () => {
    const plan = { status: "REVIEW", itemId: "minecraft:iron_ingot", sourcePath: "MC-物品資料庫/鐵錠.md",
        previewFilename: "updates/鐵錠.update-preview.md",
        candidateFilename: "formal-candidates/鐵錠.formal-candidate.md" };
    for (const [action, expected] of [["preview", plan.previewFilename], ["inspect", plan.candidateFilename]]) {
        const ui = await templaterPreviewHarness(plan, action);
        assert.equal(await ui.run(), "");
        assert.deepEqual(ui.opened, ["MC-自動化BIO/preview/ui-test/" + expected]);
        assert.deepEqual(ui.prompts[2], ["preview", "inspect", "apply"]);
        assert.equal(ui.prompts.length, 3);
        assert.equal(ui.answers.length, 0);
        assert.equal(ui.applyCalls(), 0);
        assert.equal(ui.writes(), 0);
    }
});

test("Templater rejects a preview outside its batch before opening a file or writing", async () => {
    const plan = { status: "UNCHANGED", itemId: "minecraft:iron_ingot", sourcePath: "MC-物品資料庫/鐵錠.md",
        previewFilename: "../outside.md", candidateFilename: null };
    const ui = await templaterPreviewHarness(plan, "preview");
    await assert.rejects(ui.run(), /預覽／候選路徑不在本批次內/);
    assert.deepEqual(ui.opened, []);
    assert.deepEqual(ui.lookedUp, []);
    assert.equal(ui.prompts.length, 3);
    assert.equal(ui.answers.length, 0);
    assert.equal(ui.applyCalls(), 0);
    assert.equal(ui.writes(), 0);
});
