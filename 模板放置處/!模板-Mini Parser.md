<%*
// ============================================================
// OB-SF Mini Parser 統合版（Java / YAML / 手動）
// - 正式 BIO + Preview + zh_tw 名稱候選，使用 ID 辨識；只連結正式 BIO
// - 中文名稱唯一候選自動採用；多候選人工挑選；未發布原版材料顯示 Preview 的 SF-ID（如 IRON_INGOT）
// - 所有配方都輸出 [output:: N]；未取得明確產量預設 1
// - 建立單一 BIO Preview，由集中 SCAN 與 Publisher 處理
// - 以根目錄 Recipe Mapping Draft.md 的 Provider Headings 決定跨插件 ##### 標題
// - 先預覽摘要，明確確認後才寫入
// ============================================================
const CONFIG = { referenceFolder: "參考資料", recipeMappingFile: null };
// Load the pure shared module from Vault text: no Obsidian require shim,
// require.resolve or stale CommonJS cache is involved. One table snapshot/run.
let recipeMappingText, MACHINE_DICT, formalRoots, isFormalPath, providers;
try {
    const sharedModule = { exports: {} };
    const sharedSource = await app.vault.adapter.read("BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping.js");
    new Function("module", "exports", sharedSource)(sharedModule, sharedModule.exports);
    CONFIG.recipeMappingFile = sharedModule.exports.RECIPE_MAPPING_FILE;
    recipeMappingText = await app.vault.adapter.read(CONFIG.recipeMappingFile);
    formalRoots = sharedModule.exports.formalRoots(recipeMappingText);
    isFormalPath = sharedModule.exports.isFormalPath;
    providers = sharedModule.exports.providerRecords(recipeMappingText);
    const dictionary = sharedModule.exports.parseMachineDictionary(recipeMappingText);
    if (dictionary.diagnostics.length) throw new Error(dictionary.diagnostics.map(value => value.message).join("；"));
    MACHINE_DICT = Object.assign(Object.create(null), Object.fromEntries(dictionary.machines));
} catch (error) {
    new Notice(`❌ 無法載入 Machine Dictionary：${error.message}`, 10000); return;
}
const folderRouting = new Map();
const routingBlock = recipeMappingText.match(/<!-- obsf:bio-folder-routing:start -->([\s\S]*?)<!-- obsf:bio-folder-routing:end -->/);
for (const [, routeMode, selector, folder] of (routingBlock?.[1] || "").matchAll(/^\s*\|\s*(java|yaml)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*true\s*\|\s*$/gm)) {
    const key = routeMode + ":" + selector;
    if (folderRouting.has(key)) { new Notice("❌ Folder Routing 重複：" + key); return; }
    folderRouting.set(key, folder);
}
const TYPE_TO_FIELD = { "mc-item": "item", "sf-item": "item", "mc-drop": "drop", "sf-drop": "drop", "sf-GEO": "GEO" };
const warnings = [];
const unresolved = [];
const cancel = message => { new Notice(message || "已取消 Mini Parser"); };
const escapeRe = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const positiveInt = value => /^\d+$/.test(String(value).trim()) && Number(value) > 0 && Number.isSafeInteger(Number(value));
const cleanId = value => String(value || "").trim();
const mcId = value => { const raw = String(value).trim().toLowerCase(); return raw.startsWith("minecraft:") ? raw : `minecraft:${raw}`; };
const escapeWikilink = value => String(value).replace(/[\[\]|]/g, "").replace(/\r?\n/g, " ");
const plainMachine = value => !value || value === "無/手動" ? "無/手動" : String(value);

// 0. Mini Parser 建立待審核的單一 Preview。
const mode = await tp.system.suggester(
    ["📄 解析 YAML 配方", "☕ 解析 Java 配方", "✏️ 手動建立配方", "🏷️ 自訂建立 Tag BIO"],
    ["yaml", "java", "manual", "tag"], false, "請選擇 Mini Parser 解析模式"
);
if (mode == null) { cancel(); return; }
const tagMode = mode === "tag";

// 1. 確立正在建立/追加的物品身分。正式 BIO 禁止 Preview / candidate。
const allMd = app.vault.getMarkdownFiles();
let itemName, itemId, nameAliases = [];
    const rawName = await tp.system.prompt("輸入新物品名稱（其他別名以空格分開）：");
    if (!rawName?.trim()) { cancel("未填物品名稱"); return; }
    [itemName, ...nameAliases] = rawName.trim().split(/\s+/);
    if (/[\\/:*?"<>|\[\]]/.test(itemName) || itemName === "." || itemName === "..") {
        new Notice("❌ 物品名稱包含不合法的檔名字元"); return;
    }
    itemId = cleanId(await tp.system.prompt("輸入物品唯一 ID（例如 STEEL_INGOT 或 HM_QKJCY）："));
    if (!itemId || !/^[A-Za-z0-9_:.-]+$/.test(itemId)) { new Notice("❌ 無效 ID"); return; }

// 2. 建立「正式 BIO + Preview + 原版翻譯」的唯讀身分索引。
//    Preview 只用來辨識 ID，永遠不會輸出指向 Preview 的 Wikilink。
const formal = [];
const byId = new Map(), byMinecraftId = new Map();
const identities = new Map();
const isPreviewFile = path => /(^|\/)preview(\/|$)/i.test(path) || /\.preview\.md$/i.test(path);
const isAuxiliaryFile = path => /\.(?:update-preview|formal-candidate)\.md$/i.test(path);
const normalizeName = value => String(value || "").trim().normalize("NFKC").toLocaleLowerCase();
const looksLikeId = value => /^[A-Za-z0-9_:.-]+$/.test(String(value || "").trim());
function addIdentity(key, id, source) {
    if (!identities.has(key)) identities.set(key, {
        key, id, source, formal: [], previews: [], names: new Set(), aliases: new Set(), translationOnly: false
    });
    return identities.get(key);
}
function registerAlias(identity, value) {
    if (value != null && String(value).trim()) identity.aliases.add(String(value).trim());
}
function index(indexMap, key, record) {
    if (typeof key !== "string" || !key.trim()) return;
    const k = key.trim();
    const values = indexMap.get(k) || [];
    if (!values.some(x => x.path === record.path)) values.push(record);
    indexMap.set(k, values);
}
for (const f of allMd) {
    if (isAuxiliaryFile(f.path)) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter || {};
    const type = String(fm.type || "");
    if (!TYPE_TO_FIELD[type] && type !== "mc-tag") continue;
    const preview = isPreviewFile(f.path);
    if (!preview && !isFormalPath(f.path, formalRoots)) continue;
    const rawMcId = String(fm.minecraft_id || "").trim();
    const rawId = String(fm.id || "").trim();
    const collection = Boolean(type === "mc-tag" || fm.minecraft_tag || fm.derived_group || fm.tag_identity);
    let identity, source, canonical;
    if (collection) {
        if (!rawId) continue;
        source = "tag";
        canonical = fm.minecraft_tag || fm.derived_group || rawId;
        identity = addIdentity(`tag:${canonical.toLowerCase()}`, rawId, source);
    } else if (type.startsWith("mc-")) {
        canonical = rawMcId ? mcId(rawMcId) : (rawId ? mcId(rawId) : "");
        if (!canonical || !looksLikeId(canonical)) continue;
        source = "minecraft";
        identity = addIdentity(`mc:${canonical}`, canonical, source);
    } else {
        if (!rawId || !looksLikeId(rawId)) continue;
        canonical = rawId;
        source = "slimefun";
        identity = addIdentity(`sf:${canonical}`, canonical, source);
    }
    const record = {
        path: f.path.replace(/\.md$/i, ""),
        name: f.basename.replace(/(?:--\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)?\.preview$/i, ""),
        type, collection, field: collection ? "item" : TYPE_TO_FIELD[type], id: rawId,
        minecraft_id: rawMcId, preview
    };
    if (preview) identity.previews.push(record);
    else {
        identity.formal.push(record);
        formal.push(record);
        index(byId, rawId, record);
        if (rawMcId) index(byMinecraftId, mcId(rawMcId), record);
    }
    identity.names.add(record.name);
    registerAlias(identity, rawId);
    registerAlias(identity, rawMcId);
    registerAlias(identity, fm.minecraft_tag);
    registerAlias(identity, fm.derived_group);
    const aliases = Array.isArray(fm.aliases) ? fm.aliases : (fm.aliases ? [fm.aliases] : []);
    for (const alias of aliases) registerAlias(identity, alias);
}
// 原版 zh_tw 提供額外的中文候選，讓尚未正式 Publish 的材料也能按名稱查 ID。
// 它是名稱線索，不代表已經有正式 BIO，也不能自動產生 Wikilink。
try {
    const translations = JSON.parse(await app.vault.adapter.read("參考資料/Minecraft/zh_tw.json"));
    for (const [key, name] of Object.entries(translations)) {
        const match = key.match(/^(?:item|block)\.minecraft\.([a-z0-9_./-]+)$/i);
        if (!match || typeof name !== "string" || !name.trim()) continue;
        const id = mcId(match[1]);
        const identity = addIdentity(`mc:${id}`, id, "minecraft");
        registerAlias(identity, name);
        if (!identity.formal.length && !identity.previews.length) identity.translationOnly = true;
    }
} catch (_) { /* 原版翻譯檔非必要：仍可查正式 BIO / Preview 名稱 */ }

function identityDisplay(x) {
    const name = [...x.names][0] || [...x.aliases].find(a => /[^\x00-\x7F]/.test(a)) || x.id;
    const status = x.formal.length === 1 ? "✅ 正式" :
        x.formal.length > 1 ? "⚠️ 正式 ID 衝突" :
        x.previews.length ? "🧪 Preview（未發布）" : "📚 翻譯索引";
    return `${name}｜${x.id}｜${status}`;
}
function lookupIdentities(query, sourceHint = "unknown") {
    const q = normalizeName(query);
    if (!q) return [];
    const candidates = [...identities.values()].filter(x => sourceHint === "unknown" || x.source === sourceHint);
    const terms = x => [...x.names, ...x.aliases, x.id].map(normalizeName);
    let found = candidates.filter(x => terms(x).some(term => term === q));
    // 精確名稱與 ID 優先；只有完全找不到才使用片段搜尋。
    if (!found.length && !looksLikeId(q)) found = candidates.filter(x => terms(x).some(term => term.includes(q)));
    return found.sort((a, b) => identityDisplay(a).localeCompare(identityDisplay(b), "zh-Hant"));
}
function mapSelection(identity) {
    const path = identity.formal.length === 1 ? identity.formal[0].path : null;
    if (identity.formal.length > 1) warnings.push(`ID 衝突，無法自動連結：${identity.id}（${identity.formal.map(r => r.path).join("、")}）`);
    return { id: identity.id, source: identity.source, selectedPath: path };
}
async function resolveMaterialInput(query, sourceHint = "unknown") {
    const raw = cleanId(query);
    const options = lookupIdentities(raw, sourceHint);
    if (options.length === 1) return mapSelection(options[0]); // 唯一候選自動選用，不多問一次
    if (options.length > 1) {
        const choices = options.slice(0, 80);
        const chosen = await tp.system.suggester(
            [...choices.map(identityDisplay), "✏️ 候選都不對：自行輸入 ID", "❌ 取消"],
            [...choices, "CUSTOM", "CANCEL"], false,
            `「${raw}」有 ${options.length} 個候選，請確認唯一物品 ID`
        );
        if (!chosen || chosen === "CANCEL") return null;
        if (chosen !== "CUSTOM") return mapSelection(chosen);
    }
    // 來源已是 ID：可保留為未發布材料，不強迫一定有 BIO。
    if (looksLikeId(raw)) return {
        id: sourceHint === "minecraft" || raw.toLowerCase().startsWith("minecraft:") ? mcId(raw) : raw,
        source: sourceHint === "minecraft" || raw.toLowerCase().startsWith("minecraft:") ? "minecraft" : sourceHint,
        selectedPath: null
    };
    // 找不到中文名稱時不能把中文直接寫成 SF-ID；要求輸入真正的 ID。
    const fallback = await tp.system.prompt(`找不到「${raw}」的唯一 ID；請輸入正確 SF-ID 或 minecraft:ID（取消即停止）：`);
    if (fallback == null) return null;
    const id = cleanId(fallback);
    if (!looksLikeId(id)) { new Notice("❌ 沒有可驗證的材料 ID，已停止建立"); return null; }
    return resolveMaterialInput(id, "unknown");
}
function matchMaterial(id, source) {
    const raw = cleanId(id);
    if (source === "minecraft" || raw.toLowerCase().startsWith("minecraft:")) {
        const canonical = mcId(raw);
        const direct = (byMinecraftId.get(canonical) || []).filter(x => x.type.startsWith("mc-"));
        if (direct.length) return direct;
        return (byId.get(canonical.slice("minecraft:".length).toUpperCase()) || [])
            .filter(x => x.type.startsWith("mc-"));
    }
    if (source === "slimefun") return (byId.get(raw) || []).filter(x => x.type.startsWith("sf-"));
    return byId.get(raw) || [];
}
function materialLine(mat, member = false) {
    const prefix = member ? "- " : "\t- ";
    const qty = member ? "" : ` (qty:: ${mat.qty})`;
    if (mat.selectedPath) {
        const record = formal.find(x => x.path === mat.selectedPath);
        if (record) return `${prefix}[${record.field}:: [[${record.path}|${escapeWikilink(record.name)}]]]${qty}`;
    }
    const matches = matchMaterial(mat.id, mat.source);
    if (matches.length === 1) {
        const found = matches[0];
        return `${prefix}[${found.field}:: [[${found.path}|${escapeWikilink(found.name)}]]]${qty}`;
    }
    // Minecraft 的正式識別碼用於身分查詢，但 BIO 尚未發布時，
    // 配方內容必須輸出 SF 相容 ID（例如 minecraft:iron_ingot -> IRON_INGOT）。
    // 優先採用 Preview frontmatter.id，僅在未有 Preview 身分資訊時推導大寫 ID。
    let id = mat.id;
    let canonicalMinecraftId = null;
    if (mat.source === "minecraft" || String(mat.id).toLowerCase().startsWith("minecraft:")) {
        canonicalMinecraftId = mcId(mat.id);
        const identity = identities.get(`mc:${canonicalMinecraftId}`);
        const seenIds = [...new Set([...(identity?.formal || []), ...(identity?.previews || [])]
            .map(record => record.id).filter(Boolean))];
        if (seenIds.length > 1) {
            // 多份 Preview 對同一 minecraft_id 使用不同 SF-ID，不能自動選用。
            unresolved.push({ id: canonicalMinecraftId, status: "CONFLICTING_PREVIEW_SF_ID", candidates: seenIds });
            warnings.push(`原版物品 ${canonicalMinecraftId} 對應不同 SF-ID：${seenIds.join("、")}；需人工處理`);
            return `${prefix}[item:: ${canonicalMinecraftId}]${qty}`;
        }
        id = seenIds[0] || canonicalMinecraftId.slice("minecraft:".length).replace(/[^a-z0-9_]/g, "_").toUpperCase();
        // 當 SF 插件與 Vanilla 有相同的 ID，保留原版 namespace 以避免日後重建誤指。
        if (identities.has(`sf:${id}`)) {
            unresolved.push({ id, source: canonicalMinecraftId, status: "CROSS_PROVIDER_ID_COLLISION" });
            warnings.push(`SF-ID ${id} 同時存在於 Minecraft 與 Slimefun，須人工處理，暫保留 ${canonicalMinecraftId}`);
            return `${prefix}[item:: ${canonicalMinecraftId}]${qty}`;
        }
    }
    unresolved.push({ id, minecraft_id: canonicalMinecraftId, status: matches.length ? "AMBIGUOUS_ID" : "UNPUBLISHED_ID", matches: matches.map(x => x.path) });
    return `${prefix}[item:: ${id}]${qty}`;
}

// 3. 解析結果（共用資料模型）
const result = { materials: [], machine: "無/手動", machinePath: null,
    output: 1, explicitOutput: false, level: "", group: "", aliases: [],
    energy: null, tickRate: null, capacity: null, sourcePath: "" };
function addMaterial(id, qty, source = "unknown", selectedPath = null) {
    const raw = cleanId(id);
    if (!raw || !positiveInt(qty)) return;
    const previous = result.materials.find(x => x.id === raw && x.source === source && x.selectedPath === selectedPath);
    if (previous) previous.qty += Number(qty);
    else result.materials.push({ id: raw, qty: Number(qty), source, selectedPath });
}
// 共用材料輸入表單：手動 / Java 補正 / YAML 補正三種模式共用。
async function promptAndAddMaterials() {
    const countStr = await tp.system.prompt("要輸入幾種材料？（0～9；可使用中文名稱或 ID）", "1");
    if (countStr == null) { cancel(); return false; }
    const count = Number(countStr);
    if (!Number.isInteger(count) || count < 0 || count > 9) { new Notice("❌ 材料種類必須介於 0～9"); return false; }
    for (let i = 0; i < count; i++) {
        const raw = await tp.system.prompt(`材料 ${i + 1}/${count}：輸入中文名稱、名稱片段或 SF-ID／minecraft:ID：`);
        if (raw == null) { cancel(); return false; }
        if (!raw.trim()) { new Notice("❌ 材料名稱／ID 不可空白"); return false; }
        const mapped = await resolveMaterialInput(raw, "unknown");
        if (!mapped) { cancel(); return false; }
        const qtyStr = await tp.system.prompt(`「${raw.trim()}」→ ${mapped.id}，需要幾個？`, "1");
        if (qtyStr == null) { cancel(); return false; }
        if (!positiveInt(qtyStr)) { new Notice("❌ 數量必須為正整數"); return false; }
        addMaterial(mapped.id, Number(qtyStr), mapped.source, mapped.selectedPath);
    }
    return true;
}
function parseJava(sourceText, id) {
    const esc = escapeRe(id);
    const reg = new RegExp(`\\bnew\\s+[\\w.]+\\s*\\(\\s*itemGroups\\.\\w+\\s*,\\s*SlimefunItems\\.${esc}\\b`, "g");
    const matches = [...sourceText.matchAll(reg)];
    if (matches.length !== 1) return null;
    const start = matches[0].index;
    const endAt = sourceText.indexOf(".register(plugin)", start);
    if (endAt < 0) return null;
    return sourceText.slice(start, endAt + ".register(plugin)".length);
}
function parseJavaRecipe(src) {
    result.group = src.match(/itemGroups\.([\w]+)/)?.[1] || "";
    const machineId = src.match(/RecipeType\.([A-Za-z0-9_]+)/)?.[1];
    result.machine = machineId ? (MACHINE_DICT[machineId] || machineId) : "無/手動";
    if (machineId && !MACHINE_DICT[machineId]) warnings.push(`未知設備類型：${machineId}`);
    const recipe = src.match(/new\s+ItemStack\s*\[\s*\]\s*\{([\s\S]*?)\}/);
    if (!recipe) { warnings.push("找不到 ItemStack[] 固定配方；請人工確認"); return; }
    let body = recipe[1];
    const sfAmount = /new\s+SlimefunItemStack\(\s*SlimefunItems\.([A-Za-z0-9_]+)\s*,\s*(\d+)\s*\)\s*\.item\(\)/g;
    body = body.replace(sfAmount, (_, id, qty) => { addMaterial(id, qty, "slimefun"); return ""; });
    const sfNormal = /SlimefunItems\.([A-Za-z0-9_]+)\s*\.item\(\)/g;
    body = body.replace(sfNormal, (_, id) => { addMaterial(id, 1, "slimefun"); return ""; });
    const vanilla = /new\s+ItemStack\(\s*Material\.([A-Za-z0-9_]+)(?:\s*,\s*(\d+))?\s*\)/g;
    body = body.replace(vanilla, (_, id, qty) => { addMaterial(id, qty || 1, "minecraft"); return ""; });
    // 不認識的材料語法不應當作已解析完成。
    body = body.replace(/\/\/[^\r\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
               .replace(/\bnull\b/g, "").replace(/[\s,]/g, "");
    if (body) warnings.push(`可能有未解析的 Java 材料表達式：${body.slice(0, 80)}`);
}
function extractYamlBlock(sourceText, id) {
    const lines = sourceText.split(/\r?\n/);
    const start = lines.findIndex(line => new RegExp(`^${escapeRe(id)}:\\s*(?:#.*)?$`).test(line));
    if (start < 0) return "";
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^\S[^\r\n]*:\s*(?:#.*)?$/.test(lines[i])) { end = i; break; }
    }
    return lines.slice(start, end).join("\n");
}
function parseYamlRecipe(src) {
    const yamlName = src.match(/^\s+name:\s*['"]?([^'"\r\n#]+)['"]?/m)?.[1]?.replace(/&[0-9a-fk-orlmn]/ig, "").trim();
    if (yamlName && yamlName !== itemName) result.aliases.push(yamlName);
    const lines = src.split(/\r?\n/);
    // item: 下方的 amount: 是此物品的產量，與材料 amount 不同。
    const index = lines.findIndex(line => /^([ \t]*)item:\s*$/.test(line));
    if (index >= 0) {
        const base = lines[index].match(/^\s*/)[0].replace(/\t/g, "    ").length;
        for (let i = index + 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const depth = lines[i].match(/^\s*/)[0].replace(/\t/g, "    ").length;
            if (depth <= base) break;
            const qty = lines[i].match(/^\s*amount:\s*(\d+)\s*(?:#.*)?$/)?.[1];
            if (qty && positiveInt(qty)) { result.output = Number(qty); result.explicitOutput = true; break; }
        }
    }
    const mt = src.match(/^\s+recipe_type:\s*['"]?([A-Za-z0-9_]+)['"]?/m)?.[1];
    result.machine = mt ? (MACHINE_DICT[mt] || mt) : "無/手動";
    if (mt && !MACHINE_DICT[mt]) warnings.push(`未知設備類型：${mt}`);
    const per = src.match(/^\s+per:\s*(\d+(?:\.\d+)?)\s*$/m)?.[1];
    const ticks = src.match(/^\s+tickRate:\s*(\d+(?:\.\d+)?)\s*$/m)?.[1];
    const capacity = src.match(/^\s+capacity:\s*(\d+(?:\.\d+)?)\s*$/m)?.[1];
    if (per != null) result.energy = Number(per) * 2; // 延續原工具每 0.5 秒為一 Slimefun tick 的計算
    if (ticks != null) result.tickRate = Number(ticks);
    if (capacity != null) result.capacity = Number(capacity);
    // 僅在 recipe: 子區塊辨識 material/amount。
    const recipeStart = lines.findIndex(line => /^([ \t]*)recipe:\s*$/.test(line));
    if (recipeStart < 0) { warnings.push("找不到 recipe 區塊"); return; }
    const baseIndent = lines[recipeStart].match(/^\s*/)[0].replace(/\t/g, "    ").length;
    let pending = null;
    function flush() {
        if (!pending) return;
        if (pending.qty == null) warnings.push(`材料 ${pending.id} 沒有明確 amount，預設 1`);
        addMaterial(pending.id, pending.qty ?? 1, "unknown");
        pending = null;
    }
    for (let i = recipeStart + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim() || /^\s*#/.test(line)) continue;
        const indent = line.match(/^\s*/)[0].replace(/\t/g, "    ").length;
        if (indent <= baseIndent) break;
        const material = line.match(/^\s*(?:-\s*)?material:\s*(?:"([^"]+)"|'([^']+)'|([^#\r\n]+?))\s*(?:#.*)?$/)?.slice(1).find(Boolean)?.trim();
        if (material) { flush(); pending = { id: material, qty: null }; continue; }
        const qty = line.match(/^\s*amount:\s*(\d+)\s*(?:#.*)?$/)?.[1];
        if (pending && qty && positiveInt(qty)) { pending.qty = Number(qty); continue; }
        // 支援固定列表格式；不認識的巢狀特殊配方標記為待人工審查。
        if (/^\s*-\s*\S/.test(line)) warnings.push(`未辨識的 YAML 配方項目：${line.trim().slice(0, 60)}`);
    }
    flush();
}

let tagMembers, preferredMember;
if (tagMode) {
    const input = await tp.system.prompt("輸入 Tag 成員的中文名稱或 ID，以逗號或換行分隔：", "", false, true);
    const names = input?.split(/[\n,，、]/).map(name => name.trim()).filter(Boolean);
    if (!names?.length) { cancel("請至少填入一個 Tag 成員"); return; }
    tagMembers = [];
    const seen = new Set();
    for (const name of names) {
        const member = await resolveMaterialInput(name);
        if (!member) { cancel("未確認 Tag 成員：" + name); return; }
        const key = member.selectedPath || `${member.source}:${normalizeName(member.id)}`;
        if (seen.has(key)) { cancel("重複的 Tag 成員：" + name); return; }
        seen.add(key);
        tagMembers.push({ ...member, label: name });
    }
    preferredMember = tagMembers[0];
} else if (mode !== "manual") {
    let list;
    try { list = await app.vault.adapter.list(CONFIG.referenceFolder); }
    catch (e) { new Notice(`❌ 無法讀取 ${CONFIG.referenceFolder}：${e.message}`); return; }
    // 沿用舊工具的「參考資料」直接子檔案搜尋。
    const suffix = mode === "java" ? /\.(?:java|txt|md)$/i : /\.(?:yml|yaml|txt|md)$/i;
    const paths = (list.files || []).filter(x => suffix.test(x));
    const candidates = [];
    let levelCandidate = "";
    for (const path of paths) {
        let source;
        try { source = await app.vault.adapter.read(path); }
        catch (e) { warnings.push(`讀取失敗：${path}`); continue; }
        if (mode === "java") {
            const found = parseJava(source, itemId);
            if (found) candidates.push({ path, block: found });
            // Research 登錄可能不在同一份 Java。
            if (!levelCandidate) {
                const escaped = escapeRe(itemId);
                const blocks = source.match(/register\([\s\S]*?\);/g) || [];
                for (const block of blocks) {
                    if (!new RegExp(`SlimefunItems\\.${escaped}\\b`).test(block)) continue;
                    const value = block.match(/register\(\s*"[^"]*"\s*,\s*\d+\s*,\s*"[^"]*"\s*,\s*(\d+)/)?.[1];
                    if (value) { levelCandidate = value; break; }
                }
            }
        } else {
            const block = extractYamlBlock(source, itemId);
            if (block) candidates.push({ path, block });
            if (!levelCandidate) {
                for (const b of source.split(/\n(?=[A-Za-z0-9_]+:)/)) {
                    if (!new RegExp(`-\\s*${escapeRe(itemId)}\\b`).test(b)) continue;
                    levelCandidate = b.match(/levelCost:\s*(\d+)/)?.[1] || "";
                    if (levelCandidate) break;
                }
            }
        }
    }
    if (candidates.length !== 1) {
        new Notice(`❌ ${mode.toUpperCase()} 來源符合 ${candidates.length} 筆；須唯一，請檢查參考資料或改用手動模式。`, 9000);
        console.warn("[Mini Parser] matches", candidates.map(x => x.path));
        return;
    }
    const candidate = candidates[0];
    result.sourcePath = candidate.path;
    result.level = levelCandidate;
    if (mode === "java") {
        parseJavaRecipe(candidate.block);
        const escaped = escapeRe(itemId);
        const explicit = candidate.block.match(new RegExp(`new\\s+SlimefunItemStack\\(\\s*SlimefunItems\\.${escaped}\\s*,\\s*(\\d+)\\s*\\)\\s*\\.item\\(\\)`))?.[1];
        if (explicit && positiveInt(explicit)) { result.output = Number(explicit); result.explicitOutput = true; }
    } else parseYamlRecipe(candidate.block);
    if (!result.materials.length) warnings.push("未解析到任何材料；請確認是否為特殊配方或改用手動模式");
    if (!result.explicitOutput) warnings.push("來源未明確提供批產量；預設 1，請人工確認");
    // Java/YAML 共用：已解析出的每項材料也經過「名稱 / ID → 候選」解析。
    // ID 直接唯一匹配就自動選用；中文名稱可以來自 YAML material 欄位。
    const parsedMaterials = [...result.materials];
    result.materials = [];
    for (const mat of parsedMaterials) {
        const mapped = await resolveMaterialInput(mat.id, mat.source);
        if (!mapped) { cancel(`未確認材料：${mat.id}`); return; }
        addMaterial(mapped.id, mat.qty, mapped.source, mapped.selectedPath);
    }
    const correction = await tp.system.suggester(
        ["✅ 使用解析結果（不加材料）", "➕ 用中文名稱／ID 補加材料", "♻️ 用中文名稱／ID 重建材料清單"],
        ["KEEP", "ADD", "REPLACE"], false, "Java／YAML 材料確認；三種模式都能以中文搜尋 ID"
    );
    if (correction == null) { cancel(); return; }
    if (correction === "REPLACE") result.materials = [];
    if (correction === "ADD" || correction === "REPLACE") {
        if (!(await promptAndAddMaterials())) return;
    }
} else {
    // 手動模式：選設備，再選既有 BIO 或輸入新 ID。
    const machineChoice = await tp.system.suggester(
        ["🔧 無/手動", "📎 從現有 BIO 選擇設備", "✏️ 手動輸入設備名稱或 ID", ...new Set(Object.values(MACHINE_DICT))],
        ["NONE", "EXISTING", "CUSTOM", ...new Set(Object.values(MACHINE_DICT))], false, "選擇生產設備"
    );
    if (machineChoice == null) { cancel(); return; }
    if (machineChoice === "EXISTING") {
        const options = formal.filter(x => !x.collection).map(x => ({ label: `${x.name}｜${x.path}`, value: x }));
        const picked = await tp.system.suggester(options.map(x => x.label), options.map(x => x.value), false, "選擇設備 BIO");
        if (!picked) { cancel(); return; }
        result.machine = picked.name;
        result.machinePath = picked.path;
    } else if (machineChoice === "CUSTOM") {
        const typed = await tp.system.prompt("輸入設備名稱或 ID：");
        if (typed === null) { cancel(); return; }
        result.machine = typed.trim() || "無/手動";
    } else result.machine = machineChoice === "NONE" ? "無/手動" : machineChoice;

    if (!(await promptAndAddMaterials())) return;
    if (!result.materials.length) warnings.push("手動配方沒有材料；待人工補充");
}

// 4. OUTPUT：一律詢問，預設為 1；若來源能解析出產量則帶入來源值。
if (!tagMode) {
    const outputStr = await tp.system.prompt("本條配方每批 OUTPUT（產量）是多少？", String(result.output || 1));
    if (outputStr === null) { cancel(); return; }
    if (!positiveInt(outputStr)) { new Notice("❌ OUTPUT 必須為正整數"); return; }
    result.output = Number(outputStr);
}

// 5. 確認 BIO 所在資料夾。既有 BIO 沿用原路徑；新 BIO 保留原先自動分類。
const folders = app.vault.getAllLoadedFiles().filter(x => Array.isArray(x.children) && x.path && isFormalPath(x.path + "/example.md", formalRoots));
if (!folders.length) { new Notice("❌ 找不到任何資料夾"); return; }
const byFolder = new Map(folders.map(x => [x.path, x]));
let targetFolder = null;
let destination = null;
    const preferredFolder = folderRouting.get(mode + ":" + (mode === "java" ? result.group : itemId.split("_")[0]));
    targetFolder = preferredFolder ? byFolder.get(preferredFolder) : null;
    if (!targetFolder) {
        const paths = folders.map(x => x.path).sort((a, b) => a.localeCompare(b, "zh-Hant"));
        const chosen = await tp.system.suggester(paths.map(x => `📁 ${x}`), paths, false, "選擇新 BIO 建立資料夾");
        if (chosen == null) { cancel(); return; }
        targetFolder = byFolder.get(chosen);
    }
    if (!targetFolder) { new Notice("❌ 資料夾選擇失敗"); return; }
    destination = `${targetFolder.path}/${itemName}.md`;
    if (app.vault.getAbstractFileByPath(destination)) { new Notice(`❌ 已存在同名 BIO：${destination}`); return; }
    const idCollision = [...(byId.get(itemId) || []), ...(byMinecraftId.get(itemId) || [])]
        .filter(record => record.collection === tagMode)
        .filter((r, i, a) => a.findIndex(x => x.path === r.path) === i);
    if (idCollision.length) {
        new Notice(`❌ ID 已存在正式 BIO，停止建立：${itemId}`, 10000);
        console.table(idCollision);
        return;
    }

const types = Object.keys(TYPE_TO_FIELD);
const type = tagMode ? "mc-tag" : await tp.system.suggester(types, types, false, "選擇 BIO type");
if (!tagMode && !types.includes(type)) { cancel(); return; }

let sourceProvider, section, note = "";
if (!tagMode) {
    const providerFolders = [...providers.keys()];
    sourceProvider = await tp.system.suggester(
        [...providerFolders.map(folder => providers.get(folder).heading + "｜" + folder), "待 Review 確認"],
        [...providerFolders, ""], false, "選擇實際提供此配方的插件"
    );
    if (sourceProvider == null) { cancel(); return; }
    section = (await tp.system.prompt("三級生產體系：", "常規"))?.trim();
    if (!section || /[#\r\n]/.test(section) || ["外部取得", "Tag 代表材料"].includes(section)) { cancel("三級生產體系無效"); return; }
    note = await tp.system.prompt("配方 NOTE（可留空）：", "");
    if (note == null) { cancel(); return; }
}
const providerHeading = providers.get(sourceProvider)?.heading;
const providerId = providers.get(sourceProvider)?.id || "";

// 6. 格式化 BIO（各模式一律保留每條 output）
let machineText = plainMachine(result.machine);
if (result.machinePath) machineText = `[[${result.machinePath}|${escapeWikilink(result.machine)}]]`;
else if (machineText !== "無/手動") {
    // 機器名稱只是顯示標籤；唯一對應同名正式 BIO 時才建立 wikilink。
    const options = formal.filter(x => !x.collection && x.name === machineText);
    if (options.length === 1) machineText = `[[${options[0].path}|${escapeWikilink(options[0].name)}]]`;
}
const recipeLines = ["<!-- preferred -->", `- **生產設備**：(Machine:: ${machineText})`, "\t**合成所需**："];
for (const mat of result.materials) recipeLines.push(materialLine(mat));
recipeLines.push(`\t- [output:: ${result.output}]`);
if (result.energy != null) recipeLines.push(`\t- [note:: 耗電量 ${result.energy} J/s]`);
if (result.tickRate != null) recipeLines.push(`\t- [note:: 生產間隔 ${result.tickRate * 0.5} 秒（${result.tickRate} 黏液刻）]`);
if (result.capacity != null) recipeLines.push(`\t- [note:: 儲電容量 ${result.capacity} J]`);
if (note.trim()) recipeLines.push(`\t- [note:: ${note.trim().replace(/[\r\n]+/g, " ").replaceAll("]", "］")}]`);
const aliases = [...new Set([...nameAliases, ...result.aliases, itemId])].filter(x => x && x !== itemName);
const reviewTag = tagMode ? "#待補充" : "#未人工檢查";
const insideRegular = providerHeading
            ? `##### ${providerHeading}\n\n${recipeLines.join("\n")}` : recipeLines.join("\n");
const recipeMetadata = tagMode ? "" :
    `recipe_provider: ${JSON.stringify(sourceProvider)}\nprovider_id: ${JSON.stringify(providerId)}\nlevel: ${result.level}\n`;
const recipeBody = tagMode
    ? "### Tag 代表材料\n\n" + tagMembers.map(member =>
        (member === preferredMember ? "<!-- preferred -->\n" : "") + materialLine(member, true)).join("\n")
    : `### ${section}\n\n${insideRegular}`;
const content = `---
type: ${type}
id: ${JSON.stringify(itemId)}
generated_by: obsf-mini-parser
preview_source: mini
preview_mode: ${tagMode ? "manual" : mode}
preview_evidence: ${JSON.stringify(result.sourcePath || "manual")}
publish_target: ${JSON.stringify(destination)}
${recipeMetadata}aliases: ${JSON.stringify(aliases)}
---

${reviewTag}
#需攻略補充
# 合成/取得

${recipeBody}

# 用途

- 

# 產物

- 
`;

// 7. 先看解析摘要 / 預覽全文（Console），再明確確認建立。
const summary = (tagMode ? [
    `Tag BIO：${itemName}　ID：${itemId}`,
    `成員：${tagMembers.length}　首選：${preferredMember.label}　未連結 ID：${unresolved.length}`,
    `寫入位置：${destination}`
] : [
    `模式：${mode.toUpperCase()}　物品：${itemName}　ID：${itemId}`,
    `設備：${machineText}　OUTPUT：${result.output}`,
    `材料種類：${result.materials.length}　未連結 ID：${unresolved.length}　警告：${warnings.length}`,
    `配方來源：${sourceProvider}${providerHeading ? ` → ##### ${providerHeading}` : "（常規）"}`,
    `寫入位置：${destination}`
]).join("\n");
console.log("[Mini Parser] BIO 預覽全文：\n" + content);
console.log("[Mini Parser] 解析摘要：\n" + summary);
if (warnings.length) console.warn("[Mini Parser] 警告", warnings);
if (unresolved.length) console.table(unresolved);
let confirmed = false;
while (true) {
    const action = await tp.system.suggester(
        ["🧪 預覽摘要（不寫入）", "✅ 建立 BIO Preview", "❌ 取消"],
        ["preview", "apply", "cancel"], false,
        `Mini Parser｜${itemName}｜${tagMode ? "成員 " + tagMembers.length : "OUTPUT " + result.output}｜未連結 ${unresolved.length}｜警告 ${warnings.length}`
    );
    if (action === "preview") { new Notice(summary + (warnings.length ? `\n警告：${warnings.slice(0, 3).join("；")}` : "") + "\n（全文見開發者 Console）", 12000); continue; }
    if (action === "apply") { confirmed = true; break; }
    cancel(); return;
}
if (!confirmed) return;
// 使用獨立路徑，不覆蓋其他同 ID Preview，交由集中 SCAN 報告重複。
const previewRoot = "MC-自動化BIO/preview/mini";
try {
    for (const folder of ["MC-自動化BIO", "MC-自動化BIO/preview", previewRoot]) {
        if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const previewPath = `${previewRoot}/${itemName}--${stamp}.preview.md`;
    await app.vault.create(previewPath, content);
    new Notice(`✅ 已建立 BIO Preview：${previewPath}`, 9000);
} catch (error) {
    new Notice(`❌ 無法建立 BIO Preview：${error.message}`, 10000);
}
%>
