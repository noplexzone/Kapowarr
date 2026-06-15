# Kapowarr Frontend Smoke Checklist

Run through these checks after any UI change. No dependencies required — manual verification only.

## Pages to verify

### 1. Volume Detail (`/volumes/<id>`)
- [ ] Page loads without JS errors (check browser console)
- [ ] Cover image renders with rounded corners and shadow
- [ ] Monitor toggle works (green chip = Monitored, grey = Unmonitored)
- [ ] Toast notification appears on monitor toggle
- [ ] Hero action buttons (Refresh, Auto-Search, Manual Search, Edit, Delete) are visible and clickable
- [ ] Description expands/collapses if content overflows 4 lines
- [ ] Issue table renders with status chips (Downloaded=green, Missing=red, Downloading=accent)
- [ ] Issue monitor toggle works per-row
- [ ] Manual search opens, shows results with match/source chips
- [ ] Download/Force/Blocklist buttons in manual search work
- [ ] Issue history opens in right-side drawer (not modal window)
- [ ] Drawer closes with Escape key or clicking overlay
- [ ] All modal windows (Delete, Edit, Rename, Convert, Manage Issues, Fix Match) still open and close correctly
- [ ] Responsive: below 520px, issue rows become card layout; `<thead>` hidden

### 2. Download Queue (`/activity/queue`)
- [ ] Queue loads with card-like rows and progress bars
- [ ] "Remove All" button in toolbar
- [ ] Downloading entries show progress bar fill + percentage
- [ ] Task label chips visible (e.g. "Snatching", "Post-processing")
- [ ] Move up/down buttons work (hidden for first/last/downloading entries)
- [ ] Remove and Blocklist buttons work
- [ ] WebSocket updates live (status changes, new entries, completed entries removed)
- [ ] Responsive: below 720px, cards stack as grid

### 3. Library (`/`)
- [ ] Poster grid view renders with cover images, shadows, hover scale
- [ ] Progress bars on covers (accent for partial, green for complete)
- [ ] Search bar works (filter + clear)
- [ ] View toggle (Posters/Table) works
- [ ] Sort options work (Title, Year, Recently Added, etc.)
- [ ] Filter options work (No Filter, Wanted, Monitored)
- [ ] Table view shows monitored column with toggle
- [ ] Toast appears on monitor toggle
- [ ] Mass edit works (select checkboxes, action bar appears)
- [ ] Stats footer visible with volume/issue/file counts
- [ ] Responsive: covers scale down; table hides year/volume columns below 535px

### 4. Manual Search (via Volume Detail)
- [ ] Match column shows `.chip--success` "Match" or `.chip--error` with reason
- [ ] Source column shows source name as chip
- [ ] Action buttons use `.action-btn` styled buttons
- [ ] Download/Force Download/Blocklist actions work correctly

### 5. Settings / Download (`/settings/download`)
- [ ] All form fields visible and editable
- [ ] Save button works
- [ ] Client list cards visible
- [ ] Source priority tables populated
- [ ] Suwayomi settings section visible
- [ ] No JS errors in console

### 6. Dashboard (`/dashboard`)
- [ ] Page loads with four stat cards
- [ ] Active downloads count accurate
- [ ] Recent downloads count accurate (7 days)
- [ ] Wanted issues count accurate
- [ ] Library stats (volumes, issues, downloaded) accurate
- [ ] Recently added list shows covers + titles + metadata
- [ ] Refresh button works
- [ ] Nav link "Dashboard" is highlighted when on page

### 7. Global checks
- [ ] Toast notifications appear from any page that calls `showToast()`
- [ ] Theme toggle works (light/dark/comic themes)
- [ ] All themes have correct text contrast
- [ ] Keyboard navigation: Tab through interactive elements, focus ring visible
- [ ] Reduced motion: enable in OS settings, animations stop
- [ ] `url_base` works (if not running at root, all links/routes still resolve)
- [ ] No console errors on any page
- [ ] No broken images (check network tab for 404s on icons)

## Quick verification commands

```bash
cd /mnt/user/appdata/dev/kapowarr
node --check frontend/static/js/view_volume.js
node --check frontend/static/js/queue.js
node --check frontend/static/js/volumes.js
node --check frontend/static/js/dashboard.js
node --check frontend/static/js/settings_download.js
node --check frontend/static/js/settings_download_clients.js
node --check frontend/static/js/general.js
node --check frontend/static/js/window.js
python3 -m py_compile frontend/ui.py
git diff --check
```
