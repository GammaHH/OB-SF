// Pure report construction and analysis limits, shared by DataviewJS and Templater.
const DEFAULT_LIMITS = Object.freeze({
    maxDepth: 200, maxNodes: 1000, maxMilliseconds: 30000, maxMermaidNodes: 200
});

function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : String(Number(Number(value).toFixed(4)));
}

function createBudget(options = {}, now = () => Date.now()) {
    const limits = { ...DEFAULT_LIMITS, ...options };
    const started = now();
    let nodes = 0;
    let exhausted = false;
    let forcedReason = "";
    const reasons = new Set();
    function check(depth) {
        let reason = forcedReason;
        if (forcedReason) reason = forcedReason;
        else if (depth > limits.maxDepth) reason = "超過遞歸深度 " + limits.maxDepth;
        else if (nodes >= limits.maxNodes) reason = "超過展開節點 " + limits.maxNodes;
        else if (now() - started >= limits.maxMilliseconds) reason = "超過分析時間 " + limits.maxMilliseconds / 1000 + " 秒";
        if (reason) {
            reasons.add(reason);
            if (depth <= limits.maxDepth) exhausted = true;
        }
        return { allowed: !reason, reason };
    }
    return {
        limits,
        check,
        enter(depth) {
            const permit = check(depth);
            if (permit.allowed) nodes++;
            return permit;
        },
        stop(reason) {
            forcedReason = reason;
            reasons.add(reason);
            exhausted = true;
        },
        get nodes() { return nodes; },
        get exhausted() { return exhausted; },
        snapshot() {
            return { limits: { ...limits }, visitedNodes: nodes, elapsedMilliseconds: now() - started,
                truncated: reasons.size > 0, reasons: [...reasons] };
        }
    };
}

function cleanTree(tree) {
    const root = {};
    const stack = [[tree, root]];
    const seen = new Set();
    while (stack.length) {
        const [node, result] = stack.pop();
        for (const key of [
            "name", "type", "required", "output", "batches", "machine", "section",
            "selectedRecipeKey", "tagRepresentative", "acquisition", "notes", "leaf",
            "unresolved", "cycle", "truncated", "reason", "placeholder", "unavailable"
        ]) {
            if (node[key] != null) result[key] = node[key];
        }
        result.path = node.page?.file?.path || node.path || "";
        result.children = [];
        if (seen.has(node)) {
            result.cycle = true;
            result.leaf = true;
            continue;
        }
        seen.add(node);
        for (const child of node.children || []) {
            const value = {};
            result.children.push(value);
            stack.push([child, value]);
        }
    }
    return root;
}

function sortedMaterials(source) {
    return [...source.values()].map(item => ({
        name: item.name, path: item.page?.file?.path || "", type: item.type || "",
        qty: item.qty, status: item.status || ""
    })).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

function walkTree(tree, visitor) {
    const stack = [tree];
    while (stack.length) {
        const node = stack.pop();
        visitor(node);
        for (let index = (node.children || []).length - 1; index >= 0; index--) stack.push(node.children[index]);
    }
}

function postOrder(tree) {
    const result = [];
    const stack = [[tree, false]];
    while (stack.length) {
        const [node, visited] = stack.pop();
        if (visited) { result.push(node); continue; }
        stack.push([node, true]);
        for (let index = (node.children || []).length - 1; index >= 0; index--) {
            stack.push([node.children[index], false]);
        }
    }
    return result;
}

function displayMaterial(node) {
    let current = node;
    while (current.tagRepresentative && current.children?.length === 1) current = current.children[0];
    return { name: current.name, type: current.type || "", qty: node.required };
}

function productSteps(tree) {
    const result = [];
    const blocked = new Set();
    for (const node of postOrder(tree)) {
        if (node.truncated || node.cycle || node.unresolved || node.unavailable || node.children.some(child => blocked.has(child))) {
            blocked.add(node);
        }
        if (node.leaf || node.tagRepresentative || node.truncated || !node.children.length) continue;
        result.push({
            name: node.name, path: node.path, routeKey: node.selectedRecipeKey || "",
            machine: node.machine || "無/手動", output: node.output, batches: node.batches,
            notes: node.notes || [],
            required: node.required, materials: node.children.filter(child => !child.placeholder).map(displayMaterial),
            incomplete: blocked.has(node)
        });
    }
    return result;
}

function mergeSteps(steps) {
    const result = new Map();
    for (const step of steps) {
        const key = JSON.stringify([step.path || step.name, step.routeKey, step.machine, step.output]);
        if (!result.has(key)) result.set(key, { ...step, batches: 0, required: 0, materials: [], incomplete: false });
        const target = result.get(key);
        target.batches += step.batches;
        target.required += step.required;
        target.incomplete ||= Boolean(step.incomplete);
        target.depth = Math.min(target.depth ?? Infinity, step.depth ?? 0);
        target.parents = [...new Set([...(target.parents || []), ...(step.parents || [])])];
        for (const material of step.materials) {
            const existing = target.materials.find(item => item.name === material.name && item.type === material.type);
            if (existing) existing.qty += material.qty;
            else target.materials.push({ ...material });
        }
    }
    return [...result.values()];
}

function createSnapshot(input) {
    const tree = cleanTree(input.tree);
    const problems = [];
    walkTree(tree, node => {
        if (node.truncated || node.cycle || node.unresolved || node.unavailable) {
            problems.push({
                name: node.name, qty: node.required || 0,
                path: node.path || "",
                kind: node.truncated ? "TRUNCATED" : node.cycle ? "CYCLE" : node.unavailable ? "NO_ALLOWED_RECIPE" : "MISSING_BIO",
                reason: node.reason || (node.unavailable ? node.notes?.[0] || "目前範圍沒有可用配方" : node.cycle ? "循環配方" : "未建立 / 範圍外")
            });
        }
    });
    const materials = sortedMaterials(input.leafTotals);
    const equipmentMaterials = sortedMaterials(input.machineLeafTotals);
    const machines = [...input.machineList.values()].map(item => ({
        name: item.name, path: item.page?.file?.path || "", status: item.status
    })).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    const budget = input.budget || { truncated: false, reasons: [], limits: DEFAULT_LIMITS };
    const warnings = [...(input.warnings || [])];
    const needsReview = [...materials, ...equipmentMaterials].some(item =>
        /無配方|未允許|未建立|未確認|待人工確認/.test(item.status)
    ) || machines.some(machine => /未確認|未建立|需先確認/.test(machine.status));
    const complete = !budget.truncated && problems.length === 0 &&
        !machines.some(machine => !machine.path || /未分析|未確認|未建立|需先確認/.test(machine.status)) &&
        !warnings.some(message => /循環|INVALID|UNCLOSED|EMPTY/.test(message));
    const snapshot = {
        reportSchema: 1, createdAt: new Date().toISOString(),
        target: { name: input.page.file.name, path: input.page.file.path, qty: input.requestedQty },
        complete, needsReview, budget, tree, materials, machines, equipmentMaterials, warnings, problems,
        equipmentSteps: mergeSteps(input.equipmentSteps || []),
        productionSteps: mergeSteps(productSteps(tree))
    };
    snapshot.assessment = assessReport(snapshot);
    return snapshot;
}

function assessReport(snapshot) {
    const items = [...snapshot.materials, ...snapshot.equipmentMaterials];
    const unique = values => [...new Set(values)];
    return {
        analysisTruncated: snapshot.budget.truncated ||
            snapshot.problems.some(problem => problem.kind === "TRUNCATED"),
        missingItemBIOs: unique([
            ...snapshot.problems.filter(problem => problem.kind === "MISSING_BIO").map(problem => problem.name),
            ...items.filter(item => /未建立|範圍外/.test(item.status)).map(item => item.name)
        ]),
        missingMachineBIOs: unique(snapshot.machines.filter(machine => !machine.path).map(machine => machine.name)),
        cycles: unique([
            ...snapshot.problems.filter(problem => problem.kind === "CYCLE").map(problem => problem.name),
            ...snapshot.warnings.filter(message => /循環/.test(message))
        ]),
        recipeGaps: unique([
            ...items.filter(item => /無配方|未允許/.test(item.status)).map(item => item.name),
            ...snapshot.machines.filter(machine => /配方未確認/.test(machine.status)).map(machine => machine.name)
        ]),
        sourceGaps: unique(items.filter(item => /待人工確認/.test(item.status)).map(item => item.name)),
        equipmentGaps: unique(snapshot.machines.filter(machine => /需先確認/.test(machine.status)).map(machine => machine.name)),
        dataErrors: snapshot.warnings.filter(message => /INVALID|UNCLOSED|EMPTY/.test(message))
    };
}

function reportWarnings(snapshot) {
    const status = assessReport(snapshot);
    const messages = [];
    if (status.analysisTruncated) {
        const reason = snapshot.budget.reasons.join("、") || "部分分支未展開";
        messages.push("分析已截斷：" + reason + "。需求統計僅包含已分析部分。");
    }
    if (status.missingItemBIOs.length) messages.push(
        "缺少物品 BIO：" + status.missingItemBIOs.join("、") +
        "。已算到的需求量保留在清單中，這些物品的取得方式尚未展開。");
    if (status.missingMachineBIOs.length) messages.push(
        "缺少設備 BIO：" + status.missingMachineBIOs.join("、") +
        "。設備需求已列出，其建造材料尚未計算。");
    if (status.cycles.length) messages.push(
        "循環依賴：" + status.cycles.join("、") + "。循環處已停止展開，需調整路線或材料選擇。");
    if (status.recipeGaps.length) messages.push(
        "缺少可用配方：" + status.recipeGaps.join("、") +
        "。目前作為遞歸終點，請確認取得方式、Tag 格式或篩選設定。");
    if (status.sourceGaps.length) messages.push(
        "取得說明待確認：" + status.sourceGaps.join("、") + "。需求量已依目前選定路線計算。");
    if (status.equipmentGaps.length) messages.push(
        "設備建造材料待確認：" + status.equipmentGaps.join("、") + "。請查看相關物品或設備的缺漏診斷。");
    if (status.dataErrors.length) messages.push(
        "BIO 格式錯誤：" + status.dataErrors.join("、") + "。部分路線未能解析。");
    return messages;
}

function mermaidLabel(value) {
    const text = String(value);
    return (text.length > 500 ? text.slice(0, 500) + "…" : text).replaceAll("&", "&amp;").replaceAll('"', "#quot;")
        .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/[\r\n]/g, " ");
}

function buildMermaid(tree, maximum = DEFAULT_LIMITS.maxMermaidNodes) {
    const lines = ["flowchart TD"];
    const stack = [{ node: tree, parent: null }];
    let count = 0;
    let clipped = false;
    while (stack.length && count < maximum) {
        const { node, parent } = stack.pop();
        const id = "n" + count++;
        let label = node.name + (node.placeholder ? "" : " ×" + formatNumber(node.required));
        if (node.machine) label += " ｜ " + node.machine + " ｜ " + formatNumber(node.batches) + "批 → " + formatNumber(node.output * node.batches);
        if (node.acquisition) label += " ｜ " + node.acquisition;
        if (node.notes?.length) label += " ｜ 備註：" + node.notes.join("；");
        if (node.cycle) label += " ⚠ 循環";
        if (node.unresolved) label += " ⚠ 未建立";
        if (node.truncated) label += " ⚠ " + node.reason;
        lines.push("  " + id + '["' + mermaidLabel(label) + '"]');
        if (parent != null) lines.push("  " + parent + " --> " + id);
        for (let index = (node.children || []).length - 1; index >= 0; index--) {
            stack.push({ node: node.children[index], parent: id });
        }
    }
    if (stack.length) {
        clipped = true;
        lines.push('  omitted["圖表達到顯示上限，其餘內容請查看 JSON 或製作教程"]');
        const parents = new Set(stack.map(entry => entry.parent).filter(Boolean));
        for (const parent of parents) lines.push("  " + parent + " -.-> omitted");
    }
    return { text: lines.join("\n"), nodes: count, clipped };
}

function materialText(item) {
    return (item.type ? "[" + item.type + "] " : "") + item.name + " ×" + formatNumber(item.qty);
}

function tutorial(snapshot) {
    const steps = [];
    function add(phase, text, materials = []) { steps.push({ phase, text, materials }); }
    for (const problem of snapshot.problems) add("確認", "先處理「" + problem.name + "」：" + problem.reason);
    const status = assessReport(snapshot);
    if (status.analysisTruncated) add("重新分析", "先處理分析上限，再重新計算尚未展開的分支。");
    for (const machine of status.missingMachineBIOs) add("補齊設備", "補齊「" + machine + "」的 BIO，才能計算建造材料。");
    if (status.dataErrors.length) add("修復資料", "依診斷修正 BIO 格式，再重新計算配方。");
    if (snapshot.materials.length) add("備料", "準備基礎材料，參照 [[#【最終基礎材料】|最終基礎材料清單]]；取得方式與缺少 BIO 等狀態見清單。");
    if (snapshot.machines.length) add("設備", "準備生產設備，參照 [[#【生產設備需求】|生產設備清單]]。");
    appendProductionSteps(steps, "成品製作", snapshot.productionSteps);
    if (snapshot.complete && !snapshot.needsReview) add("核對", "核對已取得「" + snapshot.target.name + "」×" + formatNumber(snapshot.target.qty) + "。");
    return steps;
}

function appendProductionSteps(steps, phase, entries) {
    function add(phase, text, materials = []) { steps.push({ phase, text, materials }); }
    function appendProduction(phase, entries) {
        for (const entry of entries) {
            const materials = entry.materials;
            if (materials.length > 5) {
                for (let index = 0; index < materials.length; index += 5) {
                    const group = materials.slice(index, index + 5);
                    add(phase, "為「" + entry.name + "」備妥 " + group.map(materialText).join("、"), group);
                }
            }
            const inputs = materials.length > 5
                ? "前面分組備妥的全部配方材料"
                : materials.map(materialText).join("、");
            const produced = entry.batches * entry.output;
            add(phase, (entry.incomplete ? "先確認缺漏，再" : "") +
                "使用「" + entry.machine + "」，投入 " + inputs +
                "，製作 " + formatNumber(entry.batches) + " 批「" + entry.name +
                "」，每批 " + formatNumber(entry.output) + "，共得 " + formatNumber(produced) +
                "（本階段需求 " + formatNumber(entry.required) + "，剩餘 " + formatNumber(produced - entry.required) + "）。" +
                (entry.notes?.length ? " 備註：" + entry.notes.join("；") : ""),
                materials.length > 5 ? [] : materials);
        }
    }
    appendProduction(phase, entries);
}

function checklist(lines, title, items, describe) {
    lines.push("", "##### 【" + title + "】", "");
    if (!items.length) lines.push("（無）");
    items.forEach((item, index) => lines.push((index + 1) + ". [ ] " + describe(item)));
}

function equipmentGroup(filePath = "") {
    const folder = filePath.replaceAll("\\", "/").split("/")[0];
    if (/^MC-/.test(folder)) return "MC 設備";
    if (/^SF-/.test(folder)) return "黏液科技／" + folder;
    return "科技分類待確認";
}

function totalMaterials(snapshot) {
    const totals = new Map();
    for (const item of [...snapshot.materials, ...snapshot.equipmentMaterials]) {
        const key = item.path || item.type + ":" + item.name;
        if (!totals.has(key)) totals.set(key, { ...item, qty: 0, statuses: new Set() });
        const total = totals.get(key);
        total.qty += item.qty;
        if (item.status) total.statuses.add(item.status);
    }
    return [...totals.values()].map(item => ({ ...item, status: [...item.statuses].join("；") }));
}

function buildCSV(snapshot) {
    const assessment = assessReport(snapshot);
    const completeness = assessment.analysisTruncated ? "分析截斷" : "已分析範圍";
    function csv(rows) {
        return "\uFEFF" + rows.map(row => row.map(value => {
            let cell = String(value ?? "");
            // Prevent spreadsheet formula execution from BIO names or notes.
            if (/^[\s]*[=+@-]/.test(cell)) cell = "'" + cell;
            return '"' + cell.replaceAll('"', '""') + '"';
        }).join(",")).join("\r\n") + "\r\n";
    }
    const warnings = reportWarnings(snapshot).join("；");
    return {
        materials: csv([["材料", "類型", "總需求", "狀態", "BIO 路徑", "統計範圍", "診斷"],
            ...totalMaterials(snapshot).map(item => [item.name, item.type, item.qty, item.status, item.path, completeness, warnings])]),
        machines: csv([["設備", "數量", "科技分類", "狀態", "BIO 路徑", "統計範圍", "診斷"],
            ...snapshot.machines.map(item => [item.name, 1, equipmentGroup(item.path), item.status, item.path, completeness, warnings])])
    };
}

function buildMarkdown(snapshot, options = {}) {
    const graph = buildMermaid(snapshot.tree, snapshot.budget.limits?.maxMermaidNodes);
    const lines = [snapshot.target.name + " ×" + formatNumber(snapshot.target.qty)];
    for (const message of reportWarnings(snapshot)) lines.push("", "> ⚠ " + message);
    lines.push("", "【配方遞歸樹】", "", "```mermaid", graph.text, "```");
    if (graph.clipped) lines.push("", "> ⚠ 圖表顯示已達上限，JSON 仍保留全部已分析節點。");
    checklist(lines, "最終基礎材料", snapshot.materials,
        item => materialText(item) + (item.status ? " ｜ " + item.status : ""));
    checklist(lines, "生產設備需求", snapshot.machines,
        item => item.name + " ×1 ｜ " + item.status);
    lines.push("", "製作方式參照 [[#【設備製作教程】|設備製作教程]]。");
    checklist(lines, "設備建造所需基礎材料", snapshot.equipmentMaterials,
        item => materialText(item) + (item.status ? " ｜ " + item.status : ""));
    lines.push("", "【逐步製作教程】", "");
    tutorial(snapshot).forEach((step, index) =>
        lines.push((index + 1) + ". [ ] 【" + step.phase + "】" + step.text));
    lines.push("", "##### 【設備製作教程】", "");
    // Keep dependency post-order even when technology categories interleave.
    const groups = [];
    function addGroup(group, steps) {
        if (groups.at(-1)?.[0] !== group) groups.push([group, []]);
        groups.at(-1)[1].push(...steps);
    }
    let omitted = 0;
    for (const entry of snapshot.equipmentSteps) {
        if (!options.full && (entry.depth || 0) >= 3) { omitted++; continue; }
        const group = equipmentGroup(entry.path);
        const steps = [];
        appendProductionSteps(steps, "設備製作", [entry]);
        addGroup(group, steps.map(step => ({ ...step,
            text: (entry.parents?.length ? "（" + entry.parents.join("、") + "）" : "") + step.text })));
    }
    const built = new Set(snapshot.equipmentSteps.map(step => step.path || step.name));
    for (const machine of snapshot.machines) {
        if (built.has(machine.path || machine.name)) continue;
        const group = equipmentGroup(machine.path);
        addGroup(group, [{ text: "準備「" + machine.name + "」×1（" + machine.status + "）。" }]);
    }
    let sequence = 0;
    for (const [group, steps] of groups) {
        lines.push("", "###### " + group, "");
        for (const step of steps) lines.push(++sequence + ". [ ] " + step.text);
    }
    if (omitted) lines.push("", "> 設備教程省略超過 3 層的 " + omitted + " 項製作內容；完整匯出保留所有已分析步驟。");
    if (!groups.length && !omitted) lines.push("（無）");
    const warnings = [...snapshot.budget.reasons, ...snapshot.warnings];
    if (warnings.length) lines.push("", "【診斷】", "", ...warnings.map(value => "- " + value));
    return lines.join("\n") + "\n";
}

function htmlEscape(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function buildPrintHTML(snapshot) {
    const lines = [snapshot.target.name + " ×" + formatNumber(snapshot.target.qty)];
    for (const message of reportWarnings(snapshot)) lines.push("⚠ " + message);
    const stack = [{ node: snapshot.tree, depth: 0 }];
    lines.push("", "【配方遞歸樹】");
    while (stack.length) {
        const { node, depth } = stack.pop();
        lines.push("  ".repeat(depth) + node.name +
            (node.placeholder ? "" : " ×" + formatNumber(node.required)) +
            (node.machine ? " ← " + node.machine : "") +
            (node.acquisition ? " ｜ " + node.acquisition : "") +
            (node.notes?.length ? " ｜ 備註：" + node.notes.join("；") : "") +
            (node.reason ? " ⚠ " + node.reason : "") +
            (node.cycle ? " ⚠ 循環" : "") + (node.unresolved ? " ⚠ 未建立" : ""));
        for (let index = (node.children || []).length - 1; index >= 0; index--) {
            stack.push({ node: node.children[index], depth: depth + 1 });
        }
    }
    const markdown = buildMarkdown(snapshot, { full: true });
    const start = markdown.indexOf("\n##### 【最終基礎材料】\n");
    const content = lines.join("\n") + "\n" + markdown.slice(start);
    let printable = htmlEscape(content.replace(/\[ \]/g, "☐"));
    for (const [title, id] of [["最終基礎材料", "materials"], ["生產設備需求", "machines"],
        ["設備建造所需基礎材料", "equipment-materials"], ["設備製作教程", "equipment-tutorial"]]) {
        printable = printable.replace("##### 【" + title + "】", '<b id="' + id + '">【' + title + '】</b>');
        printable = printable.replaceAll(new RegExp("\\[\\[#【" + title + "】\\|([^\\]\\n]+)\\]\\]", "g"),
            '<a href="#' + id + '">$1</a>');
    }
    return '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>' +
        htmlEscape(snapshot.target.name) + '</title><style>@page{size:A4;margin:16mm}' +
        'body{font:12px "Microsoft JhengHei",sans-serif}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}' +
        '</style><body><pre>' + printable + "</pre></body></html>";
}

function needsFileExport(snapshot, markdown = "") {
    if (snapshot.budget.truncated || markdown.length > 80000) return true;
    let estimatedCharacters = 0;
    walkTree(snapshot.tree, node => {
        estimatedCharacters += (node.name?.length || 0) + (node.acquisition?.length || 0) + 100;
        for (const note of node.notes || []) estimatedCharacters += note.length;
    });
    for (const item of [...snapshot.materials, ...snapshot.equipmentMaterials, ...snapshot.machines]) {
        estimatedCharacters += (item.name?.length || 0) + (item.status?.length || 0) + 100;
    }
    for (const step of [...snapshot.productionSteps, ...snapshot.equipmentSteps]) {
        estimatedCharacters += (step.name?.length || 0) + 150;
        for (const note of step.notes || []) estimatedCharacters += note.length;
        for (const item of step.materials) estimatedCharacters += (item.name?.length || 0) + 50;
    }
    return estimatedCharacters > 80000 ||
        buildMermaid(snapshot.tree, snapshot.budget.limits?.maxMermaidNodes).clipped;
}

module.exports = {
    DEFAULT_LIMITS, createBudget, createSnapshot, buildMermaid,
    buildMarkdown, buildPrintHTML, buildCSV, tutorial, needsFileExport, formatNumber, assessReport, reportWarnings
};
