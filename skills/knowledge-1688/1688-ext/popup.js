/**
 * popup.js v2 - 1688标题采集器 插件控制面板
 */
(function() {
  'use strict';

  var items    = [];
  var seenIds  = {};
  var exporting = false;

  // ── DOM ─────────────────────────────────────────
  var $       = function(s) { return document.querySelector(s); };
  var cardCountEl   = $('#card-count');
  var cardSelEl     = $('#card-sel');
  var collectedEl   = $('#collected-count');
  var resultHeader  = $('#result-header');
  var resultList    = $('#result-list');
  var resultCountEl = $('#result-count');
  var statusEl      = $('#status-msg');

  // ── Status helper ───────────────────────────────
  function setStatus(msg, type, dur) {
    statusEl.textContent = msg;
    statusEl.className = 'status show ' + (type || 'info');
    if (dur !== 0) {
      setTimeout(function() { statusEl.className = 'status'; }, dur || 3500);
    }
  }

  // ── Update UI ──────────────────────────────────
  function updateCounts() {
    collectedEl.textContent = items.length;
  }

  function renderList() {
    resultHeader.style.display = items.length ? 'flex' : 'none';
    resultCountEl.textContent = items.length + '条';
    resultList.innerHTML = '';

    var show = items.slice(0, 50);
    show.forEach(function(item, i) {
      var div = document.createElement('div');
      div.className = 'result-item';
      div.innerHTML =
        '<div class="item-title" title="' + item.title.replace(/"/g,'&quot;') + '">' + (i+1) + '. ' + item.title.slice(0,60) + '</div>' +
        '<div class="item-meta">' +
          (item.price ? '<span class="item-price">¥' + item.price + '</span>' : '') +
          '<span>' + item.shop + '</span>' +
        '</div>';
      div.addEventListener('click', function() {
        window.open(item.link, '_blank');
      });
      resultList.appendChild(div);
    });

    if (items.length > 50) {
      var more = document.createElement('div');
      more.className = 'more-items';
      more.textContent = '... 还有 ' + (items.length - 50) + ' 条，点击可打开详情';
      resultList.appendChild(more);
    }
  }

  // ── Send to content script ──────────────────────
  function cmdToTab(act) {
    return new Promise(function(resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (!tabs[0]) { resolve({ success: false, msg: 'no tab' }); return; }
        chrome.tabs.sendMessage(tabs[0].id, { act: act }, function(resp) {
          resolve(resp || { success: false });
        });
      });
    });
  }

  // ── Collect ────────────────────────────────────
  async function collect() {
    var btn = $('#btn-collect');
    btn.disabled = true;
    btn.textContent = '采集中...';
    setStatus('采集中...', 'info', 0);

    var resp = await cmdToTab('SCRAPE');

    btn.disabled = false;
    btn.textContent = '🔍 采集当前页';

    if (resp.success && resp.items && resp.items.length) {
      var newCount = 0;
      resp.items.forEach(function(item) {
        if (!seenIds[item.offerId]) {
          seenIds[item.offerId] = true;
          items.push(item);
          newCount++;
        }
      });
      updateCounts();
      renderList();
      $('#btn-export').disabled = false;
      $('#btn-copy').disabled = false;
      $('#btn-copyall').disabled = false;
      setStatus('✅ 采集 ' + resp.items.length + ' 条 (新增' + newCount + ')', 'ok');
      if (resp.fail && resp.fail.noTitle) {
        setStatus('⚠️ 部分标题提取失败 ' + resp.fail.noTitle + ' 个', 'info');
      }
    } else {
      setStatus('❌ ' + (resp.msg || '采集失败，可能不是搜索页'), 'err');
      if (resp.selector) {
        cardSelEl.textContent = resp.selector;
        cardCountEl.textContent = resp.count || 0;
      }
    }
  }

  // ── Export CSV ────────────────────────────────
  function exportCSV() {
    if (!items.length) { setStatus('无数据', 'err'); return; }
    var BOM = '\uFEFF';
    var header = '序号\tofferId\t标题\t价格\t店铺\t链接\n';
    var rows = items.map(function(item, i) {
      return [i+1, item.offerId, '"' + item.title.replace(/"/g,'""') + '"', item.price, '"' + item.shop.replace(/"/g,'""') + '"', item.link].join('\t');
    }).join('\n');
    var csv = BOM + header + rows;
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, '1688_titles_' + Date.now() + '.csv');
    setStatus('📥 已导出 ' + items.length + ' 条 CSV', 'ok');
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href  = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
  }

  // ── Copy to clipboard ─────────────────────────
  function copyTitles(which) {
    var titles;
    if (which === 'one') {
      titles = items.slice(0,1).map(function(i) { return i.title; });
    } else {
      titles = items.map(function(i) { return i.title; });
    }
    var text = titles.join('\n');
    navigator.clipboard.writeText(text).then(function() {
      setStatus('📋 已复制 ' + titles.length + ' 条标题到剪贴板', 'ok');
    }).catch(function() {
      setStatus('❌ 复制失败', 'err');
    });
  }

  // ── Event listeners ────────────────────────────
  $('#btn-collect').addEventListener('click', collect);
  $('#btn-export').addEventListener('click', exportCSV);
  $('#btn-copy').addEventListener('click', function() { copyTitles('one'); });
  $('#btn-copyall').addEventListener('click', function() { copyTitles('all'); });
  $('#btn-clear').addEventListener('click', function() {
    items = [];
    seenIds = {};
    updateCounts();
    renderList();
    $('#btn-export').disabled = true;
    $('#btn-copy').disabled = true;
    $('#btn-copyall').disabled = true;
    setStatus('已清空', 'info');
  });

  // ── Init: ping content script ──────────────────
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0] && tabs[0].url && tabs[0].url.indexOf('1688') >= 0) {
      cmdToTab('PING').then(function(r) {
        if (r.ok) {
          setStatus('✅ 插件已就绪，请点击"采集当前页"', 'ok', 2000);
        }
      });
    } else {
      cardSelEl.textContent = '请打开1688搜索页';
    }
  });

})();
