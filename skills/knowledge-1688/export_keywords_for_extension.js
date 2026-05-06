// export_keywords_for_extension.js - 导出高频关键词供扩展使用
const sqlite3 = require('sqlite3');
const fs = require('fs');

const DB_PATH = 'E:/1688标题生成/data/1688.db';
const LIMIT = 5000;

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

db.serialize(() => {
  db.all(`
    SELECT word, type, heat, click_rate, convert_rate
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
      heat: r.heat || 0,
      click_rate: r.click_rate || 0,
      convert_rate: r.convert_rate || 0
    }));

    // 输出到 stdout（被重定向）
    console.log(JSON.stringify(keywords));
    console.log('✅ 导出 ' + keywords.length + ' 条关键词', process.stderr);
  });
});
