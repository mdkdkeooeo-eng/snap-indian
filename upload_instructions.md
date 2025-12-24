# Upload Instructions for 207.231.108.4

## Method 1: Using FileZilla (Easiest for Windows)

1. Download FileZilla Client: https://filezilla-project.org/
2. Install and open FileZilla
3. Enter connection details:
   - **Host:** 207.231.108.4
   - **Username:** (your username)
   - **Password:** (your password)
   - **Port:** 21 (FTP) or 22 (SFTP)
4. Click "Quickconnect"
5. Navigate to the target directory on the server
6. Select all extension files in the left panel (local files)
7. Drag and drop or right-click → Upload

## Method 2: Using PowerShell (SCP/SFTP)

Open PowerShell and run:

```powershell
# Using SCP (if you have SSH access)
scp -r "C:\Users\squeaky\Desktop\botty\proxy\snap bot\*" username@207.231.108.4:/path/to/destination/

# Or using SFTP
sftp username@207.231.108.4
# Then in SFTP prompt:
put -r "C:\Users\squeaky\Desktop\botty\proxy\snap bot\*" /path/to/destination/
```

## Method 3: Create ZIP and Upload via Web Interface

1. Create a ZIP file of all extension files
2. Access the server via web browser: http://207.231.108.4 (or https)
3. Log in to the file manager
4. Upload the ZIP file
5. Extract it on the server

## Method 4: Using WinSCP (Windows GUI)

1. Download WinSCP: https://winscp.net/
2. Create new session:
   - **File protocol:** SFTP or FTP
   - **Host name:** 207.231.108.4
   - **User name:** (your username)
   - **Password:** (your password)
3. Click Login
4. Drag files from left (local) to right (remote) panel

## Files to Upload:

- manifest.json
- background.js
- content.js
- popup.html
- popup.js
- icon16.png (if exists)
- icon48.png (if exists)
- icon128.png (if exists)
- README.md (optional)
- INSTALL.md (optional)

## Note:
You'll need:
- Server username
- Server password (or SSH key)
- Target directory path on the server
- Port number (usually 21 for FTP, 22 for SFTP/SSH)



