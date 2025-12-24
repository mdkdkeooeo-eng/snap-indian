// SQL-like Database for logging - Uses IndexedDB
// Stores all bot activity: accepted/declined friends, conversations, messages, etc.

// Prevent multiple initializations
if (window.snapchatBotDBInitialized) {
  console.log('[DB] Database already initialized, skipping...');
} else {
  window.snapchatBotDBInitialized = true;

  let db = null;
  const DB_NAME = 'snapchat_bot_db';
  const DB_VERSION = 1;

  // Initialize IndexedDB
  async function initDatabase() {
  if (db) return db;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      console.error('[DB] Error opening database:', request.error);
      reject(request.error);
    };
    
    request.onsuccess = () => {
      db = request.result;
      console.log('[DB] Database initialized');
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Friend requests store (accepted/declined)
      if (!db.objectStoreNames.contains('friend_requests')) {
        const store = db.createObjectStore('friend_requests', { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('action', 'action', { unique: false });
        store.createIndex('username', 'username', { unique: false });
        store.createIndex('pst_date', 'pst_date', { unique: false });
      }
      
      // Friend adds store
      if (!db.objectStoreNames.contains('friend_adds')) {
        const store = db.createObjectStore('friend_adds', { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('username', 'username', { unique: false });
        store.createIndex('pst_date', 'pst_date', { unique: false });
        store.createIndex('pst_hour', 'pst_hour', { unique: false });
      }
      
      // Conversations store
      if (!db.objectStoreNames.contains('conversations')) {
        const store = db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
        store.createIndex('user_id', 'user_id', { unique: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('started_at', 'started_at', { unique: false });
      }
      
      // Messages store
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        store.createIndex('user_id', 'user_id', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('message_type', 'message_type', { unique: false });
      }
      
      // Photos sent store
      if (!db.objectStoreNames.contains('photos_sent')) {
        const store = db.createObjectStore('photos_sent', { keyPath: 'id', autoIncrement: true });
        store.createIndex('user_id', 'user_id', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      
      // Sessions store
      if (!db.objectStoreNames.contains('sessions')) {
        const store = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        store.createIndex('session_id', 'session_id', { unique: true });
        store.createIndex('started_at', 'started_at', { unique: false });
      }
      
      console.log('[DB] Database schema created');
    };
  });
}

// Helper function to get/store data from IndexedDB
function getStore(storeName, mode = 'readwrite') {
  if (!db) throw new Error('Database not initialized');
  const transaction = db.transaction([storeName], mode);
  return transaction.objectStore(storeName);
}

// Helper function to execute query on store
function executeQuery(store, operation, ...args) {
  return new Promise((resolve, reject) => {
    const request = operation.apply(store, args);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}


// Get PST date string
function getPSTDate() {
  const now = new Date();
  const pstOffset = -8 * 60; // PST is UTC-8 in minutes
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const pstTime = new Date(utcTime + (pstOffset * 60000));
  return pstTime.toISOString().split('T')[0]; // YYYY-MM-DD format
}

// Get current session ID
async function getSessionId() {
  const data = await chrome.storage.local.get(['currentSessionId']);
  if (data.currentSessionId) {
    return data.currentSessionId;
  }
  const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  await chrome.storage.local.set({ currentSessionId: sessionId });
  return sessionId;
}

// Get PST date string (YYYY-MM-DD)
function getPSTDate() {
  const now = new Date();
  const pstOffset = -8 * 60; // PST is UTC-8 in minutes
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const pstTime = new Date(utcTime + (pstOffset * 60000));
  return pstTime.toISOString().split('T')[0]; // YYYY-MM-DD format
}

// Log friend request action (accepted/declined)
async function logFriendRequest(username, displayName, action, reason = '') {
  if (!db) await initDatabase();
  
  try {
    const pstDate = getPSTDate();
    const sessionId = await getSessionId();
    const store = getStore('friend_requests');
    
    const record = {
      username: username || '',
      display_name: displayName || '',
      action: action,
      reason: reason,
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      pst_date: pstDate
    };
    
    await executeQuery(store, store.add, record);
    console.log('[DB] Logged friend request:', action, username);
  } catch (e) {
    console.error('[DB] Error logging friend request:', e);
  }
}

// Log friend add (from Quick Add)
async function logFriendAdd(username, displayName) {
  if (!db) {
    await initDatabase();
    if (!db) return;
  }
  
  try {
    const pstDate = getPSTDate();
    const now = new Date();
    const pstOffset = -8 * 60;
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const pstTime = new Date(utcTime + (pstOffset * 60000));
    const pstHour = pstTime.getHours();
    const sessionId = getSessionId();
    
    db.run(
      `INSERT INTO friend_adds (username, display_name, session_id, pst_date, pst_hour) 
       VALUES (?, ?, ?, ?, ?)`,
      [username || '', displayName || '', sessionId, pstDate, pstHour]
    );
    
    await saveDatabase();
    console.log('[DB] Logged friend add:', username);
  } catch (e) {
    console.error('[DB] Error logging friend add:', e);
  }
}

// Log conversation
async function logConversation(userId, username, displayName, status = 'not_messaged') {
  if (!db) await initDatabase();
  
  try {
    const store = getStore('conversations');
    const index = store.index('user_id');
    
    // Try to find existing conversation
    const existing = await executeQuery(index, index.get, userId);
    
    if (existing) {
      // Update existing
      existing.username = username || existing.username;
      existing.display_name = displayName || existing.display_name;
      existing.status = status;
      existing.last_message_at = new Date().toISOString();
      await executeQuery(store, store.put, existing);
    } else {
      // Insert new
      const record = {
        user_id: userId,
        username: username || '',
        display_name: displayName || '',
        status: status,
        phase: 1,
        messages_sent: 0,
        messages_received: 0,
        cta_attempts: 0,
        cta_shared: 0,
        converted: 0,
        started_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        excluded: 0
      };
      await executeQuery(store, store.add, record);
    }
  } catch (e) {
    console.error('[DB] Error logging conversation:', e);
  }
}

// Log message
async function logMessage(userId, messageType, messageText, isFromBot = true) {
  if (!db) await initDatabase();
  
  try {
    // Get or create conversation
    const convStore = getStore('conversations');
    const convIndex = convStore.index('user_id');
    let conversation = await executeQuery(convIndex, convIndex.get, userId);
    
    if (!conversation) {
      // Create conversation first
      const newConv = {
        user_id: userId,
        username: '',
        display_name: '',
        status: 'messaged',
        phase: 1,
        messages_sent: 0,
        messages_received: 0,
        cta_attempts: 0,
        cta_shared: 0,
        converted: 0,
        started_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        excluded: 0
      };
      const addRequest = convStore.add(newConv);
      addRequest.onsuccess = async () => {
        conversation = await executeQuery(convIndex, convIndex.get, userId);
        if (conversation) await logMessageToStore(conversation.id, userId, messageType, messageText, isFromBot, conversation);
      };
      return;
    }
    
    await logMessageToStore(conversation.id, userId, messageType, messageText, isFromBot, conversation);
  } catch (e) {
    console.error('[DB] Error logging message:', e);
  }
}

// Helper to log message to store
async function logMessageToStore(conversationId, userId, messageType, messageText, isFromBot, conversation) {
  const msgStore = getStore('messages');
  const msgRecord = {
    conversation_id: conversationId,
    user_id: userId,
    message_type: messageType,
    message_text: messageText,
    is_from_bot: isFromBot ? 1 : 0,
    timestamp: new Date().toISOString()
  };
  
  await executeQuery(msgStore, msgStore.add, msgRecord);
  
  // Update conversation stats
  const convStore = getStore('conversations');
  if (isFromBot) {
    conversation.messages_sent = (conversation.messages_sent || 0) + 1;
    conversation.last_message_at = new Date().toISOString();
  } else {
    conversation.messages_received = (conversation.messages_received || 0) + 1;
    conversation.last_reply_at = new Date().toISOString();
  }
  await executeQuery(convStore, convStore.put, conversation);
}

// Log photo sent
async function logPhotoSent(userId, photoId, category, caption = '') {
  if (!db) await initDatabase();
  
  try {
    const store = getStore('photos_sent');
    const record = {
      user_id: userId,
      photo_id: photoId,
      photo_category: category,
      caption: caption || '',
      timestamp: new Date().toISOString()
    };
    
    await executeQuery(store, store.add, record);
    console.log('[DB] Logged photo sent:', userId, category);
  } catch (e) {
    console.error('[DB] Error logging photo:', e);
  }
}

// Query functions - SQL-like interface
async function query(tableName, conditions = {}, orderBy = null, limit = null) {
  if (!db) await initDatabase();
  
  try {
    const store = getStore(tableName, 'readonly');
    const index = store.index(conditions.index || 'id');
    const results = [];
    
    return new Promise((resolve, reject) => {
      const request = index.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const record = cursor.value;
          
          // Apply conditions
          let matches = true;
          for (const [key, value] of Object.entries(conditions)) {
            if (key === 'index') continue;
            if (record[key] !== value) {
              matches = false;
              break;
            }
          }
          
          if (matches) {
            results.push(record);
          }
          
          cursor.continue();
        } else {
          // Sort if needed
          if (orderBy) {
            results.sort((a, b) => {
              if (orderBy.desc) {
                return b[orderBy.field] > a[orderBy.field] ? 1 : -1;
              } else {
                return a[orderBy.field] > b[orderBy.field] ? 1 : -1;
              }
            });
          }
          
          // Limit if needed
          if (limit) {
            resolve(results.slice(0, limit));
          } else {
            resolve(results);
          }
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[DB] Query error:', e);
    return [];
  }
}

// Get all records from a store
async function getAll(tableName, orderBy = null) {
  if (!db) await initDatabase();
  
  try {
    const store = getStore(tableName, 'readonly');
    return await executeQuery(store, store.getAll);
  } catch (e) {
    console.error('[DB] Error getting all:', e);
    return [];
  }
}

// Get stats
async function getStats(startDate = null, endDate = null) {
  if (!db) await initDatabase();
  
  try {
    // Get all records and filter by date
    const allFriendRequests = await getAll('friend_requests');
    const allFriendAdds = await getAll('friend_adds');
    const allMessages = await getAll('messages');
    const allConversations = await getAll('conversations');
    
    let friendRequests = allFriendRequests;
    let friendAdds = allFriendAdds;
    let messages = allMessages;
    
    if (startDate || endDate) {
      friendRequests = friendRequests.filter(r => {
        const ts = new Date(r.timestamp);
        if (startDate && ts < new Date(startDate)) return false;
        if (endDate && ts > new Date(endDate)) return false;
        return true;
      });
      
      friendAdds = friendAdds.filter(r => {
        const ts = new Date(r.timestamp);
        if (startDate && ts < new Date(startDate)) return false;
        if (endDate && ts > new Date(endDate)) return false;
        return true;
      });
      
      messages = messages.filter(r => {
        const ts = new Date(r.timestamp);
        if (startDate && ts < new Date(startDate)) return false;
        if (endDate && ts > new Date(endDate)) return false;
        return true;
      });
    }
    
    return {
      accepted: friendRequests.filter(r => r.action === 'accepted').length,
      declined: friendRequests.filter(r => r.action === 'declined').length,
      added: friendAdds.length,
      messages: messages.filter(r => r.is_from_bot === 1).length,
      conversations: allConversations.length,
      converted: allConversations.filter(c => c.converted === 1).length
    };
  } catch (e) {
    console.error('[DB] Error getting stats:', e);
    return null;
  }
}

// Export database as JSON
async function exportDatabase() {
  if (!db) await initDatabase();
  
  try {
    const friendRequests = await getAll('friend_requests');
    const friendAdds = await getAll('friend_adds');
    const conversations = await getAll('conversations');
    const messages = await getAll('messages');
    const photos = await getAll('photos_sent');
    
    // Sort by timestamp descending
    friendRequests.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    friendAdds.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    conversations.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
    messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    photos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return {
      friendRequests,
      friendAdds,
      conversations,
      messages: messages.slice(0, 10000), // Limit messages
      photos,
      exportedAt: new Date().toISOString()
    };
  } catch (e) {
    console.error('[DB] Error exporting:', e);
    return null;
  }
}

  // Export database functions globally for content.js access
  if (typeof window !== 'undefined') {
    try {
      window.initDatabase = initDatabase;
      window.logFriendRequest = logFriendRequest;
      window.logFriendAdd = logFriendAdd;
      window.logConversation = logConversation;
      window.logMessage = logMessage;
      window.logPhotoSent = logPhotoSent;
      window.query = query;
      window.getStats = getStats;
      window.exportDatabase = exportDatabase;
      console.log('[DB] Database functions exported to window');
    } catch (e) {
      console.error('[DB] Error exporting functions:', e);
    }
  }

  // Also export for Node.js/CommonJS if needed
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      initDatabase,
      logFriendRequest,
      logFriendAdd,
      logConversation,
      logMessage,
      logPhotoSent,
      query,
      getStats,
      exportDatabase
    };
  }
}

