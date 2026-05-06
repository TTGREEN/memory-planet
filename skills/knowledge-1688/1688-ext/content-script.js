/**
 * content-script.js v2 - 1688标题采集
 * 直接读取 DOM（无需 mtop API）
 * 1688 无法检测 extension 内运行的 JS
 */
(function() {
  'use strict';

  // ── 发现最优卡片选择器 ──────────────────────────────
  function discoverSelector() {
    var candidates = [
      { sel: '[data-offer-id]',        weight: 10 },
      { sel: '.offer-list-row .offer-item', weight: 9 },
      { sel: '.sm-offer-item',         weight: 8 },
      { sel: '[class*="offerItem"]',  weight: 7 },
      { sel: '.list-item',             weight: 6 },
      { sel: '#sm-offer-list > div',   weight: 5 }
    ];
    for (var i = 0; i < candidates.length; i++) {
      var els = document.querySelectorAll(candidates[i].sel);
      if (els.length > 0) return { selector: candidates[i].sel, count: els.length };
    }
    return null;
  }

  // ── 从卡片提取标题（排除旺旺按钮文案）─────────────
  function extractTitle(el) {
    var BAD = ['联系卖家','点此可以直接和卖家交流','小二币','找相似','找同款','掌财'];
    var links = el.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href || '';
      var txt  = links[i].innerText.trim();
      var title = links[i].getAttribute('title') || '';
      // 跳过旺旺/IM链接
      if (/im\.1688|webchat|联系卖家/.test(href)) continue;
      // 取有效中文标题
      if (title && title.length > 5 && !BAD.some(function(b){ return title.indexOf(b) >= 0; })) {
        return title;
      }
      if (txt && txt.length > 5 && txt.length < 200 && !BAD.some(function(b){ return txt.indexOf(b) >= 0; })) {
        if (/[\u4e00-\u9fa5]/.test(txt)) return txt;
      }
    }
    return '';
  }

  // ── 采集 ──────────────────────────────────────────
  function scrape() {
    var info = discoverSelector();
    if (!info) return { success: false, msg: 'no cards found', selector: null, count: 0, items: [] };

    var cards    = document.querySelectorAll(info.selector);
    var seenIds  = {};
    var items    = [];
    var failNoTitle = 0, failDup = 0;

    for (var i = 0; i < cards.length; i++) {
      var card  = cards[i];
      var offerId = card.getAttribute ? card.getAttribute('data-offer-id') : null;
      if (!offerId) {
        var m = (card.innerHTML || '').match(/offer[D_]?(\d{10,})/);
        if (m) offerId = m[1];
      }
      if (!offerId) continue;
      if (seenIds[offerId]) { failDup++; continue; }
      seenIds[offerId] = true;

      var title = extractTitle(card);
      if (!title) { failNoTitle++; continue; }

      // 价格
      var price = '';
      var priceEl = card.querySelector('[class*="price"]');
      if (priceEl) {
        var pt = (priceEl.innerText || '').match(/([¥￥]?[\d,]+\.?\d*)/);
        if (pt) price = pt[1].replace(/,/g, '');
      }

      // 店铺名
      var shop = '';
      var shopEl = card.querySelector('[class*="company"]') || card.querySelector('[class*="shop"]') ||
                   card.querySelector('[class*="member"]') || card.querySelector('.sm-offer-company');
      if (shopEl) shop = shopEl.innerText.trim().replace(/\s+/g, ' ').slice(0, 60);

      items.push({
        offerId: offerId,
        title:   title,
        price:   price,
        shop:    shop,
        link:    'https://detail.1688.com/offer/' + offerId + '.html'
      });
    }

    return {
      success: items.length > 0,
      selector: info.selector,
      totalCards: cards.length,
      items: items,
      fail: { noTitle: failNoTitle, dup: failDup }
    };
  }

  // ── 消息路由 ─────────────────────────────────────
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResp) {
    if (!msg || !msg.act) return;
    var result;
    if (msg.act === 'SCRAPE') {
      result = scrape();
    } else if (msg.act === 'PING') {
      result = { ok: true };
    } else {
      result = { success: false, msg: 'unknown act' };
    }
    sendResp(result);
    return true;
  });

})();
