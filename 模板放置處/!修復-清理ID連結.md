<%*
// 1. 取得你目前正在觀看的檔案
const file = tp.file.find_tfile(tp.file.title);
if (!file) {
    new Notice("找不到當前檔案！");
    return;
}

// 2. 讀取檔案內的全部文字
let content = await app.vault.read(file);

// 3. 使用正規表達式，找出所有 [[主檔名|別名]] 的格式
const regex = /\[\[(.*?)\|.*?\]\]/g;

// 4. 檢查是否有需要替換的項目
if (!regex.test(content)) {
    new Notice("✅ 檔案很乾淨，沒有發現別名連結！");
    return;
}

// 5. 執行替換：把別名尾巴切掉，只保留主檔名 [[$1]]
let newContent = content.replace(regex, "[[$1]]");

// 6. 存檔覆蓋
await app.vault.modify(file, newContent);
new Notice("🧹 清理完成！已將所有別名連結轉換為純主檔名！");
_%>