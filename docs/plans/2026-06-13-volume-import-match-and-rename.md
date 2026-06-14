# Volume Import Match-and-Rename Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Allow the user to optionally select which issue(s) an uploaded file should match *during import* on the volume home page, so the file is force-matched and renamed to the naming convention.

**Architecture:**
- Backend: Extend `POST /api/volumes/<id>/import` to accept an optional `match_map` parameter. The `ImportFilesVolume` task inserts forced issue bindings before `scan_files` runs, so auto-scan skips them and `mass_rename` renames them correctly.
- Frontend: Replace the immediate-upload file picker with a dialog window where the user selects files, optionally picks issue(s), then confirms the import.
- Manga uses the same volume detail view (`view_volume.html` / `view_volume.js`), so changes apply to both comic and manga volume pages.

**Tech Stack:** Flask (Python 3.13), vanilla JS, SQLite, existing `set_file_matching` / `issues_files` mechanism

---

### Task 1: Add `match_map` parameter to the import API endpoint

**Objective:** Extend `POST /api/volumes/<int:id>/import` to accept an optional JSON field `match_map` alongside file uploads.

**Files:**
- Modify: `frontend/api.py` (around lines 1063-1092)
- Modify: `backend/features/tasks.py` (class `ImportFilesVolume`, around lines 485-536)

**Step 1: Modify api.py — parse match_map from the request**

The endpoint currently reads `request.files.getlist('files')`. Add parsing of an optional `match_map` form field that contains a JSON string mapping saved filenames to issue ID arrays.

After the files are saved and before creating the task, parse:
```python
match_map_raw = request.form.get('match_map')
match_map = json.loads(match_map_raw) if match_map_raw else None
```

Then pass it to `ImportFilesVolume`:
```python
task_id = TaskHandler().add(ImportFilesVolume(id, saved_paths, match_map=match_map))
```

**Add imports at top of api.py** if not already present: `from json import loads as json_loads` (or use `json` which may already be imported — check and import if needed).

**Step 2: Modify tasks.py — extend ImportFilesVolume to accept and use match_map**

Change `__init__` to accept optional `match_map`:
```python
def __init__(self, volume_id: int, filepaths: List[str], match_map: Optional[Dict[str, List[int]]] = None) -> None:
    self._volume_id = volume_id
    self.filepaths = filepaths
    self.match_map = match_map or {}
    return
```

Add import at top of tasks.py: `from typing import Dict, List, Optional`

**Step 3: Add imports to tasks.py**

Ensure these are imported at the top: `from typing import Dict, List, Optional`

**Step 4: Verify tests pass**

Run: `cd /mnt/user/appdev/data/kapowarr && python3 -m pytest tests/ -q --tb=short`
Expected: all tests pass (no regressions)

**Step 5: Commit**

```bash
git add frontend/api.py backend/features/tasks.py
git commit -m "feat: add match_map parameter to volume import API and task"
```

---

### Task 2: Implement force-matching logic in ImportFilesVolume

**Objective:** When `match_map` is provided, register files in the DB and insert forced issue bindings *before* `scan_files` runs.

**Files:**
- Modify: `backend/features/tasks.py` (ImportFilesVolume.run method)

**Step 1: Add helper import for force-matching**

Import at top of tasks.py:
```python
from backend.internals.db_models import FilesDB
```

**Step 2: Insert force-matching before scan_files in ImportFilesVolume.run()**

After the "Importing files" message but before `scan_files()`, add:

```python
# Apply user-specified issue matches before scanning
if self.match_map:
    from backend.internals.db import get_db, commit
    cursor = get_db()
    for filepath, issue_ids in self.match_map.items():
        if filepath not in self.filepaths:
            continue
        # Ensure file is registered in DB
        file_id = FilesDB.add_file(filepath)
        # Delete any existing auto-bindings for this file
        cursor.execute("DELETE FROM issues_files WHERE file_id = ?", (file_id,))
        cursor.execute("DELETE FROM volume_files WHERE file_id = ?", (file_id,))
        # Insert forced bindings for specified issues
        for issue_id in issue_ids:
            cursor.execute(
                "INSERT INTO issues_files(file_id, issue_id, forced) VALUES (?, ?, 1)",
                (file_id, issue_id)
            )
        self.message = f'Force-matched {basename(filepath)} to {len(issue_ids)} issue(s)'
        WebSocket().emit(TaskStatusEvent(self.message))
    commit()
```

Also ensure `basename` is imported at the top of tasks.py:
```python
from os.path import basename
```

**Step 3: Update scan_files to skip user-matched files**

The existing `scan_files` already queries `manually_matched_files` (those with `forced = 1`) from the DB and skips them during auto-matching. Since we inserted forced bindings with `forced = 1` above, `scan_files` will automatically skip these files. No additional changes needed to `scan_files` itself.

**Step 4: Verify with the existing test suite**

Run: `python3 -m pytest tests/ -q --tb=short`
Expected: all tests pass

**Step 5: Commit**

```bash
git add backend/features/tasks.py
git commit -m "feat: force-match files to issues in ImportFilesVolume when match_map provided"
```

---

### Task 3: Add import-match window to the volume view template

**Objective:** Add a new window in `view_volume.html` with a file input, a preview table of selected files, and issue-select dropdowns.

**Files:**
- Modify: `frontend/templates/view_volume.html`
- Modify: `frontend/static/css/view_volume.css` (if needed)

**Step 1: Add the import-match window HTML to view_volume.html**

Add a new window block in the `{% block windows %}` section (after the existing `import-file-input` hidden input, or as a separate window):

```html
{% set import_match_content %}
<form id="import-match-form">
    <div class="import-match-controls">
        <label for="import-match-file-input" class="import-match-file-label">
            <span>Select Files</span>
        </label>
        <input
            type="file"
            id="import-match-file-input"
            multiple
            accept=".zip,.cbz,.cbr,.rar,.cb7,.cbt,.cba,.epub,.mobi,.pdf"
            style="display:none"
        >
        <button type="button" id="import-match-all-issues-btn">Match All To...</button>
        <select id="import-match-all-issues-select" style="display:none">
            <option value="">Auto-Match</option>
        </select>
    </div>
    <div class="import-match-files-container">
        <p class="empty-import-match-message">No files selected</p>
        <table id="import-match-table" class="icon-text-color hidden">
            <thead>
                <tr>
                    <th>File</th>
                    <th>Match To Issue</th>
                </tr>
            </thead>
            <tbody></tbody>
        </table>
    </div>
</form>
{% endset %}
{% set import_match_submit %}
<button id="submit-import-match" type="submit" form="import-match-form">Import</button>
{% endset %}
{{ window(True, "import-match-window", "Import Files", import_match_content, import_match_submit) }}
```

Also import the window macro at the top if not already there (it should be, via `{% from "base.html" import icon_button, window, loading_window %}`).

**Step 2: Add CSS for the import-match window**

In `frontend/static/css/view_volume.css`, add styles for:
- `.import-match-controls` — flex row for file picker + match-all dropdown
- `.import-match-file-label` — styled as a button
- `#import-match-table` — file list with issue selector
- `.empty-import-match-message` — centered placeholder
- `.import-match-files-container` — scrollable area

**Step 3: Verify template renders**

Load the volume page and check the Import Files button still opens the new window (it won't do anything yet — wired in Task 4). No errors in browser console.

**Step 4: Commit**

```bash
git add frontend/templates/view_volume.html frontend/static/css/view_volume.css
git commit -m "feat: add import-match window template and styles"
```

---

### Task 4: Wire the import-match window in JS

**Objective:** Replace the raw `importFiles()` function with the new dialog workflow: show the window → select files → pick issues → upload with match_map.

**Files:**
- Modify: `frontend/static/js/view_volume.js`
- Modify: `frontend/static/js/general.js` (for `sendAPI`/`fetchAPI` usage, if needed)

**Step 1: Replace importFiles() with a window-showing function**

Replace the existing `importFiles(api_key)` function:

```javascript
function importFiles(api_key) {
    // Hide any previous state
    const tbody = document.querySelector('#import-match-table tbody');
    tbody.innerHTML = '';
    document.querySelector('#import-match-all-issues-select').style.display = 'none';
    document.querySelector('#import-match-table').classList.add('hidden');
    document.querySelector('.empty-import-match-message').classList.remove('hidden');
    document.querySelector('#import-match-all-issues-select').innerHTML =
        '<option value="">Auto-Match</option>';
    
    // Populate the "Match All To" dropdown with issues from the page
    const allIssuesSelect = document.querySelector('#import-match-all-issues-select');
    document.querySelectorAll('#issues-list tr[data-id]').forEach(row => {
        const issueId = row.dataset.id;
        const issueNum = row.querySelector('.issue-number').innerText;
        const option = document.createElement('option');
        option.value = issueId;
        option.textContent = `Issue ${issueNum}`;
        allIssuesSelect.appendChild(option);
    });
    
    showWindow('import-match-window');
}
```

**Step 2: Add file-selection handler that populates the match table**

Add a new handler for when files are selected. When the user picks files, show them in the table with an issue-select dropdown for each file:

```javascript
// In the init/onload section or as a standalone handler
document.querySelector('#import-match-file-input').onchange = function(e) {
    const tbody = document.querySelector('#import-match-table tbody');
    tbody.innerHTML = '';
    
    if (!e.target.files.length) {
        document.querySelector('#import-match-table').classList.add('hidden');
        document.querySelector('.empty-import-match-message').classList.remove('hidden');
        return;
    }
    
    document.querySelector('.empty-import-match-message').classList.add('hidden');
    document.querySelector('#import-match-table').classList.remove('hidden');
    document.querySelector('#import-match-all-issues-select').style.display = 'inline-block';
    
    for (const file of e.target.files) {
        const row = ViewEls.pre_build.manage_entry.cloneNode(true);
        // Adapt manage_entry or build the row manually
        row.querySelector('.mi-filepath').textContent = file.name;
        
        // Issue select dropdown
        const select = document.createElement('select');
        select.className = 'import-issue-select';
        select.dataset.filename = file.name;
        
        const autoOpt = document.createElement('option');
        autoOpt.value = '';
        autoOpt.textContent = 'Auto-Match';
        select.appendChild(autoOpt);
        
        document.querySelectorAll('#issues-list tr[data-id]').forEach(issueRow => {
            const opt = document.createElement('option');
            opt.value = issueRow.dataset.id;
            opt.textContent = `${issueRow.querySelector('.issue-number').innerText} - ${issueRow.querySelector('.issue-title').innerText}`;
            select.appendChild(opt);
        });
        
        const td = row.querySelector('.mi-matched') || document.createElement('td');
        td.innerHTML = '';
        td.appendChild(select);
        
        tbody.appendChild(row);
    }
};
```

**Step 3: Wire the "Match All To" dropdown**

```javascript
document.querySelector('#import-match-all-issues-btn').onclick = function() {
    const select = document.querySelector('#import-match-all-issues-select');
    const selectedIssueId = select.value;
    document.querySelectorAll('.import-issue-select').forEach(s => s.value = selectedIssueId);
};
```

**Step 4: Wire the Import submit button**

```javascript
document.querySelector('#submit-import-match').onclick = function() {
    const fileInput = document.querySelector('#import-match-file-input');
    if (!fileInput.files.length) return;
    
    const button = this;
    const originalText = button.textContent;
    button.textContent = 'Uploading...';
    button.disabled = true;
    
    // Build match_map: filename -> [issue_id]
    const matchMap = {};
    document.querySelectorAll('.import-issue-select').forEach(select => {
        if (select.value) {
            matchMap[select.dataset.filename] = [parseInt(select.value)];
        }
    });
    
    const formData = new FormData();
    for (const file of fileInput.files) {
        formData.append('files', file);
    }
    if (Object.keys(matchMap).length > 0) {
        formData.append('match_map', JSON.stringify(matchMap));
    }
    
    fetch(`${url_base}/api/volumes/${volume_id}/import`, {
        method: 'POST',
        headers: {'x-api-key': api_key},
        body: formData
    })
    .then(r => {
        if (!r.ok) throw r;
        button.textContent = 'Queued!';
    })
    .catch(() => {
        button.textContent = 'Failed';
    })
    .finally(() => {
        setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
            closeWindow();
            fileInput.value = '';
        }, 2000);
    });
};
```

**Step 5: Ensure ViewEls.pre_build references include the import-match row**

In `view_volume.html`, add a pre-build row for the import match entry if `manage_entry` isn't suitable:
```html
<tr class="import-match-entry">
    <td class="im-filepath"></td>
    <td class="im-match"></td>
</tr>
```

Reference as `ViewEls.pre_build.import_match_entry` in JS.

**Step 6: Verify the flow end-to-end**

1. Load volume page
2. Click "Import Files" → new window opens
3. Click "Select Files" → pick a PDF
4. File appears in table with issue dropdown
5. Select an issue from dropdown
6. Click "Import" → uploads with match_map
7. Check console for success/failure

**Step 7: Commit**

```bash
git add frontend/static/js/view_volume.js frontend/templates/view_volume.html
git commit -m "feat: wire import-match dialog with file selection and issue matching"
```

---

### Task 5: Handle edge cases — no issues in volume, no match selected, existing files

**Objective:** Ensure the import-match window degrades gracefully when there are no issues, no match is selected, or files already exist.

**Files:**
- Modify: `frontend/static/js/view_volume.js`
- Modify: `frontend/backend/features/tasks.py` (if needed)

**Step 1: Handle empty issue list**

When the volume has no issues (e.g., TPB/One-shot without individual issues), don't show the issue match UI. In that case, the file should be treated as a general file or volume-level file automatically.

In the frontend init of the import-match window, check if `#issues-list tr[data-id]` has entries. If not, hide the match controls and show text: "No issues to match — file will be auto-matched."

In the backend, when `match_map` is provided but non-empty, proceed with force-matching. When empty, run normal auto-scan behavior.

**Step 2: Handle no-match-selected case**

When a user selects files but doesn't pick any issue for some files, those files have `match_map` entries with empty-string values. Filter these out when building the `match_map` JSON:

```javascript
const matchMap = {};
document.querySelectorAll('.import-issue-select').forEach(select => {
    if (select.value) {
        matchMap[select.dataset.filename] = [parseInt(select.value)];
    }
});
```

Files without a match selected will be auto-matched by `scan_files`.

**Step 3: Handle existing file overwrite**

The current `secure_filename` flow already handles this via Werkzeug's `secure_filename` which disallows path separators. No additional changes needed — files with the same name overwrite, which is existing behavior.

**Step 4: Add pre-build row for import entry**

In `view_volume.html`, add:
```html
<tr class="import-match-entry" data-filename="">
    <td class="im-filepath"></td>
    <td class="im-match"></td>
</tr>
```

And add to JS `ViewEls.pre_build`:
```javascript
import_match: document.querySelector('.pre-build-els .import-match-entry'),
```

**Step 5: Verify edge cases**

1. Volume with 0 issues → window opens but shows "No issues" message
2. Volume with issues → dropdown populated
3. Select file, no issue selected → file auto-matched
4. Select file, pick issue → file force-matched
5. Multiple files, some matched some not → mixed behavior
6. Import without selecting any file → button does nothing

**Step 6: Commit**

```bash
git add frontend/static/js/view_volume.js frontend/templates/view_volume.html backend/features/tasks.py
git commit -m "feat: handle import-match edge cases (no issues, no match, partial match)"
```

---

### Task 6: Integration verification and final commit

**Objective:** Run the full test suite and verify everything works together.

**Step 1: Run full test suite**

```bash
cd /mnt/user/appdata/dev/kapowarr
python3 -m pytest tests/ -q --tb=short
```

Expected: all tests pass. If any fail, diagnose and fix.

**Step 2: Start dev server for manual verification**

```bash
python3 Kapowarr.py --no-browser &
sleep 3
curl -s http://localhost:5656/api/volumes?api_key=test | python3 -m json.tool
```

**Step 3: Verify the import flow**

1. Open browser to Kapowarr
2. Navigate to a volume with issues
3. Click Import Files
4. Verify dialog opens with file picker and issue list
5. Select a test PDF
6. Pick an issue from dropdown
7. Click Import
8. Verify the task runs and file appears matched + renamed

**Step 4: Final commit**

```bash
git status
git add -A
git commit -m "feat: complete volume import with optional manual issue match and rename"
```
