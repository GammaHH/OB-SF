const previewRoot = '@自動化BIO Preview';
const previewRoots = [previewRoot, 'MC-自動化BIO/preview'];
const rootForPreview = relative => previewRoots.find(root => relative === root || relative.startsWith(root + '/'));

module.exports = { previewRoot, previewRoots, rootForPreview };
