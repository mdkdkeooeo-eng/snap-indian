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

  // Middle Eastern names
  const middleEasternNames = ['ahmed','mohammed','muhammad','mohamed','mohammad','ali','hassan','hussain','hussein','omar','yusuf','yousef','ibrahim','abdullah','abdul','khalid','saad','tariq','zain','zayn','hamza','bilal','mustafa','osman','ismail','salman','karim','jamal','rashid','faisal','nasser','mahmoud','majid','noor','reza','saeed','samir','waleed','yazan','zaid','adnan','amir','farid','hadi','hani','jamil','kareem','malik','nasir','qasim','sadiq','shahid','tahir','zahir','zaki','amin','arif','aziz','bashir','emad','fahad','ghazi','habib','imran','javed','jawad','khalil','latif','nabeel','nadeem','naveed','nazir','rafiq','rizwan','sabir','sajid','saleem','samad','shafiq','shahzad','shakir','sharif','taha','waqar','waqas','waseem','yasir','zafar','zahid','zubair','khan','sheikh','syed','iqbal','mirza','ramita','rukhsar'];

  // Female names
  const femaleNames = ['sarah','emily','jessica','jennifer','amanda','melissa','michelle','stephanie','nicole','elizabeth','ashley','samantha','lauren','rachel','lisa','kimberly','rebecca','amy','angela','maria','christina','kelly','susan','nancy','karen','betty','helen','sandra','donna','carol','ruth','sharon','laura','sophia','emma','olivia','ava','isabella','mia','charlotte','amelia','harper','evelyn','abigail','ella','mila','avery','camila','aria','scarlett','victoria','madison','luna','grace','chloe','penelope','layla','zoey','nora','hannah','lillian','addison','aubrey','ellie','stella','natalie','leah','hazel','violet','aurora','savannah','audrey','brooklyn','bella','claire','skylar','lucy','anna','caroline','nova','aaliyah','kennedy','allison','maya','willow','naomi','elena','ariana','gabriella','alice','ruby','eva','autumn','hailey','gianna','valentina','isla','ivy','sadie','piper','lydia','alexa','emilia','ariel','mackenzie','brianna','kylie','morgan','julia','kaylee','destiny','bailey','riley','zoe','alexis','jasmine','brooke','kayla','taylor','sydney','andrea','vanessa','brittany','danielle','kam'];

  // Check name
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
    return text.includes('\u{1F3FD}') || text.includes('\u{1F3FE}') || text.includes('\u{1F3FF}');
  }

  // Delays
  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  
  function randDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Click
  async function click(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(randDelay(100, 300));
    el.click();
    await delay(randDelay(100, 200));
  }

  // Create panel
  function createPanel() {
    if (document.getElementById('snap-filter-panel')) {
      document.getElementById('snap-filter-panel').style.display = 'flex';
      return true;
    }
    
    if (!document.body) return false;
    
    panel = document.createElement('div');
    panel.id = 'snap-filter-panel';
    panel.style.cssText = 'position:fixed;top:0;right:0;width:380px;height:100vh;background:#1a1a1a;z-index:999999;box-shadow:-2px 0 10px rgba(0,0,0,0.5);display:flex;flex-direction:column;';
    
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

  // Find Accept buttons
  function findEntries() {
    const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent);
    const accepts = [];
    
    for (const btn of btns) {
      const txt = btn.textContent.trim().toLowerCase();
      const cls = btn.className || '';
      if (txt === 'friends') continue;
      if (txt.includes('accept') || cls.includes('F7jpS')) {
        accepts.push(btn);
      }
    }
    
    return accepts.map(btn => {
      let el = btn.parentElement;
      for (let i = 0; i < 6 && el && el !== document.body; i++) {
        if (el.textContent.length > 10 && el.textContent.length < 500) {
          return { container: el, acceptBtn: btn };
        }
        el = el.parentElement;
      }
      return { container: btn.parentElement, acceptBtn: btn };
    });
  }

  // Get info
  function getInfo(container) {
    const text = container.textContent || '';
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const name = lines[0] || '';
    let user = '';
    for (const line of lines) {
      if (line.includes('@') || /^[a-z0-9._]+$/i.test(line)) {
        user = line.replace('@', '');
        break;
      }
    }
    return { name, user, text };
  }

  // Click ignore confirmation
  async function confirmIgnore() {
    await delay(300);
    const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent);
    const ignoreBtn = btns.find(b => b.textContent.trim() === 'Ignore' && (b.className || '').includes('tXFz7'));
    if (ignoreBtn) {
      await click(ignoreBtn);
      return true;
    }
    return false;
  }

  // Process one entry
  async function processEntry(entry) {
    const { name, user, text } = getInfo(entry.container);
    
    if (user && processed.has(user.toLowerCase())) return false;
    if (user) processed.add(user.toLowerCase());
    
    console.log('Processing:', name, '@' + user);
    
    let shouldIgnore = false;
    let reason = '';
    
    if (settings.filterBrownEmoji && hasBrownEmoji(text)) {
      shouldIgnore = true;
      reason = 'Brown emoji';
    }
    if (settings.filterNonAmerican && isNonAmerican(name, user)) {
      shouldIgnore = true;
      reason = 'Non-American';
    }
    if (isFemale(name, user)) {
      shouldIgnore = true;
      reason = 'Female';
    }
    
    if (shouldIgnore) {
      // Find X button (small icon button that's not Accept)
      const allBtns = Array.from(entry.container.querySelectorAll('button, [role="button"]')).filter(b => b.offsetParent);
      let xBtn = null;
      
      for (const btn of allBtns) {
        if (btn === entry.acceptBtn) continue;
        const txt = btn.textContent.trim().toLowerCase();
        if (txt === 'friends') continue;
        
        // Small icon button
        const rect = btn.getBoundingClientRect();
        if (rect.width <= 50 && rect.height <= 50) {
          xBtn = btn;
          break;
        }
      }
      
      // Fallback: any button that's not Accept
      if (!xBtn) {
        xBtn = allBtns.find(b => b !== entry.acceptBtn && !b.textContent.toLowerCase().includes('friend'));
      }
      
      if (xBtn) {
        console.log('  Ignoring:', reason);
        await click(xBtn);
        await confirmIgnore();
        console.log('  ✓ Ignored');
        return true;
      } else {
        console.log('  ⚠ No X button found');
      }
    } else {
      console.log('  Accepting (American male)');
      await click(entry.acceptBtn);
      console.log('  ✓ Accepted');
    }
    
    return false;
  }

  // Open friend requests
  async function openFriendRequests() {
    const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent);
    for (const btn of btns) {
      const title = (btn.getAttribute('title') || '').toLowerCase();
      if (title.includes('friend request')) {
        console.log('Opening friend requests...');
        await click(btn);
        await delay(1500);
        return;
      }
    }
  }

  // Main loop
  async function run() {
    if (!isRunning) return;
    
    let entries = findEntries();
    if (entries.length === 0) {
      await openFriendRequests();
      await delay(2000);
    }
    
    let scrolls = 0;
    let ignored = 0;
    let total = 0;
    
    while (isRunning && scrolls < settings.maxScrolls) {
      entries = findEntries();
      console.log('Found', entries.length, 'entries');
      
      for (const entry of entries) {
        if (!isRunning) break;
        const wasIgnored = await processEntry(entry);
        if (wasIgnored) ignored++;
        total++;
        await delay(randDelay(settings.minDelay, settings.maxDelay));
      }
      
      window.scrollBy(0, 400);
      await delay(settings.scrollDelay);
      scrolls++;
    }
    
    console.log('Done! Processed:', total, 'Ignored:', ignored);
    isRunning = false;
    
    chrome.runtime.sendMessage({
      action: 'statusUpdate',
      status: 'stopped',
      message: 'Done! Processed: ' + total + ', Ignored: ' + ignored
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
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'getStatus') {
      respond({ running: isRunning });
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
    
    if (msg.action === 'debug') {
      const entries = findEntries();
      console.log('=== DEBUG ===');
      console.log('Entries found:', entries.length);
      entries.forEach((e, i) => {
        const info = getInfo(e.container);
        console.log(i + 1, info.name, '@' + info.user);
      });
      respond({ success: true });
      return true;
    }
    
    if (msg.action === 'findAllButtons') {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent);
      let log = '=== BUTTON LOG ===\n';
      log += 'URL: ' + location.href + '\n';
      log += 'Buttons: ' + btns.length + '\n\n';
      btns.forEach((b, i) => {
        log += (i + 1) + '. "' + b.textContent.trim().substring(0, 30) + '" class="' + (b.className || '').substring(0, 40) + '"\n';
      });
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
