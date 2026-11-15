const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const test = require("node:test");
const reports = require("../../BIO相關模組/搜尋介面模塊/bio_report_v4");

async function harness(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "obsf-v4-export-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const report = reports.createSnapshot({
        page: { file: { name: "測試物品", path: "測試物品.md" } }, requestedQty: 1,
        tree: { name: "測試物品", required: 1, leaf: true, children: [] },
        leafTotals: new Map(), machineList: new Map(), machineLeafTotals: new Map(),
        budget: reports.createBudget().snapshot()
    });
    if (options.large) {
        report.complete = false;
        report.budget.truncated = true;
        report.budget.reasons.push("節點上限");
    }
    let menu = null;
    let destroyed = false;
    let windowOptions = null;
    class BrowserWindow {
        constructor(settings) {
            windowOptions = settings;
            this.webContents = {
                setWindowOpenHandler() {},
                executeJavaScript: async () => true,
                printToPDF: async () => {
                    if (options.pdfError) throw new Error("模擬列印失敗");
                    return Buffer.from("%PDF-1.7\n" + "x".repeat(150));
                }
            };
        }
        async loadURL(url) { assert.match(url, /^data:text\/html/); }
        isDestroyed() { return destroyed; }
        destroy() { destroyed = true; }
    }
    const source = await fs.readFile(path.resolve(__dirname,
        "../../BIO相關模組/搜尋介面模塊/export_report_v4.js"), "utf8");
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module,
        globalThis: { __obsfV4LatestReports: { [root]: report } },
        require(name) {
            if (name === "./bio_report_v4") return reports;
            if (name === "obsidian") throw new Error("Cannot find module 'obsidian'");
            if (name === "electron") return { remote: { BrowserWindow } };
            return require(name);
        }
    });
    const tp = {
        obsidian: { Notice: function () {} },
        system: { suggester: async (labels, values) => {
            menu = { labels: Array.from(labels), values: Array.from(values) };
            return options.format || "json";
        } }
    };
    const app = { vault: { getName: () => "test", adapter: { basePath: root } } };
    return {
        run: () => module.exports(tp, app), root, report,
        menu: () => menu, destroyed: () => destroyed, windowOptions: () => windowOptions
    };
}

test("Templater exporter writes fresh JSON with completion and truncation metadata", async t => {
    const value = await harness(t, { large: true });
    await value.run();
    assert.deepEqual(value.menu().values, ["json", "pdf", "csv"]);
    const folder = path.join(value.root, "BIO-輸出報告");
    const files = await fs.readdir(folder);
    assert.equal(files.length, 1);
    assert.match(files[0], /\.json$/);
    const decoded = JSON.parse(await fs.readFile(path.join(folder, files[0]), "utf8"));
    assert.equal(decoded.complete, false);
    assert.equal(decoded.budget.truncated, true);
    assert.equal(decoded.assessment.analysisTruncated, true);
});

test("PDF exporter requests a hidden window, writes PDF bytes, and closes the window", async t => {
    const value = await harness(t, { format: "pdf" });
    await value.run();
    assert.equal(value.windowOptions().show, false);
    assert.equal(value.windowOptions().webPreferences.nodeIntegration, false);
    assert.equal(value.destroyed(), true);
    const folder = path.join(value.root, "BIO-輸出報告");
    const files = await fs.readdir(folder);
    assert.equal(files.length, 1);
    assert.match(files[0], /\.pdf$/);
    assert.equal((await fs.readFile(path.join(folder, files[0]))).subarray(0, 5).toString(), "%PDF-");
});

test("failed PDF printing closes its hidden window and leaves no output artifact", async t => {
    const value = await harness(t, { format: "pdf", pdfError: true });
    await assert.rejects(value.run(), /模擬列印失敗/);
    assert.equal(value.destroyed(), true);
    assert.deepEqual(await fs.readdir(path.join(value.root, "BIO-輸出報告")), []);
});

test("CSV export writes two BOM-prefixed Excel files in a fresh bundle", async t => {
    const value = await harness(t, { format: "csv", large: true });
    await value.run();
    const folder = path.join(value.root, "BIO-輸出報告");
    const bundles = await fs.readdir(folder);
    assert.equal(bundles.length, 1);
    const bundle = path.join(folder, bundles[0]);
    assert.deepEqual((await fs.readdir(bundle)).sort(), ["基礎材料.csv", "生產設備.csv"].sort());
    for (const name of await fs.readdir(bundle)) {
        const bytes = await fs.readFile(path.join(bundle, name));
        assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
        assert.match(bytes.toString("utf8"), /統計範圍/);
    }
});

test("Templater export wrapper supports a require without resolve or cache", async () => {
    const source = await fs.readFile(path.resolve(__dirname, "../../BIO engine/export_report_v4.js"), "utf8");
    const root = path.resolve(__dirname, "../..");
    const app = { vault: { adapter: { basePath: root } } };
    const tp = { app };
    const resolved = [];
    let called = false;
    const nodeRequire = modulePath => {
        assert.equal(modulePath, path.join(root, "BIO相關模組", "搜尋介面模塊", "export_report_v4.js"));
        return async (receivedTP, receivedApp) => {
            assert.equal(receivedTP, tp);
            assert.equal(receivedApp, app);
            called = true;
            return "";
        };
    };
    nodeRequire.resolve = value => { resolved.push(path.basename(value)); return value; };
    nodeRequire.cache = {};
    const templaterRequire = name => name === "node:module"
        ? { createRequire: modulePath => { assert.ok(path.isAbsolute(modulePath)); return nodeRequire; } }
        : require(name);
    assert.equal(templaterRequire.resolve, undefined);
    const module = { exports: {} };
    vm.runInNewContext(source, { module, require: templaterRequire });
    assert.equal(await module.exports(tp), "");
    assert.equal(called, true);
    assert.deepEqual(resolved, ["export_report_v4.js", "bio_report_v4.js"]);
});
