// Popup script

document.addEventListener('DOMContentLoaded', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) {
    updateStatus('error', 'No active tab');
    return;
  }
  
  const url = tabs[0].url || '';
  if (!url.includes('snapchat.com')) {
    updateStatus('stopped', 'Go to snapchat.com first');
    return;
  }
  
  // Check if content script is loaded
  try {
    const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'ping' });
    if (response && response.loaded) {
      updateStatus('stopped', 'Ready! Open panel to configure.');
    }
  } catch (e) {
    // Try to inject
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['content.js']
      });
      updateStatus('stopped', 'Ready! Open panel to configure.');
    } catch (e2) {
      updateStatus('error', 'Please refresh Snapchat page');
    }
  }
});

function updateStatus(type, msg) {
  const el = document.getElementById('status');
  el.className = 'status ' + type;
  el.textContent = msg;
}

// Open panel
document.getElementById('openPanelBtn').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;
  
  if (!tabs[0].url.includes('snapchat.com')) {
    updateStatus('error', 'Go to snapchat.com first');
    return;
  }
  
  try {
    await chrome.tabs.sendMessage(tabs[0].id, { action: 'openPanel' });
    updateStatus('stopped', 'Panel opened! Check Snapchat page.');
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['content.js']
      });
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tabs[0].id, { action: 'openPanel' });
        updateStatus('stopped', 'Panel opened!');
      }, 500);
    } catch (e2) {
      updateStatus('error', 'Please refresh Snapchat page');
    }
  }
});

// Quick start with default settings
document.getElementById('startBtn').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;
  
  const settings = await chrome.storage.sync.get({
    minDelay: 1000,
    maxDelay: 3000,
    scrollDelay: 1500,
    maxScrolls: 50,
    maxDaily: 100,
    maxHourly: 20,
    maxSession: 30,
    sessionBreakMins: 30,
    filterNonAmerican: true,
    filterBrownEmoji: true,
    humanLikeMouse: true
  });
  
  try {
    const response = await chrome.tabs.sendMessage(tabs[0].id, {
      action: 'start',
      settings: settings
    });
    
    if (response && response.success) {
      updateStatus('running', 'Running...');
      document.getElementById('startBtn').disabled = true;
      document.getElementById('stopBtn').disabled = false;
    } else {
      updateStatus('error', response?.error || 'Failed');
    }
  } catch (e) {
    updateStatus('error', 'Please refresh page');
  }
});

// Stop
document.getElementById('stopBtn').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;
  
  try {
    await chrome.tabs.sendMessage(tabs[0].id, { action: 'stop' });
  } catch (e) {}
  
  updateStatus('stopped', 'Stopped');
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
});

// Find buttons
document.getElementById('findBtn').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;
  
  try {
    const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'findAllButtons' });
    if (response && response.log) {
      await navigator.clipboard.writeText(response.log);
      updateStatus('stopped', 'Log copied!');
    }
  } catch (e) {
    updateStatus('error', 'Please refresh page');
  }
});

// Listen for updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'statusUpdate') {
    updateStatus(msg.status, msg.message);
    if (msg.status === 'stopped') {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
  }
});
