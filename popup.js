// Popup script for Snapchat Friend Filter

document.addEventListener('DOMContentLoaded', async () => {
  // Load settings
  const settings = await chrome.storage.sync.get({
    minDelay: 800,
    maxDelay: 2000,
    scrollDelay: 1500,
    maxScrolls: 50,
    filterNonAmerican: true,
    filterBrownEmoji: true,
    humanLikeMouse: true
  });
  
  document.getElementById('minDelay').value = settings.minDelay;
  document.getElementById('maxDelay').value = settings.maxDelay;
  document.getElementById('scrollDelay').value = settings.scrollDelay;
  document.getElementById('maxScrolls').value = settings.maxScrolls;
  document.getElementById('filterNonAmerican').checked = settings.filterNonAmerican;
  document.getElementById('filterBrownEmoji').checked = settings.filterBrownEmoji;
  document.getElementById('humanLikeMouse').checked = settings.humanLikeMouse;
  
  // Get current tab and check status
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) {
      updateStatus('error', 'No active tab');
      return;
    }
    
    const tab = tabs[0];
    const url = tab.url || '';
    
    // Check if on Snapchat
    if (!isSnapchatWeb(url)) {
      updateStatus('stopped', 'Go to snapchat.com/web then click here');
      return;
    }
    
    // Try to communicate with content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      if (response && response.loaded) {
        updateStatus('stopped', 'Ready! Click "Open Panel" or "Start Filtering"');
        
        // Check if running
        const statusResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
        if (statusResponse && statusResponse.running) {
          updateStatus('running', 'Filtering in progress...');
          document.getElementById('startBtn').disabled = true;
          document.getElementById('stopBtn').disabled = false;
        }
      }
    } catch (e) {
      // Content script not loaded - try to inject
      console.log('Content script not responding, injecting...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        updateStatus('stopped', 'Ready! Click "Open Panel" or "Start Filtering"');
      } catch (injectError) {
        console.error('Failed to inject:', injectError);
        updateStatus('error', 'Please refresh the Snapchat page');
      }
    }
  });
});

// Save settings
function saveSettings() {
  const settings = {
    minDelay: parseInt(document.getElementById('minDelay').value),
    maxDelay: parseInt(document.getElementById('maxDelay').value),
    scrollDelay: parseInt(document.getElementById('scrollDelay').value),
    maxScrolls: parseInt(document.getElementById('maxScrolls').value),
    filterNonAmerican: document.getElementById('filterNonAmerican').checked,
    filterBrownEmoji: document.getElementById('filterBrownEmoji').checked,
    humanLikeMouse: document.getElementById('humanLikeMouse').checked
  };
  
  chrome.storage.sync.set(settings);
  return settings;
}

// Update status
function updateStatus(type, message) {
  const statusEl = document.getElementById('status');
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
}

// Check if Snapchat
function isSnapchatWeb(url) {
  if (!url) return false;
  return url.includes('snapchat.com');
}

// Start button
document.getElementById('startBtn').addEventListener('click', async () => {
  const settings = saveSettings();
  
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) {
      updateStatus('error', 'No active tab');
      return;
    }
    
    const tab = tabs[0];
    
    if (!isSnapchatWeb(tab.url || '')) {
      updateStatus('error', 'Please go to snapchat.com/web first');
      return;
    }
    
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'start',
        settings: settings
      });
      
      if (response && response.success) {
        updateStatus('running', 'Filtering started...');
        document.getElementById('startBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
      } else {
        updateStatus('error', response?.error || 'Failed to start');
      }
    } catch (e) {
      // Try inject and retry
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        
        setTimeout(async () => {
          try {
            const response = await chrome.tabs.sendMessage(tab.id, {
              action: 'start',
              settings: settings
            });
            if (response && response.success) {
              updateStatus('running', 'Filtering started...');
              document.getElementById('startBtn').disabled = true;
              document.getElementById('stopBtn').disabled = false;
            }
          } catch (e2) {
            updateStatus('error', 'Please refresh the page');
          }
        }, 500);
      } catch (e2) {
        updateStatus('error', 'Please refresh the page');
      }
    }
  });
});

// Stop button
document.getElementById('stopBtn').addEventListener('click', async () => {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) return;
    
    try {
      await chrome.tabs.sendMessage(tabs[0].id, { action: 'stop' });
    } catch (e) {}
    
    updateStatus('stopped', 'Stopped');
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
  });
});

// Debug button
document.getElementById('debugBtn').addEventListener('click', async () => {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) return;
    
    if (!isSnapchatWeb(tabs[0].url || '')) {
      updateStatus('error', 'Go to snapchat.com/web first');
      return;
    }
    
    try {
      await chrome.tabs.sendMessage(tabs[0].id, { action: 'debug' });
      updateStatus('stopped', 'Check browser console (F12)');
    } catch (e) {
      updateStatus('error', 'Please refresh the page');
    }
  });
});

// Find button
document.getElementById('findBtn').addEventListener('click', async () => {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) return;
    
    if (!isSnapchatWeb(tabs[0].url || '')) {
      updateStatus('error', 'Go to snapchat.com/web first');
      return;
    }
    
    try {
      const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'findAllButtons' });
      if (response && response.log) {
        updateStatus('stopped', 'Log in console (F12). Copying...');
        try {
          await navigator.clipboard.writeText(response.log);
          updateStatus('stopped', 'Log copied to clipboard!');
        } catch (e) {
          updateStatus('stopped', 'Check console (F12) for log');
        }
      }
    } catch (e) {
      updateStatus('error', 'Please refresh the page');
    }
  });
});

// Open Panel button
document.getElementById('openPanelBtn').addEventListener('click', async () => {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) {
      updateStatus('error', 'No active tab');
      return;
    }
    
    if (!isSnapchatWeb(tabs[0].url || '')) {
      updateStatus('error', 'Go to snapchat.com/web first');
      return;
    }
    
    try {
      const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'openPanel' });
      if (response && response.success) {
        updateStatus('stopped', 'Panel opened! Look at right side of page');
      } else {
        updateStatus('error', 'Could not open panel');
      }
    } catch (e) {
      // Try inject
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['content.js']
        });
        setTimeout(async () => {
          try {
            await chrome.tabs.sendMessage(tabs[0].id, { action: 'openPanel' });
            updateStatus('stopped', 'Panel opened!');
          } catch (e2) {
            updateStatus('error', 'Please refresh the page');
          }
        }, 500);
      } catch (e2) {
        updateStatus('error', 'Please refresh the page');
      }
    }
  });
});

// Listen for status updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'statusUpdate') {
    updateStatus(message.status, message.message);
    if (message.status === 'stopped') {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
  }
});
