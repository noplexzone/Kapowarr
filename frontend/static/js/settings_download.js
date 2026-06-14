function fillSettings(api_key) {
	fetchAPI('/settings', api_key)
	.then(json => {
		document.querySelector('#download-folder-input').value = json.result.download_folder;
		document.querySelector('#concurrent-direct-downloads-input').value = json.result.concurrent_direct_downloads;
		document.querySelector('#download-timeout-input').value = ((json.result.failing_download_timeout || 0) / 60) || '';
		document.querySelector('#seeding-handling-input').value = json.result.seeding_handling;
		document.querySelector('#delete-downloads-input').checked = json.result.delete_completed_downloads;
		fillPref(json.result.service_preference);
		fillDownloadSourcePriority('#comic-source-priority-table', json.result.comic_source_priority);
		fillDownloadSourcePriority('#manga-source-priority-table', json.result.manga_source_priority);
	});
};

function saveSettings(api_key) {
	document.querySelector("#save-button p").innerText = 'Saving';
	document.querySelector('#download-folder-input').classList.remove('error-input');
	const data = {
		'download_folder': document.querySelector('#download-folder-input').value,
		'concurrent_direct_downloads': parseInt(document.querySelector('#concurrent-direct-downloads-input').value),
		'failing_download_timeout': parseInt(document.querySelector('#download-timeout-input').value || 0) * 60,
		'seeding_handling': document.querySelector('#seeding-handling-input').value,
		'delete_completed_downloads': document.querySelector('#delete-downloads-input').checked,
		'service_preference': [...document.querySelectorAll('#pref-table select')].map(e => e.value),
		'comic_source_priority': getDownloadSourcePriority('#comic-source-priority-table'),
		'manga_source_priority': getDownloadSourcePriority('#manga-source-priority-table')
	};
	sendAPI('PUT', '/settings', api_key, {}, data)
	.then(response => 
		document.querySelector("#save-button p").innerText = 'Saved'
	)
	.catch(e => {
		document.querySelector("#save-button p").innerText = 'Failed';
        e.json().then(e => {
            if (
                e.error === "InvalidKeyValue"
                && e.result.key === "download_folder"
                ||
                e.error === "FolderNotFound"
            )
                document.querySelector('#download-folder-input').classList.add('error-input');

			else
                console.log(e);
        });
	});
};

//
// Empty download folder
//
function emptyFolder(api_key) {
	sendAPI('DELETE', '/activity/folder', api_key)
	.then(response => {
		document.querySelector('#empty-download-folder').innerText = 'Done';
	});
};

//
// Service preference
//
function fillPref(pref) {
	const selects = document.querySelectorAll('#pref-table select');
	for (let i = 0; i < pref.length; i++) {
		const service = pref[i];
		const select = selects[i];
		select.onchange = updatePrefOrder;
		pref.forEach(option => {
			const entry = document.createElement('option');
			entry.value = option;
			entry.innerText = option.charAt(0).toUpperCase() + option.slice(1);
			if (option === service)
				entry.selected = true;
			select.appendChild(entry);
		});
	};
};

function updatePrefOrder(e) {
	const other_selects = document.querySelectorAll(
		`#pref-table select:not([data-place="${e.target.dataset.place}"])`
	);
	// Find select that has the value of the target select
	for (let i = 0; i < other_selects.length; i++) {
		if (other_selects[i].value === e.target.value) {
			// Set it to old value of target select
			all_values = [...document.querySelector('#pref-table select').options].map(e => e.value)
			used_values = new Set([...document.querySelectorAll('#pref-table select')].map(s => s.value));
			open_value = all_values.filter(e => !used_values.has(e))[0];
			other_selects[i].value = open_value;
			break;
		};
	};
};

//
// Download source priority
//
const downloadSourcePriorityLabels = {
	'usenet': 'Usenet',
	'getcomics': 'GetComics',
	'suwayomi': 'Suwayomi'
};

function fillDownloadSourcePriority(tableSelector, priority) {
	const table = document.querySelector(tableSelector);
	if (!table) return;
	const selects = table.querySelectorAll('select');
	if (!priority || priority.length === 0) {
		const defaults = {'#comic-source-priority-table': ['usenet', 'getcomics'], '#manga-source-priority-table': ['suwayomi', 'usenet', 'getcomics']};
		priority = defaults[tableSelector] || [];
	};
	for (let i = 0; i < priority.length; i++) {
		const source = priority[i];
		const select = selects[i];
		select.innerHTML = '';
		select.onchange = updateDownloadSourcePriorityOrder;
		priority.forEach(option => {
			const entry = document.createElement('option');
			entry.value = option;
			entry.innerText = downloadSourcePriorityLabels[option] || option;
			if (option === source)
				entry.selected = true;
			select.appendChild(entry);
		});
	};
};

function getDownloadSourcePriority(tableSelector) {
	return [...document.querySelectorAll(`${tableSelector} select`)].map(e => e.value);
};

function updateDownloadSourcePriorityOrder(e) {
	const table = e.target.closest('table');
	const other_selects = table.querySelectorAll(
		`select:not([data-place="${e.target.dataset.place}"])`
	);
	for (let i = 0; i < other_selects.length; i++) {
		if (other_selects[i].value === e.target.value) {
			const all_values = [...table.querySelector('select').options].map(e => e.value);
			const used_values = new Set([...table.querySelectorAll('select')].map(s => s.value));
			const open_value = all_values.filter(e => !used_values.has(e))[0];
			other_selects[i].value = open_value;
			break;
		};
	};
};

// code run on load
usingApiKey()
.then(api_key => {
	fillSettings(api_key);

	document.querySelector('#save-button').onclick = e => saveSettings(api_key);
	document.querySelector('#empty-download-folder').onclick = e => emptyFolder(api_key);
});
