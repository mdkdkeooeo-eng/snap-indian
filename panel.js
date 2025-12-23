// Panel script - stays open on the page
let panelWindow = null;

// Load saved settings
document.addEventListener('DOMContentLoaded', async () => {
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
  
  // Check if script is running
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (tabs[0]) {
      try {
        const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' });
        if (response && response.running) {
          updateStatus('running', 'Filtering in progress...');
          document.getElementById('startBtn').disabled = true;
          document.getElementById('stopBtn').disabled = false;
        }
      } catch (e) {
        // Content script not loaded yet
        updateStatus('stopped', 'Ready - Click Start to begin');
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

// Update status display
function updateStatus(type, message) {
  const statusEl = document.getElementById('status');
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
}

// Check if URL is Snapchat web
function isSnapchatWeb(url) {
  if (!url) return false;
  return url.includes('snapchat.com') || url.includes('web.snapchat.com');
}

// Start button
document.getElementById('startBtn').addEventListener('click', async () => {
  const settings = saveSettings();
  
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) {
      updateStatus('error', 'No active tab found');
      return;
    }
    
    const tab = tabs[0];
    const url = tab.url || '';
    
    if (!isSnapchatWeb(url)) {
      updateStatus('error', 'Please navigate to web.snapchat.com first');
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
      } else if (response && response.error) {
        updateStatus('error', response.error);
      } else {
        updateStatus('error', 'Content script not loaded. Try refreshing the page.');
      }
    } catch (error) {
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
          } catch (e) {
            updateStatus('error', 'Please refresh the Snapchat page and try again');
          }
        }, 500);
      } catch (injectError) {
        updateStatus('error', 'Please refresh the Snapchat page and try again');
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
      updateStatus('stopped', 'Stopped');
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    } catch (e) {
      updateStatus('stopped', 'Stopped (script may have already stopped)');
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
  });
});

// Debug button
document.getElementById('debugBtn').addEventListener('click', async () => {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) return;
    
    if (!isSnapchatWeb(tabs[0].url || '')) {
      updateStatus('error', 'Please navigate to web.snapchat.com first');
      return;
    }
    
    try {
      await chrome.tabs.sendMessage(tabs[0].id, { action: 'debug' });
      updateStatus('stopped', 'Check browser console (F12) for debug info');
    } catch (e) {
      updateStatus('error', 'Content script not loaded. Refresh the page.');
    }
  });
});

// Find button
document.getElementById('findBtn').addEventListener('click', async () => {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (!tabs[0]) return;
    
    if (!isSnapchatWeb(tabs[0].url || '')) {
      updateStatus('error', 'Please navigate to web.snapchat.com first');
      return;
    }
    
    try {
      const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'findAllButtons' });
      if (response && response.log) {
        updateStatus('stopped', 'Log generated! Check console (F12) and copy the log');
        try {
          await navigator.clipboard.writeText(response.log);
          updateStatus('stopped', 'Log copied to clipboard! Also check console (F12)');
        } catch (e) {
          // Clipboard failed, that's okay
        }
      } else {
        updateStatus('error', 'Error generating log. Refresh the page and try again.');
      }
    } catch (e) {
      updateStatus('error', 'Content script not loaded. Refresh the page.');
    }
  });
});

// Close button
document.getElementById('closeBtn').addEventListener('click', () => {
  // Send message to content script to close the panel
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'closePanel' }).catch(() => {});
    }
  });
});

// Listen for status updates from content script (via postMessage from iframe parent)
window.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'statusUpdate') {
    updateStatus(event.data.status, event.data.message);
    if (event.data.status === 'stopped') {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
  }
});

// Also listen via chrome.runtime for popup messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'statusUpdate') {
    updateStatus(message.status, message.message);
    if (message.status === 'stopped') {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
  }
});

