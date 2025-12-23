// Background service worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('Snapchat Friend Filter installed');
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'statusUpdate') {
    // Forward status updates to popup if open
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might not be open, ignore error
    });
  }
});

