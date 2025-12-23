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
    await saveSessionStats();
    console.log('  Accepts - Session:', acceptedThisSession, 'Hour:', acceptedThisHour, 'Today:', acceptedToday);
  }
  
  async function incrementDeclineCount() {
    declinedThisSession++;
    await saveSessionStats();
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
  
  function startRecording() {
    recordedActions = [];
    isRecordingActions = true;
    document.addEventListener('click', recordClickHandler, true);
    console.log('🔴 Recording started - click elements to record');
    return true;
  }
  
  function stopRecording() {
    isRecordingActions = false;
    document.removeEventListener('click', recordClickHandler, true);
    
    // Generate log
    let log = '=== RECORDED ACTIONS ===\n\n';
    log += 'Recording stopped at: ' + new Date().toISOString() + '\n';
    log += 'Total actions: ' + recordedActions.length + '\n';
    log += 'URL: ' + location.href + '\n\n';
    
    recordedActions.forEach((action, i) => {
      log += '--- Action ' + (i + 1) + ' [' + action.type.toUpperCase() + '] ---\n';
      log += 'Time: ' + action.timestamp + '\n';
      log += 'Click position: ' + action.clientX + ', ' + action.clientY + '\n\n';
      
      const el = action.element;
      log += 'Element: <' + el.tagName + '>\n';
      log += '  ID: "' + el.id + '"\n';
      log += '  Class: "' + el.className + '"\n';
      log += '  Text: "' + el.textContent + '"\n';
      log += '  Aria-Label: "' + el.ariaLabel + '"\n';
      log += '  Title: "' + el.title + '"\n';
      log += '  Role: "' + el.role + '"\n';
      log += '  Position: x=' + el.x + ' y=' + el.y + ' w=' + el.width + ' h=' + el.height + '\n';
      log += '  Visible: ' + el.visible + '\n';
      log += '  Cursor: ' + el.cursor + '\n';
      log += '  Background: ' + el.bgColor + '\n';
      if (el.hasSVG) {
        log += '  Has SVG: true (paths: ' + el.svgPaths + ')\n';
      }
      
      if (el.parent) {
        log += '  Parent: <' + el.parent.tagName + '> class="' + el.parent.className + '"\n';
        log += '          text: "' + el.parent.textPreview + '"\n';
      }
      
      if (action.path.length > 0) {
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
    'ahme', 'ahmd', 'ahm',  // ahmed variants
    'hass', 'huss', 'husn',  // hassan/hussein
    'ibra', 'abdu', 'abd',  // ibrahim/abdullah
    'khal', 'khld',  // khalid/khalil
    'must', 'mstf',  // mustafa
    'osma', 'usmn',  // osman/usman
    'isma', 'ism',  // ismail
    'yusf', 'yous', 'yose',  // yusuf/yousef
    'tarq', 'tariq',  // tariq
    'hamz', 'hmza',  // hamza
    'bila', 'blal',  // bilal
    'rash', 'rshd',  // rashid
    'fais', 'fysl',  // faisal
    'nass', 'nasr',  // nasser/nasir
    'qasi', 'qsm',  // qasim
    'shah', 'shaz',  // shahid/shahzad
    'waqr', 'wqs',  // waqar/waqas
    'rizw', 'rzwn',  // rizwan
    'jave', 'jwd',  // javed/jawad
    'imra', 'imrn',  // imran
    'nabi', 'ndm',  // nabeel/nadeem
    'iqba', 'iqbl',  // iqbal
    'zubr', 'zbr',  // zubair
    'rami', 'rukh',  // ramita/rukhsar
    'noor', 'nur',  // noor/nur
    'sami', 'smr',  // samir
    'dani', 'dnyl',  // daniyal
    'ayan', 'arya', 'ayaa',  // ayan/aryan
    'zara', 'sara',  // zara (if male context)
    'asad', 'asif', 'atif',  // asad/asif/atif
    'faiz', 'fayz',  // faiz
    'haid', 'hayd',  // haider
    'uzai', 'uzma',  // uzair
    // Turkish roots
    'mehm', 'mehmet',  // mehmet
    'ahmet', 'mustaf',  // ahmet/mustafa
    'ceng', 'cenk',  // cengiz/cenk
    'berk', 'kaan',  // berk/kaan
    'emir', 'emre',  // emir/emre
    'burak', 'bura',  // burak
    'oguz', 'oğuz',  // oguz
    'serkan', 'serk',  // serkan
    'volkan', 'volk',  // volkan
    'gokh', 'gökh',  // gokhan
    'ozgu', 'özgü',  // ozgur
    'tugr', 'tuğr',  // tugrul
    'yilm', 'yılm',  // yilmaz
    'demi', 'demir',  // demir
    // Mexican/Hispanic roots
    'guad', 'guadal',  // guadalupe
    'javi', 'javie',  // javier
    'fern', 'fernan',  // fernando
    'guil', 'guill',  // guillermo
    'robe', 'rober',  // roberto
    'alej', 'alejan',  // alejandro
    'enri', 'enriq',  // enrique
    'gonz', 'gonzal',  // gonzalez/gonzalo
    'hern', 'hernan',  // hernandez/hernando
    'carl', 'carlo',  // carlos
    'migu', 'migue',  // miguel
    'edua', 'eduar',  // eduardo
    'anto', 'anton',  // antonio
    'salv', 'salva',  // salvador
    'fran', 'franc',  // francisco
    'rami', 'ramir',  // ramirez/ramiro
    'rodri', 'rodrig',  // rodrigo/rodriguez
  ];
  
  // Full names to match exactly or as substring
  const middleEasternNames = [
    // Middle Eastern / Arabic
    'ahmed','mohammed','muhammad','mohamed','mohammad','mohamad','muhamed','ali','hassan','hussain','hussein','omar','yusuf','yousef','ibrahim','abdullah','abdul','khalid','saad','tariq','zain','zayn','hamza','bilal','mustafa','osman','usman','ismail','salman','karim','jamal','rashid','faisal','nasser','mahmoud','majid','noor','reza','saeed','samir','waleed','yazan','zaid','adnan','amir','farid','hadi','hani','jamil','kareem','malik','nasir','qasim','sadiq','shahid','tahir','zahir','zaki','amin','arif','aziz','bashir','emad','fahad','ghazi','habib','imran','javed','jawad','khalil','latif','nabeel','nadeem','naveed','nazir','rafiq','rizwan','sabir','sajid','saleem','samad','shafiq','shahzad','shakir','sharif','taha','waqar','waqas','waseem','yasir','zafar','zahid','zubair','khan','sheikh','syed','iqbal','mirza','ramita','rukhsar',
    // South Asian / Indian
    'preet','singh','raj','kumar','patel','gupta','sharma','ankit','rohit','vikram','suresh','dinesh','rakesh','daniyal','danyal','danya','ayan','aryan','ayaan','rehan','rohan','sohan','mohan','karan','arjun','varun','tarun','nikhil','rahul','sahil','vishal','kapil','sunil','anil','ravi','sanjay','vijay','ajay','manoj','deepak','ashok','vinod','pramod','naresh','ganesh','umesh','mukesh','lokesh','yogesh','jitesh','hitesh','ritesh','manish','danish','tanish','harish','girish','satish','nitish','pritesh','paresh','jayesh','brijesh','alpesh','chirag','nirav','maulik','ketan','chetan','hiren','jignesh','bhavesh','darshan','kishan','ishan','roshan','shan','farhan','burhan','imtiaz','mumtaz','nawaz','shabaz','faraz','niaz','liaqat','shaukat','barkat','rifat','aftab','mehtab','sohail','wajid','junaid','obaid','ubaid','humaid','saif','naif','hanif','sharif','siddiq','farooq','masood','mehmood','dawood','suleman','hafeez','azeez','muneeb','haseeb','munir','zaheer','sameer','tanveer','pervez','parveen','yasmeen','shireen','tasleem','hakeem','rahim','faheem','naeem','kaleem','haleem','akram','ikram','ashraf','musharaf','anwar','sarwar','dilwar','gulzar','sarfraz','shahbaz','riaz','ijaz','fayyaz','noman','othman','affan','irfan','kamran','adeel','aqeel','shakeel','jameel','sumeet','puneet','navneet','gurpreet','harpreet','manpreet','kuldeep','sandeep','pradeep','sukhdeep','jagdeep','randeep','amardeep','kuljit','gurjit','baljit','surjit','daljit','manjit','jagjit','ranjit','paramjit','sukhvir','balvir','rajvir','jasvir','dalvir','inderjit','avtar',
    // Turkish names
    'mehmet','ahmet','mustafa','kemal','erdogan','yilmaz','ozturk','kaya','demir','celik','sahin','yildiz','aydin','ozdemir','arslan','dogan','kilic','aslan','cetin','koc','kurt','ozcan','polat','simsek','yildirim','gunes','aktas','korkmaz','kaplan','tekin','bulut','karaca','tas','keskin','bayrak','bozkurt','unal','turan','erdem','cengiz','cenk','berk','kaan','emir','emre','burak','oguz','serkan','volkan','gokhan','ozgur','tugrul','onur','murat','kerem','cem','selim','tolga','baris','arda','omer','yusuf','eren','alp','efe','koray','deniz','umut','hakan','serdar','tuncay','cihan','ilhan','orhan','ferhat','recep','tayyip','suleyman','ismet','nihat','tamer','levent','ercan','ozan','taylan','sinan','evren','erhan','gorkem','furkan','batuhan','emirhan','berkay','kubilay','ilker','doruk','bora','aras','poyraz','utku','tarkan','teoman','sertab','tariq',
    // Mexican / Hispanic names
    'alejandro','javier','fernando','guillermo','roberto','carlos','miguel','eduardo','antonio','jose','juan','luis','pedro','rafael','ramon','raul','ricardo','sergio','angel','armando','arturo','benito','cesar','diego','emilio','ernesto','esteban','felipe','gerardo','gilberto','gonzalo','gustavo','hector','hugo','ignacio','jaime','jesus','joaquin','jorge','julian','lorenzo','manuel','marcos','mario','martin','mauricio','nestor','octavio','orlando','oscar','pablo','pancho','patricio','paco','reynaldo','rodolfo','rodrigo','rolando','ruben','salvador','santiago','santos','tomas','ulises','valentin','vicente','xavier','guadalupe','hernandez','martinez','lopez','garcia','rodriguez','gonzalez','perez','sanchez','ramirez','torres','flores','rivera','gomez','diaz','reyes','morales','jimenez','ruiz','alvarez','mendoza','castillo','romero','herrera','medina','aguilar','vargas','castro','cruz','ortiz','gutierrez','ramos','chavez','moreno','silva','vasquez','delgado','sandoval','guerrero','contreras','fuentes','soto','rojas','vega','campos','leon','espinoza','munoz','estrada','acosta',
    // Common short patterns that indicate non-American
    'jai','dev','tej','pal','jot','gur','har','bal','dal','sim','parm','jag','ran'
  ];

  // Female names
  const femaleNames = ['sarah','emily','jessica','jennifer','amanda','melissa','michelle','stephanie','nicole','elizabeth','ashley','samantha','lauren','rachel','lisa','kimberly','rebecca','amy','angela','maria','christina','kelly','susan','nancy','karen','betty','helen','sandra','donna','carol','ruth','sharon','laura','sophia','emma','olivia','ava','isabella','mia','charlotte','amelia','harper','evelyn','abigail','ella','mila','avery','camila','aria','scarlett','victoria','madison','luna','grace','chloe','penelope','layla','zoey','nora','hannah','lillian','addison','aubrey','ellie','stella','natalie','leah','hazel','violet','aurora','savannah','audrey','brooklyn','bella','claire','skylar','lucy','anna','caroline','nova','aaliyah','kennedy','allison','maya','willow','naomi','elena','ariana','gabriella','alice','ruby','eva','autumn','hailey','gianna','valentina','isla','ivy','sadie','piper','lydia','alexa','emilia','ariel','mackenzie','brianna','kylie','morgan','julia','kaylee','destiny','bailey','riley','zoe','alexis','jasmine','brooke','kayla','taylor','sydney','andrea','vanessa','brittany','danielle'];

  function isNonAmerican(name, user) {
    const combined = (name + ' ' + user).toLowerCase();
    const textNoSymbols = combined.replace(/[^a-z\s]/g, '');
    const words = textNoSymbols.split(/\s+/).filter(w => w.length > 0);
    
    // Check for non-ASCII characters first (foreign scripts like 핿핾, Arabic, etc.)
    if (/[^\x00-\x7F]/.test(name + user)) {
      console.log('  → Contains non-ASCII characters');
      return true;
    }
    
    // Check each word separately against full names
    for (const word of words) {
      for (const n of middleEasternNames) {
        // Exact match - word equals the name
        if (word === n) {
          console.log('  → Exact name match:', n);
          return true;
        }
        // Embedded match - only for longer names (6+ chars) to avoid false positives
        // like "eren" in "conference"
        if (n.length >= 6 && word.includes(n)) {
          console.log('  → Embedded name match:', n, 'in', word);
          return true;
        }
        // For 4-5 char names, only match at START of word
        if (n.length >= 4 && n.length < 6 && word.startsWith(n)) {
          console.log('  → Name at word start:', n, 'in', word);
          return true;
        }
      }
    }
    
    // Check root patterns - must be at START of a word (not middle)
    for (const word of words) {
      for (const root of nameRoots) {
        // Root must be at the beginning of the word AND word must be longer
        if (word.startsWith(root) && word.length >= root.length + 2) {
          console.log('  → Matched root:', root, 'at start of:', word);
          return true;
        }
      }
    }
    
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
          await incrementDeclineCount();
          console.log('  ✓ DECLINED:', reason, '-', name, username ? '@' + username : '');
          return { action: 'declined', reason };
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
    declinedThisSession = 0;
    declineButtonMissing = false;
    processed.clear(); // Clear processed set for fresh run
    await saveSessionStats();
    
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
      if (!canAcceptMore()) {
        console.log('Rate limit reached, stopping...');
        break;
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
        if (!canAcceptMore()) break;
        
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
          break;
        }
        
        await delay(randDelay(200, 400));
      }
      
      // After processing current batch, try to load more
      await clickViewMore();
      await delay(1000);
    }
    
    await saveSessionEnd();
    
    // Save session log
    try {
      const logsData = await chrome.storage.local.get('sessionLogs');
      const logs = logsData.sessionLogs || [];
      logs.push({
        date: new Date().toISOString(),
        accepted: accepted,
        declined: declined,
        skipped: skipped,
        sessionAccepted: acceptedThisSession,
        hourlyTotal: acceptedThisHour,
        dailyTotal: acceptedToday
      });
      // Keep only last 100 sessions
      if (logs.length > 100) logs.shift();
      await chrome.storage.local.set({ sessionLogs: logs });
    } catch (e) {
      console.log('Failed to save session log:', e);
    }
    
    const msg = 'Done! Accepted: ' + accepted + ', Declined: ' + declined + ', Skipped: ' + skipped;
    console.log(msg);
    console.log('Limits - Session:', acceptedThisSession, 'Hour:', acceptedThisHour, 'Today:', acceptedToday);
    
    isRunning = false;
    updateStatus(msg);
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
