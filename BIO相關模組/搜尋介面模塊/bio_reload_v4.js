// Explicit refresh reads the vault files, independently of the Dataview index.
async function readCatalog({ files, readText, parseYaml, isBio }) {
    const pages = [];
    const sections = new Set();
    for (const file of files) {
        const text = await readText(file);
        const frontmatter = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (!frontmatter) continue;
        let metadata;
        try {
            metadata = parseYaml(frontmatter[1]) || {};
        } catch (error) {
            throw new Error(file.path + "：YAML 讀取失敗 — " + error.message);
        }
        if (!isBio(metadata)) continue;
        const folder = file.path.split("/").slice(0, -1).join("/");
        pages.push({ ...metadata, file: {
            path: file.path, name: file.basename, folder
        } });
        const body = text.slice(frontmatter[0].length)
            .replace(/<!--[^]*?-->/g, "")
            .replace(/^\s*(`{3,}|~{3,})[^\r\n]*\r?\n[^]*?^\s*\1\s*$/gm, "");
        for (const heading of body.matchAll(/^###\s+(.+?)\s*$/gm)) {
            sections.add(heading[1]);
        }
    }
    return { pages, sections: [...sections] };
}

module.exports = { readCatalog };
