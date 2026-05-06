const sqlite3 = require('sqlite3');
const fs = require('fs');

const DB_PATH = 'E:/1688标题生成/data/1688.db';
const LIMIT = 5000;
const OUT = 'C:/Users/Administrator/.openclaw/workspace/skills/knowledge-1688-scraper/1688-ext/keywords.json';

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

db.serialize(() => {
  db.all(`
    SELECT word, type, heat
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
      heat: r.heat || 0
    }));

    fs.writeFileSync(OUT, JSON.stringify(keywords, null, 2), 'utf8');
    console.log('✅ 导出完成: ' + keywords.length + ' 条 → ' + OUT);
  });
});
