// Panel script - runs inside iframe on Snapchat page
// Communicates with parent content script via postMessage

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Panel loaded');
  
  // Load settings
  try {
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
  } catch (e) {
    console.error('Error loading settings:', e);
  }
  
  updateStatus('stopped', 'Ready - Click Start to begin');
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
  
  try {
    chrome.storage.sync.set(settings);
  } catch (e) {
    console.error('Error saving settings:', e);
  }
  
  return settings;
}

// Update status
function updateStatus(type, message) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.className = `status ${type}`;
    statusEl.textContent = message;
  }
}

// Send message to content script via chrome.runtime
function sendMessage(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Message error:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

// Start button
document.getElementById('startBtn').addEventListener('click', async () => {
  const settings = saveSettings();
  updateStatus('running', 'Starting...');
  
  try {
    const response = await sendMessage('panelAction', { 
      panelAction: 'start',
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
    updateStatus('error', 'Error: ' + e.message);
  }
});

// Stop button
document.getElementById('stopBtn').addEventListener('click', async () => {
  try {
    await sendMessage('panelAction', { panelAction: 'stop' });
  } catch (e) {}
  
  updateStatus('stopped', 'Stopped');
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
});

// Debug button
document.getElementById('debugBtn').addEventListener('click', async () => {
  try {
    await sendMessage('panelAction', { panelAction: 'debug' });
    updateStatus('stopped', 'Check browser console (F12)');
  } catch (e) {
    updateStatus('error', 'Error: ' + e.message);
  }
});

// Find button
document.getElementById('findBtn').addEventListener('click', async () => {
  try {
    const response = await sendMessage('panelAction', { panelAction: 'findAllButtons' });
    if (response && response.log) {
      updateStatus('stopped', 'Log in console (F12)');
      try {
        await navigator.clipboard.writeText(response.log);
        updateStatus('stopped', 'Log copied to clipboard!');
      } catch (e) {
        updateStatus('stopped', 'Check console (F12) for log');
      }
    }
  } catch (e) {
    updateStatus('error', 'Error: ' + e.message);
  }
});

// Close button
document.getElementById('closeBtn').addEventListener('click', async () => {
  try {
    await sendMessage('panelAction', { panelAction: 'closePanel' });
  } catch (e) {
    console.error('Error closing panel:', e);
  }
});

// Listen for status updates
window.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'statusUpdate') {
    updateStatus(event.data.status, event.data.message);
    if (event.data.status === 'stopped') {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
  }
});

// Listen via chrome.runtime for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'statusUpdate') {
    updateStatus(message.status, message.message);
    if (message.status === 'stopped') {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
  }
});
