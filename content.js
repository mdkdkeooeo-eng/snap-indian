// Snapchat Friend Filter - Content Script
console.log('=== SNAPCHAT FILTER LOADING ===');

(function() {
  'use strict';
  
  // Unique identifier to avoid conflicts with CupidBot and other extensions
  const SF_UNIQUE_ID = 'sf_' + Math.random().toString(36).substr(2, 9);
  const SF_VERSION = '2.1.0';
  
  if (window.__sf_snapFilterLoaded_v2) {
    console.log('SF: Already loaded');
    return;
  }
  window.__sf_snapFilterLoaded_v2 = true;
  
  // Don't interfere with CupidBot - check if on OnlyFans
  if (window.location.hostname.includes('onlyfans')) {
    console.log('SF: OnlyFans detected, staying dormant for CupidBot');
    return;
  }
  
  console.log('SF v' + SF_VERSION + ' loaded');
  
  // Use non-obvious console prefix to avoid detection
  const log = (msg) => console.log('%c[SF]', 'color: #FFFC00; font-weight: bold', msg);

  // State
  let isRunning = false;
  let settings = null;
  let processed = new Set();
  let panel = null;
  let declineButtonMissing = false; // Track if we've warned about missing decline button
  
  // Action recording state
  let isRecordingActions = false;
  let recordedActions = [];
  
  // Rate limiting counters
  let acceptedThisSession = 0;
  let declinedThisSession = 0;
  let acceptedThisHour = 0;
  let acceptedToday = 0;
  let lastHourTimestamp = 0;
  let lastDayTimestamp = 0;
  
  // Friend adding counters (separate from friend request accepting)
  let friendsAddedThisHour = 0;
  let friendsAddedToday = 0;
  let friendsAddedCount = 0; // For pause after X adds
  let lastFriendAddHourTimestamp = 0;
  let lastFriendAddDayTimestamp = '';

  // Load rate limit data from storage
  async function loadRateLimits() {
    try {
      const data = await chrome.storage.local.get(['acceptedToday', 'acceptedThisHour', 'lastHourTimestamp', 'lastDayTimestamp', 'lastSessionEnd']);
      const now = Date.now();
      const today = new Date().toDateString();
      const currentHour = Math.floor(now / (60 * 60 * 1000));
      
      if (data.lastDayTimestamp !== today) {
        acceptedToday = 0;
        lastDayTimestamp = today;
      } else {
        acceptedToday = data.acceptedToday || 0;
        lastDayTimestamp = data.lastDayTimestamp;
      }
      
      if (data.lastHourTimestamp !== currentHour) {
        acceptedThisHour = 0;
        lastHourTimestamp = currentHour;
      } else {
        acceptedThisHour = data.acceptedThisHour || 0;
        lastHourTimestamp = data.lastHourTimestamp;
      }
      
      console.log('Rate limits loaded - Today:', acceptedToday, 'This hour:', acceptedThisHour);
      return data.lastSessionEnd || 0;
    } catch (e) {
      console.error('Error loading rate limits:', e);
      return 0;
    }
  }

  async function saveRateLimits() {
    try {
      await chrome.storage.local.set({
        acceptedToday,
        acceptedThisHour,
        lastHourTimestamp,
        lastDayTimestamp: new Date().toDateString()
      });
    } catch (e) {}
  }

  async function saveSessionEnd() {
    try {
      await chrome.storage.local.set({ lastSessionEnd: Date.now() });
    } catch (e) {}
  }

  // Check limits - returns: 'ok', 'hourly', or 'daily'
  // Session limit is just informational, doesn't stop or pause
  function checkLimits() {
    if (settings.maxDaily > 0 && acceptedToday >= settings.maxDaily) {
      console.log('⚠ Daily limit reached:', acceptedToday, '/', settings.maxDaily);
      return 'daily';
    }
    if (settings.maxHourly > 0 && acceptedThisHour >= settings.maxHourly) {
      console.log('⚠ Hourly limit reached:', acceptedThisHour, '/', settings.maxHourly);
      return 'hourly';
    }
    // Session limit is just for display - doesn't cause stops or breaks
    return 'ok';
  }
  
  function canAcceptMore() {
    return checkLimits() === 'ok';
  }
  
  // Wait for hourly limit to reset
  async function waitForHourlyReset() {
    // Calculate time until next hour
    const now = Date.now();
    const nextHour = new Date(now);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    const resetTime = nextHour.getTime() + 60000; // Add 1 min buffer
    const waitMins = Math.ceil((resetTime - now) / 60000);
    
    console.log('⏳ Hourly limit reached. Waiting', waitMins, 'minutes until reset...');
    updateStatus('Hourly limit - wait ' + waitMins + ' min', 'warning');
    
    // Save wait info for panel display AND persistence across crashes
    await chrome.storage.local.set({ 
      waitingForHourly: true, 
      hourlyResetTime: resetTime 
    });
    await saveLastActivity('Waiting for hourly reset');
    
    // Wait in 10-second intervals
    while (Date.now() < resetTime && isRunning) {
      await delay(10000);
      const remaining = Math.ceil((resetTime - Date.now()) / 60000);
      if (remaining > 0) {
        updateStatus('Hourly reset in: ' + remaining + ' min', 'warning');
      }
    }
    
    // Reset hourly counter
    acceptedThisHour = 0;
    lastHourTimestamp = Math.floor(Date.now() / (60 * 60 * 1000));
    await chrome.storage.local.set({ 
      waitingForHourly: false, 
      hourlyResetTime: 0,
      acceptedThisHour: 0,
      lastHourTimestamp: lastHourTimestamp
    });
    await saveLastActivity('Hourly limit reset - resuming');
    
    console.log('✅ Hourly limit reset, resuming...');
    updateStatus('Hourly limit reset, resuming...', 'running');
  }
  
  // Check if we were waiting for hourly reset (browser crashed/closed)
  async function checkPendingHourlyReset() {
    try {
      const data = await chrome.storage.local.get(['waitingForHourly', 'hourlyResetTime']);
      if (data.waitingForHourly && data.hourlyResetTime) {
        const now = Date.now();
        if (now >= data.hourlyResetTime) {
          // Reset time has passed, clear the hourly counter
          console.log('✅ Hourly reset time passed while closed, resetting counter...');
          acceptedThisHour = 0;
          await chrome.storage.local.set({ 
            waitingForHourly: false, 
            hourlyResetTime: 0,
            acceptedThisHour: 0
          });
          await saveLastActivity('Hourly reset completed (was closed)');
          return false; // No need to wait
        } else {
          // Still need to wait
          const remaining = Math.ceil((data.hourlyResetTime - now) / 60000);
          console.log('⏳ Still waiting for hourly reset:', remaining, 'minutes left');
          return true; // Need to continue waiting
        }
      }
    } catch (e) {}
    return false;
  }

  async function incrementAcceptCount(name) {
    acceptedThisSession++;
    acceptedThisHour++;
    acceptedToday++;
    await saveRateLimits();
    await saveSessionStats();
    await saveLastActivity('Accepted: ' + (name || 'user').substring(0, 20));
    console.log('  Accepts - Session:', acceptedThisSession, 'Hour:', acceptedThisHour, 'Today:', acceptedToday);
  }
  
  async function incrementDeclineCount(name, reason) {
    declinedThisSession++;
    await saveSessionStats();
    await saveLastActivity('Declined: ' + (name || 'user').substring(0, 15) + ' (' + (reason || '') + ')');
    console.log('  Declined this session:', declinedThisSession);
  }
  
  async function saveSessionStats() {
    try {
      await chrome.storage.local.set({
        acceptedThisSession,
        declinedThisSession,
        acceptedThisHour,
        acceptedToday
      });
      // Also notify panel
      chrome.runtime.sendMessage({
        action: 'statsUpdate',
        accepted: acceptedThisSession,
        declined: declinedThisSession
      }).catch(() => {});
    } catch (e) {}
  }
  
  // Save last activity for persistence across crashes
  async function saveLastActivity(activity) {
    try {
      await chrome.storage.local.set({
        lastActivity: activity,
        lastActivityTime: Date.now()
      });
    } catch (e) {}
  }
  
  // Log every username action to persistent storage
  async function logUserAction(name, username, action, reason) {
    try {
      const data = await chrome.storage.local.get('userLog');
      const log = data.userLog || [];
      
      // Format: username-name (like userid format)
      const userEntry = username ? (username + '-' + name) : name;
      
      log.push({
        timestamp: new Date().toISOString(),
        user: userEntry,
        name: name || '',
        username: username || '',
        action: action, // 'accepted', 'declined', 'skipped'
        reason: reason || ''
      });
      
      // Keep last 1000 entries to avoid storage limits
      while (log.length > 1000) {
        log.shift();
      }
      
      await chrome.storage.local.set({ userLog: log });
    } catch (e) {
      console.log('Failed to log user action:', e);
    }
  }
  
  // Get user log for export
  async function getUserLog() {
    try {
      const data = await chrome.storage.local.get('userLog');
      return data.userLog || [];
    } catch (e) {
      return [];
    }
  }
  
  // ============================================
  // USER ID TRACKING - Prevents messaging same person on new Snapchat
  // ============================================
  // Use these functions to track which users have been messaged
  // Format: userId should be "username-name" or just "username" or "name"
  // This persists across browser sessions and new Snapchat logins
  // ============================================
  
  // Track messaged user IDs (persistent across sessions)
  async function hasMessagedUser(userId) {
    try {
      const data = await chrome.storage.local.get('messagedUsers');
      const messaged = data.messagedUsers || {};
      return messaged[userId] === true;
    } catch (e) {
      return false;
    }
  }
  
  async function markUserAsMessaged(userId) {
    try {
      const data = await chrome.storage.local.get('messagedUsers');
      const messaged = data.messagedUsers || {};
      messaged[userId] = true;
      await chrome.storage.local.set({ messagedUsers: messaged });
      log('Marked user as messaged: ' + userId);
    } catch (e) {
      log('Failed to mark user as messaged: ' + e);
    }
  }
  
  // ============================================
  // CONVERSATION READING - Understands context before responding
  // ============================================
  // These functions read the actual conversation from the page
  // so the AI can understand context and respond appropriately
  // Use getConversationContext() to get formatted history for AI
  // ============================================
  
  // Read conversation messages from the current chat
  async function readConversationMessages() {
    try {
      // Look for message elements in the chat view
      // Snapchat web typically uses divs with message content
      const messages = [];
      
      // Try multiple selectors for message containers
      const messageSelectors = [
        '[data-testid*="message"]',
        '[class*="Message"]',
        '[class*="message"]',
        'div[role="log"] > div', // Common chat container pattern
        '.chat-messages > div',
        '[aria-label*="message"]'
      ];
      
      let messageElements = [];
      for (const selector of messageSelectors) {
        messageElements = Array.from(document.querySelectorAll(selector));
        if (messageElements.length > 0) break;
      }
      
      // If no specific selector works, try to find all divs with text that might be messages
      if (messageElements.length === 0) {
        // Look for divs that contain text and are in a scrollable container
        const chatContainers = document.querySelectorAll('[role="log"], [class*="chat"], [class*="conversation"], [class*="messages"]');
        chatContainers.forEach(container => {
          const divs = container.querySelectorAll('div[class*="Message"], div[class*="message"]');
          messageElements.push(...Array.from(divs));
        });
      }
      
      // Extract message text and determine sender
      messageElements.forEach((el, index) => {
        const text = (el.textContent || el.innerText || '').trim();
        if (text.length < 1 || text.length > 500) return; // Skip empty or too long
        
        // Try to determine if it's sent by us or them
        // Common patterns: look for "You" indicator, or check position/classes
        const isFromMe = el.classList.toString().includes('sent') || 
                        el.classList.toString().includes('me') ||
                        el.classList.toString().includes('outgoing') ||
                        el.getAttribute('data-sender') === 'me' ||
                        el.closest('[class*="sent"], [class*="me"], [class*="outgoing"]');
        
        messages.push({
          index: index,
          text: text,
          isFromMe: !!isFromMe,
          timestamp: new Date().toISOString() // Approximate
        });
      });
      
      // Return last 20 messages (most recent)
      return messages.slice(-20).reverse(); // Most recent first
      
    } catch (e) {
      log('Error reading conversation: ' + e);
      return [];
    }
  }
  
  // Get conversation context for AI
  async function getConversationContext() {
    const messages = await readConversationMessages();
    if (messages.length === 0) return null;
    
    // Format as conversation history
    const history = messages.map(msg => ({
      role: msg.isFromMe ? 'assistant' : 'user',
      content: msg.text
    }));
    
    return {
      messages: history,
      lastMessage: messages[0]?.text || '',
      lastMessageFrom: messages[0]?.isFromMe ? 'me' : 'them',
      messageCount: messages.length
    };
  }
  
  // Get user ID from current conversation (username-name format)
  async function getCurrentConversationUserId() {
    try {
      // Try to find username/name in the chat header or conversation info
      const headerSelectors = [
        '[data-testid*="header"]',
        '[class*="Header"]',
        '[class*="header"]',
        'h1', 'h2',
        '[aria-label*="chat"], [aria-label*="conversation"]'
      ];
      
      for (const selector of headerSelectors) {
        const header = document.querySelector(selector);
        if (header) {
          const text = (header.textContent || header.innerText || '').trim();
          // Try to extract username from text
          const usernameMatch = text.match(/@?(\w+)/);
          if (usernameMatch) {
            // Try to find name nearby
            const nameMatch = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
            if (nameMatch && usernameMatch[1] !== nameMatch[1]) {
              return usernameMatch[1] + '-' + nameMatch[1];
            }
            return usernameMatch[1];
          }
        }
      }
      
      // Fallback: try to get from URL or other indicators
      // Snapchat web URLs sometimes contain user identifiers
      const urlMatch = location.href.match(/[?&]user=([^&]+)/);
      if (urlMatch) return urlMatch[1];
      
      return null;
    } catch (e) {
      log('Error getting conversation user ID: ' + e);
      return null;
    }
  }
  
  // Check if we should message this user (hasn't been messaged before)
  async function shouldMessageUser(userId) {
    if (!userId) {
      log('No user ID provided, skipping message');
      return false;
    }
    
    const alreadyMessaged = await hasMessagedUser(userId);
    if (alreadyMessaged) {
      log('User already messaged, skipping: ' + userId);
      return false;
    }
    
    return true;
  }
  
  // ============================================
  // FOLLOW-UP TRACKING - Send follow-up if no reply after X hours
  // ============================================
  // Tracks when messages were sent and whether user replied
  // Only sends follow-up if no reply after the delay time
  // ============================================
  
  // Track message sent to a user (for follow-up purposes)
  async function trackMessageSent(userId, messageText) {
    try {
      const data = await chrome.storage.local.get('conversationTracking');
      const tracking = data.conversationTracking || {};
      
      if (!tracking[userId]) {
        tracking[userId] = {
          userId: userId,
          firstMessageAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
          messagesSent: 1,
          followUpsSent: 0,
          lastReplyAt: null,
          lastMessageText: messageText
        };
      } else {
        tracking[userId].lastMessageAt = new Date().toISOString();
        tracking[userId].messagesSent = (tracking[userId].messagesSent || 0) + 1;
        tracking[userId].lastMessageText = messageText;
      }
      
      await chrome.storage.local.set({ conversationTracking: tracking });
      log('Tracked message sent to: ' + userId);
    } catch (e) {
      log('Failed to track message: ' + e);
    }
  }
  
  // Track reply received from a user
  async function trackReplyReceived(userId) {
    try {
      const data = await chrome.storage.local.get('conversationTracking');
      const tracking = data.conversationTracking || {};
      
      if (!tracking[userId]) {
        tracking[userId] = { userId: userId };
      }
      
      tracking[userId].lastReplyAt = new Date().toISOString();
      tracking[userId].replied = true;
      
      await chrome.storage.local.set({ conversationTracking: tracking });
      log('Tracked reply from: ' + userId);
    } catch (e) {
      log('Failed to track reply: ' + e);
    }
  }
  
  // Check if we should send a follow-up message
  // Returns: { shouldSend: true/false, reason: string, nextFollowUpTime: date }
  async function shouldSendFollowUp(userId, followUpDelayHours, maxFollowUps, onlyIfNoReply = true) {
    try {
      const data = await chrome.storage.local.get('conversationTracking');
      const tracking = data.conversationTracking || {};
      const userTracking = tracking[userId];
      
      if (!userTracking || !userTracking.lastMessageAt) {
        return { shouldSend: false, reason: 'No previous message tracked' };
      }
      
      // Check if they've already replied (if we only send follow-ups if no reply)
      if (onlyIfNoReply && userTracking.lastReplyAt) {
        const lastReplyTime = new Date(userTracking.lastReplyAt);
        const lastMessageTime = new Date(userTracking.lastMessageAt);
        
        // If they replied after our last message, don't send follow-up
        if (lastReplyTime > lastMessageTime) {
          return { shouldSend: false, reason: 'User already replied' };
        }
      }
      
      // Check if we've exceeded max follow-ups
      const followUpsSent = userTracking.followUpsSent || 0;
      if (followUpsSent >= maxFollowUps) {
        return { shouldSend: false, reason: 'Max follow-ups reached (' + maxFollowUps + ')' };
      }
      
      // Check if enough time has passed
      const lastMessageTime = new Date(userTracking.lastMessageAt);
      const now = new Date();
      const hoursSinceLastMessage = (now - lastMessageTime) / (1000 * 60 * 60);
      
      if (hoursSinceLastMessage < followUpDelayHours) {
        const hoursRemaining = followUpDelayHours - hoursSinceLastMessage;
        return { 
          shouldSend: false, 
          reason: 'Not enough time passed (' + hoursRemaining.toFixed(1) + 'h remaining)',
          nextFollowUpTime: new Date(lastMessageTime.getTime() + (followUpDelayHours * 60 * 60 * 1000))
        };
      }
      
      // All checks passed - should send follow-up
      return { 
        shouldSend: true, 
        reason: 'No reply after ' + hoursSinceLastMessage.toFixed(1) + ' hours',
        hoursSinceLastMessage: hoursSinceLastMessage
      };
      
    } catch (e) {
      log('Error checking follow-up: ' + e);
      return { shouldSend: false, reason: 'Error: ' + e };
    }
  }
  
  // Mark follow-up as sent
  async function trackFollowUpSent(userId) {
    try {
      const data = await chrome.storage.local.get('conversationTracking');
      const tracking = data.conversationTracking || {};
      
      if (!tracking[userId]) {
        tracking[userId] = { userId: userId };
      }
      
      tracking[userId].followUpsSent = (tracking[userId].followUpsSent || 0) + 1;
      tracking[userId].lastFollowUpAt = new Date().toISOString();
      tracking[userId].lastMessageAt = new Date().toISOString(); // Update last message time
      
      await chrome.storage.local.set({ conversationTracking: tracking });
      log('Tracked follow-up sent to: ' + userId + ' (total: ' + tracking[userId].followUpsSent + ')');
    } catch (e) {
      log('Failed to track follow-up: ' + e);
    }
  }
  
  // Get all users that need follow-ups
  async function getPendingFollowUps(followUpDelayHours, maxFollowUps, onlyIfNoReply = true) {
    try {
      const data = await chrome.storage.local.get('conversationTracking');
      const tracking = data.conversationTracking || {};
      const pending = [];
      
      for (const userId in tracking) {
        const check = await shouldSendFollowUp(userId, followUpDelayHours, maxFollowUps, onlyIfNoReply);
        if (check.shouldSend) {
          pending.push({
            userId: userId,
            ...check,
            tracking: tracking[userId]
          });
        }
      }
      
      return pending;
    } catch (e) {
      log('Error getting pending follow-ups: ' + e);
      return [];
    }
  }
  
  // ============================================
  // PHOTO MANAGEMENT - Never reuse photos to same username
  // ============================================
  // Photo selection based on conversation context
  // Main: general conversations
  // Sexy: teasing/CTA phase
  // Sad: rarely used
  // Pose: when they ask to prove you're real
  // ============================================
  
  // Get photos by category (filtered by enabled categories)
  async function getPhotosByCategory(category, enabledCategories) {
    try {
      if (!enabledCategories[category]) {
        return []; // Category disabled
      }
      
      const data = await chrome.storage.local.get('photos');
      const photos = data.photos || [];
      
      return photos.filter(p => p.category === category && p.dataUrl);
    } catch (e) {
      log('Error getting photos: ' + e);
      return [];
    }
  }
  
  // Select appropriate photo based on conversation context
  // Returns: { photo: object, category: string } or null
  async function selectPhotoForUser(userId, context = {}) {
    try {
      const settings = await chrome.storage.sync.get([
        'photosEnabled', 'photoCategoryMain', 'photoCategorySexy', 
        'photoCategorySad', 'photoCategoryPose'
      ]);
      
      if (!settings.photosEnabled) {
        return null; // Photos disabled
      }
      
      const enabledCategories = {
        main: settings.photoCategoryMain !== false,
        sexy: settings.photoCategorySexy !== false,
        sad: settings.photoCategorySad === true,
        pose: settings.photoCategoryPose !== false
      };
      
      // Load photos and sent tracking
      const data = await chrome.storage.local.get('photos');
      let photos = data.photos || [];
      
      // Determine which category to use based on context
      let targetCategory = 'main'; // Default
      
      // If in CTA phase, use sexy photos for teasing
      if (context.ctaPhase && context.ctaPhase === true) {
        targetCategory = 'sexy';
      }
      // If they asked to prove you're real, use pose
      else if (context.needsProof && context.needsProof === true) {
        targetCategory = 'pose';
      }
      // If conversation is sad/down, rarely use sad (only if enabled)
      else if (context.isSad && context.isSad === true && enabledCategories.sad) {
        targetCategory = 'sad';
      }
      
      // Get available photos for this category
      let availablePhotos = photos.filter(p => 
        p.category === targetCategory && 
        p.dataUrl && 
        enabledCategories[p.category]
      );
      
      // Filter out photos already sent to this user (NEVER REUSE)
      availablePhotos = availablePhotos.filter(photo => {
        const sentTo = photo.sentTo || [];
        return !sentTo.includes(userId);
      });
      
      // If no photos available for this category, try main as fallback
      if (availablePhotos.length === 0 && targetCategory !== 'main') {
        availablePhotos = photos.filter(p => 
          p.category === 'main' && 
          p.dataUrl && 
          enabledCategories.main
        );
        availablePhotos = availablePhotos.filter(photo => {
          const sentTo = photo.sentTo || [];
          return !sentTo.includes(userId);
        });
        targetCategory = 'main';
      }
      
      if (availablePhotos.length === 0) {
        log('No photos available for user: ' + userId);
        return null;
      }
      
      // Select random photo from available
      const selectedPhoto = availablePhotos[Math.floor(Math.random() * availablePhotos.length)];
      
      return {
        photo: selectedPhoto,
        category: targetCategory
      };
      
    } catch (e) {
      log('Error selecting photo: ' + e);
      return null;
    }
  }
  
  // Mark photo as sent to user (prevents reuse)
  async function markPhotoSentToUser(userId, photoId) {
    try {
      const data = await chrome.storage.local.get('photos');
      let photos = data.photos || [];
      
      const photo = photos.find(p => p.id === photoId);
      if (photo) {
        if (!photo.sentTo) {
          photo.sentTo = [];
        }
        if (!photo.sentTo.includes(userId)) {
          photo.sentTo.push(userId);
          await chrome.storage.local.set({ photos: photos });
          log('Marked photo sent to user: ' + userId);
        }
      }
    } catch (e) {
      log('Error marking photo sent: ' + e);
    }
  }
  
  // Inject photo into Snapchat camera/upload interface
  async function injectPhotoToSnapchat(photoDataUrl, description) {
    try {
      // Look for file input in Snapchat's camera/upload area
      // Common selectors for file inputs in web apps
      const fileInputSelectors = [
        'input[type="file"][accept*="image"]',
        'input[type="file"]',
        '[data-testid*="file"]',
        '[data-testid*="upload"]',
        '.file-input',
        '#file-input'
      ];
      
      let fileInput = null;
      for (const selector of fileInputSelectors) {
        fileInput = document.querySelector(selector);
        if (fileInput) break;
      }
      
      if (!fileInput) {
        log('Could not find file input for photo upload');
        return false;
      }
      
      // Convert data URL to File object
      const response = await fetch(photoDataUrl);
      const blob = await response.blob();
      const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
      
      // Create a new FileList with our file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      
      // Trigger change event
      const changeEvent = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(changeEvent);
      
      // If description exists, try to find caption/description field and set it
      if (description) {
        setTimeout(() => {
          const captionSelectors = [
            'textarea[placeholder*="caption"]',
            'textarea[placeholder*="description"]',
            'textarea[placeholder*="add"]',
            'input[type="text"][placeholder*="caption"]',
            '[contenteditable="true"]',
            '[data-testid*="caption"]'
          ];
          
          for (const selector of captionSelectors) {
            const captionField = document.querySelector(selector);
            if (captionField) {
              if (captionField.tagName === 'TEXTAREA' || captionField.tagName === 'INPUT') {
                captionField.value = description;
                captionField.dispatchEvent(new Event('input', { bubbles: true }));
              } else if (captionField.contentEditable === 'true') {
                captionField.textContent = description;
                captionField.dispatchEvent(new Event('input', { bubbles: true }));
              }
              break;
            }
          }
        }, 500); // Wait a bit for upload UI to appear
      }
      
      // After injecting photo, wait a bit then try to click photo send button and click out
      setTimeout(async () => {
        // Click photo send button (different from text message send button)
        await clickPhotoSendButton();
        
        // Click out after sending
        await clickOutAfterSend();
      }, 1000); // Wait for photo preview to appear
      
      log('Photo injected successfully');
      return true;
      
    } catch (e) {
      log('Error injecting photo: ' + e);
      return false;
    }
  }
  
  // ============================================
  // MESSAGE SENDING - Type and send messages in Snapchat
  // ============================================
  // Based on recording: message input -> type -> click SVG send button -> click out
  // ============================================
  
  // Find message input field
  async function findMessageInput() {
    const inputSelectors = [
      'textarea[placeholder*="Chat"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Say something"]',
      'textarea[data-testid*="message"]',
      'textarea[data-testid*="input"]',
      '[contenteditable="true"][data-testid*="message"]',
      '[contenteditable="true"][data-testid*="input"]',
      '[contenteditable="true"][role="textbox"]',
      'textarea',
      '[contenteditable="true"]'
    ];
    
    for (const selector of inputSelectors) {
      const input = document.querySelector(selector);
      if (input && input.offsetParent !== null) { // Check if visible
        // Verify it's actually the message input (not a caption field, etc.)
        const rect = input.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 20) { // Reasonable size for message input
          return input;
        }
      }
    }
    
    return null;
  }
  
  // Type text into message input (simulates human typing)
  async function typeMessage(text, inputElement) {
    try {
      if (!inputElement) {
        inputElement = await findMessageInput();
        if (!inputElement) {
          log('Could not find message input');
          return false;
        }
      }
      
      // Focus the input
      inputElement.focus();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Clear existing content
      if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
        inputElement.value = '';
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (inputElement.contentEditable === 'true') {
        inputElement.textContent = '';
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Type character by character (simulates human typing)
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
          inputElement.value += char;
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (inputElement.contentEditable === 'true') {
          inputElement.textContent += char;
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // Random delay between characters (30-80ms for natural typing)
        await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 50));
      }
      
      // Trigger final input event
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      
      log('Typed message: ' + text.substring(0, 50) + (text.length > 50 ? '...' : ''));
      return true;
      
    } catch (e) {
      log('Error typing message: ' + e);
      return false;
    }
  }
  
  // Find and click the photo send button (different from text message send button)
  async function clickPhotoSendButton() {
    try {
      // Wait a bit for photo send button to appear after photo is selected
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Photo send button is typically a DIV or button near the photo preview
      // Based on recording: it's a DIV element
      const photoSendSelectors = [
        'div[role="button"][aria-label*="Send" i]',
        'div[role="button"][aria-label*="send" i]',
        'button[aria-label*="Send photo" i]',
        'button[aria-label*="Send image" i]',
        'button[aria-label*="Send snap" i]',
        'div[data-testid*="send-photo" i]',
        'div[data-testid*="send-image" i]',
        'div[data-testid*="send-snap" i]',
        'button[data-testid*="send-photo" i]',
        'button[data-testid*="send-image" i]',
        'button[data-testid*="send-snap" i]'
      ];
      
      // Also look for DIV elements that might be the send button
      // Check for clickable divs near photo preview area
      const allDivs = document.querySelectorAll('div[role="button"], div[onclick], div[style*="cursor: pointer"]');
      for (const div of allDivs) {
        const ariaLabel = div.getAttribute('aria-label') || '';
        const text = div.textContent || '';
        const rect = div.getBoundingClientRect();
        
        // Check if it's visible and might be a send button
        if (div.offsetParent !== null && rect.width > 0 && rect.height > 0) {
          if (ariaLabel.toLowerCase().includes('send') || 
              text.toLowerCase().includes('send') ||
              ariaLabel.toLowerCase().includes('photo') ||
              ariaLabel.toLowerCase().includes('snap')) {
            div.click();
            log('Clicked photo send button (DIV): ' + ariaLabel);
            return true;
          }
        }
      }
      
      // Try standard selectors
      for (const selector of photoSendSelectors) {
        try {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) {
            element.click();
            log('Clicked photo send button: ' + selector);
            return true;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // Fallback: look for any button or div with "send" in aria-label near bottom of screen
      // Photo send buttons are usually at the bottom
      const viewportHeight = window.innerHeight;
      const allElements = document.querySelectorAll('button, div[role="button"], div[onclick]');
      for (const el of allElements) {
        const rect = el.getBoundingClientRect();
        const ariaLabel = el.getAttribute('aria-label') || '';
        
        // Check if it's in the bottom portion of screen and has "send" in label
        if (rect.top > viewportHeight * 0.7 && 
            rect.top < viewportHeight &&
            el.offsetParent !== null &&
            (ariaLabel.toLowerCase().includes('send') || ariaLabel.toLowerCase().includes('photo'))) {
          el.click();
          log('Clicked photo send button (fallback): ' + ariaLabel);
          return true;
        }
      }
      
      log('Could not find photo send button');
      return false;
      
    } catch (e) {
      log('Error clicking photo send button: ' + e);
      return false;
    }
  }
  
  // Find and click the text message send button (SVG element based on recording)
  async function clickSendButton() {
    try {
      // Wait a bit for send button to become active after typing
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Look for send button - SVG or button near the message input
      const sendButtonSelectors = [
        'button[aria-label*="Send" i]',
        'button[aria-label*="Send message" i]',
        'button[data-testid*="send" i]',
        'button svg[aria-label*="Send" i]',
        'button svg[aria-label*="send" i]',
        'svg[aria-label*="Send" i]',
        'svg[aria-label*="send" i]',
        'button:has(svg)',
        '[role="button"][aria-label*="Send" i]'
      ];
      
      // Also try finding button near message input
      const messageInput = await findMessageInput();
      if (messageInput) {
        const parent = messageInput.closest('div, form, section');
        if (parent) {
          const nearbyButtons = parent.querySelectorAll('button svg, button[aria-label], svg[aria-label]');
          for (const btn of nearbyButtons) {
            const ariaLabel = btn.getAttribute('aria-label') || '';
            const text = btn.textContent || '';
            if (ariaLabel.toLowerCase().includes('send') || text.toLowerCase().includes('send')) {
              if (btn.tagName === 'BUTTON') {
                btn.click();
                log('Clicked send button (found near input)');
                return true;
              } else if (btn.tagName === 'SVG') {
                const button = btn.closest('button');
                if (button) {
                  button.click();
                  log('Clicked send button (SVG near input)');
                  return true;
                }
              }
            }
          }
        }
      }
      
      // Try standard selectors
      for (const selector of sendButtonSelectors) {
        try {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) {
            if (element.tagName === 'BUTTON') {
              element.click();
              log('Clicked send button: ' + selector);
              return true;
            } else if (element.tagName === 'SVG') {
              const button = element.closest('button');
              if (button) {
                button.click();
                log('Clicked send button (SVG): ' + selector);
                return true;
              } else {
                element.click();
                log('Clicked send SVG directly');
                return true;
              }
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      log('Could not find send button');
      return false;
      
    } catch (e) {
      log('Error clicking send button: ' + e);
      return false;
    }
  }
  
  // Click out/away after sending (clears input or closes any modals)
  async function clickOutAfterSend() {
    try {
      // Wait a moment for message to send
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Click on a neutral area (chat area, not on input or buttons)
      // Try clicking on the chat message area
      const chatAreaSelectors = [
        '[data-testid*="message-list"]',
        '[data-testid*="chat"]',
        '.chat-container',
        'main',
        'body'
      ];
      
      for (const selector of chatAreaSelectors) {
        const element = document.querySelector(selector);
        if (element && element !== document.body) {
          const rect = element.getBoundingClientRect();
          // Click in the middle of the element, avoiding edges
          const x = rect.left + rect.width * 0.5;
          const y = rect.top + rect.height * 0.3; // Upper middle area
          
          element.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y
          }));
          
          log('Clicked out after send');
          return true;
        }
      }
      
      // Fallback: just blur the input
      const input = await findMessageInput();
      if (input) {
        input.blur();
      }
      
      return true;
      
    } catch (e) {
      log('Error clicking out: ' + e);
      return false;
    }
  }
  
  // Send a text message (complete function)
  async function sendTextMessage(messageText) {
    try {
      log('Sending message: ' + messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''));
      
      // Step 1: Find and type in message input
      const typed = await typeMessage(messageText);
      if (!typed) {
        return false;
      }
      
      // Step 2: Click send button
      const sent = await clickSendButton();
      if (!sent) {
        return false;
      }
      
      // Step 3: Click out/away after sending
      await clickOutAfterSend();
      
      log('Message sent successfully');
      return true;
      
    } catch (e) {
      log('Error sending message: ' + e);
      return false;
    }
  }
  
  // Send photo to user (high-level function)
  async function sendPhotoToUser(userId, context = {}) {
    try {
      const photoData = await selectPhotoForUser(userId, context);
      if (!photoData) {
        log('No photo available to send');
        return false;
      }
      
      const { photo, category } = photoData;
      
      // Inject photo into Snapchat
      const injected = await injectPhotoToSnapchat(photo.dataUrl, photo.description || '');
      if (!injected) {
        return false;
      }
      
      // Mark photo as sent to this user (prevents reuse)
      await markPhotoSentToUser(userId, photo.id);
      
      log('Photo sent to user: ' + userId + ' (category: ' + category + ')');
      return true;
      
    } catch (e) {
      log('Error sending photo: ' + e);
      return false;
    }
  }
  
  // ============================================
  // PHASE-BASED PHOTO SENDING
  // ============================================
  // Determine current phase and decide if we should send photo
  // based on the photo rate percentage set for that phase
  // ============================================
  
  // Get current phase for a conversation based on message exchanges
  async function getCurrentPhase(userId, messageExchanges) {
    try {
      const settings = await chrome.storage.sync.get([
        'phase1MinExchanges', 'phase1PhotoRate',
        'phase2MinExchanges', 'phase2PhotoRate',
        'additionalPhases'
      ]);
      
      // Check Phase 1
      if (messageExchanges < (settings.phase2MinExchanges || 5)) {
        return {
          phaseNumber: 1,
          minExchanges: settings.phase1MinExchanges || 0,
          photoRate: settings.phase1PhotoRate || 0
        };
      }
      
      // Check additional phases
      const additionalPhases = settings.additionalPhases || [];
      for (let i = 0; i < additionalPhases.length; i++) {
        const phase = additionalPhases[i];
        const nextPhaseMin = i < additionalPhases.length - 1 
          ? additionalPhases[i + 1].minExchanges 
          : Infinity;
        
        if (messageExchanges >= phase.minExchanges && messageExchanges < nextPhaseMin) {
          return {
            phaseNumber: i + 3, // Phase 3, 4, 5...
            minExchanges: phase.minExchanges,
            photoRate: phase.photoRate || 0
          };
        }
      }
      
      // Phase 2 (default if past Phase 1 but no additional phases)
      if (messageExchanges >= (settings.phase2MinExchanges || 5)) {
        return {
          phaseNumber: 2,
          minExchanges: settings.phase2MinExchanges || 5,
          photoRate: settings.phase2PhotoRate || 0
        };
      }
      
      // Default to Phase 1
      return {
        phaseNumber: 1,
        minExchanges: settings.phase1MinExchanges || 0,
        photoRate: settings.phase1PhotoRate || 0
      };
      
    } catch (e) {
      log('Error getting current phase: ' + e);
      return {
        phaseNumber: 1,
        minExchanges: 0,
        photoRate: 0
      };
    }
  }
  
  // Check if we should send a photo based on phase photo rate percentage
  async function shouldSendPhotoBasedOnPhase(userId, messageExchanges) {
    try {
      const settings = await chrome.storage.sync.get(['photosEnabled']);
      if (!settings.photosEnabled) {
        return { shouldSend: false, reason: 'Photos disabled' };
      }
      
      const currentPhase = await getCurrentPhase(userId, messageExchanges);
      const photoRate = currentPhase.photoRate || 0;
      
      if (photoRate <= 0) {
        return { shouldSend: false, reason: 'Photo rate is 0% for Phase ' + currentPhase.phaseNumber };
      }
      
      // Generate random number 0-100 and check if it's below the photo rate
      const randomChance = Math.random() * 100;
      const shouldSend = randomChance < photoRate;
      
      return {
        shouldSend: shouldSend,
        reason: shouldSend 
          ? 'Photo rate check passed (' + photoRate + '% chance in Phase ' + currentPhase.phaseNumber + ')'
          : 'Photo rate check failed (' + randomChance.toFixed(1) + '% > ' + photoRate + '% for Phase ' + currentPhase.phaseNumber + ')',
        phase: currentPhase
      };
      
    } catch (e) {
      log('Error checking phase photo rate: ' + e);
      return { shouldSend: false, reason: 'Error: ' + e };
    }
  }
  
  // Check if all phases are complete and we should ask for CTA
  async function shouldAskForCTAAfterPhases(userId, messageExchanges) {
    try {
      const settings = await chrome.storage.sync.get([
        'askCTAAfterPhases', 'phase1MinExchanges', 'phase2MinExchanges', 'additionalPhases'
      ]);
      
      if (!settings.askCTAAfterPhases) {
        return { shouldAsk: false, reason: 'CTA after phases disabled' };
      }
      
      // Find the highest phase requirement
      const allPhases = [
        { minExchanges: settings.phase1MinExchanges || 0 },
        { minExchanges: settings.phase2MinExchanges || 5 },
        ...(settings.additionalPhases || [])
      ];
      
      const maxPhaseExchanges = Math.max(...allPhases.map(p => p.minExchanges || 0));
      
      // If we've passed all phase requirements, ask for CTA
      if (messageExchanges >= maxPhaseExchanges) {
        return { 
          shouldAsk: true, 
          reason: 'All phases complete (' + messageExchanges + ' exchanges >= ' + maxPhaseExchanges + ')' 
        };
      }
      
      return { 
        shouldAsk: false, 
        reason: 'Still in phases (' + messageExchanges + ' exchanges < ' + maxPhaseExchanges + ')' 
      };
      
    } catch (e) {
      log('Error checking CTA after phases: ' + e);
      return { shouldAsk: false, reason: 'Error: ' + e };
    }
  }
  
  // AI-powered name detection cache
  const aiNameCache = new Map();
  
  // Check name using Claude AI
  async function checkNameWithAI(name, username) {
    const cacheKey = (name + '|' + username).toLowerCase();
    if (aiNameCache.has(cacheKey)) {
      return aiNameCache.get(cacheKey);
    }
    
    if (!settings.apiKey) {
      console.log('  No API key, using rule-based detection');
      return null; // Fallback to rule-based
    }
    
    try {
      const prompt = `Analyze this Snapchat profile name/username and classify it.

Name: "${name}"
Username: "${username}"

Check for TWO things:

1. ORIGIN: Is this likely a white American male?
- American names (Mike, John, Chris, Jake, Tyler, etc.) = AMERICAN
- South Asian (Raj, Sid, Preet, Singh, Kumar, Patel) = FOREIGN
- Middle Eastern (Mohammed, Ahmed, Ali, Hassan) = FOREIGN
- Hispanic/Latino (Carlos, Miguel, Juan, José) = FOREIGN
- East Asian, African, Sikh names = FOREIGN
- Female names = FOREIGN
- "Sid" is usually Siddharth (Indian) = FOREIGN

2. SEXUAL/SPAM: Is this sexual, inappropriate, or spam?
- Sexual terms (dick, sexy, horny, daddy, etc.) = SEXUAL
- Trading/crypto spam (forex, trading, bitcoin) = SEXUAL
- Suggestive nicknames (bigboy, baddie, freaky) = SEXUAL
- Normal nicknames (gamer, sports refs, hobbies) = OK

Respond with EXACTLY one line in this format:
ORIGIN:AMERICAN or ORIGIN:FOREIGN
SEXUAL:YES or SEXUAL:NO

Example responses:
ORIGIN:AMERICAN
SEXUAL:NO

or

ORIGIN:FOREIGN
SEXUAL:YES`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 20,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });
      
      if (!response.ok) {
        console.log('  AI API error:', response.status);
        return null; // Fallback to rule-based
      }
      
      const data = await response.json();
      const result = data.content[0].text.trim().toUpperCase();
      
      const isNonAmerican = result.includes('ORIGIN:FOREIGN');
      const isSexual = result.includes('SEXUAL:YES');
      
      console.log('  🤖 AI says:', name, '→', isNonAmerican ? 'FOREIGN' : 'AMERICAN', isSexual ? '+ SEXUAL' : '');
      
      // Cache the result
      const aiResult = { isNonAmerican, isSexual };
      aiNameCache.set(cacheKey, aiResult);
      
      return aiResult;
    } catch (e) {
      console.log('  AI error:', e.message);
      return null; // Fallback to rule-based
    }
  }

  // === ACTION RECORDING ===
  
  function getElementDetails(el) {
    const rect = el.getBoundingClientRect();
    const details = {
      tagName: el.tagName,
      id: el.id || '',
      className: (el.className || '').toString().substring(0, 100),
      textContent: (el.textContent || '').trim().substring(0, 100),
      ariaLabel: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      role: el.getAttribute('role') || '',
      type: el.getAttribute('type') || '',
      href: el.getAttribute('href') || '',
      name: el.getAttribute('name') || '',
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: el.offsetParent !== null
    };
    
    // Check for SVG
    const svg = el.querySelector('svg');
    if (svg) {
      details.hasSVG = true;
      details.svgPaths = svg.querySelectorAll('path').length;
    }
    
    // Get parent info
    if (el.parentElement) {
      details.parent = {
        tagName: el.parentElement.tagName,
        className: (el.parentElement.className || '').toString().substring(0, 50),
        textPreview: (el.parentElement.textContent || '').trim().substring(0, 50)
      };
    }
    
    // Get computed styles
    const styles = window.getComputedStyle(el);
    details.bgColor = styles.backgroundColor;
    details.cursor = styles.cursor;
    
    return details;
  }
  
  // Track last hover to avoid duplicate logs
  let lastHoverElement = null;
  let hoverTimeout = null;
  
  function recordClickHandler(event) {
    if (!isRecordingActions) return;
    
    const el = event.target;
    const action = {
      timestamp: new Date().toISOString(),
      type: 'click',
      element: getElementDetails(el),
      clientX: event.clientX,
      clientY: event.clientY,
      path: []
    };
    
    // Record the path from clicked element up to body
    let current = el;
    for (let i = 0; i < 5 && current && current !== document.body; i++) {
      action.path.push({
        tagName: current.tagName,
        className: (current.className || '').toString().substring(0, 30),
        id: current.id || ''
      });
      current = current.parentElement;
    }
    
    recordedActions.push(action);
    console.log('📍 Recorded click #' + recordedActions.length + ':', el.tagName, (el.textContent || '').substring(0, 30));
  }
  
  function recordMouseMoveHandler(event) {
    if (!isRecordingActions) return;
    
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || el === lastHoverElement) return;
    
    // Check if this element is interactive or might be a hidden button
    const isInteractive = el.matches('button, a, [role="button"], [tabindex], svg, path, input, [onclick]');
    const hasClickCursor = window.getComputedStyle(el).cursor === 'pointer';
    const isSmall = el.offsetWidth < 50 && el.offsetHeight < 50;
    
    // Only record if it seems like a potential button
    if (!isInteractive && !hasClickCursor) return;
    
    lastHoverElement = el;
    
    // Debounce to avoid too many entries
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      const action = {
        timestamp: new Date().toISOString(),
        type: 'hover',
        element: getElementDetails(el),
        clientX: event.clientX,
        clientY: event.clientY,
        path: [],
        isInteractive,
        hasClickCursor,
        isSmall
      };
      
      // Record path
      let current = el;
      for (let i = 0; i < 5 && current && current !== document.body; i++) {
        action.path.push({
          tagName: current.tagName,
          className: (current.className || '').toString().substring(0, 30),
          id: current.id || ''
        });
        current = current.parentElement;
      }
      
      recordedActions.push(action);
      console.log('👆 Recorded hover #' + recordedActions.length + ':', el.tagName, isSmall ? '(small)' : '', hasClickCursor ? '(clickable)' : '');
    }, 200);
  }
  
  function recordMouseEnterHandler(event) {
    if (!isRecordingActions) return;
    
    const el = event.target;
    
    // Check for elements that appear on hover (hidden buttons)
    setTimeout(() => {
      // Look for new elements that appeared after hover
      const newElements = el.querySelectorAll('button, svg, [role="button"], [tabindex]');
      newElements.forEach(newEl => {
        if (newEl.offsetParent && !recordedActions.some(a => a.element && a.element.x === newEl.getBoundingClientRect().left)) {
          const action = {
            timestamp: new Date().toISOString(),
            type: 'revealed',
            element: getElementDetails(newEl),
            revealedBy: {
              tagName: el.tagName,
              className: (el.className || '').toString().substring(0, 50)
            },
            path: []
          };
          recordedActions.push(action);
          console.log('👁 Revealed element:', newEl.tagName);
        }
      });
    }, 300);
  }
  
  function startRecording() {
    recordedActions = [];
    isRecordingActions = true;
    lastHoverElement = null;
    document.addEventListener('click', recordClickHandler, true);
    document.addEventListener('mousemove', recordMouseMoveHandler, true);
    document.addEventListener('mouseenter', recordMouseEnterHandler, true);
    console.log('🔴 Recording started - click and move mouse to record. Tracking hidden buttons.');
    return true;
  }
  
  function stopRecording() {
    isRecordingActions = false;
    document.removeEventListener('click', recordClickHandler, true);
    document.removeEventListener('mousemove', recordMouseMoveHandler, true);
    document.removeEventListener('mouseenter', recordMouseEnterHandler, true);
    
    // Generate log
    let log = '=== RECORDED ACTIONS ===\n\n';
    log += 'Recording stopped at: ' + new Date().toISOString() + '\n';
    log += 'Total actions: ' + recordedActions.length + '\n';
    log += 'URL: ' + location.href + '\n\n';
    
    // Separate by type
    const clicks = recordedActions.filter(a => a.type === 'click');
    const hovers = recordedActions.filter(a => a.type === 'hover');
    const revealed = recordedActions.filter(a => a.type === 'revealed');
    
    log += 'Clicks: ' + clicks.length + '\n';
    log += 'Hovers (interactive): ' + hovers.length + '\n';
    log += 'Revealed elements: ' + revealed.length + '\n\n';
    
    recordedActions.forEach((action, i) => {
      log += '--- Action ' + (i + 1) + ' [' + action.type.toUpperCase() + '] ---\n';
      log += 'Time: ' + action.timestamp + '\n';
      if (action.clientX) log += 'Position: ' + action.clientX + ', ' + action.clientY + '\n';
      
      const el = action.element;
      log += 'Element: <' + el.tagName + '>\n';
      log += '  ID: "' + el.id + '"\n';
      log += '  Class: "' + el.className + '"\n';
      log += '  Text: "' + el.textContent + '"\n';
      log += '  Aria-Label: "' + el.ariaLabel + '"\n';
      log += '  Position: x=' + el.x + ' y=' + el.y + ' w=' + el.width + ' h=' + el.height + '\n';
      log += '  Visible: ' + el.visible + '\n';
      log += '  Cursor: ' + el.cursor + '\n';
      
      if (action.type === 'hover') {
        log += '  Interactive: ' + action.isInteractive + '\n';
        log += '  Click cursor: ' + action.hasClickCursor + '\n';
        log += '  Small element: ' + action.isSmall + '\n';
      }
      
      if (action.type === 'revealed' && action.revealedBy) {
        log += '  Revealed by: <' + action.revealedBy.tagName + '> class="' + action.revealedBy.className + '"\n';
      }
      
      if (el.hasSVG) {
        log += '  Has SVG: true (paths: ' + el.svgPaths + ')\n';
      }
      
      if (action.path && action.path.length > 0) {
        log += '  DOM Path: ';
        log += action.path.map(p => p.tagName + (p.id ? '#' + p.id : '') + (p.className ? '.' + p.className.split(' ')[0] : '')).join(' > ');
        log += '\n';
      }
      log += '\n';
    });
    
    log += '=== END RECORDED ACTIONS ===\n';
    
    console.log(log);
    
    const count = recordedActions.length;
    recordedActions = [];
    
    return { log, count };
  }

  // Middle Eastern name ROOTS/PREFIXES for fuzzy matching
  // These catch variations like mohamad, mohmad, muhamed, mohmandolo, etc.
  const nameRoots = [
    'mohm', 'moha', 'muha', 'muhm', 'mahm', 'mohd',  // mohammad variants
    'ahme', 'ahmd',  // ahmed variants
    'hass', 'huss', 'husn',  // hassan/hussein
    'ibra', 'abdu', 'abd',  // ibrahim/abdullah
    'khal', 'khld',  // khalid/khalil
    'must', 'mstf',  // mustafa
    'osma', 'usmn',  // osman/usman
    'isma',  // ismail
    'yusf', 'yous', 'yose',  // yusuf/yousef
    'tarq', 'tariq',  // tariq
    'hamz', 'hmza',  // hamza
    'bila', 'blal',  // bilal
    'rash', 'rshd',  // rashid
    'fais', 'fysl',  // faisal
    'nass', 'nasr',  // nasser/nasir
    'qasi',  // qasim
    'shahi', 'shahz',  // shahid/shahzad
    'waqr', 'waqa',  // waqar/waqas
    'rizw',  // rizwan
    'jave', 'jawa',  // javed/jawad
    'imra',  // imran
    'nabi', 'nade',  // nabeel/nadeem
    'iqba',  // iqbal
    'zuba',  // zubair
    'rukh',  // rukhsar
    'noor',  // noor/nur
    'sami',  // samir
    'dani', 'dany',  // daniyal
    'arya', 'ayaa',  // aryan
    'asad', 'asif', 'atif',  // asad/asif/atif
    'faiz',  // faiz
    'haid', 'hayd',  // haider
    'uzai',  // uzair
    
    // Sikh/Punjabi PREFIXES (very common patterns)
    'gurp', 'gurd', 'gurj', 'gurm', 'gurs',  // Gur- names
    'harp', 'hard', 'harj', 'harm', 'hars',  // Har- names
    'manp', 'mand', 'manj', 'manm',  // Man- names
    'navp', 'navd', 'navj', 'navm',  // Nav- names
    'balj', 'balv', 'bald', 'balp',  // Bal- names
    'jasv', 'jasp', 'jasd', 'jasj',  // Jas- names
    'rajv', 'rajp', 'rajd', 'rajj',  // Raj- names
    'sukh', 'sukhd', 'sukhj', 'sukhv',  // Sukh- names
    'ravj', 'ravi', 'ravd', 'ravm',  // Rav- names (RAVJOT!)
    'davj', 'davi', 'davd',  // Dav- names
    'jatj', 'jati', 'jatd',  // Jat- names
    'surj', 'suri', 'surd',  // Sur- names
    'kulj', 'kuld', 'kulp',  // Kul- names
    'amar', 'amard', 'amarj',  // Amar- names
    'parm', 'parj', 'pard',  // Par- names
    'jagj', 'jagd', 'jagp',  // Jag- names
    'rand', 'ranj', 'ranv',  // Ran- names
    'indj', 'indd', 'indp',  // Ind- names (Inderjit, etc)
    
    // Sikh/Punjabi SUFFIXES that form names
    'deep', 'preet', 'jeet', 'meet', 'veer', 'inder', 'inder',
    
    // Turkish roots
    'mehm', 'mehmet',  // mehmet
    'ahmet', 'mustaf',  // ahmet/mustafa
    'ceng', 'cenk',  // cengiz/cenk
    'berk', 'kaan',  // berk/kaan
    'emir', 'emre',  // emir/emre
    'burak', 'bura',  // burak
    'oguz',  // oguz
    'serkan', 'serk',  // serkan
    'volkan', 'volk',  // volkan
    'gokh',  // gokhan
    'ozgu',  // ozgur
    'tugr',  // tugrul
    'yilm',  // yilmaz
    'demir',  // demir
  ];
  
  // Mexican/Hispanic name roots (separate for optional filtering)
  const hispanicRoots = [
    'guad', 'guadal',  // guadalupe
    'javi', 'javie',  // javier
    'fern', 'fernan',  // fernando
    'guil', 'guill',  // guillermo
    'robe', 'rober',  // roberto
    'alej', 'alejan',  // alejandro
    'enri', 'enriq',  // enrique
    'gonz', 'gonzal',  // gonzalez/gonzalo
    'hern', 'hernan',  // hernandez/hernando
    'carlo',  // carlos
    'migu', 'migue',  // miguel
    'edua', 'eduar',  // eduardo
    'anton',  // antonio
    'salv', 'salva',  // salvador
    'franc',  // francisco
    'ramir',  // ramirez/ramiro
    'rodri', 'rodrig',  // rodrigo/rodriguez
  ];
  
  // Full names to match exactly or as substring
  const middleEasternNames = [
    // Middle Eastern / Arabic
    'ahmed','mohammed','muhammad','mohamed','mohammad','mohamad','muhamed','ali','hassan','hussain','hussein','omar','yusuf','yousef','ibrahim','abdullah','abdul','khalid','saad','tariq','zain','zayn','hamza','bilal','mustafa','osman','usman','ismail','salman','karim','jamal','rashid','faisal','nasser','mahmoud','majid','noor','reza','saeed','samir','waleed','yazan','zaid','adnan','amir','farid','hadi','hani','jamil','kareem','malik','nasir','qasim','sadiq','shahid','tahir','zahir','zaki','amin','arif','aziz','bashir','emad','fahad','ghazi','habib','imran','javed','jawad','khalil','latif','nabeel','nadeem','naveed','nazir','rafiq','rizwan','sabir','sajid','saleem','samad','shafiq','shahzad','shakir','sharif','taha','waqar','waqas','waseem','yasir','zafar','zahid','zubair','khan','sheikh','syed','iqbal','mirza','ramita','rukhsar',
    // South Asian / Indian
    'preet','singh','raj','kumar','patel','gupta','sharma','ankit','rohit','vikram','suresh','dinesh','rakesh','daniyal','danyal','danya','ayan','aryan','ayaan','rehan','rohan','sohan','mohan','karan','arjun','varun','tarun','nikhil','rahul','sahil','vishal','kapil','sunil','anil','ravi','sanjay','vijay','ajay','manoj','deepak','ashok','vinod','pramod','naresh','ganesh','umesh','mukesh','lokesh','yogesh','jitesh','hitesh','ritesh','manish','danish','tanish','harish','girish','satish','nitish','pritesh','paresh','jayesh','brijesh','alpesh','chirag','nirav','maulik','ketan','chetan','hiren','jignesh','bhavesh','darshan','kishan','ishan','roshan','shan','farhan','burhan','imtiaz','mumtaz','nawaz','shabaz','faraz','niaz','liaqat','shaukat','barkat','rifat','aftab','mehtab','sohail','wajid','junaid','obaid','ubaid','humaid','saif','naif','hanif','sharif','siddiq','farooq','masood','mehmood','dawood','suleman','hafeez','azeez','muneeb','haseeb','munir','zaheer','sameer','tanveer','pervez','parveen','yasmeen','shireen','tasleem','hakeem','rahim','faheem','naeem','kaleem','haleem','akram','ikram','ashraf','musharaf','anwar','sarwar','dilwar','gulzar','sarfraz','shahbaz','riaz','ijaz','fayyaz','noman','othman','affan','irfan','kamran','adeel','aqeel','shakeel','jameel','sumeet','puneet','navneet',
    // Sikh/Punjabi names (comprehensive)
    'gurpreet','harpreet','manpreet','navpreet','kulpreet','sukpreet','balpreet','jaspreet','rajpreet','davpreet','amritpreet',
    'gurdeep','hardeep','mandeep','navdeep','kuldeep','sukhdeep','baldeep','jasdeep','rajdeep','davdeep','amritdeep','sandeep','pradeep','jagdeep','randeep','amardeep',
    'gurjot','harjot','manjot','navjot','kuljot','sukhjot','baljot','jasjot','rajjot','davjot','ravjot','amritjot',  // RAVJOT here!
    'gurjit','harjit','manjit','navjit','kuljit','sukhjit','baljit','jasjit','rajjit','davjit','ravjit','amritjit','surjit','daljit','jagjit','ranjit','paramjit','inderjit',
    'gurmeet','harmeet','manmeet','navmeet','kulmeet','sukhmeet','balmeet','jasmeet','rajmeet','davmeet','ravmeet','amritmeet',
    'gurvir','harvir','manvir','navvir','kulvir','sukhvir','balvir','jasvir','rajvir','davvir','ravvir',
    'gurinder','harinder','maninder','navinder','kulinder','sukhinder','balinder','jasinder','rajinder','davinder','ravinder','jatinder','surinder',
    'gurpal','harpal','manpal','navpal','kulpal','sukhpal','balpal','jaspal','rajpal','davpal','ravpal','kirpal','gopal',
    'gurmit','harmit','manmit','navmit','kulmit','sukhmit','balmit','jasmit','rajmit','davmit','ravmit',
    'amandeep','amanpreet','amanjot','amanvir','simran','simrat','simranjit','simranpreet',
    'tejinder','tejpreet','tejvir','tejpal',
    'avtar','avtarjit','avtarpreet',
    // Turkish names
    'mehmet','ahmet','mustafa','kemal','erdogan','yilmaz','ozturk','kaya','demir','celik','sahin','yildiz','aydin','ozdemir','arslan','dogan','kilic','aslan','cetin','koc','kurt','ozcan','polat','simsek','yildirim','gunes','aktas','korkmaz','kaplan','tekin','bulut','karaca','tas','keskin','bayrak','bozkurt','unal','turan','erdem','cengiz','cenk','berk','kaan','emir','emre','burak','oguz','serkan','volkan','gokhan','ozgur','tugrul','onur','murat','kerem','cem','selim','tolga','baris','arda','omer','yusuf','eren','alp','efe','koray','deniz','umut','hakan','serdar','tuncay','cihan','ilhan','orhan','ferhat','recep','tayyip','suleyman','ismet','nihat','tamer','levent','ercan','ozan','taylan','sinan','evren','erhan','gorkem','furkan','batuhan','emirhan','berkay','kubilay','ilker','doruk','bora','aras','poyraz','utku','tarkan','teoman','sertab','tariq',
    // Common short patterns that indicate non-American
    'jai','tej','jot','dal','parm','jag','ran'
  ];
  
  // Mexican / Hispanic names (separate for optional filtering)
  const hispanicNames = [
    'alejandro','javier','fernando','guillermo','roberto','carlos','miguel','eduardo','antonio','jose','juan','luis','pedro','rafael','ramon','raul','ricardo','sergio','angel','armando','arturo','benito','cesar','diego','emilio','ernesto','esteban','felipe','gerardo','gilberto','gonzalo','gustavo','hector','hugo','ignacio','jaime','jesus','joaquin','jorge','julian','lorenzo','manuel','marcos','mario','martin','mauricio','nestor','octavio','orlando','oscar','pablo','pancho','patricio','paco','reynaldo','rodolfo','rodrigo','rolando','ruben','salvador','santiago','santos','tomas','ulises','valentin','vicente','xavier','guadalupe','hernandez','martinez','lopez','garcia','rodriguez','gonzalez','perez','sanchez','ramirez','torres','flores','rivera','gomez','diaz','reyes','morales','jimenez','ruiz','alvarez','mendoza','castillo','romero','herrera','medina','aguilar','vargas','castro','cruz','ortiz','gutierrez','ramos','chavez','moreno','silva','vasquez','delgado','sandoval','guerrero','contreras','fuentes','soto','rojas','vega','campos','leon','espinoza','munoz','estrada','acosta'
  ];
  
  // Short standalone names that are typically South Asian (exact match only)
  const shortNonAmericanNames = [
    'sid','vik','raj','dev','nav','jas','pav','suk','kul','sat','san','ish','ash','adi','anu','ari','om','av',
    'ravi','sham','ram','shiv','arun','amit','anil','ajay','vijay','sunil','amar','deep','jeet','meet','veer',
    'aman','arjun','varun','tarun','nikhil','rahul','sahil','vishal','kapil','karan','rohan','sohan','mohan',
    'preet','simran','gurleen','harleen','navleen','manleen','jasleen','ramandeep','sukhdeep','lovedeep',
    'prem','krishan','gopal','mohan','sohan','kishan','ishan','roshan','darshan','lakhan','rehan','farhan',
    'shan','ali','omar','amir','zain','zayn','bilal','hamza','usman','imran','kamran','adeel','faisal'
  ];
  
  // Sexual/inappropriate/spam terms to filter out
  const sexualTerms = [
    // Explicit sexual
    'penis','dick','cock','pussy','sex','sexy','horny','naked','nude','porn','xxx','nsfw','onlyfans','fansly',
    'boob','boobs','tits','titties','ass','asses','butt','bbc','bwc','hung','thicc','thot','slut','whore','hoe',
    'milf','dilf','gilf','cuck','fetish','kink','kinky','bdsm','dom','sub','daddy','mommy','master','slave',
    'cum','creampie','blowjob','handjob','footjob','anal','oral','69','threesome','gangbang','orgy',
    'hookup','hook up','fwb','nsa','ddf','420friendly','pnp','chemsex',
    // Suggestive
    'bigguy','bigboy','bigman','badboy','baddie','zaddy','papito','papi','mami','mamacita',
    'hotguy','hotboy','hotman','sexyboy','sexyman','sexyguy','naughty','freaky','freak',
    'hung','wellendowed','longdick','bigdick','monster','beastmode',
    'cuddlebuddy','snuggle','netflix','chill','netflixandchill','dtf','down2f','d2f',
    
    // Sugar daddy/mama
    'sugar','sugarbaby','sugardaddy','sugarmama','sugarmommy','findom','paypig','cashcow',
    'spoil','spoiled','spoilme','treatme','pamper','allowance','arrangement','seeking arrangement',
    'sd','sb','sm','splenda','saltdaddy',
    
    // Drug dealers
    'plug','theplug','yourplug','plugged','pluggin','getter','traphouse','trap','trapstar','trapper',
    'pack','packs','runningpacks','gas','loud','zaza','exotic','exotics','exoticpack',
    'weed','kush','dank','fire','pressure','runtz','cookies','gelato','sherbert',
    'perc','percs','perky','xan','xans','xanax','lean','drank','purp','actavis','wock','wockhardt',
    'molly','mdma','ecstasy','acid','lsd','shrooms','dmt','ket','ketamine','coke','blow','snow','yay','yayo',
    'dealer','deals','serving','serve','serves','fronts','tick','ticks','scores',
    '420','710','dabs','carts','cart','thc','cbd','delta8','delta9','hhc',
    
    // Shops/businesses/selling
    'shop','shopp','shopping','store','outlet','retail','wholesale','reseller','resale',
    'sell','sells','selling','seller','forsale','4sale','buy','buying','buyer',
    'order','orders','ordering','ship','ships','shipping','delivery','deliver','delivers',
    'menu','pricelist','prices','rates','deals','discounts','cheap','cheapest',
    'vendor','supplier','supply','stock','instock','restock','inventory',
    'brand','brands','authentic','legit','verified','trusted','reliable',
    'replica','reps','rep','fake','fakes','knockoff','dupe','dupes','dhgate','aliexpress',
    'sneakers','kicks','shoes','clothing','clothes','designer','gucci','louis','prada','nike','jordan',
    'electronics','phones','iphone','samsung','airpods','console','ps5','xbox',
    'cashout','cashouts','method','methods','sauce','sauces','tutorial','tutorials',
    'cc','cvv','fullz','bins','logs','accounts','accs','gmail','netflix','spotify','hulu',
    
    // Trading/crypto spam  
    'trading','trade','trades','trader','forex','crypto','bitcoin','btc','eth','nft',
    'invest','investor','investing','investment','returns','profit','profits','roi','passive','income',
    'binance','coinbase','robinhood','webull','stocks','stock','options','calls','puts',
    'cashapp','venmo','paypal','zelle','moneygram','westernunion','applepay','googlepay',
    
    // Promo/spam
    'follow4follow','f4f','like4like','l4l','promo','promote','promotion','influencer',
    'dm4','dmme','dmfor','hmu','himu','addme','snapme','textme','linkintree','linkinbio',
    'scam','scammer','bot','fake','catfish','clickbait',
    
    // Gambling
    'bet','bets','betting','gamble','gambling','casino','slots','poker','blackjack','sportsbook',
    'picks','locks','parlay','parlays','handicapper','tipster',
    
    // Other red flags
    'anon','anonymous','secret','discreet','private','hidden','mystery','unknown','incognito',
    'single','lonely','bored','looking','seeking','searching','want','need','desperate',
    'rich','wealthy','money','cash','paid','pay','premium','vip','exclusive','elite'
  ];
  
  // Check for sexual/inappropriate content
  function isSexualOrSpam(name, username) {
    const combined = (name + ' ' + username).toLowerCase().replace(/[^a-z0-9]/g, '');
    const words = (name + ' ' + username).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 0);
    
    // Check each blocked term
    for (const term of sexualTerms) {
      const termClean = term.replace(/[^a-z0-9]/g, '');
      // Check if term appears in combined text (handles no-space names like "bigdick69")
      if (combined.includes(termClean)) {
        console.log('  → Blocked term found:', term);
        return true;
      }
    }
    
    // Check for spam/business patterns
    const spamPatterns = [
      /^(trading|forex|crypto|bitcoin|promo|follow|add|plug|trap|shop|sell)\d*$/i,
      /\d{2,}(plug|shop|trap|dealer|sells|packs)$/i,
      /(plug|shop|trap|dealer|sells|packs)\d{2,}$/i,
      /^(the|your|my|da|tha)?(plug|trap|shop|dealer|connect)$/i,
      /official|verified|legit|trusted|real/i,
      /^(get|got|need|want)(money|cash|rich|paid)$/i,
      /(hmu|dm)(4|for)(deals|prices|menu|info)$/i,
      /free(money|cash|gift|iphone|ps5)/i,
      /sugar(daddy|mommy|mama|baby)/i,
      /findom|paypig|cashslave/i,
    ];
    
    for (const pattern of spamPatterns) {
      if (pattern.test(username) || pattern.test(name)) {
        console.log('  → Spam pattern matched:', pattern);
        return true;
      }
    }
    
    // Check for emojis commonly used by dealers/sellers (💊💉🍃🔌⛽🎰)
    if (/[\u{1F48A}\u{1F489}\u{1F343}\u{1F50C}\u{26FD}\u{1F3B0}\u{1F911}\u{1F4B0}\u{1F4B5}\u{1F4B8}]/u.test(name + username)) {
      console.log('  → Suspicious emoji found');
      return true;
    }
    
    return false;
  }

  // Female names
  const femaleNames = ['sarah','emily','jessica','jennifer','amanda','melissa','michelle','stephanie','nicole','elizabeth','ashley','samantha','lauren','rachel','lisa','kimberly','rebecca','amy','angela','maria','christina','kelly','susan','nancy','karen','betty','helen','sandra','donna','carol','ruth','sharon','laura','sophia','emma','olivia','ava','isabella','mia','charlotte','amelia','harper','evelyn','abigail','ella','mila','avery','camila','aria','scarlett','victoria','madison','luna','grace','chloe','penelope','layla','zoey','nora','hannah','lillian','addison','aubrey','ellie','stella','natalie','leah','hazel','violet','aurora','savannah','audrey','brooklyn','bella','claire','skylar','lucy','anna','caroline','nova','aaliyah','kennedy','allison','maya','willow','naomi','elena','ariana','gabriella','alice','ruby','eva','autumn','hailey','gianna','valentina','isla','ivy','sadie','piper','lydia','alexa','emilia','ariel','mackenzie','brianna','kylie','morgan','julia','kaylee','destiny','bailey','riley','zoe','alexis','jasmine','brooke','kayla','taylor','sydney','andrea','vanessa','brittany','danielle'];

  function isNonAmerican(name, user, checkHispanic = true) {
    const combined = (name + ' ' + user).toLowerCase();
    const textNoSymbols = combined.replace(/[^a-z\s]/g, '');
    const words = textNoSymbols.split(/\s+/).filter(w => w.length > 0);
    
    // Check for non-ASCII characters first (foreign scripts like 핿핾, Arabic, etc.)
    if (/[^\x00-\x7F]/.test(name + user)) {
      console.log('  → Contains non-ASCII characters');
      return { match: true, reason: 'Non-American' };
    }
    
    // Check short names list (exact match for first word / display name)
    const firstName = words[0] || '';
    if (shortNonAmericanNames.includes(firstName)) {
      console.log('  → Short name match:', firstName);
      return { match: true, reason: 'Non-American' };
    }
    
    // Check Hispanic names (only if setting enabled)
    if (checkHispanic) {
      for (const word of words) {
        if (hispanicNames.includes(word)) {
          console.log('  → Hispanic name match:', word);
          return { match: true, reason: 'Hispanic' };
        }
      }
      // Check Hispanic roots
      for (const word of words) {
        for (const root of hispanicRoots) {
          if (word.startsWith(root) && word.length >= root.length + 2) {
            console.log('  → Hispanic root match:', root, 'in', word);
            return { match: true, reason: 'Hispanic' };
          }
        }
      }
    }
    
    // Check each word separately against full names (non-Hispanic)
    for (const word of words) {
      for (const n of middleEasternNames) {
        // Exact match - word equals the name
        if (word === n) {
          console.log('  → Exact name match:', n);
          return { match: true, reason: 'Non-American' };
        }
        // Embedded match - only for longer names (6+ chars) to avoid false positives
        // like "eren" in "conference"
        if (n.length >= 6 && word.includes(n)) {
          console.log('  → Embedded name match:', n, 'in', word);
          return { match: true, reason: 'Non-American' };
        }
        // For 4-5 char names, only match at START of word
        if (n.length >= 4 && n.length < 6 && word.startsWith(n)) {
          console.log('  → Name at word start:', n, 'in', word);
          return { match: true, reason: 'Non-American' };
        }
      }
    }
    
    // Check root patterns - must be at START of a word (not middle)
    for (const word of words) {
      for (const root of nameRoots) {
        // Root must be at the beginning of the word AND word must be longer
        if (word.startsWith(root) && word.length >= root.length + 2) {
          console.log('  → Matched root:', root, 'at start of:', word);
          return { match: true, reason: 'Non-American' };
        }
      }
    }
    
    return { match: false, reason: '' };
  }

  function isFemale(name, user) {
    const first = name.split(/\s+/)[0].toLowerCase();
    if (femaleNames.includes(first)) return true;
    if (/princess|queen|goddess|barbie|girl|miss|mrs|mom|wife|babe|cutie|sweetie|beauty|pretty|diva|angel/i.test(user)) return true;
    return false;
  }

  function hasBrownEmoji(text) {
    return /[\u{1F3FD}\u{1F3FE}\u{1F3FF}]/u.test(text);
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  
  function randDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async function click(el) {
    if (!el) {
      console.log('  ⚠ Click called with null element');
      return false;
    }
    
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(randDelay(100, 300));
      
      // Try native click first
      if (typeof el.click === 'function') {
        el.click();
      } else {
        // For SVG elements, dispatch a click event
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        el.dispatchEvent(event);
      }
      
      await delay(randDelay(100, 200));
      return true;
    } catch (e) {
      console.log('  ⚠ Click error:', e.message);
      return false;
    }
  }

  function createPanel() {
    // Use unique ID to avoid conflicts with CupidBot and other extensions
    const panelId = 'sf-ctrl-panel-x7k9';
    
    if (document.getElementById(panelId)) {
      document.getElementById(panelId).style.display = 'flex';
      return true;
    }
    
    if (!document.body) return false;
    
    panel = document.createElement('div');
    panel.id = panelId;
    panel.setAttribute('data-sf-panel', 'true'); // Custom attribute for identification
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 380px;
      height: 600px;
      max-height: 90vh;
      background: #1a1a1a;
      z-index: 999999;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      border-radius: 12px;
      overflow: hidden;
      resize: both;
    `;
    
    // Draggable header
    const header = document.createElement('div');
    header.id = 'sf-ctrl-header-x7k9';
    header.style.cssText = `
      background: linear-gradient(135deg, #FFFC00 0%, #FFE500 100%);
      color: #000;
      padding: 10px 15px;
      font-weight: bold;
      font-size: 14px;
      cursor: move;
      user-select: none;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    header.innerHTML = '<span>🔥 Snap Filter</span><span style="font-size:11px;opacity:0.7;">drag to move</span>';
    
    // Make panel draggable
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    
    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      panel.style.transform = 'none';
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      panel.style.left = (e.clientX - dragOffsetX) + 'px';
      panel.style.top = (e.clientY - dragOffsetY) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('panel.html');
    iframe.style.cssText = 'width:100%;flex:1;border:none;background:#1a1a1a;';
    
    panel.appendChild(header);
    panel.appendChild(iframe);
    document.body.appendChild(panel);
    console.log('✅ Panel created (centered, draggable)');
    return true;
  }

  function hidePanel() {
    const panelId = 'sf-ctrl-panel-x7k9';
    const existingPanel = document.getElementById(panelId);
    if (existingPanel) existingPanel.style.display = 'none';
    if (panel) panel.style.display = 'none';
  }

  // Find friend request entries - look for Accept buttons with F7jpS class
  function findEntries() {
    const accepts = Array.from(document.querySelectorAll('button.F7jpS')).filter(b => {
      if (!b.offsetParent) return false;
      const txt = b.textContent.trim().toLowerCase();
      return txt.includes('accept');
    });
    
    console.log('Found', accepts.length, 'Accept buttons');
    
    return accepts.map(btn => {
      // Go up to find the row container (usually has the name/username)
      let container = btn;
      for (let i = 0; i < 8 && container.parentElement; i++) {
        container = container.parentElement;
        // Stop at a reasonable container size
        if (container.offsetHeight > 50 && container.offsetHeight < 200) {
          break;
        }
      }
      return { container, acceptBtn: btn };
    });
  }

  // Extract name and username from entry
  function getInfo(container, acceptBtn) {
    // Get all text content but EXCLUDE the accept button text
    let fullText = '';
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      // Skip if this text is inside the accept button
      if (acceptBtn && acceptBtn.contains(node.parentElement)) continue;
      fullText += node.textContent + ' ';
    }
    
    fullText = fullText.trim();
    
    // Split by newlines and common separators
    const parts = fullText.split(/[\n\r]+/).map(s => s.trim()).filter(s => s && s.length > 0);
    
    // First non-empty part that isn't a date/time is usually the name
    let name = '';
    let username = '';
    
    for (const part of parts) {
      // Skip time indicators, action text
      if (/^(\d+[hmd]|just now|yesterday|added you|mutual|accept|ignore)/i.test(part)) continue;
      
      if (!name) {
        name = part;
      } else if (!username && /^[a-z0-9._-]+$/i.test(part)) {
        username = part;
      }
    }
    
    // Clean up - remove "Accept" if it got included
    name = name.replace(/\s*Accept\s*$/i, '').trim();
    
    // If no username found, try to extract from name (format: "Display Nameusername")
    if (!username && name) {
      // Look for lowercase run at end that could be username
      const match = name.match(/^(.+?)([a-z][a-z0-9._]+)$/i);
      if (match && match[2].length > 3) {
        const possibleName = match[1].trim();
        const possibleUser = match[2];
        // Only split if the first part looks like a real name
        if (/^[A-Z]/.test(possibleName)) {
          name = possibleName;
          username = possibleUser;
        }
      }
    }
    
    return { name: name || 'Unknown', username: username || '', fullText };
  }

  // Wait for and click the Ignore button in confirmation dialog
  async function confirmIgnore() {
    for (let attempt = 0; attempt < 15; attempt++) {
      await delay(200);
      
      // Look for Ignore button - class "tXFz7" with text "Ignore"
      const btns = Array.from(document.querySelectorAll('button.tXFz7')).filter(b => b.offsetParent);
      
      for (const btn of btns) {
        const txt = btn.textContent.trim().toLowerCase();
        if (txt === 'ignore') {
          console.log('  ✓ Found Ignore button, clicking...');
          await click(btn);
          return true;
        }
      }
    }
    console.log('  ✗ No Ignore button found after waiting');
    return false;
  }
  
  // Find the X/close button in a friend entry (SVG inside DIV.sGsBQ)
  function findXButton(entry) {
    const acceptBtn = entry.acceptBtn;
    const container = entry.container;
    
    // Based on recording: X button is SVG path inside DIV.sGsBQ
    // The Accept button is ALSO inside DIV.sGsBQ
    // So we find sGsBQ from the Accept button, then find sibling SVG
    
    console.log('  Looking for X button...');
    
    // Method 1: Find sGsBQ from Accept button (most reliable)
    const sGsBQ = acceptBtn.closest('div.sGsBQ');
    if (sGsBQ) {
      console.log('  Found sGsBQ via Accept button');
      
      // Find all SVGs in sGsBQ that are NOT inside the Accept button
      const svgs = Array.from(sGsBQ.querySelectorAll('svg'));
      console.log('  SVGs in sGsBQ:', svgs.length);
      
      for (const svg of svgs) {
        // Skip if inside Accept button
        if (acceptBtn.contains(svg)) {
          console.log('    Skip: inside Accept btn');
          continue;
        }
        
        // Found the X button SVG!
        console.log('  ✓ Found X button SVG');
        
        // The click target is the SVG's parent (or the SVG itself)
        const parent = svg.parentElement;
        if (parent && parent !== sGsBQ) {
          return parent;
        }
        return svg;
      }
    }
    
    // Method 2: Find H8CAi container and look for SVGs
    const h8cai = acceptBtn.closest('div.H8CAi') || container.querySelector('div.H8CAi');
    if (h8cai) {
      console.log('  Checking H8CAi');
      const svgs = Array.from(h8cai.querySelectorAll('svg'));
      for (const svg of svgs) {
        if (!acceptBtn.contains(svg)) {
          console.log('  ✓ Found X via H8CAi');
          return svg.parentElement || svg;
        }
      }
    }
    
    // Method 3: Go up from Accept button and find sibling SVGs
    let parent = acceptBtn.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const svgs = Array.from(parent.querySelectorAll('svg'));
      for (const svg of svgs) {
        if (acceptBtn.contains(svg)) continue;
        
        const rect = svg.getBoundingClientRect();
        // X icons are small (around 9x9 based on recording)
        if (rect.width < 20 && rect.height < 20 && rect.width > 3) {
          console.log('  ✓ Found small X SVG nearby:', rect.width, 'x', rect.height);
          return svg.parentElement || svg;
        }
      }
      parent = parent.parentElement;
    }
    
    // Method 4: Search entire container
    const allSvgs = Array.from(container.querySelectorAll('svg'));
    console.log('  Searching all', allSvgs.length, 'SVGs in container');
    
    for (const svg of allSvgs) {
      if (acceptBtn.contains(svg)) continue;
      
      const rect = svg.getBoundingClientRect();
      if (rect.width < 20 && rect.height < 20 && rect.width > 3) {
        console.log('  ✓ Found X SVG in container');
        return svg.parentElement || svg;
      }
    }
    
    console.log('  ✗ No X button found');
    return null;
  }

  // Process one friend request entry
  async function processEntry(entry) {
    const { name, username, fullText } = getInfo(entry.container, entry.acceptBtn);
    
    const key = (username || name).toLowerCase();
    if (processed.has(key)) {
      return { action: 'skip', reason: 'already processed' };
    }
    processed.add(key);
    
    console.log('Processing:', name, username ? '@' + username : '');
    
    // Check filters
    let shouldIgnore = false;
    let reason = '';
    let needsAICheck = false;
    
    // 1. Check brown emoji first
    if (settings.filterBrownEmoji && hasBrownEmoji(fullText)) {
      shouldIgnore = true;
      reason = 'Brown emoji';
    }
    
    // 2. Check for sexual/spam names
    if (!shouldIgnore && isSexualOrSpam(name, username)) {
      shouldIgnore = true;
      reason = 'Sexual/Spam';
    }
    
    // 3. Check for female
    if (!shouldIgnore && isFemale(name, username)) {
      shouldIgnore = true;
      reason = 'Female';
    }
    
    // 4. Check name origin using rules first
    if (!shouldIgnore && settings.filterNonAmerican) {
      const checkHispanic = settings.filterHispanic !== false; // Default to true if not set
      const nameCheck = isNonAmerican(name, username, checkHispanic);
      if (nameCheck.match) {
        shouldIgnore = true;
        reason = nameCheck.reason;
      } else {
        // Rules didn't match - might need AI check for uncertain names
        needsAICheck = true;
      }
    }
    
    // 5. If rules didn't catch it but AI is enabled, use AI as fallback
    if (!shouldIgnore && needsAICheck && settings.useAI && settings.apiKey) {
      console.log('  Rules unclear, checking with AI...');
      const aiResult = await checkNameWithAI(name, username);
      if (aiResult !== null) {
        if (aiResult.isNonAmerican) {
          shouldIgnore = true;
          reason = 'Non-American (AI)';
        }
        if (aiResult.isSexual) {
          shouldIgnore = true;
          reason = 'Sexual/Spam (AI)';
        }
      }
    }
    
    console.log('  Filter:', shouldIgnore ? 'DECLINE (' + reason + ')' : 'ACCEPT');
    
    if (shouldIgnore) {
      // DECLINE FLOW:
      // 1. Find and click the X button (SVG in DIV.sGsBQ)
      // 2. Wait for and click the "Ignore" confirmation button
      // If anything fails, just skip and move on
      
      try {
        let declined = false;
        
        // Find the X button (pass full entry so we can use acceptBtn)
        const xBtn = findXButton(entry);
        
        if (xBtn) {
          console.log('  Clicking X button to open decline dialog...');
          const clicked = await click(xBtn);
          
          if (clicked) {
            await delay(600);
            // Now click the Ignore confirmation button
            declined = await confirmIgnore();
          }
        }
        
        // If first attempt failed, try hover method
        if (!declined) {
          console.log('  Trying hover method...');
          entry.container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          await delay(400);
          
          const xBtnAfterHover = findXButton(entry);
          if (xBtnAfterHover) {
            const clicked = await click(xBtnAfterHover);
            if (clicked) {
              await delay(600);
              declined = await confirmIgnore();
            }
          }
        }
        
        if (declined) {
          await incrementDeclineCount(name, reason);
          await logUserAction(name, username, 'declined', reason);
          console.log('  ✓ DECLINED:', reason, '-', name, username ? '@' + username : '');
          return { action: 'declined', reason, name };
        } else {
          console.log('  ⚠ Could not decline - skipping');
          if (!declineButtonMissing) {
            declineButtonMissing = true;
            updateStatus('Some declines skipped', 'warning');
          }
          return { action: 'skip', reason: 'decline failed' };
        }
      } catch (e) {
        console.log('  ⚠ Error during decline, skipping:', e.message);
        return { action: 'skip', reason: 'error: ' + e.message };
      }
      
    } else {
      // ACCEPT - check rate limits first
      if (!canAcceptMore()) {
        return { action: 'limit', reason: 'rate limit reached' };
      }
      
      console.log('  Clicking Accept...');
      await click(entry.acceptBtn);
      await incrementAcceptCount(name);
      await logUserAction(name, username, 'accepted', 'Passed all filters');
      console.log('  ✓ ACCEPTED:', name, username ? '@' + username : '');
      return { action: 'accepted', name };
    }
  }

  // Open friend requests panel
  async function openFriendRequests() {
    const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent);
    for (const btn of btns) {
      const title = (btn.getAttribute('title') || '').toLowerCase();
      if (title.includes('friend request')) {
        console.log('Opening friend requests...');
        await click(btn);
        await delay(1500);
        return true;
      }
    }
    return false;
  }
  
  // Click "View X more" button to load more friend requests
  async function clickViewMore() {
    // Based on recording: "View 123 More" is inside DIV.g8CcQ with SPAN.nonIntl
    
    // Method 1: Look for the specific class from recording
    const g8CcQ = document.querySelector('div.g8CcQ');
    if (g8CcQ) {
      const text = g8CcQ.textContent.trim();
      if (/view.*\d+.*more/i.test(text)) {
        console.log('Found "View more" button via g8CcQ:', text);
        await click(g8CcQ);
        await delay(2000);
        return true;
      }
    }
    
    // Method 2: Look for span.nonIntl with "View X More" text
    const spans = Array.from(document.querySelectorAll('span.nonIntl'))
      .filter(el => el.offsetParent);
    
    for (const span of spans) {
      const text = span.textContent.trim();
      if (/view.*\d+.*more/i.test(text)) {
        console.log('Found "View more" span:', text);
        // Click the span or its parent
        const clickTarget = span.closest('[role="button"], button, [tabindex]') || span.parentElement || span;
        await click(clickTarget);
        await delay(2000);
        return true;
      }
    }
    
    // Method 3: Generic search for any element with view/more text
    const allElements = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'))
      .filter(el => el.offsetParent && el.offsetHeight > 0);
    
    for (const el of allElements) {
      const text = (el.textContent || '').trim();
      if (/view.*\d+.*more|show.*more|load.*more/i.test(text) && text.length < 50) {
        console.log('Found "View more" button (generic):', text);
        await click(el);
        await delay(2000);
        return true;
      }
    }
    
    // Method 4: Scroll the ReactVirtualized container
    const virtualList = document.querySelector('.ReactVirtualized__Grid');
    if (virtualList) {
      virtualList.scrollTop = virtualList.scrollHeight;
      await delay(500);
    }
    
    return false;
  }

  // Main run loop
  // ============================================
  // FRIEND ADDING FUNCTIONS (Quick Add)
  // ============================================
  
  // Load friend adding rate limits
  async function loadFriendAddLimits() {
    try {
      const data = await chrome.storage.local.get([
        'friendsAddedToday', 'friendsAddedThisHour', 
        'lastFriendAddHourTimestamp', 'lastFriendAddDayTimestamp'
      ]);
      const now = Date.now();
      const today = new Date().toDateString();
      const currentHour = Math.floor(now / (60 * 60 * 1000));
      
      if (data.lastFriendAddDayTimestamp !== today) {
        friendsAddedToday = 0;
        lastFriendAddDayTimestamp = today;
      } else {
        friendsAddedToday = data.friendsAddedToday || 0;
        lastFriendAddDayTimestamp = data.lastFriendAddDayTimestamp || today;
      }
      
      if (data.lastFriendAddHourTimestamp !== currentHour) {
        friendsAddedThisHour = 0;
        lastFriendAddHourTimestamp = currentHour;
      } else {
        friendsAddedThisHour = data.friendsAddedThisHour || 0;
        lastFriendAddHourTimestamp = data.lastFriendAddHourTimestamp || currentHour;
      }
      
      await chrome.storage.local.set({
        friendsAddedToday: friendsAddedToday,
        friendsAddedThisHour: friendsAddedThisHour,
        lastFriendAddHourTimestamp: lastFriendAddHourTimestamp,
        lastFriendAddDayTimestamp: lastFriendAddDayTimestamp
      });
    } catch (e) {
      console.log('Error loading friend add limits:', e);
    }
  }
  
  // Check if we can add more friends (hourly and daily limits)
  function canAddMoreFriends() {
    if (!settings) return false;
    const maxPerHour = settings.maxFriendsPerHour || 15;
    const maxPerDay = settings.maxFriendsPerDay || 50;
    
    if (friendsAddedThisHour >= maxPerHour) {
      log('Friend add hourly limit reached: ' + friendsAddedThisHour + '/' + maxPerHour);
      return false;
    }
    
    if (friendsAddedToday >= maxPerDay) {
      log('Friend add daily limit reached: ' + friendsAddedToday + '/' + maxPerDay);
      return false;
    }
    
    return true;
  }
  
  // Increment friend add counters
  async function incrementFriendAddCount() {
    friendsAddedCount++;
    friendsAddedThisHour++;
    friendsAddedToday++;
    
    const now = Date.now();
    const today = new Date().toDateString();
    const currentHour = Math.floor(now / (60 * 60 * 1000));
    
    await chrome.storage.local.set({
      friendsAddedThisHour: friendsAddedThisHour,
      friendsAddedToday: friendsAddedToday,
      lastFriendAddHourTimestamp: currentHour,
      lastFriendAddDayTimestamp: today
    });
    
    log('Friends added - This hour: ' + friendsAddedThisHour + ', Today: ' + friendsAddedToday);
  }
  
  // Find "Add" buttons in Quick Add section
  function findAddButtons() {
    const addButtons = [];
    
    // Look for buttons with "Add" text or aria-label
    const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(btn => btn.offsetParent !== null); // Only visible buttons
    
    for (const btn of allButtons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      
      // Check if it's an Add button (not Accept, not X/Close, not Send, etc.)
      if ((text === 'add' || ariaLabel.includes('add') || title.includes('add')) &&
          !text.includes('accept') && 
          !text.includes('decline') &&
          !text.includes('ignore') &&
          !text.includes('send') &&
          !text.includes('close') &&
          !ariaLabel.includes('accept') &&
          !ariaLabel.includes('decline')) {
        
        // Make sure it's in a friend entry (has name/username nearby)
        const container = btn.closest('div[class*="entry"], div[class*="item"], div[class*="card"]') || 
                         btn.parentElement?.parentElement;
        if (container) {
          addButtons.push({ button: btn, container: container });
        }
      }
    }
    
    return addButtons;
  }
  
  // Add a friend (click Add button)
  async function addFriend(addEntry) {
    try {
      if (!canAddMoreFriends()) {
        return { success: false, reason: 'limit' };
      }
      
      log('Clicking Add button...');
      const clicked = await click(addEntry.button);
      if (clicked) {
        await incrementFriendAddCount();
        return { success: true };
      }
      return { success: false, reason: 'click failed' };
    } catch (e) {
      log('Error adding friend: ' + e);
      return { success: false, reason: 'error: ' + e };
    }
  }
  
  // Friend adding loop with all limits
  async function runFriendAdding() {
    if (!isRunning || !settings.autoAddFriends) return;
    
    await loadFriendAddLimits();
    friendsAddedCount = 0; // Reset pause counter
    
    log('Starting friend adding mode...');
    updateStatus('Adding friends from Quick Add...', 'running');
    
    let added = 0;
    let skipped = 0;
    
    while (isRunning) {
      // Check hourly/daily limits
      if (!canAddMoreFriends()) {
        log('Friend add limits reached - stopping');
        break;
      }
      
      // Find Add buttons
      const addButtons = findAddButtons();
      if (addButtons.length === 0) {
        log('No Add buttons found, waiting...');
        await delay(3000);
        continue;
      }
      
      log('Found ' + addButtons.length + ' Add buttons');
      
      // Process Add buttons
      for (const addEntry of addButtons) {
        if (!isRunning || !canAddMoreFriends()) break;
        
        const result = await addFriend(addEntry);
        if (result.success) {
          added++;
          
          // Check if we need to pause AFTER X adds
          if (settings.pauseAfterAdds && 
              friendsAddedCount > 0 && 
              friendsAddedCount % settings.pauseAfterAddsCount === 0) {
            const pauseMins = settings.pauseAfterAddsDuration || 10;
            log('Pausing for ' + pauseMins + ' minutes after ' + friendsAddedCount + ' adds');
            updateStatus('Pausing for ' + pauseMins + ' mins (added ' + friendsAddedCount + ' friends)', 'running');
            await delay(pauseMins * 60 * 1000);
            if (!isRunning) break;
          }
          
          // Random delay between adds
          const delaySec = randDelay(
            (settings.friendAddMinDelay || 30) * 1000,
            (settings.friendAddMaxDelay || 120) * 1000
          );
          log('Waiting ' + (delaySec / 1000) + ' seconds before next add...');
          await delay(delaySec);
        } else if (result.reason === 'limit') {
          break; // Break out of loop if limit reached
        } else {
          skipped++;
        }
        
        await delay(randDelay(500, 1000));
      }
      
      // Scroll to find more
      window.scrollBy(0, 400);
      await delay(2000);
    }
    
    log('Friend adding stopped. Added: ' + added + ', Skipped: ' + skipped);
    updateStatus('Friend adding stopped - Added: ' + added, 'stopped');
  }
  
  async function run() {
    console.log('[SF] run() called, isRunning:', isRunning);
    if (!isRunning) {
      console.log('[SF] Not running, returning early');
      return;
    }
    
    console.log('[SF] Starting run function...');
    
    // Check if we were waiting for hourly reset (browser was closed)
    const stillWaiting = await checkPendingHourlyReset();
    if (stillWaiting) {
      // Continue waiting from where we left off
      await waitForHourlyReset();
      if (!isRunning) return;
    }
    
    const lastSessionEnd = await loadRateLimits();
    await saveLastActivity('Started filtering');
    
    // Load previous session stats (don't reset!)
    try {
      const prevData = await chrome.storage.local.get(['acceptedThisSession', 'declinedThisSession', 'lastRunStats']);
      acceptedThisSession = prevData.acceptedThisSession || 0;
      declinedThisSession = prevData.declinedThisSession || 0;
      
      // Log last session info
      if (prevData.lastRunStats) {
        console.log('=== LAST SESSION ===');
        console.log('Date:', prevData.lastRunStats.date);
        console.log('Accepted:', prevData.lastRunStats.accepted);
        console.log('Declined:', prevData.lastRunStats.declined);
        console.log('Skipped:', prevData.lastRunStats.skipped);
        console.log('====================');
      }
      
      console.log('Continuing from - Session:', acceptedThisSession, 'Hour:', acceptedThisHour, 'Today:', acceptedToday);
    } catch (e) {}
    
    // Session break - only if sessionBreakMins is set to a value > 0
    // If set to 0, no break is required (handle both string "0" and number 0)
    const sessionBreakMins = parseInt(settings.sessionBreakMins) || 0;
    console.log('[SF] Session break setting:', sessionBreakMins, '(0 = disabled)');
    
    if (sessionBreakMins > 0 && lastSessionEnd > 0) {
      const minsSinceLastSession = (Date.now() - lastSessionEnd) / (60 * 1000);
      if (minsSinceLastSession < sessionBreakMins) {
        const waitMins = Math.ceil(sessionBreakMins - minsSinceLastSession);
        console.log('⚠ Session break required. Wait', waitMins, 'more minutes.');
        updateStatus('Session break - wait ' + waitMins + ' mins');
        isRunning = false;
        return;
      }
    } else {
      // Session break disabled (0 or not set) - continue immediately
      console.log('Session break disabled (set to 0) - continuing immediately');
    }
    
    // Don't reset counters - continue from previous!
    declineButtonMissing = false;
    // Don't clear processed - allow re-runs to skip already processed
    // processed.clear();
    
    // Check which mode we're in
    console.log('[SF] Mode check - friendsAddEnabled:', settings.friendsAddEnabled, 'autoAddFriends:', settings.autoAddFriends, 'chatEnabled:', settings.chatEnabled);
    
    // If "Auto-add friends from Quick Add" is enabled, start friend adding mode
    // This is the main trigger - if autoAddFriends is on, it will start when you hit start
    if (settings.autoAddFriends) {
      // Friend adding mode - autoAddFriends enabled means start friend adding
      console.log('[SF] Starting friend adding mode (autoAddFriends enabled)...');
      updateStatus('Starting friend adding...', 'running');
      await runFriendAdding();
      isRunning = false;
      return;
    }
    
    // Friend request filtering mode (existing code) - runs when autoAddFriends is disabled
    console.log('[SF] Starting friend request filtering mode (autoAddFriends disabled)...');
    let entries = findEntries();
    if (entries.length === 0) {
      await openFriendRequests();
      await delay(2000);
    }
    
    let scrolls = 0;
    let declined = 0;
    let accepted = 0;
    let skipped = 0;
    let noNewEntriesCount = 0; // Track consecutive times with no new entries
    
    while (isRunning && scrolls < settings.maxScrolls) {
      // Check limits - handle each type differently
      const limitStatus = checkLimits();
      
      if (limitStatus === 'daily') {
        console.log('🛑 Daily limit reached, stopping completely.');
        updateStatus('Daily limit reached! Done for today.', 'warning');
        break;
      }
      
      if (limitStatus === 'hourly') {
        await waitForHourlyReset();
        if (!isRunning) break;
        continue; // Re-check limits after reset
      }
      
      entries = findEntries();
      
      // Filter to only unprocessed entries
      const unprocessedEntries = entries.filter(entry => {
        const { name, username } = getInfo(entry.container, entry.acceptBtn);
        const key = (username || name).toLowerCase();
        return !processed.has(key);
      });
      
      console.log('Found', entries.length, 'entries,', unprocessedEntries.length, 'unprocessed');
      
      if (unprocessedEntries.length === 0) {
        noNewEntriesCount++;
        console.log('No unprocessed entries (attempt', noNewEntriesCount, ')');
        
        // After processing all visible, try View More
        const foundMore = await clickViewMore();
        if (foundMore) {
          console.log('Clicked View More, waiting for new entries...');
          await delay(2000);
          noNewEntriesCount = 0; // Reset counter
          continue;
        }
        
        // Scroll down to find more
        window.scrollBy(0, 400);
        await delay(settings.scrollDelay);
        scrolls++;
        
        // If we've tried 3 times with no new entries, stop
        if (noNewEntriesCount >= 3) {
          console.log('No new entries after multiple attempts, stopping.');
          break;
        }
        continue;
      }
      
      noNewEntriesCount = 0; // Reset since we have entries to process
      
      // Process each unprocessed entry ONCE
      for (const entry of unprocessedEntries) {
        if (!isRunning) break;
        
        // Check limits before each accept (declines don't count toward limits)
        const limitStatus = checkLimits();
        if (limitStatus !== 'ok') {
          // Break inner loop to handle limit in outer loop
          break;
        }
        
        const result = await processEntry(entry);
        
        if (result.action === 'declined') {
          declined++;
          await delay(randDelay(500, 1000));
        } else if (result.action === 'accepted') {
          accepted++;
          const acceptDelay = randDelay(settings.minDelay, settings.maxDelay);
          console.log('  Waiting', acceptDelay, 'ms...');
          await delay(acceptDelay);
        } else if (result.action === 'skip') {
          skipped++;
          console.log('  Skipped, moving on...');
        } else if (result.action === 'limit') {
          // Break inner loop to handle in outer loop
          break;
        }
        
        await delay(randDelay(200, 400));
      }
      
      // After processing current batch, try to load more
      await clickViewMore();
      await delay(1000);
    }
    
    await saveSessionEnd();
    
    // Clear wait states
    await chrome.storage.local.set({ 
      waitingForHourly: false,
      hourlyResetTime: 0
    });
    
    // Save session log and last run stats
    try {
      const logsData = await chrome.storage.local.get('sessionLogs');
      const logs = logsData.sessionLogs || [];
      
      const runStats = {
        date: new Date().toISOString(),
        accepted: accepted,
        declined: declined,
        skipped: skipped,
        sessionAccepted: acceptedThisSession,
        hourlyTotal: acceptedThisHour,
        dailyTotal: acceptedToday
      };
      
      logs.push(runStats);
      // Keep only last 100 sessions
      if (logs.length > 100) logs.shift();
      
      // Save both logs and last run stats for quick access
      await chrome.storage.local.set({ 
        sessionLogs: logs,
        lastRunStats: runStats,
        acceptedThisSession: acceptedThisSession,
        declinedThisSession: declinedThisSession
      });
    } catch (e) {
      console.log('Failed to save session log:', e);
    }
    
    // Determine why we stopped
    const finalLimit = checkLimits();
    let msg;
    if (finalLimit === 'daily') {
      msg = '🛑 Daily limit reached! (' + acceptedToday + '/' + settings.maxDaily + ') - Done for today.';
      await saveLastActivity('Daily limit reached - stopped');
    } else {
      msg = 'Done! Accepted: ' + accepted + ', Declined: ' + declined + ', Skipped: ' + skipped;
      await saveLastActivity('Stopped - A:' + accepted + ' D:' + declined);
    }
    console.log(msg);
    console.log('Limits - Session:', acceptedThisSession, 'Hour:', acceptedThisHour, 'Today:', acceptedToday);
    
    isRunning = false;
    updateStatus(msg, finalLimit === 'daily' ? 'warning' : 'stopped');
  }

  function updateStatus(msg, type = 'stopped') {
    chrome.runtime.sendMessage({
      action: 'statusUpdate',
      status: type,
      message: msg
    }).catch(() => {});
  }

  // Message handler
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    console.log('Message:', msg.action);
    
    if (msg.action === 'ping') {
      respond({ success: true, loaded: true });
      return true;
    }
    
    if (msg.action === 'start') {
      if (isRunning) {
        respond({ success: false, error: 'Already running' });
        return true;
      }
      settings = msg.settings;
      if (!settings) {
        console.error('[SF] No settings provided!');
        respond({ success: false, error: 'No settings provided' });
        return true;
      }
      console.log('[SF] Starting with settings:', Object.keys(settings));
      isRunning = true;
      processed.clear();
      run().catch(err => {
        console.error('[SF] Error in run():', err);
        isRunning = false;
        updateStatus('Error: ' + err.message, 'error');
      });
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'stop') {
      isRunning = false;
      saveSessionEnd();
      // Clear any wait states
      chrome.storage.local.set({ 
        waitingForHourly: false,
        hourlyResetTime: 0
      });
      saveLastActivity('Manually stopped');
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'getStatus') {
      loadRateLimits().then(() => {
        respond({ 
          running: isRunning,
          session: acceptedThisSession,
          hour: acceptedThisHour,
          today: acceptedToday
        });
      });
      return true;
    }
    
    if (msg.action === 'openPanel') {
      respond({ success: createPanel() });
      return true;
    }
    
    if (msg.action === 'closePanel') {
      hidePanel();
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'resetLimits') {
      acceptedThisSession = 0;
      acceptedThisHour = 0;
      acceptedToday = 0;
      chrome.storage.local.set({ acceptedToday: 0, acceptedThisHour: 0, lastSessionEnd: 0 });
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'debug') {
      const entries = findEntries();
      console.log('=== DEBUG ===');
      console.log('Entries found:', entries.length);
      entries.forEach((e, i) => {
        const info = getInfo(e.container, e.acceptBtn);
        const nameCheck = isNonAmerican(info.name, info.username);
        const shouldDecline = isFemale(info.name, info.username) || nameCheck.match;
        console.log(i + 1 + '.', info.name, info.username ? '@' + info.username : '', shouldDecline ? '→ DECLINE' : '→ ACCEPT');
      });
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'startRecording') {
      startRecording();
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'stopRecording') {
      const result = stopRecording();
      respond({ success: true, log: result.log, count: result.count });
      return true;
    }
    
    if (msg.action === 'getUserLog') {
      getUserLog().then(log => {
        respond({ success: true, log: log });
      });
      return true;
    }
    
    if (msg.action === 'clearUserLog') {
      chrome.storage.local.set({ userLog: [] });
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'findAllButtons') {
      const entries = findEntries();
      
      let log = '=== SNAPCHAT BUTTON LOG ===\n\n';
      log += 'Time: ' + new Date().toLocaleString() + '\n';
      log += 'URL: ' + location.href + '\n';
      log += 'Friend entries: ' + entries.length + '\n\n';
      
      log += '=== FRIEND ENTRIES ===\n\n';
      entries.forEach((e, i) => {
        const info = getInfo(e.container, e.acceptBtn);
        const isFem = isFemale(info.name, info.username);
        const nameCheck = isNonAmerican(info.name, info.username);
        const brown = hasBrownEmoji(info.fullText);
        
        log += '--- Entry ' + (i + 1) + ' ---\n';
        log += 'Name: ' + info.name + '\n';
        log += 'Username: ' + (info.username || '(none)') + '\n';
        log += 'Decision: ' + ((isFem || nameCheck.match || brown) ? 
          'DECLINE (' + (isFem ? 'female ' : '') + (nameCheck.match ? nameCheck.reason + ' ' : '') + (brown ? 'brown-emoji' : '') + ')' : 
          'ACCEPT (American male)') + '\n';
        
        // List all clickable elements in this entry
        const clickables = Array.from(e.container.querySelectorAll('button, [role="button"], [tabindex]'))
          .filter(el => el.offsetParent);
        log += 'Clickable elements: ' + clickables.length + '\n';
        clickables.forEach((c, j) => {
          const txt = (c.textContent || '').trim().substring(0, 25);
          const isAccept = c === e.acceptBtn;
          log += '  ' + (j + 1) + '. ' + (isAccept ? '[ACCEPT] ' : '') + '"' + txt + '" ' + c.tagName + '\n';
        });
        log += '\n';
      });
      
      // Also list all visible buttons on page
      const allBtns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent);
      log += '=== ALL PAGE BUTTONS (' + allBtns.length + ') ===\n\n';
      allBtns.forEach((b, i) => {
        const txt = (b.textContent || '').trim().substring(0, 30);
        const title = b.getAttribute('title') || '';
        const cls = (b.className || '').substring(0, 40);
        log += (i + 1) + '. "' + txt + '"' + (title ? ' title="' + title + '"' : '') + ' class="' + cls + '"\n';
      });
      
      log += '\n=== END ===';
      
      console.log(log);
      respond({ success: true, log: log });
      return true;
    }
    
    respond({ success: false });
    return true;
  });

  // Auto-open panel
  if (location.href.includes('snapchat.com')) {
    const tryOpen = () => {
      if (document.body) {
        setTimeout(createPanel, 2000);
      } else {
        setTimeout(tryOpen, 200);
      }
    };
    if (document.readyState === 'complete') {
      tryOpen();
    } else {
      window.addEventListener('load', tryOpen);
    }
  }

  console.log('✅ Ready');
})();
