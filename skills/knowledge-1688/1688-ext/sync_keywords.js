// sync_keywords.js - 将数据库 keywords 导出为扩展可用的 JSON
// 运行：node sync_keywords.js > keywords.json
// 然后将 keywords.json 加载到 chrome.storage（通过 content script 或手动）

const sqlite3 = require('sqlite3');

const DB_PATH = 'E:/1688标题生成/data/1688.db';
const LIMIT = 5000;  // 先同步前 5000 高频词

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

db.serialize(() => {
  db.all(`
    SELECT word, type, category, heat, click_rate, convert_rate, competition
    FROM keywords
    ORDER BY heat DESC
    LIMIT ?
  `, [LIMIT], (err, rows) => {
    if (err) {
      console.error('❌ 查询失败:', err);
      process.exit(1);
    }

    const keywords = rows.map(r => ({
      word: r.word,
      type: r.type,
      category: r.category,
      heat: r.heat || 0,
      click_rate: r.click_rate || 0,
      convert_rate: r.convert_rate || 0,
      competition: r.competition || 0
    }));

    console.log('📦 导出 ' + keywords.length + ' 条关键词');
    console.log('💡 请在 Chrome 控制台执行：');
    console.log('   chrome.storage.local.set({keywords: ' + JSON.stringify(keywords) + '})');
    console.log('\n// 或者保存到文件：');
    console.log(JSON.stringify(keywords, null, 2));
  });
});
