// Pure, editable Machine -> recipe section mapping. Never reads or writes files.
const clean = value => String(value ?? "").trim().replace(/^`(.*)`$/, "$1");
const diagnostic = (code, message, details = {}) => ({ code, severity: "WARNING", message, ...details });

function machineTarget(value) {
    const text = clean(value).replaceAll("\\|", "|");
    const link = text.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
    return (link ? link[1] : text).replaceAll("\\", "/").replace(/\.md$/i, "");
}

function tableCells(line) {
    const text = String(line).trim();
    if (!text.startsWith("|") || !text.endsWith("|")) return null;
    const cells = [];
    let cell = "", inLink = false;
    for (let i = 1; i < text.length - 1; i++) {
        if (text[i] === "\\" && text[i + 1] === "|") { cell += "|"; i++; continue; }
        if (text.slice(i, i + 2) === "[[") inLink = true;
        if (text.slice(i, i + 2) === "]]") inLink = false;
        if (text[i] === "|" && !inLink) { cells.push(clean(cell)); cell = ""; }
        else cell += text[i];
    }
    cells.push(clean(cell));
    return cells;
}

function parseMachineRecipeMappings(markdown) {
    const rules = [], diagnostics = [], lines = String(markdown ?? "").split(/\r?\n/);
    let columns = null, fence = "", comment = false;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (comment) { comment = !line.includes("-->"); continue; }
        const code = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (code) {
            if (!fence) fence = code[1];
            else if (code[1][0] === fence[0] && code[1].length >= fence.length && !code[2].trim()) fence = "";
            columns = null; continue;
        }
        if (fence) continue;
        if (line.includes("<!--")) { comment = !line.includes("-->"); columns = null; continue; }
        const cells = tableCells(lines[index]);
        if (!cells) { columns = null; continue; }
        const names = cells.map(value => value.toLowerCase().replace(/\s+/g, ""));
        if (["provider", "machine", "section", "enabled"].every(name => names.includes(name))) {
            columns = names; continue;
        }
        if (!columns || cells.every(value => /^:?-+:?$/.test(value))) continue;
        const get = name => cells[columns.indexOf(name)] || "";
        if (!cells.some(Boolean)) continue;
        const enabled = get("enabled").toLowerCase();
        if (!["true", "false"].includes(enabled)) {
            diagnostics.push(diagnostic("INVALID_MACHINE_MAPPING", "enabled 必須為 true 或 false", { line: index + 1 }));
            continue;
        }
        const rule = { provider: get("provider"), machine: machineTarget(get("machine")),
            sourceType: get("sourcetype"), section: get("section"), enabled: enabled === "true", line: index + 1 };
        if (!rule.machine || !rule.section || /[\r\n]/.test(rule.section) || /^#/.test(rule.section)) {
            diagnostics.push(diagnostic("INVALID_MACHINE_MAPPING", "Machine 與 section 必須為有效的名稱", { line: index + 1 }));
            continue;
        }
        rules.push(rule);
    }
    if (!rules.length && !diagnostics.length) diagnostics.push(diagnostic("MISSING_MACHINE_MAPPING_TABLE", "找不到 Machine recipe mapping 規則"));
    return { rules, diagnostics };
}

function classifyMachineRecipe(route, rules = []) {
    const unchanged = { section: route.section || "", diagnostics: [] };
    if (route.external || route.tagRepresentative || ["外部取得", "Tag 代表材料"].includes(route.section) || !route.machine) return unchanged;
    const target = machineTarget(route.machine);
    const matches = rules.filter(rule => rule.enabled &&
        (rule.machine.includes("/") ? rule.machine === target : rule.machine === target.split("/").pop()) &&
        (!rule.provider || rule.provider === clean(route.provider)) &&
        (!rule.sourceType || rule.sourceType === route.sourceType));
    if (matches.length === 1) return { section: matches[0].section, diagnostics: [] };
    return { section: unchanged.section, diagnostics: [diagnostic(matches.length ? "AMBIGUOUS_MACHINE_MAPPING" : "MISSING_MACHINE_MAPPING",
        matches.length ? "Machine 對應多筆已啟用規則；保留原分類" : "Machine 無唯一可用分類；保留原分類",
        { machine: target, provider: route.provider || "", sourceType: route.sourceType || "", matches: matches.length })] };
}

function normalizeMachineRecipeSections(input, options = {}) {
    const text = String(input), lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const output = [], diagnostics = [];
    let section = "", provider = "", scope = true, fence = "", comment = false;
    let frontmatter = /^\uFEFF?---\r?\n/.test(text), lastMachine = -1, lastTarget = null;
    const bare = line => line.replace(/\r?\n$/, "");
    const blank = line => !bare(line).trim();
    const recipeRow = line => /^\s*(?:\*\*合成所需|[-*]\s*\[(?:item|drop|GEO|output|note)\s*::|<!-- obsf:choices)/i.test(bare(line));
    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index], line = bare(raw);
        if (frontmatter) {
            output.push(raw);
            if (index && line === "---") frontmatter = false;
            continue;
        }
        if (comment) { comment = !line.includes("-->"); output.push(raw); continue; }
        const code = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (code) {
            if (!fence) fence = code[1];
            else if (code[1][0] === fence[0] && code[1].length >= fence.length && !code[2].trim()) fence = "";
            output.push(raw); continue;
        }
        if (fence) { output.push(raw); continue; }
        if (line.includes("<!--") && line.trim() !== "<!-- preferred -->") {
            comment = !line.includes("-->"); output.push(raw); continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (heading) {
            if (heading[1].length === 1) scope = /^合成\s*\/\s*取得(?:\s*（.*）)?$/.test(heading[2]);
            if (heading[1].length === 5) provider = heading[2];
            else { section = heading[1].length === 3 ? heading[2] : ""; provider = ""; }
            output.push(raw); continue;
        }
        const machineLine = line.replace(/(`+).*?\1/g, "");
        const machine = scope && !/^\s*-\s*\[note\s*::/i.test(machineLine) &&
            machineLine.match(/^\s*-\s+.*?\(Machine\s*::\s*(\[\[.*?\]\]|[^)]+)\)/i);
        if (!machine || ["外部取得", "Tag 代表材料"].includes(section)) { output.push(raw); continue; }
        const route = { machine: machineTarget(machine[1]), section, provider };
        if (!route.provider && options.resolveProvider) route.provider = options.resolveProvider(route) || "";
        const result = classifyMachineRecipe(route, options.rules || []);
        diagnostics.push(...result.diagnostics.map(entry => ({ ...entry, line: index + 1 })));
        if (!result.diagnostics.length) {
            let start = output.length, sawH3 = false, sawH5 = false;
            while (start > 0) {
                const previous = bare(output[start - 1]);
                if (!previous.trim() || previous.trim() === "<!-- preferred -->") { start--; continue; }
                if (/^#####\s/.test(previous) && !sawH5 && !sawH3) { sawH5 = true; start--; continue; }
                if (/^###\s/.test(previous) && !sawH3) { sawH3 = true; start--; continue; }
                break;
            }
            const suffix = output.slice(start);
            const preferred = suffix.filter(value => bare(value).trim() === "<!-- preferred -->");
            const contiguous = lastMachine >= 0 &&
                output.slice(lastMachine + 1, start).every(value => blank(value) || recipeRow(value));
            const sameGroup = contiguous && lastTarget?.section === result.section &&
                lastTarget.provider === route.provider;
            // Preserve blanks before a pre-existing heading; only replace its
            // own section/provider run. Never cross prose, notes or metadata.
            let firstHeader = suffix.findIndex(value => /^#{3}(?:##)?\s/.test(bare(value)));
            const leading = firstHeader >= 0 ? suffix.slice(0, firstHeader).filter(blank) : [];
            output.splice(start);
            // Consecutive routes share a tight list; heading spacing stays intact.
            if (!sameGroup) {
                output.push(...leading);
                if (!leading.length && output.length && !blank(output.at(-1))) output.push(newline);
                output.push("### " + result.section + newline, newline);
                if (route.provider) output.push("##### " + route.provider + newline, newline);
            }
            output.push(...preferred);
            lastTarget = { section: result.section, provider: route.provider };
        } else {
            // Only tighten excessive blank lines between recognized machine
            // recipe rows. Manual prose and unrelated headings are untouched.
            let tail = output.length;
            while (tail && (blank(output[tail - 1]) || bare(output[tail - 1]).trim() === "<!-- preferred -->")) tail--;
            const gap = output.slice(tail);
            if (gap.some(blank) && lastMachine >= 0 &&
                output.slice(lastMachine + 1, tail).every(value => blank(value) || recipeRow(value))) {
                output.splice(tail);
                output.push(...gap.filter(value => !blank(value)));
            }
            lastTarget = null;
        }
        lastMachine = output.length;
        output.push(raw);
    }
    return { text: output.join(""), diagnostics };
}

module.exports = { parseMachineRecipeMappings, classifyMachineRecipe, normalizeMachineRecipeSections };
