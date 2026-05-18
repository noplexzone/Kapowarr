const PAGE_SIZE = 50;

const DiscEls = {
	pre_build: {
		card: document.querySelector('.pre-build-els .disc-card'),
		issue_card: document.querySelector('.pre-build-els .disc-issue-card'),
		arc_card: document.querySelector('.pre-build-els .disc-arc-card'),
		arc_vol_row: document.querySelector('.pre-build-els .disc-arc-vol-row'),
	},
	tabs: document.querySelectorAll('.disc-tab'),
	grids: {
		upcoming: document.querySelector('#disc-grid-upcoming'),
		new: document.querySelector('#disc-grid-new'),
		popular: document.querySelector('#disc-grid-popular'),
		arcs: document.querySelector('#disc-grid-arcs'),
	},
	paginations: {
		upcoming: document.querySelector('#disc-pagination-upcoming'),
		new: document.querySelector('#disc-pagination-new'),
		popular: document.querySelector('#disc-pagination-popular'),
		arcs: document.querySelector('#disc-pagination-arcs'),
	},
	msgs: {
		no_cv: document.querySelector('#disc-no-cv'),
		error: document.querySelector('#disc-error'),
		empty: document.querySelector('#disc-empty'),
		retry: document.querySelector('#disc-retry-btn'),
	},
	arc_search_bar: document.querySelector('#disc-arc-search-bar'),
	arc_input: document.querySelector('#disc-arc-input'),
	arc_search_btn: document.querySelector('#disc-arc-search-btn'),
	arc_window: {
		cover: document.querySelector('#disc-arc-cover'),
		name: document.querySelector('#disc-arc-name-display'),
		deck: document.querySelector('#disc-arc-deck-display'),
		load_msg: document.querySelector('#disc-arc-load-msg'),
		vol_list: document.querySelector('#disc-arc-vol-list'),
		add_all: document.querySelector('#disc-arc-add-all'),
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

const tab_results = { upcoming: [], new: [], popular: [], arcs: [] };
const tab_pages  = { upcoming: 0, new: 0, popular: 0, arcs: 0 };
const loaded     = { upcoming: false, new: false, popular: false, arcs: false };
let current_tab = 'upcoming';
let cached_api_key = null;
let arc_query = '';
let current_arc_id = null;
let pending_arc_volumes = [];

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

function buildArcCard(arc, api_key) {
	const card = DiscEls.pre_build.arc_card.cloneNode(true);
	card.dataset.arcId = arc.id;

	const cover_link = card.querySelector('.disc-card-cover');
	cover_link.href = arc.site_url || '';

	const img = card.querySelector('img');
	if (arc.cover_link) {
		img.src = arc.cover_link;
		img.alt = arc.name;
	} else {
		img.remove();
	}

	card.querySelector('.disc-arc-card-name').innerText = arc.name;
	card.querySelector('.disc-arc-card-deck').innerText = arc.deck || '';

	const info_parts = [];
	if (arc.issue_count) info_parts.push(`${arc.issue_count} issue${arc.issue_count !== 1 ? 's' : ''}`);
	if (arc.publisher) info_parts.push(arc.publisher);
	card.querySelector('.disc-arc-card-issues').innerText = info_parts.join(' · ');

	card.querySelector('.disc-arc-view-btn').onclick = e => {
		e.preventDefault();
		openArcDetail(arc.id, api_key);
	};
	return card;
}

//
// Arc detail window
//
function openArcDetail(arc_id, api_key) {
	current_arc_id = arc_id;
	pending_arc_volumes = [];
	DiscEls.arc_window.load_msg.innerText = 'Loading volumes…';
	DiscEls.arc_window.load_msg.classList.remove('hidden');
	DiscEls.arc_window.vol_list.innerHTML = '';
	DiscEls.arc_window.cover.src = '';
	DiscEls.arc_window.name.innerText = '';
	DiscEls.arc_window.deck.innerText = '';
	DiscEls.arc_window.add_all.disabled = true;
	DiscEls.arc_window.add_all.innerText = 'Add All Unowned';
	document.querySelector('#disc-arc-window h2').innerText = 'Story Arc';
	showWindow('disc-arc-window');

	fetchAPI(`/discovery/story-arc/${arc_id}`, api_key)
	.then(json => {
		DiscEls.arc_window.load_msg.classList.add('hidden');
		renderArcWindow(json.result, api_key);
	})
	.catch(() => {
		DiscEls.arc_window.load_msg.innerText = 'Failed to load arc volumes.';
	});
}

function renderArcWindow(arc_data, api_key) {
	const { arc, volumes } = arc_data;

	document.querySelector('#disc-arc-window h2').innerText = arc.name;
	DiscEls.arc_window.cover.src = arc.cover_link || '';
	DiscEls.arc_window.cover.style.display = arc.cover_link ? '' : 'none';
	DiscEls.arc_window.name.innerText = arc.name;
	DiscEls.arc_window.deck.innerText = arc.deck || '';

	if (!volumes.length) {
		DiscEls.arc_window.load_msg.innerText = 'No English-language volumes found in this arc.';
		DiscEls.arc_window.load_msg.classList.remove('hidden');
		return;
	}

	const listEl = DiscEls.arc_window.vol_list;
	listEl.innerHTML = '';
	pending_arc_volumes = [];

	volumes.forEach(vol => {
		const row = DiscEls.pre_build.arc_vol_row.cloneNode(true);
		row.dataset.cvId = vol.comicvine_id;

		const thumb = row.querySelector('.disc-arc-vol-thumb');
		thumb.href = vol.site_url || '';

		const img = row.querySelector('img');
		if (vol.cover_link) {
			img.src = vol.cover_link;
			img.alt = vol.title;
		} else {
			img.remove();
		}

		if (vol.already_added !== null && vol.already_added !== undefined) {
			row.querySelector('.disc-in-library').classList.remove('hidden');
		}

		row.querySelector('.disc-arc-vol-title').innerText = vol.title;

		const meta_parts = [];
		if (vol.year) meta_parts.push(vol.year);
		if (vol.publisher) meta_parts.push(vol.publisher);
		if (vol.issue_count) meta_parts.push(`${vol.issue_count} issue${vol.issue_count !== 1 ? 's' : ''}`);
		row.querySelector('.disc-arc-vol-meta').innerText = meta_parts.join(' · ');

		const btn = row.querySelector('.disc-arc-vol-add');
		if (vol.already_added !== null && vol.already_added !== undefined) {
			btn.innerText = 'In Library';
			btn.disabled = true;
		} else {
			pending_arc_volumes.push(vol);
			btn.onclick = () => {
				openAddWindow(vol);
			};
		}

		listEl.appendChild(row);
	});

	if (pending_arc_volumes.length > 0) {
		DiscEls.arc_window.add_all.disabled = false;
		DiscEls.arc_window.add_all.innerText =
			`Add All Unowned (${pending_arc_volumes.length})`;
	} else {
		DiscEls.arc_window.add_all.innerText = 'All In Library';
	}
}

function markAddedInArcVols(cv_id) {
	if (!DiscEls.arc_window.vol_list) return;
	DiscEls.arc_window.vol_list.querySelectorAll('.disc-arc-vol-row').forEach(row => {
		if (parseInt(row.dataset.cvId) === cv_id) {
			row.querySelector('.disc-in-library').classList.remove('hidden');
			const btn = row.querySelector('.disc-arc-vol-add');
			btn.innerText = 'In Library';
			btn.disabled = true;
			btn.onclick = null;
		}
	});
	pending_arc_volumes = pending_arc_volumes.filter(v => v.comicvine_id !== cv_id);
	const add_all = DiscEls.arc_window.add_all;
	if (pending_arc_volumes.length > 0) {
		add_all.innerText = `Add All Unowned (${pending_arc_volumes.length})`;
	} else {
		add_all.disabled = true;
		add_all.innerText = 'All In Library';
	}
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
		} else if (tab === 'arcs') {
			grid.appendChild(buildArcCard(r, cached_api_key));
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
	const params = tab === 'arcs'
		? { type: 'story-arcs', query: '' }
		: { type: tab };
	fetchAPI('/discovery', api_key, params)
	.then(json => {
		if (loaded[tab]) return;
		loaded[tab] = true;
		if (tab === 'arcs') arc_query = '';
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
	if (tab === 'arcs') {
		loadArcs(api_key, arc_query);
		return;
	}
	if (loaded[tab]) {
		if (!tab_results[tab].length) {
			hide(
				[DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs,
				 DiscEls.paginations.upcoming, DiscEls.paginations.new, DiscEls.paginations.popular, DiscEls.paginations.arcs,
				 DiscEls.msgs.error, DiscEls.msgs.no_cv],
				[DiscEls.msgs.empty]
			);
		} else {
			showTab(tab);
		}
		return;
	}

	hide(
		[DiscEls.msgs.error, DiscEls.msgs.empty, DiscEls.msgs.no_cv,
		 DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs,
		 DiscEls.paginations.upcoming, DiscEls.paginations.new, DiscEls.paginations.popular, DiscEls.paginations.arcs]
	);
	showWindow('disc-loading-window');

	fetchAPI('/discovery', api_key, { type: tab })
	.then(json => {
		loaded[tab] = true;
		tab_results[tab] = json.result;
		tab_pages[tab] = 0;
		closeWindow();
		if (!json.result.length) {
			hide([DiscEls.grids[tab]], [DiscEls.msgs.empty]);
			return;
		}
		hide([DiscEls.msgs.empty, DiscEls.msgs.error]);
		renderPage(tab);
		DiscEls.grids[tab].classList.remove('hidden');
	})
	.catch(e => {
		closeWindow();
		if (e && e.json) {
			e.json().then(j => {
				if (j.error === 'InvalidComicVineApiKey' || j.error === 'NoComicVineApiKey') {
					hide(
						[DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs,
						 DiscEls.msgs.empty, DiscEls.msgs.error],
						[DiscEls.msgs.no_cv]
					);
				} else {
					hide(
						[DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs,
						 DiscEls.msgs.empty],
						[DiscEls.msgs.error]
					);
				}
			}).catch(() => {
				hide(
					[DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs,
					 DiscEls.msgs.empty],
					[DiscEls.msgs.error]
				);
			});
		} else {
			hide(
				[DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs,
				 DiscEls.msgs.empty],
				[DiscEls.msgs.error]
			);
		}
	});
}

function loadArcs(api_key, query) {
	const q = (query || '').trim();
	if (loaded['arcs'] && arc_query === q) {
		if (!tab_results['arcs'].length) {
			hide(
				[DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs,
				 DiscEls.paginations.upcoming, DiscEls.paginations.new, DiscEls.paginations.popular, DiscEls.paginations.arcs,
				 DiscEls.msgs.error, DiscEls.msgs.no_cv],
				[DiscEls.msgs.empty]
			);
		} else {
			showTab('arcs');
		}
		return;
	}

	hide(
		[DiscEls.msgs.error, DiscEls.msgs.empty, DiscEls.msgs.no_cv,
		 DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs,
		 DiscEls.paginations.upcoming, DiscEls.paginations.new, DiscEls.paginations.popular, DiscEls.paginations.arcs]
	);
	showWindow('disc-loading-window');

	fetchAPI('/discovery', api_key, { type: 'story-arcs', query: q })
	.then(json => {
		arc_query = q;
		loaded['arcs'] = true;
		tab_results['arcs'] = json.result;
		tab_pages['arcs'] = 0;
		closeWindow();
		if (!json.result.length) {
			hide([DiscEls.grids.arcs], [DiscEls.msgs.empty]);
			return;
		}
		hide([DiscEls.msgs.empty, DiscEls.msgs.error]);
		renderPage('arcs');
		DiscEls.grids.arcs.classList.remove('hidden');
	})
	.catch(e => {
		arc_query = q;
		closeWindow();
		if (e && e.json) {
			e.json().then(j => {
				const no_cv = j.error === 'InvalidComicVineApiKey' || j.error === 'NoComicVineApiKey';
				hide(
					[DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs, DiscEls.msgs.empty],
					[no_cv ? DiscEls.msgs.no_cv : DiscEls.msgs.error]
				);
			}).catch(() => hide(
				[DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs, DiscEls.msgs.empty],
				[DiscEls.msgs.error]
			));
		} else {
			hide(
				[DiscEls.grids.upcoming, DiscEls.grids.new, DiscEls.grids.popular, DiscEls.grids.arcs, DiscEls.msgs.empty],
				[DiscEls.msgs.error]
			);
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
	pending_arc_volumes = [];
	DiscEls.window.cover.src = volume.cover_link || '';
	DiscEls.window.title.innerText = volume.title;
	DiscEls.window.cv_id.value = volume.comicvine_id;

	const prefs = getLocalStorage('monitor_new_volume', 'monitoring_scheme', 'disc_auto_search');
	DiscEls.window.monitor.value = prefs.monitor_new_volume ? 'true' : 'false';
	DiscEls.window.scheme.value = prefs.monitoring_scheme || 'all';
	DiscEls.window.auto_search.checked = prefs.disc_auto_search !== false;

	showWindow('disc-add-window');
}

function openAddAllArcWindow(arc_name) {
	if (!pending_arc_volumes.length) return;
	DiscEls.window.cover.src = pending_arc_volumes[0]?.cover_link || '';
	DiscEls.window.title.innerText = `Add ${pending_arc_volumes.length} volume${pending_arc_volumes.length !== 1 ? 's' : ''} from "${arc_name}"`;
	DiscEls.window.cv_id.value = '';

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

	// Bulk arc add
	if (pending_arc_volumes.length > 0) {
		const to_add = [...pending_arc_volumes];
		usingApiKey().then(api_key => addArcVolumesSequential(api_key, to_add, base_data));
		return;
	}

	// Single add
	const data = { ...base_data, comicvine_id: parseInt(DiscEls.window.cv_id.value) };
	usingApiKey()
	.then(api_key => {
		sendAPI('POST', '/volumes', api_key, {}, data)
		.then(r => r.json())
		.then(json => {
			const cv_id = data.comicvine_id;
			markAddedInGrids(cv_id, json.result.id);
			markAddedInArcVols(cv_id);
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

async function addArcVolumesSequential(api_key, volumes, base_data) {
	for (const vol of volumes) {
		try {
			const r = await sendAPI('POST', '/volumes', api_key, {}, {
				...base_data,
				comicvine_id: vol.comicvine_id,
			});
			const json = await r.json();
			markAddedInGrids(vol.comicvine_id, json.result.id);
			markAddedInArcVols(vol.comicvine_id);
		} catch {
			// continue with next volume
		}
	}
	closeWindow();
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
	DiscEls.arc_search_bar.classList.toggle('hidden', tab !== 'arcs');
	loadTab(tab, cached_api_key);
}

// code run on load

usingApiKey()
.then(api_key => {
	cached_api_key = api_key;
	fillRootFolders(api_key);
	loadTab(current_tab, api_key);

	['upcoming', 'new', 'popular', 'arcs']
		.filter(t => t !== current_tab)
		.forEach(t => prefetchTab(t, api_key));

	DiscEls.arc_search_btn.onclick = () => {
		loaded['arcs'] = false;
		loadArcs(api_key, DiscEls.arc_input.value);
	};
	DiscEls.arc_input.onkeydown = e => {
		if (e.key === 'Enter') {
			loaded['arcs'] = false;
			loadArcs(api_key, DiscEls.arc_input.value);
		}
	};

	DiscEls.arc_window.add_all.onclick = () => {
		const arc_name = DiscEls.arc_window.name.innerText;
		openAddAllArcWindow(arc_name);
	};
});

DiscEls.tabs.forEach(btn => {
	btn.onclick = () => switchTab(btn.dataset.tab);
});

DiscEls.msgs.retry.onclick = () => {
	loaded[current_tab] = false;
	if (current_tab === 'arcs') arc_query = '';
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
