let currentFixVolumeId = null;
let allVolumes = [];

const FCEls = {
	filter: document.querySelector('#fc-filter'),
	summary: document.querySelector('#fc-summary'),
	tbody: document.querySelector('#fc-tbody'),
	loading: document.querySelector('#fc-loading'),
	table_container: document.querySelector('#fc-table-container'),
	no_results: document.querySelector('#fc-no-results'),
	pre_build: {
		row: document.querySelector('.pre-build-els .fc-volume-row'),
		search_result: document.querySelector('.pre-build-els .fc-search-result')
	}
};

function normStr(s) {
	return s.toLowerCase()
		.replace(/\(\d{4}\)/g, '')
		.replace(/[:\\*?"<>|]/g, '')    // chars forbidden in folder names — strip, don't space
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function isMismatch(folder, title) {
	const parts = folder.replace(/\\/g, '/').split('/');
	const folderBase = parts[parts.length - 1] || parts[parts.length - 2] || '';
	const nf = normStr(folderBase);
	const nt = normStr(title);
	if (!nf || !nt) return false;
	return !nf.includes(nt) && !nt.includes(nf);
}

function renderTable(filter) {
	FCEls.tbody.innerHTML = '';

	const mismatchCount = allVolumes.filter(v => isMismatch(v.folder, v.title)).length;
	FCEls.summary.innerText =
		`${allVolumes.length} volumes — ${mismatchCount} possible mismatch${mismatchCount !== 1 ? 'es' : ''}`;

	const volumes = filter === 'review'
		? allVolumes.filter(v => isMismatch(v.folder, v.title))
		: allVolumes;

	if (!volumes.length) {
		hide([FCEls.table_container], [FCEls.no_results]);
		return;
	}
	hide([FCEls.no_results], [FCEls.table_container]);

	volumes.forEach(v => {
		const row = FCEls.pre_build.row.cloneNode(true);
		row.dataset.id = v.id;
		row.dataset.cv_id = v.comicvine_id;

		const parts = v.folder.replace(/\\/g, '/').split('/');
		const folderBase = parts[parts.length - 1] || parts[parts.length - 2] || v.folder;
		const folderEl = row.querySelector('.fc-folder');
		folderEl.innerText = folderBase;
		folderEl.title = v.folder;

		row.querySelector('.fc-title').innerText = v.title;
		row.querySelector('.fc-year').innerText = v.year ?? '—';

		const mismatch = isMismatch(v.folder, v.title);
		const statusEl = row.querySelector('.fc-status');
		statusEl.innerText = mismatch ? 'Review' : 'OK';
		if (mismatch) statusEl.classList.add('status-review');
		else statusEl.classList.add('status-ok');

		row.querySelector('.fc-goto').href = `${url_base}/volumes/${v.id}`;
		row.querySelector('.fc-fix-btn').onclick = () => openFixMatch(v);

		FCEls.tbody.appendChild(row);
	});
}

function openFixMatch(volume) {
	currentFixVolumeId = volume.id;
	document.querySelector('#fc-fix-label').innerText =
		`Re-matching: ${volume.title}${volume.year ? ' (' + volume.year + ')' : ''}`;
	document.querySelector('#fc-fix-input').value = '';
	document.querySelector('#fc-fix-message').innerText = '';
	document.querySelector('#fc-fix-result-table').classList.add('hidden');
	document.querySelector('#fc-fix-result-table tbody').innerHTML = '';
	showWindow('fc-fix-window');
}

function searchFixMatch(api_key) {
	const query = document.querySelector('#fc-fix-input').value.trim();
	if (!query) return;

	const msgEl = document.querySelector('#fc-fix-message');
	const tableEl = document.querySelector('#fc-fix-result-table');
	const tbody = tableEl.querySelector('tbody');

	msgEl.innerText = 'Searching...';
	tableEl.classList.add('hidden');
	tbody.innerHTML = '';

	fetchAPI('/volumes/search', api_key, {query})
	.then(json => {
		if (!json.result.length) {
			msgEl.innerText = 'No results found.';
			return;
		}
		msgEl.innerText = '';
		json.result.forEach(r => {
			const row = FCEls.pre_build.search_result.cloneNode(true);
			row.dataset.cv_id = r.comicvine_id;
			row.querySelector('.fcs-title').innerText = r.title;
			row.querySelector('.fcs-year').innerText = r.year ?? '—';
			row.querySelector('.fcs-issues').innerText = r.issue_count ?? '—';
			row.querySelector('.fcs-select-btn').onclick = () => applyFixMatch(api_key, r.comicvine_id, r.title);
			tbody.appendChild(row);
		});
		tableEl.classList.remove('hidden');
	})
	.catch(() => {
		msgEl.innerText = 'Search failed.';
	});
}

function applyFixMatch(api_key, cv_id, new_title) {
	if (!confirm(
		`Re-match this volume to "${new_title}" (CV ID: ${cv_id})?\n\n` +
		`All existing issues will be deleted and re-fetched from ComicVine.`
	)) return;

	sendAPI('PUT', `/volumes/${currentFixVolumeId}/rematch`, api_key, {}, {comicvine_id: cv_id})
	.then(() => {
		closeWindow();
		return fetchAPI(`/volumes/${currentFixVolumeId}`, api_key);
	})
	.then(json => {
		const idx = allVolumes.findIndex(v => v.id === currentFixVolumeId);
		if (idx !== -1) allVolumes[idx] = json.result;
		renderTable(FCEls.filter.value);
	});
}

// code run on load

usingApiKey()
.then(api_key => {
	hide([FCEls.no_results, FCEls.table_container], [FCEls.loading]);

	fetchAPI('/volumes', api_key)
	.then(json => {
		allVolumes = json.result;
		hide([FCEls.loading]);
		renderTable(FCEls.filter.value);
	});

	document.querySelector('#fc-fix-search-btn').onclick = () => searchFixMatch(api_key);
	document.querySelector('#fc-fix-input').onkeydown = e => {
		if (e.key === 'Enter') searchFixMatch(api_key);
	};
});

FCEls.filter.onchange = () => renderTable(FCEls.filter.value);
