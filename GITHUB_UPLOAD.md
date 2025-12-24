# How to Upload Files to GitHub

## If you ALREADY have a GitHub repository:

### Step 1: Initialize Git (if not already done)
```bash
git init
```

### Step 2: Add your GitHub repository as remote
```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
```

(Replace YOUR_USERNAME and YOUR_REPO_NAME with your actual GitHub username and repo name)

### Step 3: Add all files
```bash
git add .
```

This adds ALL files in the folder. Git will automatically:
- Add new files
- Update changed files (overwrites old versions)
- Keep unchanged files as-is

### Step 4: Commit the changes
```bash
git commit -m "Updated extension with persistent panel and new features"
```

### Step 5: Push to GitHub
```bash
git push -u origin main
```

(If your default branch is "master" instead of "main", use: `git push -u origin master`)

---

## If you DON'T have a GitHub repository yet:

### Step 1: Create a new repository on GitHub
1. Go to https://github.com
2. Click the "+" icon → "New repository"
3. Name it (e.g., "snapchat-friend-filter")
4. Don't initialize with README (we already have files)
5. Click "Create repository"

### Step 2: Initialize Git
```bash
git init
```

### Step 3: Add all files
```bash
git add .
```

### Step 4: Commit
```bash
git commit -m "Initial commit - Snapchat Friend Filter extension"
```

### Step 5: Add remote and push
```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

---

## Quick Answer to Your Question:

**Yes, just add the files and Git will automatically:**
- ✅ Add new files (like panel.html, panel.js, etc.)
- ✅ Update changed files (overwrite old versions of content.js, popup.js, etc.)
- ✅ Keep unchanged files as-is

**Git tracks changes automatically** - you don't need to manually delete old files. Just run:
```bash
git add .
git commit -m "Updated files"
git push
```

And all your new/changed files will be uploaded and override the old ones!

---

## Files to Upload:

All these files should be uploaded:
- manifest.json
- background.js
- content.js
- popup.html
- popup.js
- panel.html (NEW)
- panel.js (NEW)
- icon16.png
- icon48.png
- icon128.png
- README.md
- INSTALL.md
- create_icons.ps1
- create_icons.html
- (and any other .txt or .md files)

---

## Troubleshooting:

**If you get "fatal: not a git repository":**
- Run `git init` first

**If you get "remote origin already exists":**
- Your repo is already connected, just skip that step

**If you get authentication errors:**
- You may need to use a Personal Access Token instead of password
- Or use GitHub Desktop app (easier for beginners)

**If files are too large:**
- Make sure icon files aren't huge (they should be small PNGs)
- Git has a 100MB file size limit



