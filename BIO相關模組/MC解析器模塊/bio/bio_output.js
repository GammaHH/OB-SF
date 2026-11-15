// Route output belongs in the recipe body. Remove only the legacy root YAML
// field; never infer or migrate its value into any recipe.
function normalizeBIOOutput(input) {
    const original = String(input);
    const frontmatter = original.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) return { text: original, diagnostics: [] };
    const cleaned = frontmatter[0].replace(/^output:[^\r\n]*(?:\r?\n|$)/gm, "");
    const text = cleaned + original.slice(frontmatter[0].length);
    return { text, diagnostics: [] };
}

module.exports = { normalizeBIOOutput };
