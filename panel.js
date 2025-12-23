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
      minSession: 5,
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
    document.getElementById('minSession').value = s.minSession;
    document.getElementById('maxSession').value = s.maxSession;
    document.getElementById('sessionBreakMins').value = s.sessionBreakMins;
    document.getElementById('filterNonAmerican').checked = s.filterNonAmerican;
    document.getElementById('filterBrownEmoji').checked = s.filterBrownEmoji;
    document.getElementById('humanLikeMouse').checked = s.humanLikeMouse;
    
    // Update limit displays
    updateLimitDisplays(s);
  } catch (e) {
    console.error('Error loading settings:', e);
  }
  
  // Load and display stats
  updateStats();
  setInterval(updateStats, 2000);
  
  updateStatus('stopped', 'Ready');
});

// Update limit badge displays
function updateLimitDisplays(settings) {
  const maxSession = settings?.maxSession || document.getElementById('maxSession').value || 30;
  const maxHourly = settings?.maxHourly || document.getElementById('maxHourly').value || 20;
  const maxDaily = settings?.maxDaily || document.getElementById('maxDaily').value || 100;
  
  // Get current counts from storage
  chrome.storage.local.get(['acceptedThisSession', 'acceptedThisHour', 'acceptedToday', 'declinedThisSession'], (data) => {
    const session = data.acceptedThisSession || 0;
    const hour = data.acceptedThisHour || 0;
    const today = data.acceptedToday || 0;
    
    document.getElementById('limitSession').textContent = session + '/' + (maxSession || '∞');
    document.getElementById('limitHourly').textContent = hour + '/' + (maxHourly || '∞');
    document.getElementById('limitDaily').textContent = today + '/' + (maxDaily || '∞');
  });
}

// Update stats display
async function updateStats() {
  try {
    const data = await chrome.storage.local.get([
      'acceptedToday', 'acceptedThisHour', 'acceptedThisSession', 
      'declinedThisSession', 'totalAccepted', 'totalDeclined'
    ]);
    
    document.getElementById('statAccepted').textContent = data.acceptedThisSession || 0;
    document.getElementById('statDeclined').textContent = data.declinedThisSession || 0;
    
    // Also update limits
    updateLimitDisplays();
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
    minSession: parseInt(document.getElementById('minSession').value) || 0,
    maxSession: parseInt(document.getElementById('maxSession').value) || 0,
    sessionBreakMins: parseInt(document.getElementById('sessionBreakMins').value) || 0,
    filterNonAmerican: document.getElementById('filterNonAmerican').checked,
    filterBrownEmoji: document.getElementById('filterBrownEmoji').checked,
    humanLikeMouse: document.getElementById('humanLikeMouse').checked
  };
  
  chrome.storage.sync.set(settings);
  updateLimitDisplays(settings);
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
  
  // Reset session stats
  await chrome.storage.local.set({ acceptedThisSession: 0, declinedThisSession: 0 });
  document.getElementById('statAccepted').textContent = '0';
  document.getElementById('statDeclined').textContent = '0';
  
  updateStatus('running', 'Starting...');
  
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
    await chrome.storage.local.set({ 
      acceptedThisSession: 0, 
      declinedThisSession: 0,
      acceptedThisHour: 0,
      acceptedToday: 0
    });
    document.getElementById('statAccepted').textContent = '0';
    document.getElementById('statDeclined').textContent = '0';
    updateLimitDisplays();
    updateStatus('stopped', 'All stats reset!');
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

// Export settings to JSON file
document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    const settings = await chrome.storage.sync.get();
    const stats = await chrome.storage.local.get();
    const logs = await chrome.storage.local.get('sessionLogs');
    
    const exportData = {
      exportDate: new Date().toISOString(),
      settings: settings,
      stats: {
        acceptedToday: stats.acceptedToday || 0,
        acceptedThisHour: stats.acceptedThisHour || 0,
        totalAccepted: stats.totalAccepted || 0,
        totalDeclined: stats.totalDeclined || 0
      },
      sessionLogs: logs.sessionLogs || []
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'snapfilter-settings-' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
    
    updateStatus('stopped', 'Settings exported!');
  } catch (e) {
    updateStatus('error', 'Export failed: ' + e.message);
  }
});

// Import settings from JSON file
document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    if (data.settings) {
      await chrome.storage.sync.set(data.settings);
      
      // Update UI with imported settings
      if (data.settings.minDelay) document.getElementById('minDelay').value = data.settings.minDelay;
      if (data.settings.maxDelay) document.getElementById('maxDelay').value = data.settings.maxDelay;
      if (data.settings.scrollDelay) document.getElementById('scrollDelay').value = data.settings.scrollDelay;
      if (data.settings.maxScrolls) document.getElementById('maxScrolls').value = data.settings.maxScrolls;
      if (data.settings.maxDaily) document.getElementById('maxDaily').value = data.settings.maxDaily;
      if (data.settings.maxHourly) document.getElementById('maxHourly').value = data.settings.maxHourly;
      if (data.settings.minSession) document.getElementById('minSession').value = data.settings.minSession;
      if (data.settings.maxSession) document.getElementById('maxSession').value = data.settings.maxSession;
      if (data.settings.sessionBreakMins) document.getElementById('sessionBreakMins').value = data.settings.sessionBreakMins;
      if (data.settings.filterNonAmerican !== undefined) document.getElementById('filterNonAmerican').checked = data.settings.filterNonAmerican;
      if (data.settings.filterBrownEmoji !== undefined) document.getElementById('filterBrownEmoji').checked = data.settings.filterBrownEmoji;
      if (data.settings.humanLikeMouse !== undefined) document.getElementById('humanLikeMouse').checked = data.settings.humanLikeMouse;
    }
    
    if (data.sessionLogs) {
      await chrome.storage.local.set({ sessionLogs: data.sessionLogs });
    }
    
    updateStatus('stopped', 'Settings imported!');
  } catch (e) {
    updateStatus('error', 'Import failed: ' + e.message);
  }
  
  e.target.value = ''; // Reset file input
});

// View session logs
document.getElementById('logsBtn').addEventListener('click', async () => {
  try {
    const data = await chrome.storage.local.get('sessionLogs');
    const logs = data.sessionLogs || [];
    
    if (logs.length === 0) {
      updateStatus('stopped', 'No logs yet');
      return;
    }
    
    let logText = '=== SESSION LOGS ===\n\n';
    logs.forEach((log, i) => {
      logText += `--- Session ${i + 1} ---\n`;
      logText += `Date: ${log.date}\n`;
      logText += `Accepted: ${log.accepted}\n`;
      logText += `Declined: ${log.declined}\n`;
      logText += `Skipped: ${log.skipped}\n`;
      if (log.names && log.names.length > 0) {
        logText += `Names: ${log.names.join(', ')}\n`;
      }
      logText += '\n';
    });
    
    console.log(logText);
    
    try {
      await navigator.clipboard.writeText(logText);
      updateStatus('stopped', 'Logs copied to clipboard! (' + logs.length + ' sessions)');
    } catch (e) {
      updateStatus('stopped', 'Check console (F12) for logs');
    }
  } catch (e) {
    updateStatus('error', e.message);
  }
});

// Record Actions button
let isRecording = false;
document.getElementById('recordBtn').addEventListener('click', async () => {
  if (!isRecording) {
    // Start recording
    try {
      const response = await sendMessage('startRecording');
      if (response && response.success) {
        isRecording = true;
        document.getElementById('recordBtn').textContent = '⏹ Stop Recording';
        document.getElementById('recordBtn').style.background = '#f44336';
        updateStatus('running', 'Recording clicks... Click elements, then stop to copy log.');
      }
    } catch (e) {
      updateStatus('error', e.message);
    }
  } else {
    // Stop recording and get log
    try {
      const response = await sendMessage('stopRecording');
      isRecording = false;
      document.getElementById('recordBtn').textContent = '🔴 Record Actions';
      document.getElementById('recordBtn').style.background = '#673AB7';
      
      if (response && response.log) {
        try {
          await navigator.clipboard.writeText(response.log);
          updateStatus('stopped', 'Recorded ' + response.count + ' actions - copied to clipboard!');
        } catch (e) {
          updateStatus('stopped', 'Recorded ' + response.count + ' actions - check console (F12)');
        }
      } else {
        updateStatus('stopped', 'No actions recorded');
      }
    } catch (e) {
      updateStatus('error', e.message);
    }
  }
});

// Listen for status updates from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'statusUpdate') {
    updateStatus(msg.status, msg.message);
    if (msg.status === 'stopped' || msg.status === 'error' || msg.status === 'warning') {
      document.getElementById('startBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
    }
    updateStats();
  }
  
  if (msg.action === 'statsUpdate') {
    if (msg.accepted !== undefined) {
      document.getElementById('statAccepted').textContent = msg.accepted;
    }
    if (msg.declined !== undefined) {
      document.getElementById('statDeclined').textContent = msg.declined;
    }
    updateLimitDisplays();
  }
});

// Also listen for postMessage from parent (content script)
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
