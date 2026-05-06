const sqlite3 = require('sqlite3');
const fs = require('fs');

const db = new sqlite3.Database('E:/1688标题生成/data/1688.db', sqlite3.OPEN_READONLY);

db.serialize(() => {
  db.all('SELECT word, type, heat FROM keywords ORDER BY heat DESC LIMIT 5000', [], (err, rows) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    const data = rows.map(r => ({
      word: r.word,
      type: r.type,
      heat: r.heat || 0
    }));
    fs.writeFileSync('keywords_export.json', JSON.stringify(data, null, 2), 'utf8');
    console.log('✅ 导出完成: ' + data.length + ' 条');
  });
});
