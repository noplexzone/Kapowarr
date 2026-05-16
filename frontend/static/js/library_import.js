const LIEls = {
	pre_build: {
		li_result: document.querySelector('.pre-build-els .li-result'),
		search_result: document.querySelector('.pre-build-els .search-result'),
		bulk_result: document.querySelector('.pre-build-els .bulk-result')
	},
	views: {
		start: document.querySelector('#start-window'),
		no_result: document.querySelector('#no-result-window'),
		list: document.querySelector('#list-window'),
		loading: document.querySelector('#loading-window'),
		no_cv: document.querySelector('#no-cv-window'),
		bulk_list: document.querySelector('#bulk-list-window')
	},
	proposal_list: document.querySelector('.proposal-list'),
	bulk_proposal_list: document.querySelector('.bulk-proposal-list'),
	select_all: document.querySelector('#selectall-input'),
	bulk_select_all: document.querySelector('#bulk-selectall-input'),
	search: {
		window: document.querySelector('#cv-window'),
		input: document.querySelector('#search-input'),
		results: document.querySelector('.search-results'),
		container: document.querySelector('.search-results-container'),
		bar: document.querySelector('.search-bar')
	},
	buttons: {
		cancel: document.querySelectorAll('.cancel-button'),
		run: document.querySelector('#run-import-button'),
		import: document.querySelector('#import-button'),
		import_rename: document.querySelector('#import-rename-button'),
		bulk_scan: document.querySelector('#run-bulk-scan-button'),
		bulk_import: document.querySelector('#bulk-import-button'),
		bulk_cancel: document.querySelector('#bulk-cancel-button')
	},
	tabs: {
		standard: document.querySelector('#tab-standard'),
		bulk: document.querySelector('#tab-bulk')
	},
	modes: {
		standard: document.querySelector('#standard-mode'),
		bulk: document.querySelector('#bulk-mode')
	}
};

const rowid_to_filepath = {};

function loadProposal(api_key) {
	const params = {
		limit: parseInt(document.querySelector('#limit-input').value),
		limit_parent_folder: document.querySelector('#folder-input').value,
		only_english: document.querySelector('#lang-input').value
	};
	const ffi = document.querySelector('#folder-filter-input');
	if (ffi.offsetParent !== null && (ffi.value || null) !== null)
		params.folder_filter = encodeURIComponent(ffi.value);

	hide(
		[LIEls.views.start, document.querySelector('#folder-filter-error')],
		[LIEls.views.loading]
	);

	LIEls.proposal_list.innerHTML = '';
	LIEls.select_all.checked = true;

	fetchAPI('/libraryimport', api_key, params)
	.then(json => {
		json.result.forEach((result, rowid) => {
			const entry = LIEls.pre_build.li_result.cloneNode(true);
			entry.dataset.rowid = rowid;
			entry.dataset.group_number = result.group_number;
			rowid_to_filepath[rowid] = {
				cv_id: result.cv.id || null,
				filepath: result.filepath
			};

			const title = entry.querySelector('.file-column');
			title.innerText = result.file_title;
			title.title = result.filepath;

			const CV_link = entry.querySelector('a');
			CV_link.href = result.cv.link || '';
			CV_link.innerText = result.cv.title || '';

			entry.querySelector('.issue-count').innerText = result.cv.issue_count;

			entry.querySelector('button').onclick = e => openEditCVMatch(rowid);

			LIEls.proposal_list.appendChild(entry);
		});

		if (json.result.length > 0)
			hide([LIEls.views.loading], [LIEls.views.list]);
		else
			hide([LIEls.views.loading], [LIEls.views.no_result]);
	})
	.catch(e => {
		e.json().then(j => {
			if (j.error === 'InvalidComicVineApiKey')
				hide([LIEls.views.loading], [LIEls.views.no_cv]);
			else if (j.error === 'InvalidKeyValue')
				hide(
					[LIEls.views.loading],
					[LIEls.views.start, document.querySelector('#folder-filter-error')]
				);
			else
				console.log(j);
		});
	});
};

function toggleSelectAll() {
	const checked = LIEls.select_all.checked;
	LIEls.proposal_list.querySelectorAll('input[type="checkbox"]').forEach(
		e => e.checked = checked
	);
};

function openEditCVMatch(rowid) {
	LIEls.search.window.dataset.rowid = rowid;
	LIEls.search.results.innerHTML = '';
	hide([LIEls.search.container]);
	LIEls.search.input.value = '';
	showWindow('cv-window');
	LIEls.search.input.focus();
};

function editCVMatch(
	rowid,
	comicvine_id,
	site_url,
	title,
	year,
	issue_count,
	group_number=null
) {
	let target_td;
	if (group_number === null)
		target_td = document.querySelectorAll(`tr[data-rowid="${rowid}"]`);
	else
		target_td = document.querySelectorAll(`tr[data-group_number="${group_number}"]`);

	target_td.forEach(tr => {
		rowid_to_filepath[tr.dataset.rowid].cv_id = parseInt(comicvine_id);
		const link = tr.querySelector('a');
		link.href = site_url;
		link.innerText = `${title} (${year})`;
		tr.querySelector('.issue-count').innerText = issue_count;
	});
};

function searchCV() {
	const input = LIEls.search.input;
	input.blur();
	usingApiKey()
	.then(api_key => {
		LIEls.search.results.innerHTML = '';
		fetchAPI('/volumes/search', api_key, {query: input.value})
		.then(json => {
			json.result.forEach(result => {
				const entry = LIEls.pre_build.search_result.cloneNode(true);

				const title = entry.querySelector('td:nth-child(1) a');
				title.href = result.site_url;
				title.innerText = `${result.title} (${result.year})`;

				entry.querySelector('td:nth-child(2)').innerText =
					result.issue_count;

				const select_button = entry.querySelector('td:nth-child(3) button');
				select_button.onclick = e => {
					editCVMatch(
						LIEls.search.window.dataset.rowid,
						result.comicvine_id,
						result.site_url,
						result.title,
						result.year,
						result.issue_count
					);
					closeWindow();
				};

				const select_for_all_button = entry.querySelector('td:nth-child(4) button');
				select_for_all_button.onclick = e => {
					const rowid = LIEls.search.window.dataset.rowid;
					const group_number = document.querySelector(`tr[data-rowid="${rowid}"]`)
						.dataset.group_number;
					editCVMatch(
						rowid,
						result.comicvine_id,
						result.site_url,
						result.title,
						result.year,
						result.issue_count,
						group_number
					);
					closeWindow();
				};

				LIEls.search.results.appendChild(entry);
			});
			hide([], [LIEls.search.container]);
		});
	});
};

function importLibrary(api_key, rename=false) {
	const data = [...LIEls.proposal_list.querySelectorAll(
		'tr:has(input[type="checkbox"]:checked)'
	)]
		.filter(i => rowid_to_filepath[i.dataset.rowid].cv_id !== null)
		.map(e => {
			const rowid = e.dataset.rowid;
			return {
				'filepath': rowid_to_filepath[rowid].filepath,
				'id': rowid_to_filepath[rowid].cv_id
			};
		});

	hide([LIEls.views.list], [LIEls.views.loading]);
	sendAPI('POST', '/libraryimport', api_key, {rename_files: rename}, data)
	.then(response => hide([LIEls.views.loading], [LIEls.views.start]));
};

// =====================
// Bulk Import (ComicInfo mode)
// =====================

function switchTab(mode) {
	const isBulk = mode === 'bulk';
	LIEls.tabs.standard.classList.toggle('active', !isBulk);
	LIEls.tabs.bulk.classList.toggle('active', isBulk);
	hide(
		isBulk ? [LIEls.modes.standard] : [LIEls.modes.bulk],
		isBulk ? [LIEls.modes.bulk]     : [LIEls.modes.standard]
	);
};

function toggleBulkSelectAll() {
	const checked = LIEls.bulk_select_all.checked;
	LIEls.bulk_proposal_list.querySelectorAll('input[type="checkbox"]').forEach(
		e => e.checked = checked
	);
};

async function loadBulkProposal(api_key) {
	const ffi = document.querySelector('#bulk-folder-filter-input');
	const progressEl = document.querySelector('#bulk-loading-progress');

	let url = `${url_base}/api/libraryimport/bulk?api_key=${api_key}`;
	const filterVal = ffi.value.trim();
	if (filterVal)
		url += `&folder_filter=${encodeURIComponent(filterVal)}`;

	hide(
		[LIEls.views.start, document.querySelector('#bulk-folder-filter-error')],
		[LIEls.views.loading, progressEl]
	);
	LIEls.bulk_proposal_list.innerHTML = '';
	progressEl.innerText = 'Starting scan…';

	let response;
	try {
		response = await fetch(url);
	} catch {
		hide([LIEls.views.loading], [LIEls.views.start]);
		return;
	}

	if (!response.ok) {
		// Server returned an error before streaming started
		try {
			const j = await response.json();
			if (j.error === 'InvalidKeyValue')
				hide(
					[LIEls.views.loading, progressEl],
					[LIEls.views.start, document.querySelector('#bulk-folder-filter-error')]
				);
			else
				hide([LIEls.views.loading, progressEl], [LIEls.views.start]);
		} catch {
			hide([LIEls.views.loading, progressEl], [LIEls.views.start]);
		}
		return;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let count = 0;
	let matched = 0;
	const rows = [];

	while (true) {
		const {done, value} = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, {stream: true});
		const lines = buffer.split('\n');
		buffer = lines.pop(); // keep any partial line for next chunk

		for (const line of lines) {
			if (!line.trim()) continue;
			let item;
			try { item = JSON.parse(line); } catch { continue; }

			count++;
			if (item.cv_id) matched++;
			progressEl.innerText =
				`Scanning… ${count} folders checked, ${matched} matched — ${item.file_title}`;

			rows.push(item);
		}
	}

	// Build table from collected results
	rows.forEach(result => {
		const row = LIEls.pre_build.bulk_result.cloneNode(true);
		row.dataset.folder = result.folder;
		row.dataset.cv_id = result.cv_id ?? '';

		row.querySelector('.file-column').innerText = result.file_title;
		row.querySelector('.file-column').title = result.folder;

		const cvCell = row.querySelector('.cv-id-column');
		if (result.cv_id) {
			cvCell.innerText = result.cv_id;
		} else {
			cvCell.innerText = '—';
			row.querySelector('input[type="checkbox"]').checked = false;
		}
		row.querySelector('.status-column').innerText = result.cv_id ? 'Ready' : 'No ID found';
		LIEls.bulk_proposal_list.appendChild(row);
	});

	document.querySelector('#bulk-summary').innerText =
		`${count} folders found — ${matched} with ComicVine IDs, ${count - matched} without.`;

	hide([LIEls.views.loading, progressEl], count > 0 ? [LIEls.views.bulk_list] : [LIEls.views.no_result]);
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
	LIEls.buttons.run.onclick = e => loadProposal(api_key);
	LIEls.buttons.import.onclick = e => importLibrary(api_key, false);
	LIEls.buttons.import_rename.onclick = e => importLibrary(api_key, true);

	LIEls.buttons.bulk_scan.onclick = e => loadBulkProposal(api_key);
	LIEls.buttons.bulk_import.onclick = e => startBulkImport(api_key);
	LIEls.buttons.bulk_cancel.onclick = e =>
		hide([LIEls.views.bulk_list], [LIEls.views.start]);
});

LIEls.tabs.standard.onclick = e => switchTab('standard');
LIEls.tabs.bulk.onclick = e => switchTab('bulk');

LIEls.search.bar.action = 'javascript:searchCV();';
LIEls.select_all.onchange = e => toggleSelectAll();
LIEls.bulk_select_all.onchange = e => toggleBulkSelectAll();
LIEls.buttons.cancel.forEach(b =>
	b.onclick = e => hide(
		[LIEls.views.list, LIEls.views.no_result, LIEls.views.no_cv],
		[LIEls.views.start]
	)
);
