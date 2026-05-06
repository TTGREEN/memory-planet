/**
 * background.js - 1688标题采集器 v2 service worker
 */
chrome.runtime.onInstalled.addListener(function() {
  chrome.contextMenus.create({
    id: 'scrape1688',
    title: '采集1688标题',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener(function(info, tab) {
  if (info.menuItemId === 'scrape1688' && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { act: 'SCRAPE' }, function(resp) {
      if (resp && resp.success && resp.items) {
        chrome.action.setBadgeText({ text: String(resp.items.length), tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#ff6b00', tabId: tab.id });
      }
    });
  }
});
