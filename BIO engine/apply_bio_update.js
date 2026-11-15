module.exports = async function apply_bio_update(tp) {
    const path = require("node:path");
    const app = tp.app?.vault ? tp.app : globalThis.app;
    const root = app?.vault?.adapter?.basePath;
    if (!root || typeof app.vault.process !== "function") throw new Error("需要桌面 Obsidian 與 Vault.process 接口");
    const Notice = tp.obsidian?.Notice;
    if (typeof Notice !== "function") throw new Error("Templater 未提供 tp.obsidian.Notice，請透過 Templater 執行模板");
    const modulePath = path.join(root, "scripts", "lib", "bio-apply.cjs");
    const nodeRequire = require("node:module").createRequire(modulePath);
    delete nodeRequire.cache[nodeRequire.resolve(modulePath)];
    for (const dependency of [
        path.join(root, "BIO相關模組", "MC解析器模塊", "bio", "bio_update.js"),
        path.join(root, "BIO相關模組", "MC解析器模塊", "bio", "bio_tags.js"),
        path.join(root, "BIO相關模組", "MC解析器模塊", "bio", "machine_recipe_mapping.js"),
        path.join(root, "BIO相關模組", "MC解析器模塊", "bio", "bio_output.js"),
        path.join(root, "BIO相關模組", "MC解析器模塊", "bio", "bio_scanner.js"),
        path.join(root, "BIO相關模組", "搜尋介面模塊", "bio_reader_v4.js")
    ]) delete nodeRequire.cache[nodeRequire.resolve(dependency)];
    const { applyReviewedBIO, BIO_UPDATE_MERGE_VERSION } = nodeRequire(modulePath);
    const manifests = app.vault.getFiles().filter(file => file.name === "BIO Update Review.json")
        .sort((a, b) => b.path.localeCompare(a.path));
    if (!manifests.length) throw new Error("找不到更新審核資料；請先執行 preview <target> --update-existing");
    const manifestFile = await tp.system.suggester(manifests.map(file => file.path), manifests, false, "選擇已審核的更新批次");
    if (!manifestFile) return "";
    const manifest = JSON.parse(await app.vault.read(manifestFile));
    if (manifest.mergeVersion !== BIO_UPDATE_MERGE_VERSION) throw new Error("這是舊版更新批次，請重新產生 --update-existing 預覽後選擇新批次");
    const candidates = (manifest.plans || []).filter(plan => plan.sourcePath &&
        (plan.previewFilename || plan.candidateFilename && ["REVIEW", "ADDITIVE_UPDATE"].includes(plan.status)));
    if (!candidates.length) { new Notice("這個批次沒有既有 BIO 的更新預覽或正式候選"); return ""; }
    const plan = await tp.system.suggester(candidates.map(plan => plan.status + " ｜ " + plan.itemId + " ｜ " + plan.sourcePath),
        candidates, false, "選擇一份 BIO（每次只套用一份）");
    if (!plan) return "";
    const artifactPath = relative => {
        if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
            throw new Error("預覽／候選路徑不在本批次內");
        }
        const directory = path.resolve(root, path.dirname(manifestFile.path));
        const absolute = path.resolve(directory, relative);
        const within = path.relative(directory, absolute);
        if (!relative || !within || within.startsWith("..") || path.isAbsolute(within) || !/\.md$/i.test(absolute)) {
            throw new Error("預覽／候選路徑不在本批次內");
        }
        return path.relative(root, absolute).replaceAll("\\", "/");
    };
    const labels = [], actions = [];
    if (plan.previewFilename) { labels.push("開啟測試更新預覽（同批 Preview 連結）"); actions.push("preview"); }
    if (plan.candidateFilename) {
        labels.push("開啟正式候選（實際寫回內容）", "已檢查正式候選，進入套用確認");
        actions.push("inspect", "apply");
    }
    const action = await tp.system.suggester(labels, actions, false,
        plan.itemId + "：" + (plan.diagnostics || []).map(entry => entry.code).join("、"));
    if (action === "inspect" || action === "preview") {
        const candidateFile = app.vault.getAbstractFileByPath(artifactPath(action === "preview" ? plan.previewFilename : plan.candidateFilename));
        if (!candidateFile) throw new Error("找不到預覽／候選稿");
        await app.workspace.getLeaf(false).openFile(candidateFile);
        return "";
    }
    if (action !== "apply" || !plan.candidateFilename) return "";
    const confirmed = await tp.system.suggester(["取消", "確認：先建立 Git 還原點，再套用正式候選（不是測試預覽）"], [false, true], false,
        plan.sourcePath + " ｜ 原配方與人工內容保留；#更新需人工解析");
    if (confirmed !== true) return "";
    const result = await applyReviewedBIO({ vaultRoot: root, manifestPath: manifestFile.path, itemId: plan.itemId,
        confirmReview: true, write: async (sourcePath, transform) => {
            const file = app.vault.getAbstractFileByPath(sourcePath);
            if (!file || file.extension !== "md") throw new Error("原 BIO 已不存在或不是 Markdown");
            await app.vault.process(file, transform);
        } });
    new Notice("已套用 " + result.sourcePath + "；Git 還原點：" + result.ref, 20000);
    try {
        if (!app.vault.getAbstractFileByPath("BIO-輸出報告")) await app.vault.createFolder("BIO-輸出報告");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        await app.vault.create("BIO-輸出報告/BIO Apply-" + stamp + ".json", JSON.stringify(result, null, 2));
    } catch (error) {
        new Notice("BIO 已套用且 Git 還原點已建立，但套用報告未寫入：" + error.message, 20000);
    }
    return "";
};
