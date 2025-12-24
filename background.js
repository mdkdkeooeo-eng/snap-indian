// Background service worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('Snapchat Friend Filter installed');
});

// Handle messages from panel and forward to content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward panel actions to the active tab's content script
  if (message.action === 'panelAction') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }
      
      try {
        // Forward the actual action to content script
        const response = await chrome.tabs.sendMessage(tabs[0].id, {
          action: message.panelAction,
          settings: message.settings
        });
        sendResponse(response);
      } catch (e) {
        console.error('Error forwarding message:', e);
        sendResponse({ success: false, error: e.message });
      }
    });
    return true; // Keep channel open for async response
  }
  
  // Forward status updates to popup if it's open
  if (message.action === 'statusUpdate') {
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might not be open, ignore
    });
  }

  // Forward log messages to panel
  if (message.action === 'logToPanel') {
    chrome.runtime.sendMessage(message).catch(() => {
      // Panel might not be open, ignore
    });
  }
});
