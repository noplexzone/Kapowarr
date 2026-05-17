const LIEls = {
	pre_build: {
		bulk_result: document.querySelector('.pre-build-els .bulk-result')
	},
	views: {
		start: document.querySelector('#start-window'),
		no_result: document.querySelector('#no-result-window'),
		loading: document.querySelector('#loading-window'),
		bulk_list: document.querySelector('#bulk-list-window')
	},
	bulk_proposal_list: document.querySelector('.bulk-proposal-list'),
	bulk_select_all: document.querySelector('#bulk-selectall-input'),
	buttons: {
		cancel: document.querySelectorAll('.cancel-button'),
		bulk_scan: document.querySelector('#run-bulk-scan-button'),
		bulk_import: document.querySelector('#bulk-import-button'),
		bulk_cancel: document.querySelector('#bulk-cancel-button'),
		bulk_delete_unmatched: document.querySelector('#bulk-delete-unmatched-button'),
		scan_cancel: document.querySelector('#scan-cancel-button')
	},
	bulk_fuzzy: document.querySelector('#bulk-fuzzy-input'),
	bulk_fuzzy_note: document.querySelector('#bulk-fuzzy-note'),
	bulk_scan_mode: document.querySelector('#bulk-scan-mode-input'),
	bulk_scan_mode_row: document.querySelector('#bulk-scan-mode-row'),
	bulk_scan_mode_note: document.querySelector('#bulk-scan-mode-note')
};

function toggleBulkSelectAll() {
	const checked = LIEls.bulk_select_all.checked;
	LIEls.bulk_proposal_list.querySelectorAll('input[type="checkbox"]').forEach(
		e => e.checked = checked
	);
};

function _addBulkResultRow(result, api_key) {
	const row = LIEls.pre_build.bulk_result.cloneNode(true);
	row.dataset.folder = result.folder;
	row.dataset.cv_id = result.cv_id ?? '';
	row.dataset.id_type = result.id_type ?? '';

	row.querySelector('.file-column').innerText = result.file_title;
	row.querySelector('.file-column').title = result.folder;

	const cvCell = row.querySelector('.cv-id-column');
	if (result.cv_id) {
		cvCell.innerText = result.cv_id;
	} else {
		cvCell.innerText = '—';
		row.querySelector('input[type="checkbox"]').checked = false;
	}
	const statusLabel = result.cv_id
		? (result.match_type === 'title' ? 'Ready (title match)' : 'Ready')
		: 'No ID found';
	row.querySelector('.status-column').innerText = statusLabel;

	if (!result.cv_id) {
		const deleteBtn = document.createElement('button');
		deleteBtn.innerText = 'Delete Folder';
		deleteBtn.className = 'bulk-delete-btn';
		deleteBtn.title = `Delete ${result.folder}`;
		deleteBtn.onclick = () => deleteBulkFolder(result.folder, row, api_key);
		row.querySelector('.delete-column').appendChild(deleteBtn);
	}

	LIEls.bulk_proposal_list.appendChild(row);
}

async function loadBulkProposal(api_key) {
	const ffi = document.querySelector('#bulk-folder-filter-input');
	const progressEl = document.querySelector('#bulk-loading-progress');

	let url = `${url_base}/api/libraryimport/bulk?api_key=${api_key}`;
	const filterVal = ffi.value.trim();
	if (filterVal)
		url += `&folder_filter=${encodeURIComponent(filterVal)}`;
	const fuzzyEnabled = LIEls.bulk_fuzzy.value === 'true';
	if (fuzzyEnabled)
		url += '&fuzzy_fallback=true';
	if (fuzzyEnabled && LIEls.bulk_scan_mode.value === 'quick')
		url += '&quick=true';

	LIEls.bulk_proposal_list.innerHTML = '';
	progressEl.innerText = 'Starting scan…';
	hide(
		[LIEls.views.start, document.querySelector('#bulk-folder-filter-error')],
		[LIEls.views.loading, progressEl, LIEls.buttons.scan_cancel]
	);

	const abortCtrl = new AbortController();
	LIEls.buttons.scan_cancel.onclick = () => abortCtrl.abort();

	let response;
	try {
		response = await fetch(url, {signal: abortCtrl.signal});
	} catch {
		hide([LIEls.views.loading, progressEl, LIEls.buttons.scan_cancel], [LIEls.views.start]);
		return;
	}

	if (!response.ok) {
		try {
			const j = await response.json();
			if (j.error === 'InvalidKeyValue')
				hide(
					[LIEls.views.loading, progressEl, LIEls.buttons.scan_cancel],
					[LIEls.views.start, document.querySelector('#bulk-folder-filter-error')]
				);
			else
				hide([LIEls.views.loading, progressEl, LIEls.buttons.scan_cancel], [LIEls.views.start]);
		} catch {
			hide([LIEls.views.loading, progressEl, LIEls.buttons.scan_cancel], [LIEls.views.start]);
		}
		return;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let count = 0;
	let matched = 0;
	let cancelled = false;

	try {
		while (true) {
			const {done, value} = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, {stream: true});
			const lines = buffer.split('\n');
			buffer = lines.pop();

			for (const line of lines) {
				if (!line.trim()) continue;
				let item;
				try { item = JSON.parse(line); } catch { continue; }

				if (item.type === 'status') {
					progressEl.innerText = item.message;
					continue;
				}

				count++;
				if (item.cv_id) matched++;
				progressEl.innerText =
					`Scanning… ${count} folders checked, ${matched} matched — ${item.file_title}`;
				_addBulkResultRow(item, api_key);
			}
		}
	} catch (e) {
		if (e.name === 'AbortError') {
			cancelled = true;
		} else {
			hide([LIEls.views.loading, progressEl, LIEls.buttons.scan_cancel], [LIEls.views.start]);
			return;
		}
	}

	hide([LIEls.buttons.scan_cancel]);

	const prefix = cancelled ? 'Scan stopped early — ' : '';
	document.querySelector('#bulk-summary').innerText =
		`${prefix}${count} folders found — ${matched} with ComicVine IDs, ${count - matched} without.`;

	hide([LIEls.views.loading, progressEl], count > 0 ? [LIEls.views.bulk_list] : [LIEls.views.no_result]);
};

function deleteBulkFolder(folder, row, api_key) {
	if (!confirm(`Permanently delete this folder and all its contents?\n\n${folder}`)) return;
	const btn = row.querySelector('.bulk-delete-btn');
	btn.disabled = true;
	btn.innerText = 'Deleting…';
	sendAPI('POST', '/libraryimport/delete', api_key, {}, [folder])
	.then(() => {
		row.remove();
	})
	.catch(() => {
		btn.disabled = false;
		btn.innerText = 'Delete Folder';
	});
};

function deleteAllUnmatched(api_key) {
	const rows = [...LIEls.bulk_proposal_list.querySelectorAll('tr')]
		.filter(r => !r.dataset.cv_id);

	if (!rows.length) return;

	const count = rows.length;
	if (!confirm(`Permanently delete ${count} unmatched folder${count !== 1 ? 's' : ''} and all their contents?`)) return;

	rows.forEach(r => {
		const btn = r.querySelector('.bulk-delete-btn');
		if (btn) { btn.disabled = true; btn.innerText = 'Deleting…'; }
	});
	LIEls.buttons.bulk_delete_unmatched.disabled = true;

	const folders = rows.map(r => r.dataset.folder);
	sendAPI('POST', '/libraryimport/delete', api_key, {}, folders)
	.then(() => {
		rows.forEach(r => r.remove());
		LIEls.buttons.bulk_delete_unmatched.disabled = false;
	})
	.catch(() => {
		rows.forEach(r => {
			const btn = r.querySelector('.bulk-delete-btn');
			if (btn) { btn.disabled = false; btn.innerText = 'Delete Folder'; }
		});
		LIEls.buttons.bulk_delete_unmatched.disabled = false;
	});
};

function startBulkImport(api_key) {
	const rows = [...LIEls.bulk_proposal_list.querySelectorAll(
		'tr:has(input[type="checkbox"]:checked)'
	)];

	const data = rows
		.filter(r => r.dataset.cv_id)
		.map(r => ({
			folder: r.dataset.folder,
			cv_id: parseInt(r.dataset.cv_id),
			id_type: r.dataset.id_type || 'volume',
			file_title: r.querySelector('.file-column').innerText
		}));

	if (!data.length) return;

	rows.forEach(r => {
		if (r.dataset.cv_id)
			r.querySelector('.status-column').innerText = 'Queued';
	});

	sendAPI('POST', '/libraryimport/bulk', api_key, {}, data)
	.then(() => {
		hide([LIEls.views.bulk_list], [LIEls.views.start]);
	});
};

// code run on load

usingApiKey()
.then(api_key => {
	LIEls.buttons.bulk_scan.onclick = e => loadBulkProposal(api_key);
	LIEls.buttons.bulk_import.onclick = e => startBulkImport(api_key);
	LIEls.buttons.bulk_cancel.onclick = e =>
		hide([LIEls.views.bulk_list], [LIEls.views.start]);
	LIEls.buttons.bulk_delete_unmatched.onclick = e => deleteAllUnmatched(api_key);
});

LIEls.bulk_fuzzy.onchange = e => {
	const fuzzy = LIEls.bulk_fuzzy.value === 'true';
	LIEls.bulk_fuzzy_note.classList.toggle('hidden', !fuzzy);
	LIEls.bulk_scan_mode_row.classList.toggle('hidden', !fuzzy);
	if (!fuzzy) LIEls.bulk_scan_mode_note.classList.add('hidden');
};

LIEls.bulk_scan_mode.onchange = e =>
	LIEls.bulk_scan_mode_note.classList.toggle('hidden', LIEls.bulk_scan_mode.value === 'paced');

LIEls.bulk_select_all.onchange = e => toggleBulkSelectAll();
LIEls.buttons.cancel.forEach(b =>
	b.onclick = e => hide([LIEls.views.no_result], [LIEls.views.start])
);
