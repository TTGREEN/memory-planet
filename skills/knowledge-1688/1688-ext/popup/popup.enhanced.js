// popup.enhanced.js - 1688 语义推荐搜索（v2.0 - Background 代理版）

const MTOP_BASE = 'https://h5api.m.1688.com/h5/mtop.relationrecommend.WirelessRecommend.recommend/2.0/';
const MTOP_APPKEY = '12574478';
const MTOP_TOKEN = '7f1460da33ecc27e96cafa07b1c1d3c3';

// ========== 工具 ==========
function md5(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  return crypto.subtle.digest('MD5', data).then(buf => {
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  });
}

// ========== 主流程 ==========
document.getElementById('searchBtn').addEventListener('click', async () => {
  const query = document.getElementById('query').value.trim();
  if (!query) return;

  const status = document.getElementById('status');
  const results = document.getElementById('results');
  status.textContent = '⏳ 搜索中...';
  results.innerHTML = '';
  document.getElementById('searchBtn').disabled = true;

  try {
    console.log('🔍 发送搜索请求:', query);
    const response = await chrome.runtime.sendMessage({
      action: 'search',
      query: query
    });
    console.log('📥 收到响应:', response);

    if (!response) {
      throw new Error('未收到响应（background 未就绪）');
    }
    if (!response.success) {
      throw new Error(response.error || '搜索失败');
    }

    const keywords = response.results;
    if (!keywords || !Array.isArray(keywords)) {
      throw new Error('响应格式错误: results 不是数组，实际类型: ' + typeof keywords);
    }
    if (keywords.length === 0) {
      status.textContent = '⚠️ 无匹配关键词';
      document.getElementById('searchBtn').disabled = false;
      return;
    }

    status.textContent = '🎯 找到 ' + keywords.length + ' 个相关关键词，获取商品中...';

    // 2. 对每个关键词获取商品（mtop API）
    const allProducts = [];
    for (const kw of keywords) {
      // 临时 mock（待实现真实搜索）
      allProducts.push({
        title: '[演示] ' + kw.keyword + ' 相关商品',
        price: '¥' + (Math.random() * 100).toFixed(2),
        shopName: '1688 供应商',
        semantic_sim: kw.semantic_sim.toFixed(3),
        keywordSource: kw.keyword
      });
    }

    // 3. 渲染
    renderProducts(allProducts);
    status.textContent = '✅ 完成';

  } catch (err) {
    console.error(err);
    status.textContent = '❌ ' + err.message;
  } finally {
    document.getElementById('searchBtn').disabled = false;
  }
});

function renderProducts(products) {
  const container = document.getElementById('results');
  container.innerHTML = '';

  products.forEach(p => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="item-title">${p.title}</div>
      <div class="item-price">${p.price}</div>
      <div class="item-shop">${p.shopName}</div>
      <span class="tag">语义相关度:${p.semantic_sim}</span>
      <span class="tag">来源:${p.keywordSource}</span>
    `;
    container.appendChild(div);
  });
}

// 回车搜索
document.getElementById('query').addEventListener('keypress', e => {
  if (e.key === 'Enter') document.getElementById('searchBtn').click();
});
