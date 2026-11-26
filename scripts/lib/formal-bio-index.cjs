const fs = require('node:fs');
const path = require('node:path');
const { formalRoots, isFormalPath } = require('../../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping');
const { parseFrontmatter } = require('../../BIO相關模組/MC解析器模塊/bio/bio_scanner');
const { buildBIOInventory } = require('../../BIO相關模組/MC解析器模塊/bio/bio_inventory');
function formalBIOIndex(root, mapping, { reportReadErrors = false } = {}) {
    const documents = [], roots = formalRoots(mapping);
    function visit(folder, recursive) {
        const directory = path.join(root, folder);
        let entries;
        try {
            const info = fs.lstatSync(directory, { throwIfNoEntry: false });
            if (!info) return;
            if (!info.isDirectory() || info.isSymbolicLink() || path.relative(fs.realpathSync(root), fs.realpathSync(directory)) !== path.normalize(folder)) throw new Error('正式資料夾不是受支援的實際路徑：' + folder);
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch (error) {
            if (!reportReadErrors) throw error;
            documents.push({ path: folder, cacheReady: false, readError: error.message });
            return;
        }
        for (const entry of entries) {
            const relative = folder + '/' + entry.name;
            if (entry.isDirectory() && recursive) visit(relative, true);
            else if (entry.isFile() && /\.md$/i.test(entry.name) && isFormalPath(relative, roots)) {
                try {
                    const text = fs.readFileSync(path.join(root,relative),'utf8');
                    documents.push({ path: relative, frontmatter: parseFrontmatter(text), cacheReady: true, text });
                } catch (error) {
                    if (!reportReadErrors) throw error;
                    documents.push({ path: relative, cacheReady: false, readError: error.message });
                }
            }
        }
    }
    for (const entry of roots) visit(entry.folder, entry.recursive);
    const unique = [...new Map(documents.map(value => [value.path,value])).values()];
    return { inventory: buildBIOInventory(unique), documents: unique, roots };
}
module.exports = { formalBIOIndex };
