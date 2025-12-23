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
      const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' });
      if (response && response.running) {
        updateStatus('running', 'Filtering in progress...');
        document.getElementById('startBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
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

// Start button
document.getElementById('startBtn').addEventListener('click', async () => {
  const settings = saveSettings();
  
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'start',
        settings: settings
      }, (response) => {
        if (chrome.runtime.lastError) {
          updateStatus('error', 'Error: Make sure you are on Snapchat web');
        } else if (response && response.success) {
          updateStatus('running', 'Filtering started...');
          document.getElementById('startBtn').disabled = true;
          document.getElementById('stopBtn').disabled = false;
        }
      });
    }
  });
});

// Stop button
document.getElementById('stopBtn').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'stop' }, (response) => {
        updateStatus('stopped', 'Stopped');
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
      });
    }
  });
});

// Debug button
document.getElementById('debugBtn').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'debug' }, (response) => {
        updateStatus('stopped', 'Check browser console (F12) for debug info');
      });
    }
  });
});

// Find button - logs all buttons for sharing
document.getElementById('findBtn').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'findAllButtons' }, (response) => {
        if (response && response.log) {
          updateStatus('stopped', 'Log generated! Check console (F12) and copy the log');
          // Also try to copy to clipboard
          navigator.clipboard.writeText(response.log).then(() => {
            updateStatus('stopped', 'Log copied to clipboard! Also check console (F12)');
          }).catch(() => {
            // If clipboard fails, that's okay - user can copy from console
          });
        } else {
          updateStatus('error', 'Error generating log. Make sure you are on Snapchat web');
        }
      });
    }
  });
});

// Listen for status updates from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'statusUpdate') {
    updateStatus(message.status, message.message);
    if (message.status === 'stopped') {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
  }
});

