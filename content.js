// Content script for Snapchat Friend Filter
let isRunning = false;
let currentSettings = null;
let processedUsernames = new Set();
let panelContainer = null;
let panelIframe = null;

// Global flag to prevent user interaction
let userInteractionBlocked = false;

// Prevent user interaction when bot is running
function preventUserInteraction() {
  if (userInteractionBlocked) return;
  if (!isRunning) return; // Only block if bot is actually running
  userInteractionBlocked = true;
  
  // Disable scrolling
  if (document.body) {
    document.body.style.overflow = 'hidden';
  }
  if (document.documentElement) {
    document.documentElement.style.overflow = 'hidden';
  }
  
  // Prevent scroll events
  const preventScroll = (e) => {
    if (isRunning) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  };
  
  // Prevent wheel/scroll
  try {
    document.addEventListener('wheel', preventScroll, { passive: false, capture: true });
    document.addEventListener('scroll', preventScroll, { passive: false, capture: true });
    document.addEventListener('touchmove', preventScroll, { passive: false, capture: true });
    
    // Prevent keyboard scrolling
    document.addEventListener('keydown', (e) => {
      if (isRunning && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End' || e.key === ' ')) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, { capture: true });
  } catch (e) {
    console.error('Error setting up interaction blocking:', e);
  }
}

function allowUserInteraction() {
  if (!userInteractionBlocked) return;
  userInteractionBlocked = false;
  
  // Re-enable scrolling
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  
  // Note: Event listeners will be re-added next time bot starts
}

// Create and inject panel
function createPanel() {
  try {
    // Check if already exists
    const existing = document.getElementById('snapchat-filter-panel');
    if (existing) {
      existing.style.display = 'flex';
      panelContainer = existing;
      panelIframe = existing.querySelector('iframe');
      return;
    }
    
    if (panelContainer && document.body && document.body.contains(panelContainer)) {
      panelContainer.style.display = 'flex';
      return;
    }
    
    // Make sure body exists and page is ready
    if (!document.body) {
      console.warn('Cannot create panel: document.body not ready');
      return;
    }
    
    // Create container
    panelContainer = document.createElement('div');
    panelContainer.id = 'snapchat-filter-panel';
    panelContainer.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: 380px;
      height: 100vh;
      background: #1a1a1a;
      z-index: 999999;
      box-shadow: -2px 0 10px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
    `;
    
    // Create iframe for panel
    panelIframe = document.createElement('iframe');
    panelIframe.src = chrome.runtime.getURL('panel.html');
    panelIframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      background: #1a1a1a;
    `;
    
    // Handle iframe errors gracefully
    panelIframe.onerror = (e) => {
      console.error('Panel iframe error:', e);
    };
    
    panelContainer.appendChild(panelIframe);
    
    // Remove existing if any (different instance)
    const existingPanel = document.getElementById('snapchat-filter-panel');
    if (existingPanel && existingPanel !== panelContainer) {
      existingPanel.remove();
    }
    
    // Append to body
    if (document.body && !document.body.contains(panelContainer)) {
      document.body.appendChild(panelContainer);
      console.log('✅ Panel created and added to page');
    }
  } catch (e) {
    console.error('Error creating panel:', e);
  }
}

// Remove panel
function removePanel() {
  if (panelContainer) {
    panelContainer.style.display = 'none';
    chrome.storage.local.set({ panelOpen: false });
  }
}

// Common Middle Eastern names (English spellings)
const middleEasternNames = [
  // Arabic/Muslim first names
  'ahmed', 'mohammed', 'muhammad', 'mohamed', 'mohammad', 'ali', 'hassan', 'hussain', 'hussein',
  'omar', 'yusuf', 'yousef', 'ibrahim', 'abdullah', 'abdul', 'khalid', 'saad', 'tariq', 'zain',
  'zayn', 'yasin', 'yaseen', 'hamza', 'bilal', 'mustafa', 'osman', 'ismail', 'ismael', 'salman',
  'suleiman', 'sulaiman', 'karim', 'jamal', 'rashid', 'faisal', 'nasser', 'nassir', 'youssef',
  'mahmoud', 'mahmud', 'majid', 'noor', 'nur', 'reza', 'reza', 'saeed', 'said', 'samir',
  'tamer', 'tariq', 'waleed', 'waleed', 'yazan', 'zaid', 'zayd', 'adnan', 'amir', 'farid',
  'hadi', 'hani', 'hasan', 'jamil', 'kareem', 'malik', 'nasir', 'qasim', 'raheem', 'rauf',
  'sadiq', 'shahid', 'tahir', 'waheed', 'yusuf', 'zahir', 'zaki', 'amin', 'arif', 'asif',
  'aziz', 'bashir', 'daniyal', 'emad', 'fahad', 'ghazi', 'habib', 'imran', 'javed', 'jawad',
  'khalil', 'latif', 'majeed', 'nabeel', 'nadeem', 'najib', 'naseem', 'naveed', 'nazir',
  'qadir', 'rafiq', 'raheel', 'raiyan', 'rameez', 'rashad', 'rayyan', 'rizwan', 'sabir',
  'sadiq', 'sajid', 'saleem', 'salim', 'samad', 'shafiq', 'shahzad', 'shakir', 'sharif',
  'taha', 'tahir', 'tariq', 'taufiq', 'waqar', 'waqas', 'waseem', 'yasir', 'younis',
  'yusuf', 'zafar', 'zahid', 'zain', 'zaki', 'zaman', 'zubair', 'zulfiqar',
  
  // Middle Eastern last names
  'abbas', 'abdullah', 'ahmad', 'akhtar', 'ali', 'ansari', 'arif', 'ashraf', 'aziz', 'baig',
  'bashir', 'chaudhry', 'chaudhary', 'hassan', 'hussain', 'ibrahim', 'khan', 'malik', 'mohammed',
  'noor', 'qadir', 'rahman', 'rashid', 'saeed', 'shah', 'sheikh', 'siddiqui', 'syed', 'tariq',
  'yusuf', 'zaman', 'abbasi', 'adnan', 'ahsan', 'akram', 'alavi', 'amjad', 'arif', 'asghar',
  'atif', 'awan', 'azhar', 'bhatti', 'butt', 'chohan', 'danish', 'farooq', 'ghani', 'haider',
  'hamid', 'hashmi', 'hassan', 'hayat', 'hussain', 'imran', 'iqbal', 'irfan', 'jamil', 'jawad',
  'khalid', 'latif', 'mahmood', 'mansoor', 'masood', 'memon', 'mirza', 'mohsin', 'nadeem',
  'naseem', 'naveed', 'nazir', 'qadri', 'qamar', 'qazi', 'raees', 'rafiq', 'raheel', 'raiyan',
  'rameez', 'rashad', 'rayyan', 'rizwan', 'sabir', 'sadiq', 'sajid', 'saleem', 'salim',
  'samad', 'shafiq', 'shahzad', 'shakir', 'sharif', 'taha', 'tahir', 'tariq', 'taufiq',
  'waqar', 'waqas', 'waseem', 'yasir', 'younis', 'yusuf', 'zafar', 'zahid', 'zain', 'zaki',
  'zaman', 'zubair', 'zulfiqar'
];

// Non-American name patterns
const nonAmericanPatterns = [
  /[^\x00-\x7F]/,  // Non-ASCII characters
  /^[A-Z][a-z]+ [A-Z][a-z]+ [A-Z]/,  // Three-part names
  /\b(bin |bint |ibn |al-|el-|de la |van |von |del )/i,  // Common prefixes
  /[ก-๙]|[一-龯]|[あ-ん]|[가-힣]|[А-Я]/,  // Thai, Chinese, Japanese, Korean, Cyrillic
];

// Brown emoji patterns (skin tone modifiers)
const brownEmojiPatterns = [
  '\u{1F3FD}',  // Medium skin tone
  '\u{1F3FE}',  // Medium-dark skin tone
  '\u{1F3FF}',  // Dark skin tone
];

// Human-like random delay
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Human-like mouse movement simulation
function humanLikeMouseMove(element) {
  if (!currentSettings.humanLikeMouse) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return Promise.resolve();
  }
  
  return new Promise((resolve) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    
    // Simulate mouse movement with slight randomness
    const steps = 10 + Math.random() * 10;
    const startX = window.innerWidth / 2;
    const startY = window.innerHeight / 2;
    
    let currentStep = 0;
    const moveInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const easeProgress = progress * (2 - progress); // Ease out
      
      const currentX = startX + (x - startX) * easeProgress + (Math.random() - 0.5) * 5;
      const currentY = startY + (y - startY) * easeProgress + (Math.random() - 0.5) * 5;
      
      // Dispatch mouse move event
      document.dispatchEvent(new MouseEvent('mousemove', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: currentX,
        clientY: currentY
      }));
      
      if (currentStep >= steps) {
        clearInterval(moveInterval);
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(resolve, randomDelay(50, 150));
      }
    }, 10);
  });
}

// Human-like click with hover
async function humanLikeClick(element) {
  await humanLikeMouseMove(element);
  await new Promise(resolve => setTimeout(resolve, randomDelay(100, 300)));
  
  // Hover first
  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, randomDelay(50, 150)));
  
  // Click
  element.click();
  await new Promise(resolve => setTimeout(resolve, randomDelay(50, 150)));
}

// Check if name sounds non-American
function isNonAmericanName(name, username) {
  const textToCheck = `${name} ${username}`.toLowerCase();
  
  // Check for Middle Eastern names (English spellings)
  const nameParts = textToCheck.split(/\s+/);
  for (const part of nameParts) {
    if (middleEasternNames.includes(part.toLowerCase())) {
      return true;
    }
  }
  
  // Check for non-American patterns
  for (const pattern of nonAmericanPatterns) {
    if (pattern.test(textToCheck)) {
      return true;
    }
  }
  
  return false;
}

// Check if name sounds female
function isFemaleName(name, username) {
  const textToCheck = `${name} ${username}`.toLowerCase();
  const firstWord = name.split(/\s+/)[0].toLowerCase();
  
  // Common female first names (most common American female names)
  const commonFemaleFirstNames = [
    'sarah', 'emily', 'jessica', 'jennifer', 'amanda', 'melissa', 'michelle', 'stephanie', 
    'nicole', 'elizabeth', 'ashley', 'samantha', 'lauren', 'rachel', 'lisa', 'kimberly', 
    'rebecca', 'katherine', 'amy', 'angela', 'maria', 'christina', 'kelly', 'susan', 'nancy', 
    'karen', 'betty', 'helen', 'sandra', 'donna', 'carol', 'ruth', 'sharon', 'laura', 
    'deborah', 'sophia', 'emma', 'olivia', 'ava', 'isabella', 'mia', 'charlotte', 'amelia', 
    'harper', 'evelyn', 'abigail', 'ella', 'mila', 'avery', 'camila', 'aria', 'scarlett', 
    'victoria', 'madison', 'luna', 'grace', 'chloe', 'penelope', 'layla', 'zoey', 'nora', 
    'eleanor', 'hannah', 'lillian', 'addison', 'aubrey', 'ellie', 'stella', 'natalie', 
    'leah', 'hazel', 'violet', 'aurora', 'savannah', 'audrey', 'brooklyn', 'bella', 'claire', 
    'skylar', 'lucy', 'paisley', 'everly', 'anna', 'caroline', 'nova', 'genesis', 'aaliyah', 
    'kennedy', 'kinsley', 'allison', 'maya', 'willow', 'naomi', 'elena', 'ariana', 'gabriella', 
    'alice', 'madelyn', 'cora', 'ruby', 'eva', 'serenity', 'autumn', 'adeline', 'hailey', 
    'gianna', 'valentina', 'isla', 'quinn', 'nevaeh', 'ivy', 'sadie', 'piper', 'lydia', 
    'alexa', 'josephine', 'emilia', 'ariel', 'eliana', 'catherine', 'peyton', 'rylee', 
    'mackenzie', 'aubree', 'brianna', 'makenzie', 'payton', 'delilah', 'isabelle', 'jocelyn', 
    'kylie', 'morgan', 'julia', 'kaylee', 'destiny', 'bailey', 'riley', 'zoe', 'alexis', 
    'jasmine', 'alexandra', 'brooke', 'kayla', 'taylor', 'sydney', 'kaitlyn', 'andrea', 
    'vanessa', 'brittany', 'danielle', 'mother', 'mom', 'mommy', 'mama', 'wife', 'wifey',
    'kam' // From the log - "Kam Smalls" appears to be female
  ];
  
  // Check if first name is in female names list
  if (commonFemaleFirstNames.includes(firstWord)) {
    return true;
  }
  
  // Check for female indicators in username
  const femaleUsernameIndicators = [
    /princess|queen|goddess|barbie|doll|girly|girl|miss|mrs|ms|mom|mommy|mama|wife|wifey|babe|babygirl|cutie|sweetie|honey|beauty|pretty|gorgeous|diva|doll|angel|butterfly|flower|rose|lily/i,
    /^[a-z]+(a|ia|ella|ina|ana|ena|elle|ette)$/i, // Ends with common female suffix
  ];
  
  for (const pattern of femaleUsernameIndicators) {
    if (pattern.test(username)) {
      return true;
    }
  }
  
  // Check for female name endings in first name
  const femaleEndings = /(a|ia|ella|ina|ana|ena|elle|ette|elle)$/i;
  if (femaleEndings.test(firstWord) && firstWord.length > 3) {
    return true;
  }
  
  return false;
}

// Check for brown emoji
function hasBrownEmoji(text) {
  for (const pattern of brownEmojiPatterns) {
    if (text.includes(pattern)) {
      return true;
    }
  }
  return false;
}

// Debug: Log button information
function debugButtons() {
  const allButtons = Array.from(document.querySelectorAll('button'));
  console.log(`\n=== BUTTON DEBUG ===`);
  console.log(`Found ${allButtons.length} total buttons`);
  
  const visibleButtons = allButtons.filter(btn => btn.offsetParent !== null);
  console.log(`Found ${visibleButtons.length} visible buttons\n`);
  
  visibleButtons.forEach((btn, idx) => {
    const text = btn.textContent.trim();
    const ariaLabel = btn.getAttribute('aria-label') || '';
    const title = btn.getAttribute('title') || '';
    const className = btn.className || '';
    const hasSvg = btn.querySelector('svg') !== null;
    
    // Determine button type
    let buttonType = 'UNKNOWN';
    const textLower = text.toLowerCase();
    const ariaLower = ariaLabel.toLowerCase();
    const titleLower = title.toLowerCase();
    
    if (textLower.includes('accept') || ariaLower.includes('accept') || 
        textLower.includes('add friend') || ariaLower.includes('add friend')) {
      buttonType = 'ACCEPT';
    } else if (textLower.includes('ignore') || ariaLower.includes('ignore') ||
               textLower.includes('dismiss') || ariaLower.includes('dismiss') ||
               text === '×' || text === 'x') {
      buttonType = 'IGNORE';
    } else if (textLower === 'friends' || ariaLower === 'friends' ||
               (textLower.includes('friend') && !textLower.includes('add') && !textLower.includes('accept'))) {
      buttonType = 'FRIENDS (EXCLUDED)';
    } else if (hasSvg) {
      buttonType = 'ICON BUTTON';
    }
    
    console.log(`Button ${idx + 1} [${buttonType}]:`, {
      text: text.substring(0, 40),
      ariaLabel: ariaLabel.substring(0, 40),
      title: title.substring(0, 40),
      className: className.substring(0, 50),
      hasSvg,
      parent: btn.parentElement?.tagName,
      rect: btn.getBoundingClientRect()
    });
  });
  
  console.log(`\n=== END DEBUG ===\n`);
}

// Find all buttons and create comprehensive log for sharing
function findAllButtonsLog() {
  const allButtons = Array.from(document.querySelectorAll('button'));
  const visibleButtons = allButtons.filter(btn => btn.offsetParent !== null);
  
  const logData = {
    timestamp: new Date().toISOString(),
    url: window.location.href,
    totalButtons: allButtons.length,
    visibleButtons: visibleButtons.length,
    buttons: []
  };
  
  // Also try to find friend entries context
  const entries = findFriendEntries();
  logData.friendEntriesFound = entries.length;
  
  visibleButtons.forEach((btn, idx) => {
    const rect = btn.getBoundingClientRect();
    const text = btn.textContent.trim();
    const ariaLabel = btn.getAttribute('aria-label') || '';
    const title = btn.getAttribute('title') || '';
    const id = btn.getAttribute('id') || '';
    const className = btn.className || '';
    const role = btn.getAttribute('role') || '';
    const type = btn.getAttribute('type') || '';
    
    // Get SVG info
    const svg = btn.querySelector('svg');
    let svgInfo = null;
    if (svg) {
      const paths = svg.querySelectorAll('path');
      const pathData = Array.from(paths).map(p => p.getAttribute('d') || '').filter(Boolean);
      svgInfo = {
        hasSvg: true,
        pathCount: paths.length,
        pathData: pathData.slice(0, 3), // First 3 paths
        viewBox: svg.getAttribute('viewBox') || '',
        width: svg.getAttribute('width') || '',
        height: svg.getAttribute('height') || ''
      };
    }
    
    // Get parent info
    let parentInfo = null;
    let currentParent = btn.parentElement;
    let depth = 0;
    while (currentParent && depth < 5) {
      const parentText = currentParent.textContent?.trim() || '';
      if (parentText.length > 0 && parentText.length < 200) {
        parentInfo = {
          tagName: currentParent.tagName,
          className: currentParent.className || '',
          id: currentParent.getAttribute('id') || '',
          textPreview: parentText.substring(0, 100)
        };
        break;
      }
      currentParent = currentParent.parentElement;
      depth++;
    }
    
    // Check if button is in a friend entry
    let inFriendEntry = false;
    let friendEntryInfo = null;
    for (const entry of entries) {
      if (entry.contains(btn)) {
        inFriendEntry = true;
        const { name, username } = extractFriendInfo(entry);
        friendEntryInfo = { name, username };
        break;
      }
    }
    
    // Determine button type
    let buttonType = 'UNKNOWN';
    const textLower = text.toLowerCase();
    const ariaLower = ariaLabel.toLowerCase();
    const titleLower = title.toLowerCase();
    const hasSvg = svg !== null;
    
    if (textLower.includes('accept') || ariaLower.includes('accept') || 
        textLower.includes('add friend') || ariaLower.includes('add friend')) {
      buttonType = 'ACCEPT';
    } else if (textLower.includes('ignore') || ariaLower.includes('ignore') ||
               textLower.includes('dismiss') || ariaLower.includes('dismiss') ||
               text === '×' || text === 'x') {
      buttonType = 'IGNORE';
    } else if (textLower === 'friends' || ariaLower === 'friends' ||
               (textLower.includes('friend') && !textLower.includes('add') && !textLower.includes('accept'))) {
      buttonType = 'FRIENDS';
    } else if (hasSvg) {
      buttonType = 'ICON';
    }
    
    const buttonData = {
      index: idx + 1,
      type: buttonType,
      text: text,
      ariaLabel: ariaLabel,
      title: title,
      id: id,
      className: className,
      role: role,
      typeAttr: type,
      position: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      svg: svgInfo,
      parent: parentInfo,
      inFriendEntry: inFriendEntry,
      friendEntry: friendEntryInfo
    };
    
    logData.buttons.push(buttonData);
  });
  
  // Create formatted log string
  let logString = '=== SNAPCHAT BUTTON LOG ===\n\n';
  logString += `Timestamp: ${logData.timestamp}\n`;
  logString += `URL: ${logData.url}\n`;
  logString += `Total Buttons: ${logData.totalButtons}\n`;
  logString += `Visible Buttons: ${logData.visibleButtons}\n`;
  logString += `Friend Entries Found: ${logData.friendEntriesFound}\n\n`;
  logString += '=== BUTTONS ===\n\n';
  
  logData.buttons.forEach((btn, idx) => {
    logString += `--- Button ${idx + 1} [${btn.type}] ---\n`;
    logString += `Text: "${btn.text}"\n`;
    logString += `Aria Label: "${btn.ariaLabel}"\n`;
    logString += `Title: "${btn.title}"\n`;
    logString += `ID: "${btn.id}"\n`;
    logString += `Class: "${btn.className}"\n`;
    logString += `Role: "${btn.role}"\n`;
    logString += `Position: x=${btn.position.x}, y=${btn.position.y}, w=${btn.position.width}, h=${btn.position.height}\n`;
    
    if (btn.svg) {
      logString += `SVG: ${btn.svg.pathCount} paths, viewBox="${btn.svg.viewBox}"\n`;
    }
    
    if (btn.parent) {
      logString += `Parent: <${btn.parent.tagName}> class="${btn.parent.className.substring(0, 50)}" text="${btn.parent.textPreview.substring(0, 50)}"\n`;
    }
    
    if (btn.inFriendEntry && btn.friendEntry) {
      logString += `In Friend Entry: ${btn.friendEntry.name} (@${btn.friendEntry.username})\n`;
    }
    
    logString += '\n';
  });
  
  logString += '=== END LOG ===\n';
  logString += '\n--- JSON FORMAT (for easy parsing) ---\n';
  logString += JSON.stringify(logData, null, 2);
  
  return logString;
}

// Find Accept button - handles both text and icon buttons
// Excludes "Friends" button and other non-Accept buttons
function findAcceptButton(container) {
  const buttons = Array.from(container.querySelectorAll('button')).filter(btn => btn.offsetParent !== null);
  
  // Method 1: Text-based detection (most reliable)
  for (const btn of buttons) {
    const text = btn.textContent.trim().toLowerCase();
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    
    // Explicitly exclude "Friends" button
    if (text.includes('friend') && !text.includes('add') && !text.includes('accept') && 
        !ariaLabel.includes('add') && !ariaLabel.includes('accept')) {
      continue; // Skip Friends button
    }
    
    // Look for Accept/Add Friend indicators
    if (text.includes('accept') || text.includes('add friend') || 
        ariaLabel.includes('accept') || ariaLabel.includes('add friend') ||
        title.includes('accept') || title.includes('add friend')) {
      return btn;
    }
  }
  
  // Method 2: Icon-based detection (person with plus icon)
  // Look for button with SVG that might be "add friend" icon
  for (const btn of buttons) {
    const text = btn.textContent.trim().toLowerCase();
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    
    // Skip Friends button
    if ((text.includes('friend') || ariaLabel.includes('friend') || title.includes('friend')) &&
        !text.includes('add') && !ariaLabel.includes('add') && !title.includes('add') &&
        !text.includes('accept') && !ariaLabel.includes('accept') && !title.includes('accept')) {
      continue;
    }
    
    const svg = btn.querySelector('svg');
    if (svg) {
      // Check aria-label or title for hints
      const label = `${ariaLabel} ${title}`.toLowerCase();
      if (label.includes('add') || label.includes('accept')) {
        return btn;
      }
      
      // Check if SVG contains paths that might indicate person/add icon
      const paths = svg.querySelectorAll('path');
      const pathData = Array.from(paths).map(p => p.getAttribute('d') || '').join(' ');
      
      // Person icon often has curved paths, plus icon has straight lines
      // Accept button likely has both person and plus
      if (pathData.length > 50) { // Complex icon likely
        // Additional check: look for plus-like patterns in path data
        if (pathData.includes('M') && pathData.includes('L') && paths.length > 2) {
          return btn;
        }
      }
    }
  }
  
  // Method 3: Position-based (Accept is usually NOT the first button if Friends button exists)
  // Filter out Friends button first
  const nonFriendsButtons = buttons.filter(btn => {
    const text = btn.textContent.trim().toLowerCase();
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    return !(text === 'friends' || ariaLabel === 'friends' || 
             (text.includes('friend') && !text.includes('add') && !text.includes('accept')));
  });
  
  // Accept button is usually second or third button (after Friends button)
  if (nonFriendsButtons.length >= 1) {
    // Try second button first (most common position)
    if (nonFriendsButtons.length >= 2) {
      return nonFriendsButtons[1];
    }
    return nonFriendsButtons[0];
  }
  
  return null;
}

// Find friend entries - improved detection based on actual Snapchat structure
function findFriendEntries() {
  // Method 1: Look for buttons with "Accept" or "Add Friend" text/aria-label
  const allButtons = Array.from(document.querySelectorAll('button'));
  
  // Method 2: Also look for containers that might hold friend requests
  // Check for common patterns in friend request lists
  const possibleContainers = document.querySelectorAll('div[class*="item"], div[class*="friend"], div[class*="suggestion"], div[class*="request"], div[class*="row"], div[class*="entry"], div[class*="card"], div[class*="list-item"]');
  
  // Method 3: Look for containers with buttons that have person/add icons
  // (Accept buttons often have person+plus icon)
  
  // Find Accept buttons (text or icon-based)
  // Exclude "Friends" button explicitly
  const acceptButtons = [];
  
  for (const btn of allButtons) {
    if (btn.offsetParent === null) continue; // Skip hidden buttons
    
    const text = btn.textContent.trim().toLowerCase();
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    
    // Explicitly exclude "Friends" button
    if ((text === 'friends' || ariaLabel === 'friends' || title === 'friends') ||
        (text.includes('friend') && !text.includes('add') && !text.includes('accept') &&
         !ariaLabel.includes('add') && !ariaLabel.includes('accept'))) {
      continue; // Skip Friends button
    }
    
    // Text-based detection
    if (text.includes('accept') || text.includes('add friend') ||
        ariaLabel.includes('accept') || ariaLabel.includes('add friend') ||
        title.includes('accept') || title.includes('add friend')) {
      acceptButtons.push(btn);
      continue;
    }
    
    // Class-based detection (from log: "F7jpS eKaL7 Bnaur zUzvu" for Accept buttons)
    const className = btn.className || '';
    if (className.includes('F7jpS') && text.toLowerCase() === 'accept') {
      acceptButtons.push(btn);
      continue;
    }
    
    // Icon-based detection - look for person+plus icon
    const svg = btn.querySelector('svg');
    if (svg) {
      const label = `${ariaLabel} ${title}`.toLowerCase();
      // Make sure it's not Friends button
      if (!label.includes('friend') || label.includes('add') || label.includes('accept')) {
        if (label.includes('add') || label.includes('accept')) {
          acceptButtons.push(btn);
          continue;
        }
        
        // Check if it's likely an add friend icon (has both person and plus elements)
        const paths = svg.querySelectorAll('path');
        if (paths.length > 2) { // Complex icon
          const pathData = Array.from(paths).map(p => p.getAttribute('d') || '').join(' ');
          // Check if parent container has friend-related text (but not just "Friends")
          let parent = btn.parentElement;
          let depth = 0;
          while (parent && depth < 3) {
            const parentText = parent.textContent || '';
            if (parentText.length > 5 && parentText.length < 200) {
              // Make sure parent doesn't just say "Friends"
              if (!parentText.toLowerCase().trim().startsWith('friends')) {
                acceptButtons.push(btn);
                break;
              }
            }
            parent = parent.parentElement;
            depth++;
          }
        }
      }
    }
  }
  
  if (acceptButtons.length === 0) {
    console.log('No Accept buttons found. This might mean:');
    console.log('1. Friend requests page is not open yet');
    console.log('2. No friend requests available');
    console.log('3. Friend requests are in a different structure');
    return [];
  }
  
  console.log(`Found ${acceptButtons.length} Accept buttons`);
  
  // Get parent containers for each Accept button
  const entries = acceptButtons.map(btn => {
    // Find the closest container that likely holds the full friend entry
    let container = btn.closest('div[class*="item"], div[class*="friend"], div[class*="suggestion"], div[class*="request"], div[class*="row"], div[class*="entry"]');
    
    // If no specific container, go up the DOM tree to find a reasonable parent
    if (!container) {
      let parent = btn.parentElement;
      let depth = 0;
      while (parent && parent !== document.body && depth < 6) {
        // Look for a div that contains both the button and likely has name/username
        if (parent.tagName === 'DIV' || parent.tagName === 'LI') {
          const text = parent.textContent.trim();
          // Friend entry should have some text but not too much
          if (text.length > 10 && text.length < 500 && parent.children.length >= 2) {
            container = parent;
            break;
          }
        }
        parent = parent.parentElement;
        depth++;
      }
      if (!container) container = btn.parentElement;
    }
    
    return container;
  }).filter(Boolean);
  
  // Remove duplicates (same container might have multiple buttons)
  const uniqueEntries = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!seen.has(entry)) {
      seen.add(entry);
      uniqueEntries.push(entry);
    }
  }
  
  return uniqueEntries;
}

// Extract name and username from friend entry
function extractFriendInfo(entry) {
  let name = '';
  let username = '';
  const fullText = entry.textContent || entry.innerText || '';
  
  // Try to find structured elements
  const nameEl = entry.querySelector('[class*="name"]:not([class*="username"])');
  const usernameEl = entry.querySelector('[class*="username"]');
  
  if (nameEl) name = nameEl.textContent.trim();
  if (usernameEl) username = usernameEl.textContent.trim().replace('@', '');
  
  // Parse from text if not found
  if (!name || !username) {
    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length >= 1) name = lines[0];
    if (lines.length >= 2) {
      // Find username (usually contains @ or is second line)
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].includes('@') || /^[a-z0-9._]+$/i.test(lines[i])) {
          username = lines[i].replace('@', '').trim();
          break;
        }
      }
    }
  }
  
  // Extract username from text if still not found
  if (!username) {
    const usernameMatch = fullText.match(/@?([a-z0-9._]+)/i);
    if (usernameMatch) username = usernameMatch[1];
  }
  
  return { name, username, fullText };
}

// Handle ignore confirmation dialog
async function handleIgnoreConfirmation() {
  await new Promise(resolve => setTimeout(resolve, randomDelay(200, 400)));
  
  // Look for confirmation dialog - button with class "tXFz7" and text "Ignore" (from log)
  const allButtons = Array.from(document.querySelectorAll('button'));
  let ignoreBtn = allButtons.find(btn => {
    if (btn.offsetParent === null) return false;
    const text = btn.textContent.trim();
    const className = btn.className || '';
    // Look for button with class "tXFz7" and text "Ignore"
    return className.includes('tXFz7') && text === 'Ignore';
  });
  
  // Fallback: text-based detection
  if (!ignoreBtn) {
    ignoreBtn = allButtons.find(btn => {
      if (btn.offsetParent === null) return false;
      const text = btn.textContent.trim();
      return text === 'Ignore' && !text.includes('Cancel');
    });
  }
  
  if (ignoreBtn) {
    try {
      await humanLikeClick(ignoreBtn);
      await new Promise(resolve => setTimeout(resolve, randomDelay(300, 600)));
      return true;
    } catch (e) {
      console.error('Error clicking ignore confirmation:', e);
    }
  }
  
  return false;
}

// Process a single friend entry
async function processFriendEntry(entry) {
  try {
    const { name, username, fullText } = extractFriendInfo(entry);
    
    // Skip if already processed
    if (username && processedUsernames.has(username.toLowerCase())) {
      return false;
    }
    
    if (username) {
      processedUsernames.add(username.toLowerCase());
    }
    
    console.log(`Processing: ${name} (@${username})`);
    
    // Check if entry still has Accept button (not already processed)
    const acceptBtn = findAcceptButton(entry);
    if (!acceptBtn || acceptBtn.offsetParent === null) {
      return false; // Already processed or no Accept button
    }
    
    // Check if should ignore (non-American OR female)
    let shouldIgnore = false;
    let reason = '';
    
    if (currentSettings.filterBrownEmoji && hasBrownEmoji(fullText)) {
      shouldIgnore = true;
      reason = 'Brown emoji detected';
    }
    
    if (currentSettings.filterNonAmerican && isNonAmericanName(name, username)) {
      shouldIgnore = true;
      reason = 'Non-American name pattern';
    }
    
    // Check if female (always filter females)
    if (isFemaleName(name, username)) {
      shouldIgnore = true;
      reason = 'Female name detected';
    }
    
    if (shouldIgnore) {
      // Find X/ignore button - look for buttons that are not Accept
      // Also check for clickable divs/spans that might be the decline button
      const allButtons = Array.from(entry.querySelectorAll('button')).filter(btn => btn.offsetParent !== null);
      const allClickables = Array.from(entry.querySelectorAll('[role="button"], [onclick], [tabindex="0"]')).filter(el => el.offsetParent !== null);
      const allElements = [...allButtons, ...allClickables];
      let ignoreBtn = null;
      
      // Method 1: Text/aria-label based detection
      for (const btn of allElements) {
        const text = btn.textContent.trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        const className = (btn.className || '').toLowerCase();
        
        if (text.includes('ignore') || text.includes('dismiss') || text === '×' || text === 'x' ||
            ariaLabel.includes('ignore') || ariaLabel.includes('dismiss') || ariaLabel.includes('close') ||
            title.includes('ignore') || title.includes('dismiss') ||
            className.includes('close') || className.includes('dismiss') || className.includes('ignore')) {
          ignoreBtn = btn;
          break;
        }
      }
      
      // Method 2: Icon-based detection - look for X icon (SVG)
      if (!ignoreBtn) {
        const acceptBtn = findAcceptButton(entry);
        for (const btn of allElements) {
          // Skip Accept button and Friends button
          if (btn === acceptBtn) continue;
          
          const text = btn.textContent.trim().toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          if ((text === 'friends' || ariaLabel === 'friends') ||
              (text.includes('friend') && !text.includes('ignore') && !text.includes('dismiss'))) {
            continue; // Skip Friends button
          }
          
          const svg = btn.querySelector('svg');
          if (svg) {
            // X icon typically has simple paths (1-2 paths, often crossing lines)
            const paths = svg.querySelectorAll('path, line, polyline');
            const pathCount = paths.length;
            const viewBox = svg.getAttribute('viewBox') || '';
            
            // X icon is usually simple (1-2 paths) and often has viewBox like "0 0 24 24" or "0 0 14 14"
            if (pathCount >= 1 && pathCount <= 3) {
              // Check if it's not the Accept button
              if (!text.includes('accept') && !ariaLabel.includes('accept') && !ariaLabel.includes('add')) {
                // Check path data for X pattern (crossing lines)
                const pathData = Array.from(paths).map(p => p.getAttribute('d') || '').join(' ');
                // X icons often have M (move) and L (line) commands that cross
                if (pathData.includes('M') && (pathData.includes('L') || pathData.includes('l'))) {
                  ignoreBtn = btn;
                  break;
                }
              }
            }
          }
        }
      }
      
      // Method 3: Look for small icon buttons (X buttons are usually small, 24-36px)
      if (!ignoreBtn) {
        const acceptBtn = findAcceptButton(entry);
        for (const btn of allElements) {
          if (btn === acceptBtn) continue;
          
          const rect = btn.getBoundingClientRect();
          const text = btn.textContent.trim().toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          
          // Skip Friends button
          if ((text === 'friends' || ariaLabel === 'friends') ||
              (text.includes('friend') && !text.includes('ignore') && !text.includes('dismiss'))) {
            continue;
          }
          
          // X buttons are usually small square buttons (24-36px)
          if (rect.width <= 40 && rect.height <= 40 && rect.width >= 20 && rect.height >= 20) {
            // Check if it has an SVG (icon button)
            if (btn.querySelector('svg')) {
              ignoreBtn = btn;
              break;
            }
          }
        }
      }
      
      // Method 4: Position-based - X button is usually last or second-to-last
      // Exclude Friends button and Accept button
      if (!ignoreBtn && allElements.length > 1) {
        const acceptBtn = findAcceptButton(entry);
        // Reverse order to check last elements first
        for (let i = allElements.length - 1; i >= 0; i--) {
          const btn = allElements[i];
          if (btn === acceptBtn) continue; // Skip Accept button
          
          const text = btn.textContent.trim().toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          
          // Skip Friends button
          if ((text === 'friends' || ariaLabel === 'friends') ||
              (text.includes('friend') && !text.includes('ignore') && !text.includes('dismiss'))) {
            continue;
          }
          
          // This should be the ignore button
          ignoreBtn = btn;
          break;
        }
      }
      
      // Method 5: Last resort - any visible element that's not Accept or Friends
      if (!ignoreBtn) {
        const acceptBtn = findAcceptButton(entry);
        ignoreBtn = allElements.find(btn => {
          if (btn === acceptBtn) return false;
          const text = btn.textContent.trim().toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          return !((text === 'friends' || ariaLabel === 'friends') ||
                   (text.includes('friend') && !text.includes('ignore') && !text.includes('dismiss')));
        });
      }
      
      if (ignoreBtn && ignoreBtn.offsetParent !== null) {
        try {
          console.log(`  Found ignore button, clicking...`);
          await humanLikeClick(ignoreBtn);
          await handleIgnoreConfirmation();
          console.log(`  ✓ Ignored: ${reason} - ${name} (@${username})`);
          return true;
        } catch (e) {
          console.error(`  Error ignoring ${name}:`, e);
        }
      } else {
        // Log all buttons in entry for debugging
        console.log(`  ⚠ Could not find ignore button for ${name}`);
        console.log(`  Available buttons in entry:`, allElements.map(btn => ({
          tag: btn.tagName,
          text: btn.textContent.trim(),
          ariaLabel: btn.getAttribute('aria-label'),
          className: btn.className,
          hasSvg: !!btn.querySelector('svg')
        })));
        
        // Last resort: Try clicking any button that's not Accept (might trigger menu)
        const acceptBtn = findAcceptButton(entry);
        const otherButtons = allElements.filter(btn => btn !== acceptBtn && btn.offsetParent !== null);
        if (otherButtons.length > 0) {
          console.log(`  Trying fallback: clicking first non-Accept button`);
          try {
            await humanLikeClick(otherButtons[0]);
            await new Promise(resolve => setTimeout(resolve, 500));
            // Check if confirmation dialog appeared
            await handleIgnoreConfirmation();
            console.log(`  ✓ Ignored (fallback): ${reason} - ${name} (@${username})`);
            return true;
          } catch (e) {
            console.error(`  Fallback failed for ${name}:`, e);
          }
        }
      }
    } else {
      // Accept the friend request
      const acceptBtn = findAcceptButton(entry);
      if (acceptBtn && acceptBtn.offsetParent !== null) {
        try {
          await humanLikeClick(acceptBtn);
          console.log(`  ✓ Accepted: ${name} (@${username}) - American male`);
          return false; // Not ignored, but processed
        } catch (e) {
          console.error(`  Error accepting ${name}:`, e);
        }
      } else {
        console.log(`  ⚠ Could not find accept button for ${name}`);
      }
    }
  } catch (e) {
    console.error('Error processing friend entry:', e);
  }
  
  return false;
}

// Scroll friend list - only when bot is running
async function scrollFriendList() {
  if (!isRunning) return false;
  
  // Temporarily allow scrolling for bot
  const wasBlocked = userInteractionBlocked;
  if (wasBlocked) {
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';
  }
  
  try {
    // Find scrollable container - look for friend requests list
    const scrollSelectors = [
      'div[class*="scroll"]',
      'div[class*="list"]',
      'div[class*="container"]',
      'div[role="list"]',
      'div[role="listbox"]',
      // Look for container that has Accept buttons
      'div:has(button.F7jpS)',
    ];
    
    let scrollContainer = null;
    for (const selector of scrollSelectors) {
      try {
        scrollContainer = document.querySelector(selector);
        if (scrollContainer) {
          // Verify it's scrollable
          if (scrollContainer.scrollHeight > scrollContainer.clientHeight) {
            break;
          }
        }
      } catch (e) {
        // :has() selector might not be supported, skip
        continue;
      }
    }
    
    if (scrollContainer) {
      const lastHeight = scrollContainer.scrollHeight;
      scrollContainer.scrollTop += 500;
      await new Promise(resolve => setTimeout(resolve, currentSettings.scrollDelay));
      const scrolled = scrollContainer.scrollHeight !== lastHeight;
      
      // Re-block scrolling if it was blocked
      if (wasBlocked) {
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
      }
      return scrolled;
    } else {
      // Fallback: scroll window (but only if bot is running)
      const lastScrollY = window.scrollY;
      window.scrollBy(0, 500);
      await new Promise(resolve => setTimeout(resolve, currentSettings.scrollDelay));
      
      // Re-block scrolling if it was blocked
      if (wasBlocked) {
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
      }
      return window.scrollY !== lastScrollY;
    }
  } catch (e) {
    // Re-block scrolling if it was blocked
    if (wasBlocked) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }
    return false;
  }
}

// Find and click "View friend requests" button
async function openFriendRequests() {
  console.log('Looking for "View friend requests" button...');
  
  // Method 1: Find by title attribute
  const allButtons = Array.from(document.querySelectorAll('button'));
  let friendRequestsBtn = null;
  
  for (const btn of allButtons) {
    if (btn.offsetParent === null) continue; // Skip hidden
    
    const title = (btn.getAttribute('title') || '').toLowerCase();
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    const text = btn.textContent.trim().toLowerCase();
    
    if (title.includes('view friend request') || 
        title.includes('friend request') ||
        ariaLabel.includes('friend request') ||
        (text.includes('friend') && text.includes('request'))) {
      friendRequestsBtn = btn;
      console.log('Found "View friend requests" button by title/aria-label');
      break;
    }
  }
  
  // Method 2: Find by class name pattern (from the log: "kwuI_")
  if (!friendRequestsBtn) {
    for (const btn of allButtons) {
      if (btn.offsetParent === null) continue;
      const className = btn.className || '';
      // Look for button with friend request icon pattern
      if (className.includes('kwuI_') || className.includes('friend')) {
        const svg = btn.querySelector('svg');
        if (svg) {
          // Check if SVG has the friend request icon pattern (person with plus)
          const paths = svg.querySelectorAll('path');
          if (paths.length >= 2) {
            friendRequestsBtn = btn;
            console.log('Found "View friend requests" button by class/SVG pattern');
            break;
          }
        }
      }
    }
  }
  
  if (friendRequestsBtn) {
    try {
      console.log('Clicking "View friend requests" button...');
      await humanLikeClick(friendRequestsBtn);
      await new Promise(resolve => setTimeout(resolve, randomDelay(1000, 2000)));
      console.log('Friend requests should be open now');
      return true;
    } catch (e) {
      console.error('Error clicking friend requests button:', e);
      return false;
    }
  } else {
    console.log('Could not find "View friend requests" button - friend requests may already be open');
    return true; // Assume already open
  }
}

// Main processing loop
async function processFriendRequests() {
  if (!isRunning) return;
  
  // First, try to open friend requests if not already open
  const entries = findFriendEntries();
  if (entries.length === 0) {
    console.log('No friend entries found. Attempting to open friend requests...');
    await openFriendRequests();
    // Wait a bit for friend requests to load
    await new Promise(resolve => setTimeout(resolve, randomDelay(1500, 2500)));
  }
  
  let scrollCount = 0;
  let ignoredCount = 0;
  let processedCount = 0;
  
  while (isRunning && scrollCount < currentSettings.maxScrolls) {
    console.log(`\nScroll ${scrollCount + 1}/${currentSettings.maxScrolls}`);
    
    // Find friend entries
    const entries = findFriendEntries();
    
    if (entries.length === 0) {
      console.log('No friends found, scrolling...');
      await scrollFriendList();
      scrollCount++;
      continue;
    }
    
    // Process each entry
    for (const entry of entries) {
      if (!isRunning) break;
      
      try {
        const ignored = await processFriendEntry(entry);
        if (ignored) ignoredCount++;
        processedCount++;
        
        // Random delay between processing
        await new Promise(resolve => 
          setTimeout(resolve, randomDelay(currentSettings.minDelay, currentSettings.maxDelay))
        );
      } catch (e) {
        console.error('Error processing entry:', e);
      }
    }
    
    // Scroll to load more
    await scrollFriendList();
    scrollCount++;
    
    // Delay between scrolls
    await new Promise(resolve => 
      setTimeout(resolve, randomDelay(currentSettings.minDelay, currentSettings.maxDelay))
    );
  }
  
  console.log(`\nProcessing complete! Processed: ${processedCount}, Ignored: ${ignoredCount}`);
  isRunning = false;
  
  // Re-enable user interaction
  allowUserInteraction();
  
  // Notify popup and panel
  chrome.runtime.sendMessage({
    action: 'statusUpdate',
    status: 'stopped',
    message: `Complete! Processed: ${processedCount}, Ignored: ${ignoredCount}`
  });
  
  // Also notify panel iframe directly
  if (panelIframe && panelIframe.contentWindow) {
    try {
      panelIframe.contentWindow.postMessage({
        action: 'statusUpdate',
        status: 'stopped',
        message: `Complete! Processed: ${processedCount}, Ignored: ${ignoredCount}`
      }, '*');
    } catch (e) {
      // Cross-origin or iframe not ready
    }
  }
}

// Verify we're on Snapchat web
function verifySnapchatWeb() {
  const url = window.location.href;
  return url.includes('snapchat.com') || url.includes('web.snapchat.com');
}

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Always respond to verify the script is loaded
  if (!verifySnapchatWeb()) {
    sendResponse({ success: false, error: 'Not on Snapchat web. Current URL: ' + window.location.href });
    return true;
  }
  
  if (message.action === 'start') {
    if (isRunning) {
      sendResponse({ success: false, message: 'Already running' });
      return true;
    }
    
    currentSettings = message.settings;
    isRunning = true;
    processedUsernames.clear();
    
    // Prevent user interaction
    preventUserInteraction();
    
    processFriendRequests();
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'stop') {
    isRunning = false;
    allowUserInteraction();
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'getStatus') {
    sendResponse({ running: isRunning });
    return true;
  } else if (message.action === 'debug') {
    debugButtons();
    const entries = findFriendEntries();
    console.log(`\n=== FRIEND ENTRIES DEBUG ===`);
    console.log(`Found ${entries.length} friend entries\n`);
    
    entries.forEach((entry, idx) => {
      const { name, username } = extractFriendInfo(entry);
      const acceptBtn = findAcceptButton(entry);
      const allButtons = Array.from(entry.querySelectorAll('button')).filter(btn => btn.offsetParent !== null);
      
      console.log(`\nEntry ${idx + 1}: ${name} (@${username})`);
      console.log(`  Total visible buttons: ${allButtons.length}`);
      console.log(`  Accept button found: ${acceptBtn ? 'YES' : 'NO'}`);
      
      if (acceptBtn) {
        const acceptText = acceptBtn.textContent.trim();
        const acceptAria = acceptBtn.getAttribute('aria-label') || '';
        console.log(`  Accept button: "${acceptText}" (aria: "${acceptAria}")`);
      }
      
      console.log(`  All buttons in entry:`);
      allButtons.forEach((btn, btnIdx) => {
        const text = btn.textContent.trim();
        const ariaLabel = btn.getAttribute('aria-label') || '';
        const isAccept = btn === acceptBtn;
        const isFriends = (text.toLowerCase() === 'friends' || 
                          (text.toLowerCase().includes('friend') && 
                           !text.toLowerCase().includes('add') && 
                           !text.toLowerCase().includes('accept')));
        
        let btnType = 'OTHER';
        if (isAccept) btnType = 'ACCEPT';
        else if (isFriends) btnType = 'FRIENDS (EXCLUDED)';
        else if (text.toLowerCase().includes('ignore') || text.toLowerCase().includes('dismiss')) btnType = 'IGNORE';
        
        console.log(`    Button ${btnIdx + 1} [${btnType}]: "${text.substring(0, 30)}" (aria: "${ariaLabel.substring(0, 30)}")`);
      });
    });
    
    console.log(`\n=== END ENTRIES DEBUG ===\n`);
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'findAllButtons') {
    try {
      const log = findAllButtonsLog();
      console.log('\n' + log);
      sendResponse({ success: true, log: log });
    } catch (e) {
      console.error('Error generating button log:', e);
      sendResponse({ success: false, error: e.message });
    }
    return true;
  } else if (message.action === 'openPanel') {
    try {
      createPanel();
      chrome.storage.local.set({ panelOpen: true }, () => {
        // Storage callback - ignore errors
      });
      sendResponse({ success: true });
    } catch (e) {
      console.error('Error opening panel:', e);
      sendResponse({ success: false, error: e.message });
    }
    return true;
  } else if (message.action === 'closePanel') {
    try {
      removePanel();
      chrome.storage.local.set({ panelOpen: false }, () => {
        // Storage callback - ignore errors
      });
      sendResponse({ success: true });
    } catch (e) {
      console.error('Error closing panel:', e);
      sendResponse({ success: false, error: e.message });
    }
    return true;
  } else if (message.action === 'togglePanel') {
    try {
      if (panelContainer && panelContainer.style.display !== 'none') {
        removePanel();
        chrome.storage.local.set({ panelOpen: false }, () => {});
        sendResponse({ success: true, visible: false });
      } else {
        createPanel();
        chrome.storage.local.set({ panelOpen: true }, () => {});
        sendResponse({ success: true, visible: true });
      }
    } catch (e) {
      console.error('Error toggling panel:', e);
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }
  
  } else if (message.action === 'togglePanel') {
    if (panelContainer && panelContainer.style.display !== 'none') {
      removePanel();
      sendResponse({ success: true, visible: false });
    } else {
      createPanel();
      sendResponse({ success: true, visible: true });
    }
    return true;
  }
  
  // Default response
  sendResponse({ success: false, error: 'Unknown action' });
  return true;
});

// Auto-open panel when page loads (if on Snapchat)
// Always open panel by default when Snapchat loads
// Use requestIdleCallback or setTimeout to not block page load
(function autoOpenPanel() {
  'use strict';
  
  // Don't run if not on Snapchat
  if (!verifySnapchatWeb()) {
    return;
  }
  
  // Wait for page to fully load before trying to create panel
  const tryCreatePanel = () => {
    try {
      // Only create panel if page is fully loaded
      if (document.readyState === 'complete' && document.body) {
        // Check if panel already exists
        const existing = document.getElementById('snapchat-filter-panel');
        if (existing) {
          existing.style.display = 'flex';
          console.log('✅ Panel already exists, showing it');
          return;
        }
        
        // Create panel asynchronously
        setTimeout(() => {
          try {
            createPanel();
            chrome.storage.local.set({ panelOpen: true }, () => {
              console.log('✅ Panel auto-opened on Snapchat page');
            });
          } catch (e) {
            console.error('Error creating panel:', e);
          }
        }, 100);
      } else {
        // Page not ready yet, try again
        setTimeout(tryCreatePanel, 500);
      }
    } catch (e) {
      console.error('Error in tryCreatePanel:', e);
    }
  };
  
  // Wait for page to be fully loaded
  if (document.readyState === 'complete') {
    // Page already loaded, wait a bit then create panel
    setTimeout(tryCreatePanel, 2000);
  } else {
    // Wait for page to load
    window.addEventListener('load', () => {
      setTimeout(tryCreatePanel, 2000);
    });
    
    // Backup: also try after DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(tryCreatePanel, 3000);
      });
    }
  }
})();

