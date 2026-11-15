const assert = require("node:assert/strict");
const test = require("node:test");
const reports = require("../../BIO相關模組/搜尋介面模塊/bio_report_v4");

function material(name, qty = 1) {
    return { name, type: "item", qty, status: "採集：自行取得", page: { file: { path: name + ".md" } } };
}

function leaf(name, required = 1) {
    return { name, required, leaf: true, acquisition: "採集：" + name, children: [] };
}

function snapshot(tree, options = {}) {
    return reports.createSnapshot({
        page: { file: { name: tree.name, path: tree.name + ".md" } }, requestedQty: tree.required,
        tree, leafTotals: new Map([["原料", material("原料", 2)]]),
        machineList: new Map(), machineLeafTotals: new Map(), equipmentSteps: [],
        budget: reports.createBudget().snapshot(), ...options
    });
}

test("analysis budget bounds depth, total work and elapsed time", () => {
    let clock = 0;
    const budget = reports.createBudget({ maxDepth: 2, maxNodes: 2, maxMilliseconds: 100 }, () => clock);
    assert.equal(budget.enter(0).allowed, true);
    assert.equal(budget.enter(3).allowed, false);
    assert.equal(budget.exhausted, false);
    assert.equal(budget.enter(1).allowed, true);
    assert.equal(budget.enter(1).allowed, false);
    assert.equal(budget.exhausted, true);
    assert.equal(budget.snapshot().visitedNodes, 2);
    const timed = reports.createBudget({ maxMilliseconds: 100 }, () => clock);
    clock = 101;
    assert.match(timed.enter(0).reason, /分析時間/);
});

test("Markdown exports Mermaid and numbered task lists in all three inventory sections", () => {
    const report = snapshot(leaf("成品"), {
        machineList: new Map([["工作台", { name: "工作台", page: { file: { path: "工作台.md" } }, status: "採集：庫存" }]]),
        machineLeafTotals: new Map([["木材", material("木材", 4)]])
    });
    const markdown = reports.buildMarkdown(report);
    assert.match(markdown, /```mermaid\nflowchart TD/);
    for (const title of ["最終基礎材料", "生產設備需求", "設備建造所需基礎材料"]) {
        assert.match(markdown, new RegExp("【" + title + "】\\n\\n1\\. \\[ \\] "));
    }
    assert.match(markdown, /【逐步製作教程】\n\n1\. \[ \]/);
});

test("Mermaid escapes user labels and clips graph output independently of analysis", () => {
    const tree = { name: 'X"] --> injected["<script>', required: 1, children: [leaf("A"), leaf("B")] };
    const graph = reports.buildMermaid(tree, 2);
    assert.equal(graph.nodes, 2);
    assert.equal(graph.clipped, true);
    assert.match(graph.text, /omitted/);
    assert.doesNotMatch(graph.text, /<script>/);
    assert.match(graph.text, /#quot;/);
});

test("tutorial is bottom-up, preserves batches, and splits materials into groups of at most five", () => {
    const child = {
        name: "中間物", path: "中間物.md", required: 6, output: 4, batches: 2,
        machine: "工作台", children: Array.from({ length: 7 }, (_, index) => leaf("原料" + index, 2))
    };
    const root = {
        name: "成品", required: 1, output: 1, batches: 1, machine: "高階機器", children: [child]
    };
    const steps = reports.tutorial(snapshot(root));
    const production = steps.filter(step => step.phase === "成品製作");
    assert.ok(steps.every(step => step.materials.length <= 5));
    assert.ok(production.findIndex(step => step.text.includes("製作 2 批「中間物」")) <
        production.findIndex(step => step.text.includes("製作 1 批「成品」")));
    assert.match(production.find(step => step.text.includes("製作 2 批「中間物」")).text, /共得 8.*剩餘 2/);
});

test("preparation uses real heading links without repeating inventory quantities", () => {
    const report = snapshot(leaf("目標"), {
        machineList: new Map([["工作台", { name: "工作台", page: { file: { path: "MC-物品資料庫/工作台.md" } }, status: "需建造" }]])
    });
    const steps = reports.tutorial(report);
    assert.equal(steps.filter(step => step.phase === "備料").length, 1);
    assert.match(steps.find(step => step.phase === "備料").text, /\[\[#【最終基礎材料】\|最終基礎材料清單\]\]/);
    assert.doesNotMatch(steps.find(step => step.phase === "備料").text, /原料 ×/);
    assert.match(steps.find(step => step.phase === "設備").text, /準備生產設備，參照/);
    assert.match(reports.buildMarkdown(report), /^##### 【最終基礎材料】$/m);
    assert.match(reports.buildPrintHTML(report), /href="#materials"/);
});

test("equipment tutorials retain dependency order and parent labels while preview hides deep steps", () => {
    const entries = [
        { name: "深層零件", path: "MC-物品資料庫/零件.md", depth: 3 },
        { name: "磨石", path: "SF-基礎機器(原版)/磨石.md", depth: 1, parents: ["魔法工作台"] },
        { name: "工作台", path: "MC-物品資料庫/工作台.md", depth: 0 }
    ].map(entry => ({ machine: "無/手動", batches: 1, output: 1, required: 1, materials: [], ...entry }));
    const report = snapshot(leaf("目標"), { equipmentSteps: entries });
    const preview = reports.buildMarkdown(report);
    assert.doesNotMatch(preview, /批「深層零件」/);
    assert.match(preview, /###### 黏液科技／SF-基礎機器/);
    assert.match(preview, /1\. \[ \] （魔法工作台）/);
    assert.match(preview, /###### MC 設備/);
    const full = reports.buildMarkdown(report, { full: true });
    assert.ok(full.indexOf("批「深層零件」") < full.indexOf("批「磨石」"));
    assert.ok(full.indexOf("批「磨石」") < full.indexOf("批「工作台」"));
    assert.doesNotMatch(full, /省略超過 3 層/);
    assert.match(reports.buildPrintHTML(report), /批「深層零件」/);
});

test("CSV totals combine identical BIO paths and escape Excel text cells", () => {
    const raw = material('=原料,"甲"', 2);
    const report = snapshot(leaf("目標"), {
        leafTotals: new Map([["a", raw]]), machineLeafTotals: new Map([["a", { ...raw, qty: 3 }]])
    });
    const csv = reports.buildCSV(report);
    assert.ok(csv.materials.startsWith("\uFEFF"));
    assert.match(csv.materials, /"'=原料,""甲""","item","5"/);
    assert.equal(csv.materials.split("\r\n").filter(Boolean).length, 2);
    assert.match(csv.machines, /"科技分類"/);
});

test("shared recipes combine already-computed batch requirements without discarding costs", () => {
    const make = () => ({
        name: "中間物", path: "中間物.md", selectedRecipeKey: "route", required: 1,
        output: 4, batches: 1, machine: "工作台", children: [leaf("原料", 2)]
    });
    const report = snapshot({
        name: "目標", required: 1, output: 1, batches: 1, machine: "合成台",
        children: [make(), make()]
    });
    const step = report.productionSteps.find(value => value.name === "中間物");
    assert.equal(step.required, 2);
    assert.equal(step.batches, 2);
    assert.equal(step.materials[0].qty, 4);
});

test("truncated branches make exports incomplete and are never silently counted as base materials", () => {
    const budget = reports.createBudget({ maxNodes: 1 });
    budget.enter(0); budget.enter(1);
    const report = snapshot({
        name: "A", required: 1, children: [
            { name: "未展開", required: 0, truncated: true, placeholder: true, reason: "節點上限", children: [] }
        ]
    }, { budget: budget.snapshot(), leafTotals: new Map() });
    assert.equal(report.complete, false);
    assert.equal(report.materials.length, 0);
    assert.equal(reports.needsFileExport(report, reports.buildMarkdown(report)), true);
    assert.doesNotMatch(reports.tutorial(report).at(-1).text, /核對已取得/);
    assert.match(reports.buildMarkdown(report), /分析已截斷/);
    assert.deepEqual(report.assessment.missingItemBIOs, []);
});

test("missing BIOs report the absent item and do not claim the engine hit an analysis limit", () => {
    const report = snapshot({
        name: "烈焰粉", required: 8, leaf: true, unresolved: true, children: []
    }, {
        leafTotals: new Map([["烈焰粉", { ...material("烈焰粉", 8), status: "未建立 / 範圍外", page: null }]])
    });
    const markdown = reports.buildMarkdown(report);
    assert.match(markdown, /缺少物品 BIO：烈焰粉/);
    assert.doesNotMatch(markdown, /分析已截斷|需求統計僅包含已分析部分/);
    assert.equal(report.assessment.analysisTruncated, false);
    assert.deepEqual(report.assessment.missingItemBIOs, ["烈焰粉"]);
});

test("a clipped Mermaid diagram reports display limits separately from a truncated calculation", () => {
    const report = snapshot({
        name: "目標", required: 1, output: 1, batches: 1, machine: "工作台", children: [leaf("A"), leaf("B")]
    });
    report.budget.limits.maxMermaidNodes = 1;
    const markdown = reports.buildMarkdown(report);
    assert.match(markdown, /圖表顯示已達上限/);
    assert.doesNotMatch(markdown, /分析已截斷|需求統計僅包含已分析部分/);
    assert.equal(report.assessment.analysisTruncated, false);
});

test("pending source descriptions and mixed failure causes remain individually identified", () => {
    const source = snapshot(leaf("紅石", 1), {
        leafTotals: new Map([["紅石", { ...material("紅石"), status: "外部取得：具體來源待人工確認。" }]])
    });
    assert.match(reports.buildMarkdown(source), /取得說明待確認：紅石/);
    assert.doesNotMatch(reports.buildPrintHTML(source), /分析已截斷/);

    source.budget.truncated = true;
    source.budget.reasons.push("超過展開節點 1000");
    source.machines.push({ name: "魔法工作台", path: "", status: "未建立 / 範圍外" });
    const messages = reports.reportWarnings(source);
    assert.ok(messages.some(message => message.startsWith("分析已截斷")));
    assert.ok(messages.some(message => message.startsWith("缺少設備 BIO：魔法工作台")));
    assert.ok(messages.some(message => message.startsWith("取得說明待確認：紅石")));
});

test("JSON snapshots exclude live Dataview page objects and PDF HTML safely escapes text", () => {
    const page = { file: { path: "原料.md" } };
    page.self = page;
    const report = snapshot({ name: "<script>alert(1)</script>", page, required: 1, children: [], leaf: true });
    const decoded = JSON.parse(JSON.stringify(report));
    assert.equal(decoded.tree.path, "原料.md");
    assert.equal(decoded.tree.page, undefined);
    const html = reports.buildPrintHTML(report);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /☐/);
});
