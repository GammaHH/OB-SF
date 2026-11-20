const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { parseFrontmatter } = require("../../BIO相關模組/MC解析器模塊/bio/bio_scanner");
const { metadataIsAdditive, BIO_UPDATE_MERGE_VERSION } = require("../../BIO相關模組/MC解析器模塊/bio/bio_update");
const { stripManagedBIOtags, publicationBlockingTags } = require("../../BIO相關模組/MC解析器模塊/bio/bio_tags");
const reader = require("../../BIO相關模組/搜尋介面模塊/bio_reader_v4");
const { RECIPE_MAPPING_FILE, parseMachineRecipeMappings, normalizeMachineRecipeSections } =
    require("../../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping");
const { normalizeBIOOutput } = require("../../BIO相關模組/MC解析器模塊/bio/bio_output");

const sha256 = value => createHash("sha256").update(value).digest("hex");

function git(root, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn("git", args, { cwd: root, env: { ...process.env, ...options.env },
            windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        const stdout = [], stderr = [];
        child.stdout.on("data", chunk => stdout.push(chunk));
        child.stderr.on("data", chunk => stderr.push(chunk));
        child.stdin.on("error", () => {});
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolve(Buffer.concat(stdout))
            : reject(new Error("Git 還原點操作失敗：" + Buffer.concat(stderr).toString("utf8").trim())));
        child.stdin.end(options.input);
    });
}

async function inside(root, relative) {
    if (typeof relative !== "string" || path.isAbsolute(relative)) throw new Error("必須使用 Vault 相對路徑");
    const absolute = path.resolve(root, relative);
    const check = path.relative(root, absolute);
    if (!check || check.startsWith("..") || path.isAbsolute(check) || check.split(path.sep).some(part => part.startsWith("."))) {
        throw new Error("路徑超出允許的 Vault 檔案範圍");
    }
    const realRoot = await fs.realpath(root), real = await fs.realpath(absolute);
    const physical = path.relative(realRoot, real);
    if (physical.startsWith("..") || path.isAbsolute(physical) || (await fs.lstat(absolute)).isSymbolicLink()) {
        throw new Error("不支援 Vault 外部連結或符號連結");
    }
    return absolute;
}

function addsOnlyLines(original, candidate) {
    const before = original.split(/\r?\n/), after = candidate.split(/\r?\n/);
    let index = 0;
    for (const line of after) if (index < before.length && line === before[index]) index++;
    return index === before.length;
}

function preservesBIOContent(original, candidate, rules = [], onDifference) {
    // Canonicalize only mapped Machine headers, excess recipe gaps, legacy
    // YAML output and managed tags. Custom tags, images and prose must survive.
    const providers = new Map();
    for (const route of reader.parseBIO(candidate).recipes) {
        if (!route.machine || !route.provider) continue;
        const values = providers.get(route.machine) ?? new Set();
        values.add(route.provider); providers.set(route.machine, values);
    }
    const resolveProvider = route => {
        const values = providers.get(route.machine);
        return values?.size === 1 ? [...values][0] : "";
    };
    const sourceOutput = normalizeBIOOutput(original), candidateOutput = normalizeBIOOutput(candidate);
    if ([...sourceOutput.diagnostics, ...candidateOutput.diagnostics].some(entry => entry.severity === "ERROR")) return false;
    const before = normalizeMachineRecipeSections(sourceOutput.text, { rules, resolveProvider }).text;
    const after = normalizeMachineRecipeSections(candidateOutput.text, { rules }).text;
    const oldBody = stripManagedBIOtags(before), newBody = stripManagedBIOtags(after);
    const preserved = addsOnlyLines(oldBody, newBody);
    if (!preserved && onDifference) onDifference(oldBody, newBody);
    return preserved;
}

async function checkpoint(root, sourcePath, original) {
    const top = (await git(root, ["rev-parse", "--show-toplevel"])).toString().trim();
    if (await fs.realpath(top) !== await fs.realpath(root)) throw new Error("Vault 必須是 Git 工作樹根目錄");
    const branch = (await git(root, ["branch", "--show-current"])).toString().trim();
    if (!branch || ["main", "master"].includes(branch)) throw new Error("禁止在 main/master 或 detached HEAD 套用 BIO 更新");
    const head = (await git(root, ["rev-parse", "HEAD"])).toString().trim();
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "obsf-bio-git-index-"));
    const env = { GIT_INDEX_FILE: path.join(temporary, "index") };
    const ref = "refs/obsf/bio-checkpoints/" + new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID();
    try {
        await git(root, ["read-tree", head], { env });
        const blob = (await git(root, ["hash-object", "-w", "--stdin"], { input: original })).toString().trim();
        await git(root, ["update-index", "--add", "--cacheinfo", "100644", blob, sourcePath], { env });
        const tree = (await git(root, ["write-tree"], { env })).toString().trim();
        const commit = (await git(root, ["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", head, "-m", "BIO pre-update checkpoint: " + sourcePath])).toString().trim();
        await git(root, ["update-ref", ref, commit, "0".repeat(head.length)]);
        const saved = await git(root, ["show", ref + ":" + sourcePath]);
        if (sha256(saved) !== sha256(original)) throw new Error("Git 還原點內容驗證失敗");
        return { ref, commit, branch, sourcePath, sourceSHA256: sha256(original) };
    } finally {
        // Only remove this invocation's uniquely created temporary index directory.
        const temporaryRelative = path.relative(os.tmpdir(), temporary);
        if (!temporaryRelative.startsWith("..") && path.basename(temporary).startsWith("obsf-bio-git-index-")) {
            await fs.rm(temporary, { recursive: true, force: true });
        }
    }
}

async function applyReviewedBIO(options) {
    if (typeof options.write !== "function") throw new Error("缺少 Vault 安全寫入接口");
    const root = path.resolve(options.vaultRoot);
    const manifestPath = await inside(root, options.manifestPath);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.plans)) throw new Error("更新審核資料格式不相容");
    if (manifest.mergeVersion !== BIO_UPDATE_MERGE_VERSION) throw new Error("舊版更新合併結果不可套用，請重新產生 --update-existing 預覽");
    const mappingRelative = RECIPE_MAPPING_FILE;
    let mappingBytes = null;
    try { mappingBytes = await fs.readFile(await inside(root, mappingRelative)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (manifest.machineMappingSHA256 !== (mappingBytes ? sha256(mappingBytes) : null)) {
        throw new Error("Machine Mapping 已變更或缺少驗證雜湊，請重新產生更新預覽");
    }
    const machineMapping = parseMachineRecipeMappings(mappingBytes?.toString("utf8") ?? "");
    if (mappingBytes && machineMapping.diagnostics.some(entry => entry.severity === "ERROR")) {
        throw new Error("Machine Mapping 格式錯誤，停止套用");
    }
    const matches = manifest.plans.filter(plan => plan.itemId === options.itemId);
    if (matches.length !== 1) throw new Error("更新目標缺失或重複");
    const plan = matches[0];
    if (!["ADDITIVE_UPDATE", "REVIEW"].includes(plan.status) || !plan.candidateFilename) throw new Error("沒有可套用的更新候選");
    if (!/^formal-candidates\/[^/]+\.formal-candidate\.md$/i.test(plan.candidateFilename)) {
        throw new Error("測試預覽不可作為正式候選；請重新產生更新批次並選擇 formal-candidates 內容");
    }
    if (plan.status === "REVIEW" && options.confirmReview !== true) throw new Error("REVIEW 項目尚未人工確認");
    if (!/^[a-f0-9]{64}$/.test(plan.sourceSHA256 || "") || !/^[a-f0-9]{64}$/.test(plan.candidateSHA256 || "")) {
        throw new Error("候選缺少驗證雜湊，請重新產生 --update-existing 預覽");
    }
    if (!plan.sourcePath?.endsWith(".md") || /(^|\/)preview\//i.test(plan.sourcePath) || /\.preview\.md$/i.test(plan.sourcePath)) {
        throw new Error("套用目標必須是正式 BIO");
    }
    const sourcePath = await inside(root, plan.sourcePath);
    const candidateRelative = path.relative(root, path.resolve(path.dirname(manifestPath), plan.candidateFilename));
    const candidatePath = await inside(root, candidateRelative);
    const relativeToManifest = path.relative(path.dirname(manifestPath), candidatePath);
    if (relativeToManifest.startsWith("..") || path.isAbsolute(relativeToManifest)) throw new Error("候選不在審核目錄內");
    const original = await fs.readFile(sourcePath), candidate = await fs.readFile(candidatePath);
    if (sha256(original) !== plan.sourceSHA256) throw new Error("原 BIO 已變更，請重新產生預覽；未寫回");
    if (sha256(candidate) !== plan.candidateSHA256) throw new Error("候選稿已變更，請重新產生預覽；未寫回");
    const originalText = original.toString("utf8"), candidateText = candidate.toString("utf8");
    const fm = parseFrontmatter(originalText);
    const id = String(fm?.minecraft_id || fm?.id || "").toLowerCase();
    if ((id.includes(":") ? id : "minecraft:" + id) !== plan.itemId || fm?.minecraft_tag || fm?.derived_group ||
        !["mc-item", "mc-drop"].includes(fm?.type)) {
        throw new Error("原 BIO identity 不符或為尚未支援寫回的 Tag／衍生群組");
    }
    const candidateMetadata = parseFrontmatter(candidateText);
    if ("output" in (candidateMetadata ?? {})) throw new Error("候選仍含 YAML output，請重新產生更新預覽");
    if (!preservesBIOContent(originalText, candidateText, machineMapping.rules) ||
        !metadataIsAdditive(fm, candidateMetadata, { allowOutputRemoval: true, allowManagedTags: true })) {
        throw new Error("候選包含刪改原文或 identity，停止套用");
    }
    const baseMaterial = candidateMetadata.base_material === "true";
    const parsed = reader.parseBIO(candidateText, { ...candidateMetadata, base_material: baseMaterial });
    if (parsed.recipes.some(route => route.ingredients.some(ingredient =>
        [ingredient, ...(ingredient.choices || [])].some(value =>
            /(?:^|[\\/])preview[\\/]|\.preview(?:\.md)?$/i.test(value.name || ""))))) {
        throw new Error("正式候選仍含測試 BIO 連結，停止套用");
    }
    const tags = publicationBlockingTags(candidateText);
    if (tags.length) throw new Error("正式候選仍有待審查標籤：" + tags.join("、") + "。請在更新 Preview 審查後移除，並走 scan-publication。");
    if (original.equals(candidate)) throw new Error("候選與原文相同，無須更新");
    const restorePoint = await checkpoint(root, plan.sourcePath, original);
    try {
        await options.write(plan.sourcePath, current => {
            if (sha256(current) !== plan.sourceSHA256) throw new Error("建立 Git 還原點期間原檔已變更，停止寫回");
            return candidateText;
        });
        if (sha256(await fs.readFile(sourcePath)) !== plan.candidateSHA256) throw new Error("寫回內容與候選不一致，請檢查插件或同步程式");
    } catch (error) {
        error.message += "；Git 還原點：" + restorePoint.ref;
        error.restorePoint = restorePoint;
        throw error;
    }
    return { ...restorePoint, mergeVersion: BIO_UPDATE_MERGE_VERSION, candidateSHA256: plan.candidateSHA256, updated: true };
}

module.exports = { applyReviewedBIO, addsOnlyLines, preservesBIOContent, BIO_UPDATE_MERGE_VERSION };
