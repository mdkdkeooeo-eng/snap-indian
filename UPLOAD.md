# How to Upload Extension to 207.231.108.4

## Quick Method: Using WinSCP (Recommended for Windows)

1. **Download WinSCP**: https://winscp.net/eng/download.php
2. **Install and open WinSCP**
3. **Create new session:**
   - Protocol: **SFTP** (or FTP if SFTP doesn't work)
   - Host name: **207.231.108.4**
   - Port: **22** (for SFTP) or **21** (for FTP)
   - User name: (your server username)
   - Password: (your server password)
4. **Click "Login"**
5. **Navigate to your target folder** on the server (right panel)
6. **Select these files** from your local folder (left panel):
   - manifest.json
   - background.js
   - content.js
   - popup.html
   - popup.js
   - icon16.png
   - icon48.png
   - icon128.png
7. **Drag and drop** or right-click → **Upload**

## Alternative: Using PowerShell SCP

Open PowerShell in the extension folder and run:

```powershell
# Replace USERNAME with your server username
scp -r * USERNAME@207.231.108.4:/path/to/destination/
```

You'll be prompted for your password.

## Alternative: Create ZIP and Upload

1. **Select all extension files** (manifest.json, *.js, *.html, *.png)
2. **Right-click → Send to → Compressed (zipped) folder**
3. **Rename it** to `snapchat-extension.zip`
4. **Upload the ZIP** using any method above
5. **Extract on server** using SSH or file manager

## Files You Need to Upload:

✅ manifest.json  
✅ background.js  
✅ content.js  
✅ popup.html  
✅ popup.js  
✅ icon16.png (create if missing - see below)  
✅ icon48.png (create if missing - see below)  
✅ icon128.png (create if missing - see below)  

## Create Missing Icons:

If icon files are missing, you can:
1. Open `create_icons.html` in a browser to generate them, OR
2. Use any image editor to create 16x16, 48x48, and 128x128 PNG files with yellow background (#FFFC00)

## What You Need:

- **Server username**
- **Server password** (or SSH key)
- **Target directory path** on the server (where to upload)

---

**Need help?** Share your server access method (FTP/SFTP/SSH) and I can provide more specific instructions.



