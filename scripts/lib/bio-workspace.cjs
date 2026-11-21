const fs = require('node:fs');
const path = require('node:path');
const names = Object.freeze({
    baseReview: 'BIO Base Material Review.md', recipeReview: 'BIO Recipe Review.md',
    queue: 'BIO Review Queue.md', decisions: 'BIO Review Decisions.json',
    decisionSummary: 'BIO Review Decisions.md', collections: 'BIO Collection Mapping Draft.md'
});
const legacy = Object.freeze({
    baseReview: 'Minecraft Base Material Review.md', recipeReview: 'Minecraft Recipe Review.md',
    queue: 'Minecraft Review Queue.md', decisions: 'Minecraft Review Decisions.json',
    decisionSummary: 'Minecraft Review Decisions.md', collections: 'Minecraft Tag BIO Mapping Draft.md'
});
function workspaceName(root, key) {
    if (!names[key]) throw new Error('未知 BIO workspace key：' + key);
    const migrated = fs.existsSync(path.join(root,names.decisions));
    return migrated || fs.existsSync(path.join(root,names[key])) || !fs.existsSync(path.join(root,legacy[key])) ? names[key] : legacy[key];
}
function resolveLegacyDefault(root, value) {
    const entry = Object.entries(legacy).find(([, name]) => name === value);
    return entry ? workspaceName(root, entry[0]) : value;
}
function collectionTexts(root) {
    const unified = path.join(root, names.collections);
    if (fs.existsSync(unified)) {
        const text = fs.readFileSync(unified, 'utf8');
        return { tags: text, groups: text, files: [names.collections] };
    }
    const read = name => fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name), 'utf8') : '';
    return { tags: read(legacy.collections), groups: read('Minecraft BIO Group Mapping Draft.md'),
        files: [legacy.collections, 'Minecraft BIO Group Mapping Draft.md'] };
}
module.exports = { names, legacy, workspaceName, resolveLegacyDefault, collectionTexts };
