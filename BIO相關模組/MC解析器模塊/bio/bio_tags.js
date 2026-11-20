const MANAGED_BIO_TAGS = Object.freeze(["待補充", "未人工檢查", "更新需人工解析", "需攻略補充"]);
const PUBLICATION_BLOCKING_TAGS = ["待補充", "未人工檢查", "更新需人工解析"];
const normalizeTag = value => String(value ?? "").trim().replace(/^#/, "");
const unquote = value => /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
const isManagedBIOtag = value => MANAGED_BIO_TAGS.includes(normalizeTag(unquote(String(value).trim())));

function inlineParts(value) {
    const parts = [];
    let quote = "", start = 0;
    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (quote) { if (char === quote && value[index - 1] !== "\\") quote = ""; }
        else if (char === '"' || char === "'") quote = char;
        else if (char === ",") { parts.push(value.slice(start, index)); start = index + 1; }
    }
    parts.push(value.slice(start));
    return parts;
}

function parseTagList(value) {
    if (Array.isArray(value)) return value.map(String);
    const text = String(value ?? "").trim();
    if (!text) return [];
    return (text.startsWith("[") && text.endsWith("]") ? inlineParts(text.slice(1, -1)) : [text])
        .map(part => unquote(part.trim())).filter(Boolean);
}

// Only the four exact management tags may be removed. Preserve aliases,
// custom tags, code examples, HTML metadata and every other original line.
function stripManagedBIOtags(input, onTag) {
    const managed = value => {
        if (!isManagedBIOtag(value)) return false;
        onTag?.(normalizeTag(unquote(String(value).trim())));
        return true;
    };
    const lines = String(input).match(/[^\n]*\n|[^\n]+$/g) || [];
    let frontmatter = /^\uFEFF?---\r?\n/.test(String(input)), tagList = false, fence = "", comment = false;
    const output = [];
    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index], end = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : "";
        let line = end ? raw.slice(0, -end.length) : raw;
        if (frontmatter) {
            if (index && line === "---") { frontmatter = false; tagList = false; }
            const field = line.match(/^([A-Za-z0-9_-]+):([ \t]*)(.*)$/);
            if (field) {
                tagList = field[1] === "tags" && !field[3].trim();
                if (field[1] === "tags" && field[3].trim()) {
                    const value = field[3].trim();
                    if (value.startsWith("[") && value.endsWith("]")) {
                        const parts = inlineParts(value.slice(1, -1));
                        const retained = parts.filter(part => !managed(part));
                        if (retained.length !== parts.length) line = "tags:" + field[2] + "[" + retained.join(",") + "]";
                    } else if (managed(value)) line = "tags:" + field[2];
                }
            } else if (tagList && /^[ \t]*-\s+/.test(line) && managed(line.replace(/^[ \t]*-\s+/, ""))) continue;
            output.push(line + end); continue;
        }
        let hiddenStart = "";
        if (comment) {
            const close = line.indexOf("-->");
            if (close < 0) { output.push(raw); continue; }
            hiddenStart = line.slice(0, close + 3);
            line = line.slice(close + 3);
            comment = false;
        }
        const code = line.match(/^\s*(`{3,}|~{3,})/);
        if (code) {
            if (!fence) fence = code[1];
            else if (code[1][0] === fence[0] && code[1].length >= fence.length &&
                !line.slice(code[0].length).trim()) fence = "";
            output.push(raw); continue;
        }
        if (fence) { output.push(raw); continue; }
        if (!hiddenStart && line.trim().split(/[ \t]+/).every(token => token.startsWith("#") && managed(token))) continue;
        line = line.split(/(`+.*?`+|\[\[.*?\]\]|<!--.*?(?:-->|$))/g).map((part, index) => {
            if (index % 2) {
                if (part.startsWith("<!--") && !part.endsWith("-->")) comment = true;
                return part;
            }
            return part.replace(/(^|[ \t(（、，])#(待補充|未人工檢查|更新需人工解析|需攻略補充)(?=$|[^\p{L}\p{N}_/\-])/gu,
                (_, prefix, tag) => { managed(tag); return prefix; });
        }).join("");
        output.push(hiddenStart + line + end);
    }
    return output.join("");
}

function publicationBlockingTags(text) {
    const found = new Set();
    stripManagedBIOtags(text, tag => found.add(tag));
    return PUBLICATION_BLOCKING_TAGS.filter(tag => found.has(tag)).map(tag => "#" + tag);
}

function managedTagsFor({ baseMaterial = false, hasRecipe = false, updated = false } = {}) {
    return [baseMaterial || !hasRecipe ? "#待補充" : "#未人工檢查",
        ...(updated ? ["#更新需人工解析"] : []), "#需攻略補充"];
}

function rebuildManagedBIOtags(input, state) {
    const clean = stripManagedBIOtags(input), newline = clean.includes("\r\n") ? "\r\n" : "\n";
    const fm = clean.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
    let at = fm?.[0].length || 0;
    if (clean.slice(at).startsWith(newline)) at += newline.length;
    return clean.slice(0, at) + managedTagsFor(state).join(newline) + newline + clean.slice(at);
}

module.exports = { MANAGED_BIO_TAGS, normalizeTag, isManagedBIOtag, parseTagList,
    stripManagedBIOtags, publicationBlockingTags, managedTagsFor, rebuildManagedBIOtags };
