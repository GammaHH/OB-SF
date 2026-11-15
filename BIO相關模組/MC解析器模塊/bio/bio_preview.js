// Rebind a review view to its own preview batch. Formal candidates must never
// pass through this helper. No filesystem access or source BIO writes.
function rewriteBIOForPreview(input, { resolveName, targets = new Map(), tagMembers = new Map() } = {}) {
    const original = String(input);
    const diagnostics = [];
    const lines = original.match(/[^\n]*\n|[^\n]+$/g) || [];
    const output = [];
    let yaml = /^\uFEFF?---\r?\n/.test(original), fence = null, comment = false, pending = null, machineRoute = false;
    const identity = name => {
        let resolved;
        try { resolved = resolveName?.(name); } catch { return null; }
        if (typeof resolved === "string" && targets.has(resolved)) return resolved;
        if (typeof name === "string" && name.startsWith("#minecraft:") && targets.has("tag:" + name.slice(1))) return "tag:" + name.slice(1);
        return typeof name === "string" && targets.has(name) ? name : null;
    };
    const bindingFor = name => {
        const value = targets.get(identity(name));
        return value && typeof value.target === "string" && value.target && !/[\r\n\[\]|]/.test(value.target) ? value : null;
    };
    const parseLink = value => {
        const match = value.trim().match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
        return match ? { name: match[1], alias: match[2] } : { name: value.trim() };
    };
    const link = (binding, existing) => {
        const label = existing.alias || binding.label;
        return "[[" + binding.target + (label ? "|" + label : "") + "]]";
    };
    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index], newline = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : "";
        const line = newline ? raw.slice(0, -newline.length) : raw;
        if (yaml) {
            if (index && line === "---") yaml = false;
            output.push(raw); continue;
        }
        if (comment) { if (line.includes("-->")) comment = false; output.push(raw); continue; }
        const code = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (code) {
            pending = null;
            if (!fence) fence = { char: code[1][0], length: code[1].length };
            else if (fence.char === code[1][0] && code[1].length >= fence.length && !code[2].trim()) fence = null;
            output.push(raw); continue;
        }
        if (fence) { output.push(raw); continue; }
        const metadata = line.match(/^(\s*)<!-- obsf:choices (.+) -->\s*$/);
        if (metadata) {
            pending = null;
            try {
                const value = JSON.parse(metadata[2]);
                if (!value || !Array.isArray(value.choices) || !value.choices.length ||
                    value.choices.some(choice => !choice || typeof choice.name !== "string" || !choice.name.trim())) throw new Error("choices 必須有具名候選");
                const tagId = String(value.id ?? "").replace(/^#/, "");
                const members = tagMembers.get(tagId);
                const candidateIds = value.choices.map(choice => {
                    try { return resolveName?.(choice.name) || choice.name; } catch { return null; }
                });
                const expected = new Set(members ?? []), actual = new Set(candidateIds);
                let tagBinding = value.kind === "tag" ? targets.get("tag:" + tagId) : null;
                if (!tagBinding && value.kind === "tag" && expected.size > 0) {
                    const equivalents = new Map();
                    for (const [key, values] of tagMembers) {
                        const keyIdentity = key.startsWith("group:") || key.startsWith("tag:") ? key : "tag:" + key;
                        const binding = targets.get(keyIdentity);
                        if (!binding || !Array.isArray(values) || values.length !== expected.size ||
                            new Set(values).size !== expected.size || !values.every(id => expected.has(id))) continue;
                        equivalents.set(binding.target, binding);
                    }
                    if (equivalents.size === 1) tagBinding = [...equivalents.values()][0];
                    else if (equivalents.size > 1) diagnostics.push({ code: "AMBIGUOUS_PREVIEW_COLLECTION", severity: "WARNING",
                        line: index + 1, message: "相同材料集合有多個預覽目標，保留原 choices" });
                }
                if (machineRoute && Array.isArray(members) && expected.size === members.length && members.length > 0 &&
                    value.choices.length === members.length && actual.size === expected.size &&
                    [...actual].every(id => expected.has(id)) && value.choices.every(choice => Number(choice.qty ?? 1) === 1) &&
                    tagBinding && typeof tagBinding.target === "string" && tagBinding.target && !/[\r\n\[\]|]/.test(tagBinding.target)) {
                    pending = { outputIndex: output.length, binding: tagBinding, members: expected, tagId };
                }
                const rebound = { ...value, choices: value.choices.map(choice => {
                    const binding = bindingFor(choice.name);
                    return binding ? { ...choice, name: binding.target } : choice;
                }) };
                const defaultBinding = typeof value.defaultName === "string" && bindingFor(value.defaultName);
                if (defaultBinding) rebound.defaultName = defaultBinding.target;
                const json = JSON.stringify(rebound).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
                output.push(metadata[1] + "<!-- obsf:choices " + json + " -->" + newline);
            } catch (error) {
                diagnostics.push({ code: "INVALID_PREVIEW_CHOICES", severity: "WARNING", line: index + 1, message: error.message });
                output.push(raw);
            }
            continue;
        }
        if (line.includes("<!--")) {
            pending = null; comment = !line.includes("-->"); output.push(raw); continue;
        }
        if (/^#{1,6}\s/.test(line)) machineRoute = false;
        const visibleLine = line.replace(/(`+).*?\1/g, "");
        if (/^\s*-\s/.test(visibleLine) && !/^\s*-\s*\[note\s*::/i.test(visibleLine) && /\(Machine\s*::/i.test(visibleLine)) machineRoute = true;
        const row = line.match(/^(\s*-\s*\[(?:item|drop|GEO)\s*::\s*)(\[\[.*?\]\]|[^\]]+)(\](?:\s*\(qty\s*::\s*([0-9.]+)\s*\))?.*)$/i);
        if (row) {
            const existing = parseLink(row[2]);
            let rowIdentity;
            try { rowIdentity = resolveName?.(existing.name) || existing.name; } catch { rowIdentity = null; }
            const matchingRow = pending && (pending.members.has(rowIdentity) || rowIdentity === "tag:" + pending.tagId ||
                existing.name === "#" + pending.tagId || bindingFor(existing.name)?.target === pending.binding.target);
            const compact = matchingRow && Number(row[4]) > 0 ? pending : null;
            const binding = compact?.binding || bindingFor(existing.name);
            if (compact) output[compact.outputIndex] = "";
            output.push(binding ? row[1] + link(binding, existing) + row[3] + newline : raw);
            pending = null; continue;
        }
        if (line.trim()) pending = null;
        output.push(raw);
    }
    return { text: output.join(""), diagnostics };
}

module.exports = { rewriteBIOForPreview };
