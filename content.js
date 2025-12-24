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
  
  // Initialize database
  if (typeof initDatabase === 'function') {
    initDatabase().catch(e => console.error('[SF] Database init error:', e));
  }
  
  // Use non-obvious console prefix to avoid detection
  const log = (msg) => console.log('%c[SF]', 'color: #FFFC00; font-weight: bold', msg);

  // State
  let isRunning = false;
  let settings = null;
  let processed = new Set();
  let panel = null;
  let declineButtonMissing = false; // Track if we've warned about missing decline button
  
  // Persistent state management
  async function saveRunningState() {
    try {
      await chrome.storage.local.set({ 
        sf_running: isRunning,
        sf_settings: settings,
        sf_timestamp: Date.now()
      });
    } catch (e) {
      console.error('[SF] Error saving running state:', e);
    }
  }
  
  async function loadRunningState() {
    try {
      const data = await chrome.storage.local.get(['sf_running', 'sf_settings', 'sf_timestamp']);
      // Only auto-resume if it was running within the last 5 minutes
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      if (data.sf_running && data.sf_timestamp && data.sf_timestamp > fiveMinutesAgo && data.sf_settings) {
        log('Auto-resuming from previous session...');
        settings = data.sf_settings;
        isRunning = true;
        return true;
      }
      return false;
    } catch (e) {
      console.error('[SF] Error loading running state:', e);
      return false;
    }
  }
  
  async function clearRunningState() {
    try {
      await chrome.storage.local.remove(['sf_running', 'sf_timestamp']);
    } catch (e) {
      console.error('[SF] Error clearing running state:', e);
    }
  }
  
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

  async function incrementAcceptCount(name, username = '') {
    acceptedThisSession++;
    acceptedThisHour++;
    acceptedToday++;
    await saveRateLimits();
    await saveSessionStats();
    await saveLastActivity('Accepted: ' + (name || 'user').substring(0, 20));
    console.log('  Accepts - Session:', acceptedThisSession, 'Hour:', acceptedThisHour, 'Today:', acceptedToday);
    
    // Log to database
    if (typeof window.logFriendRequest === 'function') {
      await window.logFriendRequest(username, name, 'accepted', 'Passed all filters').catch(e => console.error('[SF] DB log error:', e));
    }
  }
  
  async function incrementDeclineCount(name, reason, username = '') {
    declinedThisSession++;
    await saveSessionStats();
    await saveLastActivity('Declined: ' + (name || 'user').substring(0, 15) + ' (' + (reason || '') + ')');
    console.log('  Declined this session:', declinedThisSession);
    
            // Log to database
            if (typeof window.logFriendRequest === 'function') {
              await window.logFriendRequest(username, name, 'declined', reason || '').catch(e => console.error('[SF] DB log error:', e));
            }
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
  
  // Generate AI chat response using Anthropic API
  async function generateAIChatResponse(lastMessage, conversationMessages, settings) {
    try {
      if (!settings.apiKey) {
        log('No API key for AI chat');
        return 'hey';
      }
      
      // Build conversation history for Claude
      const messages = [];
      
      // Add conversation history (recent messages)
      if (conversationMessages && conversationMessages.length > 0) {
        // Take last 10 messages to keep context manageable
        const recentMessages = conversationMessages.slice(0, 10).reverse();
        for (const msg of recentMessages) {
          messages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          });
        }
      } else {
        // No history, start fresh
        messages.push({
          role: 'user',
          content: lastMessage || 'hey'
        });
      }
      
      // Build system prompt from settings
      const systemPrompt = buildAISystemPrompt(settings);
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          system: systemPrompt,
          messages: messages
        })
      });
      
      if (!response.ok) {
        log('AI API error: ' + response.status);
        return 'hey';
      }
      
      const data = await response.json();
      const text = data.content[0].text.trim();
      return text || 'hey';
      
    } catch (e) {
      log('Error generating AI chat response: ' + e);
      return 'hey';
    }
  }
  
  // Build AI system prompt from settings
  function buildAISystemPrompt(settings) {
    const name = settings.personaName || 'Me';
    const age = settings.personaAge || 22;
    const style = settings.personaStyle || settings.chattingStyle || 'flirty';
    const flirtLevel = settings.flirtLevel || 7;
    const bio = settings.personaBio || '';
    const interests = settings.hobbies || '';
    
    let prompt = `You are a real person named ${name}, age ${age}. You are NOT an AI.

CRITICAL RULES:
1. NEVER say you're an AI, bot, or assistant
2. Act like a real person texting - casual, natural, with occasional typos
3. Use lowercase mostly like real texting
4. Read the ENTIRE conversation history before responding
5. Make sure your response makes sense in context - don't act weird or out of context
6. Don't repeat yourself or act like you don't remember what was just said
7. Respond directly to what they're saying right now

Style: ${style}, Flirt level: ${flirtLevel}/10`;

    if (bio) prompt += `\nAbout you: ${bio}`;
    if (interests) prompt += `\nYour interests: ${interests}`;
    
    prompt += `\n\nBe natural, engaging, and human-like. Read the conversation history and respond contextually.`;
    
    return prompt;
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
      
      // Return photo data for logging
      return {
        success: true,
        photoId: photo.id,
        category: category,
        caption: photo.description || ''
      };
      
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
    'tauf', 'tawf', 'touf',  // taufiq/tawfiq variants
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
    'ahmed','mohammed','muhammad','mohamed','mohammad','mohamad','muhamed','ali','hassan','hussain','hussein','omar','yusuf','yousef','ibrahim','abdullah','abdul','khalid','saad','tariq','zain','zayn','hamza','bilal','mustafa','osman','usman','ismail','salman','karim','jamal','rashid','faisal','nasser','mahmoud','majid','noor','reza','saeed','samir','waleed','yazan','zaid','adnan','amir','farid','hadi','hani','jamil','kareem','malik','nasir','qasim','sadiq','shahid','tahir','zahir','zaki','amin','arif','aziz','bashir','emad','fahad','ghazi','habib','imran','javed','jawad','khalil','latif','nabeel','nadeem','naveed','nazir','rafiq','rizwan','sabir','sajid','saleem','samad','shafiq','shahzad','shakir','sharif','taha','waqar','waqas','waseem','yasir','zafar','zahid','zubair','khan','sheikh','syed','iqbal','mirza','ramita','rukhsar','taufeeque','taufiq','tawfiq','toufiq','taufique','ashu',
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
    'shan','ali','omar','amir','zain','zayn','bilal','hamza','usman','imran','kamran','adeel','faisal',
    'ashu','ash','taufeeque','taufiq','tawfiq'
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
    
    // Only check the FIRST NAME (first word) - if first name is American, accept regardless of last name
    const firstName = words[0] || '';
    
    if (!firstName) {
      return { match: false, reason: '' };
    }
    
    // Check for non-ASCII characters in first name only
    const firstNameOnly = name.split(/\s+/)[0] || '';
    if (/[^\x00-\x7F]/.test(firstNameOnly + user)) {
      console.log('  → First name contains non-ASCII characters');
      return { match: true, reason: 'Non-American' };
    }
    
    // Check short names list (exact match for first name only)
    if (shortNonAmericanNames.includes(firstName)) {
      console.log('  → First name short name match:', firstName);
      return { match: true, reason: 'Non-American' };
    }
    
    // Check Hispanic names (only first name, only if setting enabled)
    if (checkHispanic) {
      if (hispanicNames.includes(firstName)) {
        console.log('  → First name Hispanic match:', firstName);
        return { match: true, reason: 'Hispanic' };
      }
      // Check Hispanic roots in first name only
      for (const root of hispanicRoots) {
        if (firstName.startsWith(root) && firstName.length >= root.length + 2) {
          console.log('  → First name Hispanic root match:', root, 'in', firstName);
          return { match: true, reason: 'Hispanic' };
        }
      }
    }
    
    // Check first name against full names (non-Hispanic)
    for (const n of middleEasternNames) {
      // Exact match - first name equals the name
      if (firstName === n) {
        console.log('  → First name exact match:', n);
        return { match: true, reason: 'Non-American' };
      }
      // Embedded match - only for longer names (6+ chars) to avoid false positives
      // like "eren" in "conference"
      if (n.length >= 6 && firstName.includes(n)) {
        console.log('  → First name embedded match:', n, 'in', firstName);
        return { match: true, reason: 'Non-American' };
      }
      // For 4-5 char names, only match at START of word
      if (n.length >= 4 && n.length < 6 && firstName.startsWith(n)) {
        console.log('  → First name at word start:', n, 'in', firstName);
        return { match: true, reason: 'Non-American' };
      }
    }
    
    // Check root patterns in first name only - must be at START of the word
    for (const root of nameRoots) {
      // Root must be at the beginning of the first name AND word must be longer
      if (firstName.startsWith(root) && firstName.length >= root.length + 2) {
        console.log('  → First name matched root:', root, 'at start of:', firstName);
        return { match: true, reason: 'Non-American' };
      }
    }
    
    // First name passed all checks - accept regardless of last name
    console.log('  → First name is American, accepting (ignoring last name)');
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
    
    // Add error handling for iframe load
    iframe.onerror = (e) => {
      console.error('[SF] Panel iframe error:', e);
    };
    
    iframe.onload = () => {
      console.log('[SF] Panel iframe loaded successfully');
    };
    
    panel.appendChild(header);
    panel.appendChild(iframe);
    
    try {
      document.body.appendChild(panel);
      console.log('✅ Panel created (centered, draggable)');
      return true;
    } catch (e) {
      console.error('[SF] Error creating panel:', e);
      return false;
    }
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
          await incrementDeclineCount(name, reason, username || '');
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
  
  // Get current PST time
  function getPSTTime() {
    const now = new Date();
    // Convert to PST (UTC-8) or PDT (UTC-7) - using simple UTC-8 for now
    // For proper DST handling, you'd need a library, but this works for most cases
    const pstOffset = -8 * 60; // PST is UTC-8 in minutes
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const pstTime = new Date(utcTime + (pstOffset * 60000));
    return pstTime;
  }
  
  // Load friend adding rate limits (using PST time)
  async function loadFriendAddLimits() {
    try {
      const data = await chrome.storage.local.get([
        'friendsAddedToday', 'friendsAddedThisHour', 
        'lastFriendAddHourTimestamp', 'lastFriendAddDayTimestamp'
      ]);
      
      // Use PST time for all checks
      const pstNow = getPSTTime();
      const pstToday = pstNow.toDateString();
      const pstHour = Math.floor(pstNow.getTime() / (60 * 60 * 1000));
      
      // Check if new day (PST midnight - 00:00 PST)
      if (!data.lastFriendAddDayTimestamp || data.lastFriendAddDayTimestamp !== pstToday) {
        // New day - reset daily counter
        friendsAddedToday = 0;
        lastFriendAddDayTimestamp = pstToday;
        log('Daily friend add counter reset (new day in PST - 00:00)');
      } else {
        friendsAddedToday = data.friendsAddedToday || 0;
        lastFriendAddDayTimestamp = data.lastFriendAddDayTimestamp || pstToday;
      }
      
      // Reset hourly counter if hour has changed (PST)
      if (data.lastFriendAddHourTimestamp !== undefined && data.lastFriendAddHourTimestamp !== pstHour) {
        friendsAddedThisHour = 0;
        lastFriendAddHourTimestamp = pstHour;
        // Save reset immediately
        await chrome.storage.local.set({
          friendsAddedThisHour: 0,
          lastFriendAddHourTimestamp: pstHour
        });
        log('Hourly friend add counter reset (new hour in PST)');
      } else {
        friendsAddedThisHour = data.friendsAddedThisHour || 0;
        lastFriendAddHourTimestamp = data.lastFriendAddHourTimestamp || pstHour;
      }
      
      await chrome.storage.local.set({
        friendsAddedToday: friendsAddedToday,
        friendsAddedThisHour: friendsAddedThisHour,
        lastFriendAddHourTimestamp: lastFriendAddHourTimestamp,
        lastFriendAddDayTimestamp: lastFriendAddDayTimestamp
      });
      
      log('Friend add limits loaded (PST) - Today: ' + friendsAddedToday + ', This hour: ' + friendsAddedThisHour);
    } catch (e) {
      log('Error loading friend add limits: ' + e);
    }
  }
  
  // Check if current PST time is past stop time
  function isPastStopTime() {
    if (!settings || !settings.enableSchedule || !settings.scheduleStopTime) {
      return false; // No stop time set
    }
    
    const pstNow = getPSTTime();
    const stopTime = parseTime(settings.scheduleStopTime);
    const currentTime = pstNow.getHours() * 60 + pstNow.getMinutes();
    
    // Check if we've passed the stop time today
    return currentTime >= stopTime;
  }
  
  // Wait until next day (past midnight PST)
  async function waitUntilNextDay() {
    const pstNow = getPSTTime();
    const tomorrow = new Date(pstNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // Start of next day
    
    const waitMs = tomorrow.getTime() - pstNow.getTime();
    const waitMins = Math.ceil(waitMs / 60000);
    const waitHours = Math.floor(waitMins / 60);
    const remainingMins = waitMins % 60;
    
    log('⏰ Stop time reached. Waiting until tomorrow (PST)...');
    updateStatus('Stop time reached - wait ' + waitHours + 'h ' + remainingMins + 'm', 'running');
    
    // Save stop state
    await chrome.storage.local.set({
      stoppedAtStopTime: true,
      stopTimeReachedAt: Date.now()
    });
    
    // Wait in chunks
    let remaining = waitMs;
    const chunkSize = 60000; // 1 minute chunks
    while (remaining > 0 && isRunning) {
      const chunk = Math.min(chunkSize, remaining);
      await delay(chunk);
      remaining -= chunk;
      
      // Check state periodically
      const state = await chrome.storage.local.get(['sf_running']);
      if (!state.sf_running) {
        isRunning = false;
        break;
      }
      
      // Update status every minute
      if (remaining > 0) {
        const remainingMins = Math.ceil(remaining / 60000);
        const remainingHours = Math.floor(remainingMins / 60);
        const remainingMinsOnly = remainingMins % 60;
        updateStatus('Stop time reached - wait ' + remainingHours + 'h ' + remainingMinsOnly + 'm', 'running');
        await saveRunningState();
      }
    }
    
    if (!isRunning) return;
    
    // Clear stop state
    await chrome.storage.local.set({
      stoppedAtStopTime: false,
      stopTimeReachedAt: 0
    });
    
    log('✅ New day started (PST) - resuming...');
    updateStatus('New day - resuming...', 'running');
  }
  
  // Check if we should be stopped due to stop time (when app reopens)
  async function checkStopTimeOnResume() {
    try {
      const data = await chrome.storage.local.get(['stoppedAtStopTime', 'stopTimeReachedAt']);
      
      if (data.stoppedAtStopTime && data.stopTimeReachedAt) {
        // Check if it's past the stop time now
        if (isPastStopTime()) {
          // Still past stop time - check if it's a new day
          const pstNow = getPSTTime();
          const stopDate = new Date(data.stopTimeReachedAt);
          const pstStopDate = getPSTTime();
          pstStopDate.setTime(stopDate.getTime());
          
          // If same day and still past stop time, wait
          if (pstNow.toDateString() === pstStopDate.toDateString()) {
            log('⏰ Still past stop time - waiting until tomorrow...');
            return true; // Need to wait
          } else {
            // New day, clear stop state
            await chrome.storage.local.set({
              stoppedAtStopTime: false,
              stopTimeReachedAt: 0
            });
            return false; // Can resume
          }
        } else {
          // No longer past stop time (new day), clear state
          await chrome.storage.local.set({
            stoppedAtStopTime: false,
            stopTimeReachedAt: 0
          });
          return false;
        }
      }
    } catch (e) {
      log('Error checking stop time: ' + e);
    }
    return false;
  }
  
  // Check if current time is within schedule window (using PST)
  function isWithinSchedule() {
    if (!settings || !settings.enableSchedule) {
      return true; // No schedule restrictions
    }
    
    const pstNow = getPSTTime();
    const currentHour = pstNow.getHours();
    const currentMinute = pstNow.getMinutes();
    const currentTime = currentHour * 60 + currentMinute; // Time in minutes since midnight
    
    // Check stop time first
    if (isPastStopTime()) {
      return false; // Past stop time
    }
    
    // Check if weekend and weekend schedule is enabled
    const isWeekend = pstNow.getDay() === 0 || pstNow.getDay() === 6;
    if (isWeekend && settings.weekendSchedule) {
      const weekendStart = parseTime(settings.weekendStart || '8am');
      const weekendEnd = parseTime(settings.weekendEnd || '1am');
      return isTimeInRange(currentTime, weekendStart, weekendEnd);
    }
    
    // Regular weekday schedule
    const scheduleStart = parseTime(settings.scheduleStart || '8am');
    const scheduleEnd = parseTime(settings.scheduleEnd || '1am');
    return isTimeInRange(currentTime, scheduleStart, scheduleEnd);
  }
  
  // Parse time string - supports both military time (09:00, 21:00) and am/pm (8am, 11pm)
  function parseTime(timeStr) {
    if (!timeStr) return 0;
    const cleaned = timeStr.trim().toLowerCase();
    
    // Check for military time format (HH:MM or HHMM)
    const militaryMatch = cleaned.match(/^(\d{1,2}):?(\d{2})?$/);
    if (militaryMatch) {
      let hours = parseInt(militaryMatch[1]) || 0;
      const minutes = parseInt(militaryMatch[2]) || 0;
      if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        return hours * 60 + minutes; // Return minutes since midnight
      }
    }
    
    // Fall back to am/pm format
    const isPM = cleaned.includes('pm');
    const isAM = cleaned.includes('am');
    
    // Extract hours and minutes
    const match = cleaned.match(/(\d+)(?::(\d+))?/);
    if (!match) return 0;
    
    let hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    
    // Convert to 24-hour format
    if (isPM && hours !== 12) hours += 12;
    if (isAM && hours === 12) hours = 0;
    
    return hours * 60 + minutes; // Return minutes since midnight
  }
  
  // Format minutes since midnight to military time string
  function formatTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
  }
  
  // Check if current time is in range (handles wrap-around like 8am-1am)
  function isTimeInRange(current, start, end) {
    if (start <= end) {
      // Normal range (e.g., 8am-5pm)
      return current >= start && current <= end;
    } else {
      // Wrapping range (e.g., 8am-1am, means 8am to next day 1am)
      return current >= start || current <= end;
    }
  }
  
  // Apply variance to delay if enabled
  function applyVarianceToDelay(delayMs) {
    if (!settings || !settings.delayVariance) {
      return delayMs;
    }
    
    const variancePercent = settings.varianceAmount || 30;
    // Random variance between -variancePercent% and +variancePercent%
    const variance = (Math.random() * 2 - 1) * (variancePercent / 100); // -0.3 to +0.3 for 30%
    const adjusted = delayMs * (1 + variance);
    return Math.max(1000, Math.round(adjusted)); // Minimum 1 second
  }
  
  // Check if we can add more friends - returns object with status
  function checkFriendAddLimits() {
    if (!settings) return { canAdd: false, reason: 'no-settings' };
    
    // Check schedule first
    if (!isWithinSchedule()) {
      return { canAdd: false, reason: 'schedule', hourlyLimit: false, dailyLimit: false };
    }
    
    const maxPerHour = settings.maxFriendsPerHour || 15;
    const maxPerDay = settings.maxFriendsPerDay || 50;
    
    // Check daily limit first (this is the hard stop)
    if (friendsAddedToday >= maxPerDay) {
      log('Friend add daily limit reached: ' + friendsAddedToday + '/' + maxPerDay);
      return { canAdd: false, reason: 'daily', hourlyLimit: false, dailyLimit: true };
    }
    
    // Check hourly limit (this can wait and continue)
    if (friendsAddedThisHour >= maxPerHour) {
      log('Friend add hourly limit reached: ' + friendsAddedThisHour + '/' + maxPerHour);
      return { canAdd: false, reason: 'hourly', hourlyLimit: true, dailyLimit: false };
    }
    
    return { canAdd: true, reason: 'ok', hourlyLimit: false, dailyLimit: false };
  }
  
  // Wait for pause to resume based on PST time
  async function waitForPauseResume() {
    const data = await chrome.storage.local.get(['pauseResumeTimePST']);
    
    if (!data.pauseResumeTimePST) {
      log('No resume time found, skipping pause');
      return;
    }
    
    while (isRunning) {
      const pstNow = getPSTTime();
      const resumeTime = new Date(data.pauseResumeTimePST);
      
      if (pstNow.getTime() >= resumeTime.getTime()) {
        // Pause is over
        await chrome.storage.local.remove(['pauseResumeTimePST', 'pauseStartedAt', 'pauseDurationMins']);
        log('✅ Pause complete (PST time reached)');
        return;
      }
      
      // Calculate remaining time
      const remaining = resumeTime.getTime() - pstNow.getTime();
      const remainingMins = Math.ceil(remaining / 60000);
      
      // Wait in small chunks and check PST time
      await delay(30000); // 30 second chunks
      
      // Check if we should stop
      const state = await chrome.storage.local.get(['sf_running']);
      if (!state.sf_running) {
        isRunning = false;
        break;
      }
      
      // Update status
      const resumeTimeStr = formatTime(resumeTime.getHours() * 60 + resumeTime.getMinutes());
      updateStatus('Pausing until ' + resumeTimeStr + ' PST (' + remainingMins + ' min left)', 'running');
      await saveRunningState();
    }
  }
  
  // Check if we're in a pause and should wait (when app reopens)
  async function checkPauseOnResume() {
    try {
      const data = await chrome.storage.local.get(['pauseResumeTimePST']);
      
      if (data.pauseResumeTimePST) {
        const pstNow = getPSTTime();
        const resumeTime = new Date(data.pauseResumeTimePST);
        
        if (pstNow.getTime() < resumeTime.getTime()) {
          // Still in pause
          const remaining = resumeTime.getTime() - pstNow.getTime();
          const remainingMins = Math.ceil(remaining / 60000);
          const resumeTimeStr = formatTime(resumeTime.getHours() * 60 + resumeTime.getMinutes());
          log('⏳ Still in pause - resume at ' + resumeTimeStr + ' PST (' + remainingMins + ' min left)');
          return true; // Need to wait
        } else {
          // Pause is over
          await chrome.storage.local.remove(['pauseResumeTimePST', 'pauseStartedAt', 'pauseDurationMins']);
          log('✅ Pause complete (resumed after app was closed)');
          return false;
        }
      }
    } catch (e) {
      log('Error checking pause: ' + e);
    }
    return false;
  }
  
  // Wait for hourly reset for friend adding (using PST)
  async function waitForFriendAddHourlyReset() {
    const pstNow = getPSTTime();
    const nextHour = new Date(pstNow);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    
    const resetTimePST = nextHour.getTime();
    const waitMs = resetTimePST - pstNow.getTime();
    const waitMins = Math.ceil(waitMs / 60000);
    const resetTimeStr = formatTime(nextHour.getHours() * 60);
    
    log('⏳ Hourly friend add limit reached. Waiting until ' + resetTimeStr + ' PST (' + waitMins + ' min)...');
    updateStatus('Hourly limit - wait until ' + resetTimeStr + ' PST', 'running');
    
    // Save hourly reset state
    await chrome.storage.local.set({
      hourlyResetTimePST: resetTimePST
    });
    await saveRunningState();
    
    // Wait and check PST time
    while (isRunning) {
      const currentPST = getPSTTime();
      
      if (currentPST.getTime() >= resetTimePST) {
        // Hour reset - reset counter
        friendsAddedThisHour = 0;
        const currentHourPST = Math.floor(currentPST.getTime() / (60 * 60 * 1000));
        lastFriendAddHourTimestamp = currentHourPST;
        
        await chrome.storage.local.set({
          friendsAddedThisHour: 0,
          lastFriendAddHourTimestamp: currentHourPST,
          hourlyResetTimePST: null
        });
        
        log('✅ Hourly friend add limit reset (PST), resuming...');
        updateStatus('Hourly limit reset, resuming...', 'running');
        return;
      }
      
      // Wait in chunks and check PST time
      await delay(60000); // 1 minute chunks
      
      // Check if we should stop
      const state = await chrome.storage.local.get(['sf_running']);
      if (!state.sf_running) {
        isRunning = false;
        break;
      }
      
      // Update status
      const remaining = resetTimePST - currentPST.getTime();
      const remainingMins = Math.ceil(remaining / 60000);
      updateStatus('Hourly limit - wait until ' + resetTimeStr + ' PST (' + remainingMins + ' min)', 'running');
      await saveRunningState();
    }
  }
  
  // Check hourly reset on resume
  async function checkHourlyResetOnResume() {
    try {
      const data = await chrome.storage.local.get(['hourlyResetTimePST']);
      
      if (data.hourlyResetTimePST) {
        const pstNow = getPSTTime();
        const resetTime = new Date(data.hourlyResetTimePST);
        
        if (pstNow.getTime() >= resetTime.getTime()) {
          // Reset time passed - reset counter
          friendsAddedThisHour = 0;
          const currentHourPST = Math.floor(pstNow.getTime() / (60 * 60 * 1000));
          lastFriendAddHourTimestamp = currentHourPST;
          
          await chrome.storage.local.set({
            friendsAddedThisHour: 0,
            lastFriendAddHourTimestamp: currentHourPST,
            hourlyResetTimePST: null
          });
          
          log('✅ Hourly reset completed (was waiting while app was closed)');
          return false; // Can continue
        } else {
          // Still need to wait
          const remaining = resetTime.getTime() - pstNow.getTime();
          const remainingMins = Math.ceil(remaining / 60000);
          const resetTimeStr = formatTime(resetTime.getHours() * 60);
          log('⏳ Still waiting for hourly reset until ' + resetTimeStr + ' PST (' + remainingMins + ' min)');
          return true; // Need to continue waiting
        }
      }
    } catch (e) {
      log('Error checking hourly reset: ' + e);
    }
    return false;
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
          // Try to extract name and username from the container
          const nameElement = container.querySelector('[class*="name"], [class*="Name"], [aria-label*="name" i]');
          const usernameElement = container.querySelector('[class*="username"], [class*="Username"]');
          
          addButtons.push({ 
            button: btn, 
            container: container,
            name: nameElement?.textContent?.trim() || container.textContent?.split('\n')?.[0]?.trim() || '',
            username: usernameElement?.textContent?.trim() || '',
            displayName: container.textContent?.split('\n')?.[0]?.trim() || ''
          });
        }
      }
    }
    
    return addButtons;
  }
  
  // Add a friend (click Add button)
  async function addFriend(addEntry) {
    try {
      const limitCheck = checkFriendAddLimits();
      if (!limitCheck.canAdd) {
        return { success: false, reason: limitCheck.dailyLimit ? 'daily-limit' : 'hourly-limit' };
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
  // ============================================
  // CHAT/MESSAGING MODE
  // ============================================
  // Handles automated messaging with AI, phases, CTAs, follow-ups, etc.
  // ============================================
  
  // Find conversations in the chat list
  function findConversations() {
    try {
      const conversations = [];
      
      // Look for conversation list items - these are typically clickable divs/buttons with names
      const conversationSelectors = [
        '[data-testid*="conversation"]',
        '[data-testid*="chat"]',
        '[class*="Conversation"]',
        '[class*="ChatItem"]',
        'button[aria-label*="chat"]',
        'div[role="button"][aria-label]'
      ];
      
      // Get all potential conversation elements
      const allElements = Array.from(document.querySelectorAll('button, div[role="button"], div[onclick]'))
        .filter(el => el.offsetParent !== null); // Only visible
      
      for (const el of allElements) {
        const ariaLabel = el.getAttribute('aria-label') || '';
        const text = el.textContent || '';
        
        // Skip if it's clearly not a conversation (has "Add", "Send", "Accept", etc.)
        if (ariaLabel.toLowerCase().includes('add') ||
            ariaLabel.toLowerCase().includes('send') ||
            ariaLabel.toLowerCase().includes('accept') ||
            ariaLabel.toLowerCase().includes('decline')) {
          continue;
        }
        
        // Check if it might be a conversation (has a name-like pattern)
        // Conversations typically have names visible
        if (text.trim().length > 0 && text.trim().length < 50) {
          // Try to extract name/username
          const nameMatch = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
          if (nameMatch || ariaLabel.length > 0) {
            conversations.push({
              element: el,
              name: nameMatch ? nameMatch[1] : text.trim(),
              ariaLabel: ariaLabel,
              text: text.trim()
            });
          }
        }
      }
      
      log('Found ' + conversations.length + ' potential conversations');
      return conversations;
    } catch (e) {
      log('Error finding conversations: ' + e);
      return [];
    }
  }
  
  // Click on a conversation to open it
  async function openConversation(conversation) {
    try {
      log('Opening conversation: ' + conversation.name);
      const clicked = await click(conversation.element);
      if (clicked) {
        await delay(2000); // Wait for chat to load
        return true;
      }
      return false;
    } catch (e) {
      log('Error opening conversation: ' + e);
      return false;
    }
  }
  
  // Determine what message to send based on conversation state
  async function determineMessageToSend(userId, conversationHistory) {
    try {
      const tracking = await chrome.storage.local.get('conversationTracking');
      const convTracking = tracking.conversationTracking || {};
      const userTracking = convTracking[userId] || {};
      
      const messageCount = conversationHistory?.messages?.length || 0;
      const exchanges = messageCount / 2; // Rough estimate
      
      // Check if this is the first message (opener)
      if (!userTracking.firstMessageAt) {
        log('First message - using opener');
        return { type: 'opener', phase: 1 };
      }
      
      // Check if we need to send follow-up
      const followUpCheck = await shouldSendFollowUp(
        userId,
        settings.followUpDelay || 8,
        settings.maxFollowUps || 20,
        settings.followUpOnlyIfNoReply !== false
      );
      
      if (followUpCheck.shouldSend) {
        log('Sending follow-up: ' + followUpCheck.reason);
        return { type: 'followUp', phase: await getCurrentPhase(userId, exchanges) };
      }
      
      // Check if we should send CTA
      const ctaCheck = await shouldAskForCTAAfterPhases(userId, exchanges);
      if (ctaCheck.shouldAsk) {
        log('All phases complete - sending CTA');
        return { type: 'cta', phase: 'complete' };
      }
      
      // Check current phase for regular message
      const currentPhase = await getCurrentPhase(userId, exchanges);
      
      // Check if they asked for OnlyFans
      const lastMessage = conversationHistory?.lastMessage || '';
      if (settings.sendCTAOnOnlyFansRequest && 
          /onlyfans|of|only fans/i.test(lastMessage)) {
        log('They asked for OnlyFans - sending CTA immediately');
        return { type: 'cta', phase: 'onlyfans-request' };
      }
      
      // Regular message based on phase
      return { type: 'message', phase: currentPhase.phaseNumber };
      
    } catch (e) {
      log('Error determining message: ' + e);
      return { type: 'message', phase: 1 };
    }
  }
  
  // Generate message text based on type and phase
  async function generateMessageText(userId, messageType, phase, conversationHistory) {
    try {
      if (messageType === 'opener') {
        // Use opener message (spintax or static)
        const opener = settings.openerMessage || 'hey';
        // TODO: Parse spintax here if needed
        return opener;
      }
      
      if (messageType === 'cta') {
        // Use CTA info
        const cta = settings.ctaInfo || 'Check out my OnlyFans!';
        return cta;
      }
      
      if (messageType === 'followUp') {
        // Use AI for follow-up if enabled
        if (settings.useAIFollowUps) {
          // TODO: Generate AI follow-up
          return 'hey, how are you?';
        }
      }
      
      // Regular AI message - generate using Anthropic API
      if (settings.aiChatEnabled && settings.apiKey) {
        try {
          const context = await getConversationContext();
          const response = await generateAIChatResponse(
            conversationHistory?.lastMessage || 'hey',
            context?.messages || [],
            settings
          );
          return response || 'hey';
        } catch (e) {
          log('Error generating AI response: ' + e);
          return 'hey';
        }
      }
      
      return 'hey';
    } catch (e) {
      log('Error generating message: ' + e);
      return 'hey';
    }
  }
  
  // Main chat loop
  async function runChat() {
    if (!isRunning || !settings.chatEnabled) return;
    
    log('Starting chat mode...');
    updateStatus('Chat mode started...', 'running');
    
    let messagesSent = 0;
    let conversationsProcessed = 0;
    
    while (isRunning) {
      // Find conversations
      const conversations = findConversations();
      if (conversations.length === 0) {
        log('No conversations found, waiting...');
        await delay(5000);
        continue;
      }
      
      log('Found ' + conversations.length + ' conversations');
      
      // Process each conversation
      for (const conv of conversations) {
        if (!isRunning) break;
        
        // Open conversation
        const opened = await openConversation(conv);
        if (!opened) {
          log('Failed to open conversation: ' + conv.name);
          continue;
        }
        
        // Get conversation info
        const userId = await getCurrentConversationUserId();
        if (!userId) {
          log('Could not get user ID for conversation');
          continue;
        }
        
        // Check if we should message this user
        if (!await shouldMessageUser(userId)) {
          log('Skipping user (already messaged): ' + userId);
          conversationsProcessed++;
          continue;
        }
        
        // Read conversation history
        const conversationHistory = await getConversationContext();
        
        // Determine what to send
        const messagePlan = await determineMessageToSend(userId, conversationHistory);
        log('Message plan: ' + messagePlan.type + ' (phase ' + messagePlan.phase + ')');
        
        // Generate message text
        const messageText = await generateMessageText(userId, messagePlan.type, messagePlan.phase, conversationHistory);
        
        // Check if we should send photo (based on phase percentage)
        const photoCheck = await shouldSendPhotoBasedOnPhase(userId, (conversationHistory?.messageCount || 0) / 2);
        if (photoCheck.shouldSend) {
          log('Sending photo: ' + photoCheck.reason);
          const photoResult = await sendPhotoToUser(userId, { ctaPhase: messagePlan.type === 'cta' });
          if (photoResult && photoResult.success && typeof window.logPhotoSent === 'function') {
            await window.logPhotoSent(userId, photoResult.photoId || '', photoResult.category || 'main', photoResult.caption || '').catch(e => console.error('[SF] DB log error:', e));
          }
          await delay(2000);
        }
        
        // Send message
        const sent = await sendTextMessage(messageText);
        if (sent) {
          messagesSent++;
          await trackMessageSent(userId, messageText);
          await markUserAsMessaged(userId);
          log('Message sent: ' + messageText.substring(0, 50));
          
          // Log to database
          if (typeof window.logMessage === 'function') {
            await window.logMessage(userId, messagePlan.type, messageText, true).catch(e => console.error('[SF] DB log error:', e));
          }
          if (typeof window.logConversation === 'function') {
            const conv = conversations.find(c => c.userId === userId);
            await window.logConversation(userId, userId, conv?.name || '', 'messaged').catch(e => console.error('[SF] DB log error:', e));
          }
        }
        
        // Delay before next conversation (respect chat speed settings)
        const chatSpeed = settings.chatSpeed || 'medium';
        const delays = {
          slow: { min: 60, max: 300 },
          medium: { min: 30, max: 180 },
          fast: { min: 10, max: 60 }
        };
        const speedDelays = delays[chatSpeed] || delays.medium;
        const delaySec = randDelay(
          (settings.chatMinDelay || speedDelays.min) * 1000,
          (settings.chatMaxDelay || speedDelays.max) * 1000
        );
        log('Waiting ' + (delaySec / 1000) + ' seconds before next conversation...');
        await delay(delaySec);
        
        conversationsProcessed++;
      }
      
      // Scroll to find more conversations
      window.scrollBy(0, 400);
      await delay(2000);
    }
    
    log('Chat mode stopped. Messages sent: ' + messagesSent + ', Conversations: ' + conversationsProcessed);
    updateStatus('Chat stopped - Sent: ' + messagesSent + ' messages', 'stopped');
    await clearRunningState(); // Clear state when stopped
  }
  
  async function runFriendAdding() {
    if (!isRunning || !settings.autoAddFriends) return;
    
    // Check if we should be stopped due to stop time (when app reopens)
    const shouldWaitForNextDay = await checkStopTimeOnResume();
    if (shouldWaitForNextDay) {
      await waitUntilNextDay();
      if (!isRunning) return;
    }
    
    // Check if we're in a pause and should wait
    const inPause = await checkPauseOnResume();
    if (inPause) {
      await waitForPauseResume();
      if (!isRunning) return;
    }
    
    // Check if we're waiting for hourly reset
    const waitingForHourly = await checkHourlyResetOnResume();
    if (waitingForHourly) {
      await waitForFriendAddHourlyReset();
      if (!isRunning) return;
    }
    
    await loadFriendAddLimits();
    friendsAddedCount = 0; // Reset pause counter
    
    // Check stop time before starting
    if (settings.enableSchedule && isPastStopTime()) {
      log('⏰ Stop time (PST) reached - waiting until next day...');
      await waitUntilNextDay();
      if (!isRunning) return;
    }
    
    log('Starting friend adding mode...');
    updateStatus('Adding friends from Quick Add...', 'running');
    await saveRunningState(); // Save state at start
    
    let added = 0;
    let skipped = 0;
    
    while (isRunning) {
      try {
        // Save state periodically to survive refreshes
        await saveRunningState();
        
        // Check stop time first (PST)
        if (settings.enableSchedule && isPastStopTime()) {
          log('⏰ Stop time (PST) reached - waiting until next day...');
          await waitUntilNextDay();
          if (!isRunning) break;
          continue; // Continue after new day starts
        }
        
        // Check schedule and limits
        const limitCheck = checkFriendAddLimits();
        
        if (!limitCheck.canAdd) {
          // Check if it's schedule restriction
          if (limitCheck.reason === 'schedule' && settings.enableSchedule) {
            log('Outside scheduled hours - waiting 1 minute before checking again...');
            updateStatus('Waiting for scheduled time...', 'running');
            await delay(60000);
            continue;
          }
          
          // Check if it's hourly limit - wait and continue
          if (limitCheck.hourlyLimit && !limitCheck.dailyLimit) {
            await waitForFriendAddHourlyReset();
            if (!isRunning) break;
            continue; // Continue loop after hourly reset
          }
          
          // Daily limit reached - stop completely
          if (limitCheck.dailyLimit) {
            log('Daily friend add limit reached - stopping');
            updateStatus('Daily limit reached! Done for today.', 'stopped');
            break;
          }
          
          // Other reason - stop
          log('Friend add stopped: ' + limitCheck.reason);
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
          // Check limits before each add
          const limitCheck = checkFriendAddLimits();
          if (!isRunning || !limitCheck.canAdd) {
            if (limitCheck.dailyLimit) break; // Daily limit - stop completely
            if (limitCheck.hourlyLimit) break; // Hourly limit - will be handled in outer loop
            break;
          }
          
          // Save state before each action
          await saveRunningState();
          
          // DELAY BEFORE each add (respects min/max delay settings + variance)
          let minDelay = (settings.friendAddMinDelay || 30) * 1000;
          let maxDelay = (settings.friendAddMaxDelay || 120) * 1000;
          
          // Apply variance if enabled
          if (settings.delayVariance) {
            minDelay = applyVarianceToDelay(minDelay);
            maxDelay = applyVarianceToDelay(maxDelay);
            // Ensure max is still >= min
            if (maxDelay < minDelay) {
              const temp = maxDelay;
              maxDelay = minDelay;
              minDelay = temp;
            }
          }
          
          const delayBeforeAdd = randDelay(minDelay, maxDelay);
          log('Waiting ' + (delayBeforeAdd / 1000).toFixed(1) + ' seconds before clicking Add...' + 
              (settings.delayVariance ? ' (with ±' + (settings.varianceAmount || 30) + '% variance)' : ''));
          
          // Break delay into chunks to allow stopping
          let delayRemaining = delayBeforeAdd;
          const chunkSize = 10000; // 10 second chunks
          while (delayRemaining > 0 && isRunning) {
            const chunk = Math.min(chunkSize, delayRemaining);
            await delay(chunk);
            delayRemaining -= chunk;
            if (delayRemaining > 0 && isRunning) {
              await saveRunningState();
            }
          }
          
          // Check again after delay
          // Check limits again after delay
          const limitCheckAfterDelay = checkFriendAddLimits();
          if (!isRunning || !limitCheckAfterDelay.canAdd) {
            if (limitCheckAfterDelay.dailyLimit) break;
            if (limitCheckAfterDelay.hourlyLimit) break;
            break;
          }
          
          const result = await addFriend(addEntry);
          if (result.success) {
            added++;
            // Counters already saved by incrementFriendAddCount() in addFriend()
            
            // Log to database
            if (typeof window.logFriendAdd === 'function') {
              const username = addEntry.username || result.username || '';
              const displayName = addEntry.name || addEntry.displayName || result.name || '';
              await window.logFriendAdd(username, displayName).catch(e => console.error('[SF] DB log error:', e));
            }
            
            // Check if we need to pause AFTER X adds
            // Note: This checks if we've reached the pause count (e.g., after 5 adds)
            if (settings.pauseAfterAdds && 
                settings.pauseAfterAddsCount > 0 &&
                friendsAddedCount > 0 && 
                friendsAddedCount % settings.pauseAfterAddsCount === 0) {
              const pauseMins = settings.pauseAfterAddsDuration || 10;
              
              // Calculate resume time in PST
              const pstNow = getPSTTime();
              const resumeTimePST = new Date(pstNow.getTime() + (pauseMins * 60 * 1000));
              const resumeTimeStr = formatTime(resumeTimePST.getHours() * 60 + resumeTimePST.getMinutes());
              
              log('🛑 Pausing for ' + pauseMins + ' minutes after ' + friendsAddedCount + ' adds (resume at ' + resumeTimeStr + ' PST)');
              updateStatus('Pausing until ' + resumeTimeStr + ' PST (added ' + friendsAddedCount + ' friends)', 'running');
              
              // Save pause state with PST resume time
              await chrome.storage.local.set({
                pauseResumeTimePST: resumeTimePST.getTime(),
                pauseStartedAt: pstNow.getTime(),
                pauseDurationMins: pauseMins
              });
              
              // Wait for pause using PST time checks
              await waitForPauseResume();
              
              if (!isRunning) {
                log('Stopped during pause');
                break;
              }
              
              // After pause completes, continue adding (don't break!)
              log('✅ Pause complete - continuing to add more friends...');
              updateStatus('Pause complete - continuing to add friends...', 'running');
              await saveRunningState();
            }
          } else if (result.reason === 'limit') {
            log('Hourly/daily limit reached - stopping');
            break; // Break out of loop if limit reached
          } else {
            skipped++;
            // Small delay even on skip to avoid rapid clicking
            await delay(randDelay(500, 1000));
          }
        }
        
        // Scroll to find more
        if (isRunning) {
          window.scrollBy(0, 400);
          await delay(2000);
        }
      } catch (err) {
        console.error('[SF] Error in friend adding loop:', err);
        // Continue running despite errors
        await delay(2000);
      }
    }
    
    log('Friend adding stopped. Added: ' + added + ', Skipped: ' + skipped);
    updateStatus('Friend adding stopped - Added: ' + added, 'stopped');
    await clearRunningState(); // Clear state when stopped
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
      clearRunningState(); // Clear persistent state
      return;
    }
    
    // Chat mode - if chatEnabled and aiChatEnabled
    if (settings.chatEnabled && settings.aiChatEnabled) {
      console.log('[SF] Starting chat mode...');
      updateStatus('Starting chat mode...', 'running');
      await runChat();
      isRunning = false;
      clearRunningState(); // Clear persistent state
      return;
    }
    
    // Friend request filtering mode (existing code) - runs when autoAddFriends and chat are disabled
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
    clearRunningState(); // Clear persistent state
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
    
    if (msg.action === 'getDbStats') {
      if (typeof window.getStats === 'function') {
        window.getStats().then(stats => {
          respond({ success: true, stats });
        }).catch(e => {
          respond({ success: false, error: e.message });
        });
        return true;
      }
      respond({ success: false, error: 'Database not available' });
      return true;
    }
    
    if (msg.action === 'exportDatabase') {
      if (typeof window.exportDatabase === 'function') {
        window.exportDatabase().then(data => {
          respond({ success: true, data });
        }).catch(e => {
          respond({ success: false, error: e.message });
        });
        return true;
      }
      respond({ success: false, error: 'Database not available' });
      return true;
    }
    
    if (msg.action === 'clearDatabase') {
      if (typeof indexedDB !== 'undefined') {
        try {
          const deleteRequest = indexedDB.deleteDatabase('snapchat_bot_db');
          deleteRequest.onsuccess = () => {
            if (window.db) window.db = null;
            respond({ success: true });
          };
          deleteRequest.onerror = () => {
            respond({ success: false, error: 'Failed to delete database' });
          };
        } catch (e) {
          respond({ success: false, error: e.message });
        }
        return true;
      }
      respond({ success: false, error: 'IndexedDB not available' });
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
      saveRunningState().then(() => {
      run().catch(err => {
        console.error('[SF] Error in run():', err);
        isRunning = false;
        saveRunningState().then(() => {
          updateStatus('Error: ' + err.message, 'error');
        });
      });
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'stop') {
      isRunning = false;
      clearRunningState().then(() => {
        saveSessionEnd();
        // Clear any wait states
        chrome.storage.local.set({ 
          waitingForHourly: false,
          hourlyResetTime: 0
        });
        saveLastActivity('Manually stopped');
      });
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
      try {
        console.log('[SF] openPanel message received');
        const result = createPanel();
        console.log('[SF] createPanel returned:', result);
        respond({ success: result });
      } catch (e) {
        console.error('[SF] Error in openPanel handler:', e);
        respond({ success: false, error: e.message });
      }
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

  // Auto-open panel and check for auto-resume
  if (location.href.includes('snapchat.com')) {
    const tryOpen = async () => {
      if (document.body) {
        setTimeout(createPanel, 2000);
        
        // Check if we should auto-resume
        const wasRunning = await loadRunningState();
        if (wasRunning && settings) {
          log('Auto-resuming bot after page load...');
          processed.clear();
          // Wait a bit for page to fully load
          setTimeout(() => {
            run().catch(err => {
              console.error('[SF] Error in auto-resume run():', err);
              isRunning = false;
              saveRunningState().then(() => {
                updateStatus('Error: ' + err.message, 'error');
              });
            });
          }, 3000);
        }
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
