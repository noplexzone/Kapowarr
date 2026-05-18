const PAGE_SIZE = 50;

const DiscEls = {
	pre_build: {
		card: document.querySelector('.pre-build-els .disc-card'),
		issue_card: document.querySelector('.pre-build-els .disc-issue-card'),
	},
	tabs: document.querySelectorAll('.disc-tab'),
	grids: {
		upcoming: document.querySelector('#disc-grid-upcoming'),
		new: document.querySelector('#disc-grid-new'),
	},
	paginations: {
		upcoming: document.querySelector('#disc-pagination-upcoming'),
		new: document.querySelector('#disc-pagination-new'),
	},
	msgs: {
		no_cv: document.querySelector('#disc-no-cv'),
		error: document.querySelector('#disc-error'),
		empty: document.querySelector('#disc-empty'),
		retry: document.querySelector('#disc-retry-btn'),
	},
	window: {
		cover: document.querySelector('#disc-add-cover'),
		title: document.querySelector('#disc-add-title'),
		cv_id: document.querySelector('#disc-cv-id-input'),
		root_folder: document.querySelector('#disc-rootfolder-input'),
		monitor: document.querySelector('#disc-monitor-input'),
		scheme: document.querySelector('#disc-scheme-input'),
		auto_search: document.querySelector('#disc-autosearch-input'),
		submit: document.querySelector('#disc-add-submit'),
		form: document.querySelector('#disc-add-form'),
	},
};

const tab_results = { upcoming: [], new: [] };
const tab_pages  = { upcoming: 0, new: 0 };
const loaded     = { upcoming: false, new: false };
let current_tab = 'upcoming';
let cached_api_key = null;

//
// Root folders
//
function fillRootFolders(api_key) {
	fetchAPI('/rootfolder', api_key)
	.then(json => {
		DiscEls.window.root_folder.innerHTML = '';
		json.result.forEach(folder => {
			const opt = document.createElement('option');
			opt.value = folder.id;
			opt.innerText = folder.folder;
			DiscEls.window.root_folder.appendChild(opt);
		});
	});
}

//
// Card builders
//
function buildVolumeCard(result) {
	const card = DiscEls.pre_build.card.cloneNode(true);
	card.dataset.cvId = result.comicvine_id;

	const cover_link = card.querySelector('.disc-card-cover');
	cover_link.href = result.site_url;

	const img = card.querySelector('img');
	if (result.cover_link) {
		img.src = result.cover_link;
		img.alt = result.title;
	} else {
		img.remove();
	}

	const badge = card.querySelector('.disc-in-library');
	if (result.already_added !== null && result.already_added !== undefined) {
		badge.classList.remove('hidden');
	}

	card.querySelector('.disc-card-title').innerText = result.title;

	const meta_parts = [];
	if (result.year) meta_parts.push(result.year);
	if (result.publisher) meta_parts.push(result.publisher);
	card.querySelector('.disc-card-meta').innerText = meta_parts.join(' · ');

	const issue_str = `${result.issue_count} issue${result.issue_count !== 1 ? 's' : ''}`;
	card.querySelector('.disc-card-issues').innerText =
		result.date_added ? `${issue_str} · ${result.date_added}` : issue_str;

	const btn = card.querySelector('.disc-add-btn');
	if (result.already_added !== null && result.already_added !== undefined) {
		btn.innerText = 'In Library';
		btn.disabled = true;
	} else {
		btn.onclick = e => {
			e.preventDefault();
			openAddWindow(result);
		};
	}
	return card;
}

function buildIssueCard(result) {
	const card = DiscEls.pre_build.issue_card.cloneNode(true);
	card.dataset.volumeCvId = result.volume_id;

	const cover_link = card.querySelector('.disc-card-cover');
	cover_link.href = result.site_url;

	const img = card.querySelector('img');
	if (result.cover_link) {
		img.src = result.cover_link;
		img.alt = result.volume_title || result.title;
	} else {
		img.remove();
	}

	const badge = card.querySelector('.disc-in-library');
	if (result.already_added !== null && result.already_added !== undefined) {
		badge.classList.remove('hidden');
	}

	card.querySelector('.disc-card-title').innerText = result.volume_title || result.title;

	const issue_num = result.issue_number !== null ? `#${result.issue_number}` : '';
	card.querySelector('.disc-card-issue-num').innerText =
		[result.title, issue_num].filter(Boolean).join(' ');
	card.querySelector('.disc-card-date').innerText = result.cover_date || '';

	const btn = card.querySelector('.disc-add-btn');
	if (result.already_added !== null && result.already_added !== undefined) {
		btn.innerText = 'In Library';
		btn.disabled = true;
	} else {
		btn.onclick = e => {
			e.preventDefault();
			openAddWindow({
				comicvine_id: result.volume_id,
				title: result.volume_title || result.title,
				cover_link: result.cover_link,
				already_added: null,
			});
		};
	}
	return card;
}

//
// Pagination helpers
//
function renderPage(tab) {
	const all  = tab_results[tab];
	const page = tab_pages[tab];
	const start = page * PAGE_SIZE;
	const slice = all.slice(start, start + PAGE_SIZE);
	const grid  = DiscEls.grids[tab];
	const pgn   = DiscEls.paginations[tab];

	grid.innerHTML = '';
	slice.forEach(r => {
		if (tab === 'upcoming') {
			grid.appendChild(buildIssueCard(r));
		} else {
			grid.appendChild(buildVolumeCard(r));
		}
	});

	const total_pages = Math.ceil(all.length / PAGE_SIZE);
	if (total_pages > 1) {
		pgn.querySelector('.disc-page-indicator').innerText =
			`Page ${page + 1} of ${total_pages}`;
		pgn.querySelector('.disc-page-prev').disabled = page === 0;
		pgn.querySelector('.disc-page-next').disabled = page === total_pages - 1;
		pgn.classList.remove('hidden');
	} else {
		pgn.classList.add('hidden');
	}
}

//
// Loading data
//
function prefetchTab(tab, api_key) {
	if (loaded[tab]) return;
	fetchAPI('/discovery', api_key, { type: tab })
	.then(json => {
		if (loaded[tab]) return;
		loaded[tab] = true;
		tab_results[tab] = json.result;
		tab_pages[tab] = 0;
		if (json.result.length) {
			renderPage(tab);
			DiscEls.paginations[tab].classList.add('hidden');
		}
	})
	.catch(() => {});
}

function loadTab(tab, api_key) {
	const allGrids = Object.values(DiscEls.grids);
	const allPgns  = Object.values(DiscEls.paginations);

	if (loaded[tab]) {
		if (!tab_results[tab].length) {
			hide([...allGrids, ...allPgns, DiscEls.msgs.error, DiscEls.msgs.no_cv], [DiscEls.msgs.empty]);
		} else {
			showTab(tab);
		}
		return;
	}

	hide([DiscEls.msgs.error, DiscEls.msgs.empty, DiscEls.msgs.no_cv, ...allGrids, ...allPgns]);
	showWindow('disc-loading-window');

	fetchAPI('/discovery', api_key, { type: tab })
	.then(json => {
		loaded[tab] = true;
		tab_results[tab] = json.result;
		tab_pages[tab] = 0;
		closeWindow();
		if (!json.result.length) {
			hide(allGrids, [DiscEls.msgs.empty]);
			return;
		}
		hide([DiscEls.msgs.empty, DiscEls.msgs.error]);
		renderPage(tab);
		DiscEls.grids[tab].classList.remove('hidden');
	})
	.catch(e => {
		closeWindow();
		const showNoCV = () => hide([...allGrids, DiscEls.msgs.empty, DiscEls.msgs.error], [DiscEls.msgs.no_cv]);
		const showErr  = () => hide([...allGrids, DiscEls.msgs.empty], [DiscEls.msgs.error]);
		if (e && e.json) {
			e.json().then(j => {
				if (j.error === 'InvalidComicVineApiKey' || j.error === 'NoComicVineApiKey') showNoCV();
				else showErr();
			}).catch(showErr);
		} else {
			showErr();
		}
	});
}

function showTab(tab) {
	const grid = DiscEls.grids[tab];
	const pgn  = DiscEls.paginations[tab];
	Object.values(DiscEls.grids).forEach(g => { if (g !== grid) g.classList.add('hidden'); });
	Object.values(DiscEls.paginations).forEach(p => { if (p !== pgn) p.classList.add('hidden'); });
	hide([DiscEls.msgs.empty, DiscEls.msgs.error]);
	grid.classList.remove('hidden');
	const total_pages = Math.ceil(tab_results[tab].length / PAGE_SIZE);
	if (total_pages > 1) pgn.classList.remove('hidden');
}

//
// Add window
//
function openAddWindow(volume) {
	DiscEls.window.cover.src = volume.cover_link || '';
	DiscEls.window.title.innerText = volume.title;
	DiscEls.window.cv_id.value = volume.comicvine_id;

	const prefs = getLocalStorage('monitor_new_volume', 'monitoring_scheme', 'disc_auto_search');
	DiscEls.window.monitor.value = prefs.monitor_new_volume ? 'true' : 'false';
	DiscEls.window.scheme.value = prefs.monitoring_scheme || 'all';
	DiscEls.window.auto_search.checked = prefs.disc_auto_search !== false;

	showWindow('disc-add-window');
}

function submitAdd() {
	showLoadWindow('disc-add-window');

	const base_data = {
		root_folder_id: parseInt(DiscEls.window.root_folder.value),
		monitor: DiscEls.window.monitor.value === 'true',
		monitoring_scheme: DiscEls.window.scheme.value,
		monitor_new_issues: DiscEls.window.monitor.value === 'true',
		volume_folder: '',
		auto_search: DiscEls.window.auto_search.checked,
	};

	setLocalStorage({
		monitor_new_volume: base_data.monitor,
		monitoring_scheme: base_data.monitoring_scheme,
		disc_auto_search: base_data.auto_search,
	});

	const data = { ...base_data, comicvine_id: parseInt(DiscEls.window.cv_id.value) };
	usingApiKey()
	.then(api_key => {
		sendAPI('POST', '/volumes', api_key, {}, data)
		.then(r => r.json())
		.then(json => {
			markAddedInGrids(data.comicvine_id, json.result.id);
			closeWindow();
		})
		.catch(e => {
			if (e.status === 509) {
				DiscEls.window.submit.innerText = 'ComicVine rate limit reached';
				showWindow('disc-add-window');
			} else if (e.status === 400) {
				DiscEls.window.submit.innerText = 'Volume folder conflict';
				showWindow('disc-add-window');
			} else {
				closeWindow();
			}
		});
	});
}

function markAddedInGrids(cv_id, library_id) {
	document.querySelectorAll('.disc-card').forEach(card => {
		if (parseInt(card.dataset.cvId) === cv_id) {
			card.querySelector('.disc-in-library').classList.remove('hidden');
			const btn = card.querySelector('.disc-add-btn');
			btn.innerText = 'In Library';
			btn.disabled = true;
			btn.onclick = null;
		}
	});
	document.querySelectorAll('.disc-issue-card').forEach(card => {
		if (parseInt(card.dataset.volumeCvId) === cv_id) {
			card.querySelector('.disc-in-library').classList.remove('hidden');
			const btn = card.querySelector('.disc-add-btn');
			btn.innerText = 'In Library';
			btn.disabled = true;
			btn.onclick = null;
		}
	});
}

//
// Tab switching
//
function switchTab(tab) {
	current_tab = tab;
	DiscEls.tabs.forEach(btn => {
		btn.classList.toggle('active', btn.dataset.tab === tab);
	});
	loadTab(tab, cached_api_key);
}

// code run on load

usingApiKey()
.then(api_key => {
	cached_api_key = api_key;
	fillRootFolders(api_key);
	loadTab(current_tab, api_key);

	['new']
		.filter(t => t !== current_tab)
		.forEach(t => prefetchTab(t, api_key));
});

DiscEls.tabs.forEach(btn => {
	btn.onclick = () => switchTab(btn.dataset.tab);
});

DiscEls.msgs.retry.onclick = () => {
	loaded[current_tab] = false;
	loadTab(current_tab, cached_api_key);
};

Object.keys(DiscEls.paginations).forEach(tab => {
	const pgn = DiscEls.paginations[tab];
	pgn.querySelector('.disc-page-prev').onclick = () => {
		if (tab_pages[tab] > 0) {
			tab_pages[tab]--;
			renderPage(tab);
			DiscEls.grids[tab].scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	};
	pgn.querySelector('.disc-page-next').onclick = () => {
		const max = Math.ceil(tab_results[tab].length / PAGE_SIZE) - 1;
		if (tab_pages[tab] < max) {
			tab_pages[tab]++;
			renderPage(tab);
			DiscEls.grids[tab].scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	};
});

DiscEls.window.form.action = 'javascript:submitAdd();';
