# Snapchat Friend Filter Browser Extension

A Chrome/Edge browser extension that automatically filters Snapchat friend requests on Snapchat Web, ignoring profiles with non-American names or brown emoji.

## Features

- **Browser Extension** - No external scripts, works directly in the browser
- **Configurable Settings** - Adjust delays and behavior through a user-friendly panel
- **Human-like Behavior** - Random delays, smooth mouse movements, and natural interactions
- **Smart Filtering** - Detects non-American name patterns and brown emoji
- **Real-time Status** - See progress and statistics in the extension popup

## Installation

1. **Download/Clone** this extension folder

2. **Open Chrome/Edge Extensions Page:**
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`

3. **Enable Developer Mode** (toggle in top right)

4. **Load Extension:**
   - Click "Load unpacked"
   - Select this extension folder

5. **Create Icon Files** (or use placeholder):
   - Create `icon16.png`, `icon48.png`, `icon128.png` in the extension folder
   - Or download icons from any icon pack

## Usage

1. **Open Snapchat Web:**
   - Navigate to `https://web.snapchat.com`
   - Log in to your account

2. **Open Add Friends:**
   - Click the "Add Friends" button/modal in Snapchat

3. **Configure Extension:**
   - Click the extension icon in your browser toolbar
   - Adjust settings:
     - **Min/Max Delay**: Random delay range between actions (ms)
     - **Scroll Delay**: Delay after scrolling to load more (ms)
     - **Max Scrolls**: Maximum number of scroll operations
     - **Filter Options**: Toggle filtering for non-American names and brown emoji
     - **Human-like Mouse**: Enable smooth mouse movements

4. **Start Filtering:**
   - Click "Start Filtering" button
   - The extension will automatically scroll and process friend requests
   - Watch the status in the popup

5. **Stop Anytime:**
   - Click "Stop" button to pause/stop the process

## Settings Explained

- **Min Delay**: Minimum milliseconds between actions (recommended: 800-1000ms)
- **Max Delay**: Maximum milliseconds between actions (recommended: 2000-3000ms)
- **Scroll Delay**: Time to wait after scrolling for content to load (recommended: 1500ms)
- **Max Scrolls**: How many times to scroll through the list
- **Filter Non-American Names**: Enable/disable name pattern filtering
- **Filter Brown Emoji**: Enable/disable brown emoji detection
- **Human-like Mouse**: Simulates natural mouse movements (recommended: ON)

## How It Works

1. The extension uses content scripts to interact with the Snapchat web page
2. It finds friend entries by looking for "Accept" buttons
3. For each entry, it extracts the name and username
4. It checks against filtering criteria:
   - Non-American name patterns (non-ASCII, common prefixes, etc.)
   - Brown emoji (skin tone modifiers)
5. If a match is found, it clicks the ignore/X button
6. Handles confirmation dialogs automatically
7. Scrolls to load more entries and continues processing

## Filtering Criteria

### Non-American Names
- Non-ASCII characters (Chinese, Arabic, etc.)
- Three-part names
- Common prefixes (bin, ibn, al-, van, von, etc.)
- Non-Latin scripts (Thai, Chinese, Japanese, Korean, Cyrillic)

### Brown Emoji
- Medium skin tone (U+1F3FD)
- Medium-dark skin tone (U+1F3FE)
- Dark skin tone (U+1F3FF)

## Privacy & Security

- **No Data Collection**: The extension doesn't collect or send any data
- **Local Only**: All processing happens in your browser
- **No External Connections**: No network requests except to Snapchat
- **Open Source**: You can review all the code

## Troubleshooting

**Extension not working:**
- Make sure you're on `web.snapchat.com`
- Ensure the Add Friends modal is open
- Check browser console for errors (F12)

**Not finding friends:**
- Snapchat may have changed their HTML structure
- Check the console for selector issues
- You may need to update the selectors in `content.js`

**Too fast/slow:**
- Adjust the delay settings in the popup
- Increase delays if you're getting rate-limited
- Decrease delays if it's too slow (but be careful!)

## Notes

- The extension simulates human behavior to avoid detection
- Random delays make actions appear natural
- Mouse movements are smoothed and randomized
- The extension respects Snapchat's rate limits

## Development

To modify the extension:

1. Edit the files as needed
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

## License

Free to use and modify.
