window.onerror = (msg, src, line, col, err) => {
	const summary = document.querySelector('#fc-summary');
	if (summary) summary.innerText = `JS error at ${src}:${line} — ${msg}`;
};

let currentFixVolumeId = null;
let allVolumes = [];

const FCEls = {
	filter: document.querySelector('#fc-filter'),
	summary: document.querySelector('#fc-summary'),
	tbody: document.querySelector('#fc-tbody'),
	loading: document.querySelector('#fc-loading'),
	table_container: document.querySelector('#fc-table-container'),
	no_results: document.querySelector('#fc-no-results'),
	autosuggest_btn: document.querySelector('#fc-autosuggest-btn'),
	cancel_suggest_btn: document.querySelector('#fc-cancel-suggest-btn'),
	apply_accepted_btn: document.querySelector('#fc-apply-accepted-btn'),
	suggest_progress: document.querySelector('#fc-suggest-progress'),
	pre_build: {
		row: document.querySelector('.pre-build-els .fc-volume-row'),
		search_result: document.querySelector('.pre-build-els .fc-search-result')
	}
};

const suggestions = new Map(); // volume id → {cvId, title, year, publisher, type} | null
let autoSuggestActive = false;
let autoSuggestCancelled = false;
const delay = ms => new Promise(r => setTimeout(r, ms));

function stripHtml(html) {
	if (!html) return '';
	const tmp = document.createElement('div');
	tmp.innerHTML = html;
	return tmp.innerText.trim();
}

function inferType(title, description) {
	const plain = stripHtml(description).toLowerCase();
	if (/trade\s*paperback/.test(plain)) return 'TPB';
	if (/\bhardcover\b/.test(plain)) return 'HC';
	if (/\bomnibus\b/.test(plain) || /\bomnibus\b/i.test(title || '')) return 'Omnibus';
	if (/one[- ]shot/.test(plain)) return 'One-Shot';
	return 'Standard';
}

let fcsResults = [];
let fcsSortState = { key: null, dir: 1 };

function renderFcSearchResults(api_key) {
	const tbody = document.querySelector('#fc-fix-result-table tbody');
	tbody.innerHTML = '';

	let sorted = [...fcsResults];
	if (fcsSortState.key) {
		sorted.sort((a, b) => {
			let va = a[fcsSortState.key] ?? '';
			let vb = b[fcsSortState.key] ?? '';
			if (typeof va === 'string') va = va.toLowerCase();
			if (typeof vb === 'string') vb = vb.toLowerCase();
			return va < vb ? -fcsSortState.dir : va > vb ? fcsSortState.dir : 0;
		});
	}

	sorted.forEach(r => {
		const row = FCEls.pre_build.search_result.cloneNode(true);
		row.dataset.cv_id = r.comicvine_id;
		row.querySelector('.fcs-title').innerText = r.title;
		row.querySelector('.fcs-year').innerText = r.year ?? '—';
		row.querySelector('.fcs-issues').innerText = r.issue_count ?? '—';
		row.querySelector('.fcs-publisher').innerText = r.publisher ?? '—';
		row.querySelector('.fcs-type').innerText = r._type;
		row.querySelector('.fcs-select-btn').onclick = () => applyFixMatch(api_key, r.comicvine_id, r.title);
		tbody.appendChild(row);
	});

	document.querySelectorAll('#fc-fix-result-table thead th[data-sort-key]').forEach(th => {
		const key = th.dataset.sortKey;
		const label = th.dataset.baseLabel || th.innerText.replace(/\s*[▲▼]$/, '').trim();
		th.dataset.baseLabel = label;
		th.innerText = label + (key === fcsSortState.key ? (fcsSortState.dir === 1 ? ' ▲' : ' ▼') : '');
	});
}

function normStr(s) {
	if (!s) return '';
	return s.toLowerCase()
		.replace(/\(\d{4}\)/g, '')
		.replace(/[:\\*?"<>|,]/g, '')
		.replace(/'/g, '')  // ASCII apostrophe to nothing ("Asgard's" == "Asgards")
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function isMismatch(folder, title) {
	if (!folder || !title) return false;
	const parts = folder.replace(/\\/g, '/').split('/');
	const folderBase = parts[parts.length - 1] || parts[parts.length - 2] || '';
	const nf = normStr(folderBase);
	const nt = normStr(title);
	if (!nf || !nt) return false;
	return !nf.includes(nt) && !nt.includes(nf);
}

const FOREIGN_SIGNALS = [
	'verlag', 'deutschland', 'deutsch', 'gmbh',
	'éditions', 'editeur', 'française',
	'editore', 'edizioni', 'planeta',
	'carlsen', 'egmont ehapa', 'splitter', 'cross cult',
	'glenat', 'glénat',
];

function isForeignPublisher(publisher) {
	if (!publisher) return false;
	const p = publisher.toLowerCase();
	return FOREIGN_SIGNALS.some(sig => p.includes(sig));
}

function makeStatusCell(nameMismatch, langFlag, publisher) {
	const frag = document.createDocumentFragment();
	if (nameMismatch) {
		const span = document.createElement('span');
		span.className = 'status-review';
		span.innerText = 'Review';
		frag.appendChild(span);
	}
	if (langFlag) {
		if (nameMismatch) frag.appendChild(document.createTextNode(' '));
		const span = document.createElement('span');
		span.className = 'status-language';
		span.innerText = 'Language?';
		if (publisher) span.title = publisher;
		frag.appendChild(span);
	}
	if (!nameMismatch && !langFlag) {
		const span = document.createElement('span');
		span.className = 'status-ok';
		span.innerText = 'OK';
		frag.appendChild(span);
	}
	return frag;
}

function renderTable(filter) {
	FCEls.tbody.innerHTML = '';

	const nameMismatches = allVolumes.filter(v => isMismatch(v.folder, v.title));
	const langFlags = allVolumes.filter(v => isForeignPublisher(v.publisher));

	let summary = `${allVolumes.length} volumes — ${nameMismatches.length} name mismatch${nameMismatches.length !== 1 ? 'es' : ''}`;
	if (langFlags.length)
		summary += `, ${langFlags.length} language flag${langFlags.length !== 1 ? 's' : ''}`;
	FCEls.summary.innerText = summary;

	let volumes;
	if (filter === 'name')     volumes = nameMismatches;
	else if (filter === 'language') volumes = langFlags;
	else if (filter === 'any') volumes = allVolumes.filter(v => isMismatch(v.folder, v.title) || isForeignPublisher(v.publisher));
	else                       volumes = allVolumes;

	if (!volumes.length) {
		hide([FCEls.table_container], [FCEls.no_results]);
		return;
	}
	hide([FCEls.no_results], [FCEls.table_container]);

	const hasSuggestions = suggestions.size > 0 || autoSuggestActive;
	document.querySelectorAll('#fc-table thead .fc-suggest-col').forEach(th =>
		th.classList.toggle('hidden', !hasSuggestions)
	);

	volumes.forEach(v => {
		const row = FCEls.pre_build.row.cloneNode(true);
		row.dataset.id = v.id;
		row.dataset.cv_id = v.comicvine_id;

		const parts = (v.folder || '').replace(/\\/g, '/').split('/');
		const folderBase = parts[parts.length - 1] || parts[parts.length - 2] || v.folder || '';
		const folderEl = row.querySelector('.fc-folder');
		folderEl.innerText = folderBase;
		folderEl.title = v.folder;

		const titleEl = row.querySelector('.fc-title');
		const titleLink = document.createElement('a');
		titleLink.href = `${url_base}/volumes/${v.id}`;
		titleLink.innerText = v.title;
		titleEl.appendChild(titleLink);
		row.querySelector('.fc-year').innerText = v.year ?? '—';
		row.querySelector('.fc-issues').innerText =
			`${v.issues_downloaded ?? '?'} / ${v.issue_count ?? '?'}`;
		row.querySelector('.fc-publisher').innerText = v.publisher ?? '—';
		row.querySelector('.fc-type').innerText = v.special_version?.toUpperCase() ?? 'Standard';

		const nameMismatch = isMismatch(v.folder, v.title);
		const langFlag = isForeignPublisher(v.publisher);
		const statusEl = row.querySelector('.fc-status');
		statusEl.innerHTML = '';
		statusEl.appendChild(makeStatusCell(nameMismatch, langFlag, v.publisher));

		const sugEl = row.querySelector('.fc-suggested');
		const acceptEl = row.querySelector('.fc-accept');
		if (hasSuggestions) {
			sugEl.classList.remove('hidden');
			acceptEl.classList.remove('hidden');
			if (suggestions.has(v.id)) {
				applySuggestionToRow(sugEl, acceptEl, suggestions.get(v.id));
			} else {
				sugEl.innerText = '…';
				acceptEl.querySelector('.fc-accept-cb').disabled = true;
			}
		}

		row.querySelector('.fc-goto').href = `${url_base}/volumes/${v.id}`;
		row.querySelector('.fc-fix-btn').onclick = () => openFixMatch(v);

		FCEls.tbody.appendChild(row);
	});
}

function applySuggestionToRow(sugEl, acceptEl, sug) {
	const cb = acceptEl.querySelector('.fc-accept-cb');
	if (sug) {
		sugEl.innerText = `${sug.title} (${sug.year ?? '?'}) · ${sug.issues ?? '?'} iss · ${sug.publisher ?? '?'} · ${sug.type}`;
		sugEl.dataset.cvId = sug.cvId;
		sugEl.dataset.title = sug.title;
		cb.checked = true;
		cb.disabled = false;
	} else {
		sugEl.innerText = 'No results';
		delete sugEl.dataset.cvId;
		cb.checked = false;
		cb.disabled = true;
	}
}

function openFixMatch(volume) {
	currentFixVolumeId = volume.id;
	document.querySelector('#fc-fix-label').innerText =
		`Re-matching: ${volume.title}${volume.year ? ' (' + volume.year + ')' : ''}`;
	const parts = (volume.folder || '').replace(/\\/g, '/').split('/');
	const folderBase = parts[parts.length - 1] || parts[parts.length - 2] || '';
	document.querySelector('#fc-fix-input').value = folderBase.replace(/\s*\(\d{4}\)\s*$/, '').trim();
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

	msgEl.innerText = 'Searching...';
	tableEl.classList.add('hidden');
	fcsResults = [];
	fcsSortState = { key: null, dir: 1 };

	fetchAPI('/volumes/search', api_key, {query})
	.then(json => {
		if (!json.result.length) {
			msgEl.innerText = 'No results found.';
			return;
		}
		msgEl.innerText = '';
		fcsResults = json.result.map(r => ({ ...r, _type: inferType(r.title, r.description) }));
		renderFcSearchResults(api_key);
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

	const volumeId = currentFixVolumeId;
	sendAPI('PUT', `/volumes/${volumeId}/rematch`, api_key, {}, {comicvine_id: cv_id, new_title})
	.then(r => r.json())
	.then(() => {
		document.querySelector('#fc-fix-search-bar').classList.add('hidden');
		document.querySelector('#fc-fix-result-table').classList.add('hidden');
		document.querySelector('#fc-fix-message').innerText =
			'Rematching… fetching new metadata from ComicVine. You will be redirected when complete.';
		document.querySelectorAll('#fc-fix-window button').forEach(b => b.disabled = true);
		pollVolumeReadyThenNavigate(api_key, volumeId);
	});
}

function pollVolumeReadyThenNavigate(api_key, volume_id, attempts = 0) {
	if (attempts >= 60) {
		window.location.href = `${url_base}/volumes/${volume_id}`;
		return;
	}
	fetchAPI(`/volumes/${volume_id}`, api_key)
	.then(json => {
		if (json.result.issue_count > 0) {
			window.location.href = `${url_base}/volumes/${volume_id}`;
		} else {
			setTimeout(() => pollVolumeReadyThenNavigate(api_key, volume_id, attempts + 1), 1000);
		}
	})
	.catch(() => {
		setTimeout(() => pollVolumeReadyThenNavigate(api_key, volume_id, attempts + 1), 1000);
	});
}

function waitForVolumeReady(api_key, volume_id) {
	return new Promise(resolve => {
		let attempts = 0;
		function poll() {
			if (attempts >= 60) { resolve(); return; }
			attempts++;
			fetchAPI(`/volumes/${volume_id}`, api_key)
			.then(json => {
				if ((json.result.issue_count ?? 0) > 0) resolve();
				else setTimeout(poll, 1000);
			})
			.catch(() => setTimeout(poll, 1000));
		}
		poll();
	});
}

async function autoSuggest(api_key) {
	const mismatches = allVolumes.filter(v => isMismatch(v.folder, v.title));
	const toProcess = mismatches.slice(0, 50);

	if (!toProcess.length) {
		FCEls.suggest_progress.innerText = 'No name mismatches to process.';
		return;
	}

	autoSuggestActive = true;
	autoSuggestCancelled = false;
	suggestions.clear();

	FCEls.autosuggest_btn.disabled = true;
	FCEls.cancel_suggest_btn.classList.remove('hidden');
	FCEls.apply_accepted_btn.classList.add('hidden');

	document.querySelectorAll('#fc-table thead .fc-suggest-col').forEach(th =>
		th.classList.remove('hidden')
	);

	const capped = mismatches.length > 50;
	const prefix = capped ? `Processing first 50 of ${mismatches.length} mismatches. ` : '';

	for (let i = 0; i < toProcess.length; i++) {
		if (autoSuggestCancelled) break;

		const v = toProcess[i];
		FCEls.suggest_progress.innerText = `${prefix}Searching ${i + 1} / ${toProcess.length}…`;

		const parts = (v.folder || '').replace(/\\/g, '/').split('/');
		const folderBase = parts[parts.length - 1] || parts[parts.length - 2] || '';
		const query = folderBase.replace(/\s*\(\d{4}\)\s*$/, '').trim();

		try {
			const json = await fetchAPI('/volumes/search', api_key, {query});
			const top = json.result[0] ?? null;
			suggestions.set(v.id, top ? {
				cvId: top.comicvine_id,
				title: top.title,
				year: top.year,
				issues: top.issue_count,
				publisher: top.publisher,
				type: inferType(top.title, top.description)
			} : null);
		} catch {
			suggestions.set(v.id, null);
		}

		const row = FCEls.tbody.querySelector(`tr[data-id="${v.id}"]`);
		if (row) {
			const sugEl = row.querySelector('.fc-suggested');
			const acceptEl = row.querySelector('.fc-accept');
			sugEl.classList.remove('hidden');
			acceptEl.classList.remove('hidden');
			applySuggestionToRow(sugEl, acceptEl, suggestions.get(v.id));
		}

		if (i < toProcess.length - 1 && !autoSuggestCancelled) await delay(1500);
	}

	autoSuggestActive = false;
	FCEls.cancel_suggest_btn.classList.add('hidden');
	FCEls.autosuggest_btn.disabled = false;

	const processed = [...suggestions.keys()].length;
	const found = [...suggestions.values()].filter(s => s !== null).length;
	FCEls.suggest_progress.innerText =
		(autoSuggestCancelled ? 'Cancelled. ' : '') +
		`${found} suggestion${found !== 1 ? 's' : ''} found across ${processed} volumes.` +
		(capped && !autoSuggestCancelled ? ` (${mismatches.length - 50} remaining mismatches not searched)` : '');

	if (found > 0) FCEls.apply_accepted_btn.classList.remove('hidden');
}

function cancelAutoSuggest() {
	autoSuggestCancelled = true;
}

async function applyAccepted(api_key) {
	const rows = [...FCEls.tbody.querySelectorAll('tr.fc-volume-row')];
	const toApply = rows
		.filter(row => {
			const cb = row.querySelector('.fc-accept-cb');
			return cb && cb.checked && !cb.disabled;
		})
		.map(row => ({
			volumeId: parseInt(row.dataset.id),
			cvId: parseInt(row.querySelector('.fc-suggested').dataset.cvId),
			title: row.querySelector('.fc-suggested').dataset.title
		}));

	if (!toApply.length) {
		FCEls.suggest_progress.innerText = 'No accepted suggestions to apply.';
		return;
	}

	FCEls.apply_accepted_btn.disabled = true;
	FCEls.autosuggest_btn.disabled = true;

	let successes = 0;
	for (let i = 0; i < toApply.length; i++) {
		const { volumeId, cvId, title } = toApply[i];
		FCEls.suggest_progress.innerText = `Applying ${i + 1} / ${toApply.length}: ${title}…`;
		try {
			await sendAPI('PUT', `/volumes/${volumeId}/rematch`, api_key, {}, {comicvine_id: cvId, new_title: title});
			await waitForVolumeReady(api_key, volumeId);
			successes++;
		} catch {
			// continue with remaining
		}
	}

	FCEls.suggest_progress.innerText = `Applied ${successes} rematch${successes !== 1 ? 'es' : ''}. Refreshing…`;

	suggestions.clear();
	FCEls.apply_accepted_btn.classList.add('hidden');
	FCEls.apply_accepted_btn.disabled = false;
	FCEls.autosuggest_btn.disabled = false;

	fetchAPI('/volumes', api_key).then(json => {
		allVolumes = json.result;
		renderTable(FCEls.filter.value);
		const remaining = allVolumes.filter(v => isMismatch(v.folder, v.title)).length;
		FCEls.suggest_progress.innerText =
			`Done. ${remaining} name mismatch${remaining !== 1 ? 'es' : ''} remaining.`;
	});
}

// code run on load

FCEls.summary.innerText = 'Waiting for auth…';

usingApiKey()
.then(api_key => {
	FCEls.summary.innerText = 'Fetching volumes…';
	hide([FCEls.no_results, FCEls.table_container], [FCEls.loading]);

	fetchAPI('/volumes', api_key)
	.then(json => {
		allVolumes = json.result;
		hide([FCEls.loading]);
		renderTable(FCEls.filter.value);
	})
	.catch(err => {
		FCEls.summary.innerText = `API error: ${err && err.status ? 'HTTP ' + err.status : err}`;
		hide([FCEls.loading], [FCEls.no_results]);
		FCEls.no_results.innerText = 'Failed to load volumes.';
	});

	document.querySelector('#fc-fix-search-btn').onclick = () => searchFixMatch(api_key);
	document.querySelector('#fc-fix-input').onkeydown = e => {
		if (e.key === 'Enter') searchFixMatch(api_key);
	};

	document.querySelectorAll('#fc-fix-result-table thead th[data-sort-key]').forEach(th => {
		th.style.cursor = 'pointer';
		th.onclick = () => {
			const key = th.dataset.sortKey;
			if (fcsSortState.key === key) {
				fcsSortState.dir *= -1;
			} else {
				fcsSortState.key = key;
				fcsSortState.dir = 1;
			}
			if (fcsResults.length) renderFcSearchResults(api_key);
		};
	});

	FCEls.autosuggest_btn.onclick = () => autoSuggest(api_key);
	FCEls.cancel_suggest_btn.onclick = () => cancelAutoSuggest();
	FCEls.apply_accepted_btn.onclick = () => applyAccepted(api_key);
})
.catch(err => {
	FCEls.summary.innerText = `Auth error: ${err}`;
	hide([FCEls.loading], [FCEls.no_results]);
	FCEls.no_results.innerText = 'Authentication failed — try refreshing.';
});

FCEls.filter.onchange = () => renderTable(FCEls.filter.value);
