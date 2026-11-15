const fs = require("node:fs/promises");
const path = require("node:path");
const reports = require("./bio_report_v4");

function safeName(value) {
    return String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "") || "BIO";
}

async function makePDF(snapshot) {
    const electron = require("electron");
    const BrowserWindow = electron.remote?.BrowserWindow;
    if (!BrowserWindow) {
        throw new Error("目前 Obsidian 無法建立 PDF 列印視窗，請先選 JSON 輸出。");
    }
    const win = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    try {
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(reports.buildPrintHTML(snapshot)));
        await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
        const buffer = await win.webContents.printToPDF({ pageSize: "A4", printBackground: true });
        if (buffer.length < 100 || buffer.subarray(0, 5).toString() !== "%PDF-") {
            throw new Error("PDF 產物驗證失敗");
        }
        return buffer;
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
}

module.exports = async function exportReport(tp, app) {
    const vaultName = app.vault.getName();
    const snapshotKey = app.vault.adapter.basePath || vaultName;
    const savedSnapshot = globalThis.__obsfV4LatestReports?.[snapshotKey];
    const Notice = tp.obsidian?.Notice;
    if (typeof Notice !== "function") throw new Error("Templater 未提供 tp.obsidian.Notice，請透過 Templater 執行模板");
    if (!savedSnapshot) {
        new Notice("請先在 V4 搜尋介面執行一次遞歸分析，再輸出報告。");
        return "";
    }
    const snapshot = { ...savedSnapshot, assessment: reports.assessReport(savedSnapshot) };
    const large = reports.needsFileExport(snapshot);
    const values = large ? ["json", "pdf", "csv"] : ["md", "json", "pdf", "csv"];
    const labels = large
        ? ["JSON：保存已分析資料與完成狀態", "PDF：列印已分析內容與完成狀態", "Excel CSV：基礎材料＋生產設備（兩份檔案）"]
        : ["Markdown：Mermaid＋Checklist＋完整製作教程", "JSON：分析資料", "PDF：製作報告", "Excel CSV：基礎材料＋生產設備（兩份檔案）"];
    const statusLabels = reports.reportWarnings(snapshot).map(message => message.split("：", 1)[0]);
    const title = snapshot.target.name + " ×" + snapshot.target.qty +
        (statusLabels.length ? "｜" + statusLabels.join("、") : "") +
        (large ? "｜報告較大，請選 JSON、PDF 或 CSV" : "");
    const format = await tp.system.suggester(labels, values, false, title);
    if (!format) return "";
    const root = app.vault.adapter.basePath;
    if (!root) throw new Error("檔案輸出需要桌面版 Obsidian 的本機 Vault");
    const folder = path.resolve(root, "BIO-輸出報告");
    if (path.relative(path.resolve(root), folder).startsWith("..")) throw new Error("輸出路徑超出 Vault");
    await fs.mkdir(folder, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (format === "csv") {
        const bundle = path.join(folder, safeName(snapshot.target.name) + "-" + stamp + "-CSV");
        await fs.mkdir(bundle); // A fresh bundle cannot overwrite a previous export.
        const csv = reports.buildCSV(snapshot);
        await fs.writeFile(path.join(bundle, "基礎材料.csv"), csv.materials, { flag: "wx" });
        await fs.writeFile(path.join(bundle, "生產設備.csv"), csv.machines, { flag: "wx" });
        new Notice("已輸出 CSV：" + bundle, 10000);
        return "";
    }
    const filename = safeName(snapshot.target.name) + "-" + stamp + "." + format;
    const destination = path.join(folder, filename);
    const data = format === "json"
        ? JSON.stringify(snapshot, null, 2)
        : format === "pdf" ? await makePDF(snapshot) : reports.buildMarkdown(snapshot, { full: true });
    // wx preserves any existing file when repeated exports happen to share a timestamp.
    await fs.writeFile(destination, data, { flag: "wx" });
    new Notice("已輸出 BIO-輸出報告/" + filename, 10000);
    return "";
};
