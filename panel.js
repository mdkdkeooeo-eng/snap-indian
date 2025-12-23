// Panel script

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Panel loaded');
  
  // Load settings
  try {
    const s = await chrome.storage.sync.get({
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
    
    document.getElementById('minDelay').value = s.minDelay;
    document.getElementById('maxDelay').value = s.maxDelay;
    document.getElementById('scrollDelay').value = s.scrollDelay;
    document.getElementById('maxScrolls').value = s.maxScrolls;
    document.getElementById('maxDaily').value = s.maxDaily;
    document.getElementById('maxHourly').value = s.maxHourly;
    document.getElementById('maxSession').value = s.maxSession;
    document.getElementById('sessionBreakMins').value = s.sessionBreakMins;
    document.getElementById('filterNonAmerican').checked = s.filterNonAmerican;
    document.getElementById('filterBrownEmoji').checked = s.filterBrownEmoji;
    document.getElementById('humanLikeMouse').checked = s.humanLikeMouse;
  } catch (e) {
    console.error('Error loading settings:', e);
  }
  
  // Load stats
  updateStats();
  setInterval(updateStats, 5000);
  
  updateStatus('stopped', 'Ready');
});

// Update stats display
async function updateStats() {
  try {
    const data = await chrome.storage.local.get(['acceptedToday', 'acceptedThisHour']);
    document.getElementById('statToday').textContent = data.acceptedToday || 0;
    document.getElementById('statHour').textContent = data.acceptedThisHour || 0;
  } catch (e) {}
}

// Save settings
function saveSettings() {
  const settings = {
    minDelay: parseInt(document.getElementById('minDelay').value) || 1000,
    maxDelay: parseInt(document.getElementById('maxDelay').value) || 3000,
    scrollDelay: parseInt(document.getElementById('scrollDelay').value) || 1500,
    maxScrolls: parseInt(document.getElementById('maxScrolls').value) || 50,
    maxDaily: parseInt(document.getElementById('maxDaily').value) || 0,
    maxHourly: parseInt(document.getElementById('maxHourly').value) || 0,
    maxSession: parseInt(document.getElementById('maxSession').value) || 0,
    sessionBreakMins: parseInt(document.getElementById('sessionBreakMins').value) || 0,
    filterNonAmerican: document.getElementById('filterNonAmerican').checked,
    filterBrownEmoji: document.getElementById('filterBrownEmoji').checked,
    humanLikeMouse: document.getElementById('humanLikeMouse').checked
  };
  
  chrome.storage.sync.set(settings);
  return settings;
}

// Update status
function updateStatus(type, msg) {
  const el = document.getElementById('status');
  el.className = 'status ' + type;
  el.textContent = msg;
}

// Send message to content script via background
function sendMessage(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'panelAction', panelAction: action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
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
  document.getElementById('statSession').textContent = '0';
  
  try {
    const response = await sendMessage('start', { settings });
    if (response && response.success) {
      updateStatus('running', 'Filtering in progress...');
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
    await sendMessage('stop');
  } catch (e) {}
  
  updateStatus('stopped', 'Stopped');
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
});

// Debug button
document.getElementById('debugBtn').addEventListener('click', async () => {
  try {
    await sendMessage('debug');
    updateStatus('stopped', 'Check console (F12)');
  } catch (e) {
    updateStatus('error', e.message);
  }
});

// Find buttons
document.getElementById('findBtn').addEventListener('click', async () => {
  try {
    const response = await sendMessage('findAllButtons');
    if (response && response.log) {
      try {
        await navigator.clipboard.writeText(response.log);
        updateStatus('stopped', 'Log copied to clipboard!');
      } catch (e) {
        updateStatus('stopped', 'Check console (F12)');
      }
    }
  } catch (e) {
    updateStatus('error', e.message);
  }
});

// Reset limits
document.getElementById('resetBtn').addEventListener('click', async () => {
  try {
    await sendMessage('resetLimits');
    document.getElementById('statSession').textContent = '0';
    document.getElementById('statHour').textContent = '0';
    document.getElementById('statToday').textContent = '0';
    updateStatus('stopped', 'Limits reset!');
  } catch (e) {
    updateStatus('error', e.message);
  }
});

// Close button
document.getElementById('closeBtn').addEventListener('click', async () => {
  try {
    await sendMessage('closePanel');
  } catch (e) {}
});

// Listen for status updates
window.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'statusUpdate') {
    updateStatus(event.data.status, event.data.message);
    if (event.data.status === 'stopped') {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
    updateStats();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'statusUpdate') {
    updateStatus(msg.status, msg.message);
    if (msg.status === 'stopped') {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
    updateStats();
  }
});
