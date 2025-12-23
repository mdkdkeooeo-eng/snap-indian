// Snapchat Friend Filter - Content Script
console.log('=== SNAPCHAT FILTER LOADING ===');

(function() {
  'use strict';
  
  if (window.__snapFilterLoaded) {
    console.log('Already loaded');
    return;
  }
  window.__snapFilterLoaded = true;
  
  console.log('✅ Snapchat Friend Filter LOADED');
  console.log('URL:', window.location.href);

  // State
  let isRunning = false;
  let settings = null;
  let processed = new Set();
  let panel = null;
  
  // Rate limiting counters
  let acceptedThisSession = 0;
  let acceptedThisHour = 0;
  let acceptedToday = 0;
  let lastHourTimestamp = 0;
  let lastDayTimestamp = 0;

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

  function canAcceptMore() {
    if (settings.maxDaily > 0 && acceptedToday >= settings.maxDaily) {
      console.log('⚠ Daily limit reached:', acceptedToday, '/', settings.maxDaily);
      return false;
    }
    if (settings.maxHourly > 0 && acceptedThisHour >= settings.maxHourly) {
      console.log('⚠ Hourly limit reached:', acceptedThisHour, '/', settings.maxHourly);
      return false;
    }
    if (settings.maxSession > 0 && acceptedThisSession >= settings.maxSession) {
      console.log('⚠ Session limit reached:', acceptedThisSession, '/', settings.maxSession);
      return false;
    }
    return true;
  }

  async function incrementAcceptCount() {
    acceptedThisSession++;
    acceptedThisHour++;
    acceptedToday++;
    await saveRateLimits();
    console.log('  Accepts - Session:', acceptedThisSession, 'Hour:', acceptedThisHour, 'Today:', acceptedToday);
  }

  // Middle Eastern names
  const middleEasternNames = ['ahmed','mohammed','muhammad','mohamed','mohammad','ali','hassan','hussain','hussein','omar','yusuf','yousef','ibrahim','abdullah','abdul','khalid','saad','tariq','zain','zayn','hamza','bilal','mustafa','osman','ismail','salman','karim','jamal','rashid','faisal','nasser','mahmoud','majid','noor','reza','saeed','samir','waleed','yazan','zaid','adnan','amir','farid','hadi','hani','jamil','kareem','malik','nasir','qasim','sadiq','shahid','tahir','zahir','zaki','amin','arif','aziz','bashir','emad','fahad','ghazi','habib','imran','javed','jawad','khalil','latif','nabeel','nadeem','naveed','nazir','rafiq','rizwan','sabir','sajid','saleem','samad','shafiq','shahzad','shakir','sharif','taha','waqar','waqas','waseem','yasir','zafar','zahid','zubair','khan','sheikh','syed','iqbal','mirza','ramita','rukhsar'];

  // Female names
  const femaleNames = ['sarah','emily','jessica','jennifer','amanda','melissa','michelle','stephanie','nicole','elizabeth','ashley','samantha','lauren','rachel','lisa','kimberly','rebecca','amy','angela','maria','christina','kelly','susan','nancy','karen','betty','helen','sandra','donna','carol','ruth','sharon','laura','sophia','emma','olivia','ava','isabella','mia','charlotte','amelia','harper','evelyn','abigail','ella','mila','avery','camila','aria','scarlett','victoria','madison','luna','grace','chloe','penelope','layla','zoey','nora','hannah','lillian','addison','aubrey','ellie','stella','natalie','leah','hazel','violet','aurora','savannah','audrey','brooklyn','bella','claire','skylar','lucy','anna','caroline','nova','aaliyah','kennedy','allison','maya','willow','naomi','elena','ariana','gabriella','alice','ruby','eva','autumn','hailey','gianna','valentina','isla','ivy','sadie','piper','lydia','alexa','emilia','ariel','mackenzie','brianna','kylie','morgan','julia','kaylee','destiny','bailey','riley','zoe','alexis','jasmine','brooke','kayla','taylor','sydney','andrea','vanessa','brittany','danielle'];

  function isNonAmerican(name, user) {
    const text = (name + ' ' + user).toLowerCase();
    for (const n of middleEasternNames) {
      if (text.includes(n)) return true;
    }
    if (/[^\x00-\x7F]/.test(text)) return true;
    return false;
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
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(randDelay(100, 300));
    el.click();
    await delay(randDelay(100, 200));
  }

  function createPanel() {
    if (document.getElementById('snap-filter-panel')) {
      document.getElementById('snap-filter-panel').style.display = 'flex';
      return true;
    }
    
    if (!document.body) return false;
    
    panel = document.createElement('div');
    panel.id = 'snap-filter-panel';
    panel.style.cssText = 'position:fixed;top:0;right:0;width:400px;height:100vh;background:#1a1a1a;z-index:999999;box-shadow:-2px 0 10px rgba(0,0,0,0.5);display:flex;flex-direction:column;';
    
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('panel.html');
    iframe.style.cssText = 'width:100%;height:100%;border:none;background:#1a1a1a;';
    
    panel.appendChild(iframe);
    document.body.appendChild(panel);
    console.log('✅ Panel created');
    return true;
  }

  function hidePanel() {
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
    for (let attempt = 0; attempt < 10; attempt++) {
      await delay(300);
      
      // Look for Ignore button in confirmation dialog
      const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent);
      
      for (const btn of btns) {
        const txt = btn.textContent.trim();
        const cls = btn.className || '';
        // The ignore confirmation button has class "tXFz7"
        if (txt === 'Ignore' && cls.includes('tXFz7')) {
          console.log('  Found Ignore confirmation button, clicking...');
          await click(btn);
          return true;
        }
      }
    }
    console.log('  No Ignore confirmation found');
    return false;
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
    
    if (settings.filterBrownEmoji && hasBrownEmoji(fullText)) {
      shouldIgnore = true;
      reason = 'Brown emoji';
    }
    if (settings.filterNonAmerican && isNonAmerican(name, username)) {
      shouldIgnore = true;
      reason = 'Non-American';
    }
    if (isFemale(name, username)) {
      shouldIgnore = true;
      reason = 'Female';
    }
    
    console.log('  Filter:', shouldIgnore ? 'DECLINE (' + reason + ')' : 'ACCEPT');
    
    if (shouldIgnore) {
      // To DECLINE: We need to hover/click on the entry to reveal the X/decline option
      // Looking at the DOM, clicking on the row might open a menu or reveal buttons
      
      // Method 1: Try clicking on the container (not the accept button) to trigger decline flow
      // First, find any clickable element in the container that's NOT the accept button
      const clickables = Array.from(entry.container.querySelectorAll('[role="button"], button, [tabindex="0"]'))
        .filter(el => el.offsetParent && el !== entry.acceptBtn && !entry.acceptBtn.contains(el));
      
      // Also check if the container itself is clickable
      const containerClickable = entry.container.getAttribute('role') === 'button' || 
                                  entry.container.tabIndex >= 0 ||
                                  entry.container.style.cursor === 'pointer';
      
      let declined = false;
      
      // Try clicking the container first (might open a profile/options)
      if (containerClickable || entry.container.onclick) {
        console.log('  Clicking container to reveal decline option...');
        await click(entry.container);
        await delay(500);
        declined = await confirmIgnore();
      }
      
      // If that didn't work, try other clickable elements
      if (!declined) {
        for (const el of clickables) {
          const txt = (el.textContent || '').trim().toLowerCase();
          // Skip if it looks like accept or add
          if (txt.includes('accept') || txt.includes('add')) continue;
          
          console.log('  Trying clickable element:', el.tagName, txt.substring(0, 20));
          await click(el);
          await delay(500);
          
          // Check if Ignore button appeared
          declined = await confirmIgnore();
          if (declined) break;
        }
      }
      
      // If still not declined, try simulating hover to reveal X button
      if (!declined) {
        // Dispatch mouseenter event to potentially reveal hidden buttons
        entry.container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await delay(500);
        
        // Look for newly visible X/decline buttons
        const newBtns = Array.from(entry.container.querySelectorAll('button, [role="button"]'))
          .filter(b => b.offsetParent && b !== entry.acceptBtn);
        
        for (const btn of newBtns) {
          const txt = (btn.textContent || '').trim().toLowerCase();
          if (txt === 'x' || txt === '×' || txt === '' || txt.includes('decline') || txt.includes('ignore')) {
            console.log('  Found hidden X button after hover');
            await click(btn);
            await delay(500);
            declined = await confirmIgnore();
            if (declined) break;
          }
        }
      }
      
      if (declined) {
        console.log('  ✓ DECLINED:', reason, '-', name, username ? '@' + username : '');
        return { action: 'declined', reason };
      } else {
        console.log('  ⚠ Could not find decline option - skipping (NOT accepting)');
        return { action: 'skip', reason: 'no decline button found' };
      }
      
    } else {
      // ACCEPT - check rate limits first
      if (!canAcceptMore()) {
        return { action: 'limit', reason: 'rate limit reached' };
      }
      
      console.log('  Clicking Accept...');
      await click(entry.acceptBtn);
      await incrementAcceptCount();
      console.log('  ✓ ACCEPTED:', name, username ? '@' + username : '');
      return { action: 'accepted' };
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

  // Main run loop
  async function run() {
    if (!isRunning) return;
    
    const lastSessionEnd = await loadRateLimits();
    if (settings.sessionBreakMins > 0 && lastSessionEnd > 0) {
      const minsSinceLastSession = (Date.now() - lastSessionEnd) / (60 * 1000);
      if (minsSinceLastSession < settings.sessionBreakMins) {
        const waitMins = Math.ceil(settings.sessionBreakMins - minsSinceLastSession);
        console.log('⚠ Session break required. Wait', waitMins, 'more minutes.');
        updateStatus('Session break - wait ' + waitMins + ' mins');
        isRunning = false;
        return;
      }
    }
    
    acceptedThisSession = 0;
    
    let entries = findEntries();
    if (entries.length === 0) {
      await openFriendRequests();
      await delay(2000);
    }
    
    let scrolls = 0;
    let declined = 0;
    let accepted = 0;
    let total = 0;
    
    while (isRunning && scrolls < settings.maxScrolls) {
      if (!canAcceptMore()) {
        console.log('Rate limit reached, stopping...');
        break;
      }
      
      entries = findEntries();
      console.log('Found', entries.length, 'entries');
      
      if (entries.length === 0) {
        console.log('No more entries, scrolling...');
        window.scrollBy(0, 400);
        await delay(settings.scrollDelay);
        scrolls++;
        continue;
      }
      
      for (const entry of entries) {
        if (!isRunning) break;
        if (!canAcceptMore()) break;
        
        const result = await processEntry(entry);
        
        if (result.action === 'declined') {
          declined++;
          total++;
          await delay(randDelay(500, 1000));
        } else if (result.action === 'accepted') {
          accepted++;
          total++;
          const acceptDelay = randDelay(settings.minDelay, settings.maxDelay);
          console.log('  Waiting', acceptDelay, 'ms...');
          await delay(acceptDelay);
        } else if (result.action === 'limit') {
          break;
        }
        
        await delay(randDelay(200, 400));
      }
      
      window.scrollBy(0, 400);
      await delay(settings.scrollDelay);
      scrolls++;
    }
    
    await saveSessionEnd();
    
    const msg = 'Done! Accepted: ' + accepted + ', Declined: ' + declined;
    console.log(msg);
    console.log('Limits - Session:', acceptedThisSession, 'Hour:', acceptedThisHour, 'Today:', acceptedToday);
    
    isRunning = false;
    updateStatus(msg);
  }

  function updateStatus(msg) {
    chrome.runtime.sendMessage({
      action: 'statusUpdate',
      status: 'stopped',
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
      isRunning = true;
      processed.clear();
      run();
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'stop') {
      isRunning = false;
      saveSessionEnd();
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
        const shouldDecline = isFemale(info.name, info.username) || isNonAmerican(info.name, info.username);
        console.log(i + 1 + '.', info.name, info.username ? '@' + info.username : '', shouldDecline ? '→ DECLINE' : '→ ACCEPT');
      });
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
        const isNonAm = isNonAmerican(info.name, info.username);
        const brown = hasBrownEmoji(info.fullText);
        
        log += '--- Entry ' + (i + 1) + ' ---\n';
        log += 'Name: ' + info.name + '\n';
        log += 'Username: ' + (info.username || '(none)') + '\n';
        log += 'Decision: ' + ((isFem || isNonAm || brown) ? 
          'DECLINE (' + (isFem ? 'female ' : '') + (isNonAm ? 'non-american ' : '') + (brown ? 'brown-emoji' : '') + ')' : 
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
