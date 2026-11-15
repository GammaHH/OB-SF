module.exports = async function export_report_v4(tp) {
    const path = require("node:path");
    const app = tp.app?.vault ? tp.app : globalThis.app;
    if (!app?.vault?.adapter?.basePath) throw new Error("請在桌面版 Obsidian 執行 V4 輸出模板");
    const modulePath = path.join(
        app.vault.adapter.basePath, "BIO相關模組", "搜尋介面模塊", "export_report_v4.js"
    );
    const nodeRequire = require("node:module").createRequire(modulePath);
    delete nodeRequire.cache[nodeRequire.resolve(modulePath)];
    const reportPath = path.join(path.dirname(modulePath), "bio_report_v4.js");
    delete nodeRequire.cache[nodeRequire.resolve(reportPath)];
    return await nodeRequire(modulePath)(tp, app);
};
