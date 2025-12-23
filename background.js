// Background service worker for Snapchat Friend Filter

chrome.runtime.onInstalled.addListener(() => {
  console.log('Snapchat Friend Filter installed');
});

// Handle messages from panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle status updates from content script
  if (message.action === 'statusUpdate') {
    // Forward to popup and panel
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }
  
  // Handle panel actions - forward to content script
  if (message.action === 'panelAction') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }
      
      const tab = tabs[0];
      const action = message.panelAction;
      
      try {
        let response;
        
        if (action === 'start') {
          response = await chrome.tabs.sendMessage(tab.id, {
            action: 'start',
            settings: message.settings
          });
        } else if (action === 'stop') {
          response = await chrome.tabs.sendMessage(tab.id, { action: 'stop' });
        } else if (action === 'debug') {
          response = await chrome.tabs.sendMessage(tab.id, { action: 'debug' });
        } else if (action === 'findAllButtons') {
          response = await chrome.tabs.sendMessage(tab.id, { action: 'findAllButtons' });
        } else if (action === 'closePanel') {
          response = await chrome.tabs.sendMessage(tab.id, { action: 'closePanel' });
        } else {
          response = { success: false, error: 'Unknown action' };
        }
        
        sendResponse(response || { success: true });
      } catch (e) {
        console.error('Error forwarding message:', e);
        sendResponse({ success: false, error: e.message });
      }
    });
    
    return true; // Keep message channel open for async response
  }
  
  return false;
});
