const PAGE_SIZE = 50;

const ArcEls = {
	pre_build: {
		arc_card: document.querySelector('.pre-build-els .arc-card'),
		arc_vol_row: document.querySelector('.pre-build-els .arc-vol-row'),
	},
	grid: document.querySelector('#arc-grid'),
	pagination: document.querySelector('#arc-pagination'),
	msgs: {
		no_cv: document.querySelector('#arc-no-cv'),
		error: document.querySelector('#arc-error'),
		empty: document.querySelector('#arc-empty'),
		hint: document.querySelector('#arc-hint'),
		retry: document.querySelector('#arc-retry-btn'),
	},
	search: {
		input: document.querySelector('#arc-input'),
		btn: document.querySelector('#arc-search-btn'),
	},
	detail: {
		cover: document.querySelector('#arc-detail-cover'),
		name: document.querySelector('#arc-detail-name'),
		deck: document.querySelector('#arc-detail-deck'),
		load_msg: document.querySelector('#arc-detail-load-msg'),
		vol_list: document.querySelector('#arc-detail-vol-list'),
		add_all: document.querySelector('#arc-add-all'),
	},
	window: {
		cover: document.querySelector('#arc-add-cover'),
		title: document.querySelector('#arc-add-title'),
		cv_id: document.querySelector('#arc-cv-id-input'),
		root_folder: document.querySelector('#arc-rootfolder-input'),
		monitor: document.querySelector('#arc-monitor-input'),
		scheme: document.querySelector('#arc-scheme-input'),
		auto_search: document.querySelector('#arc-autosearch-input'),
		submit: document.querySelector('#arc-add-submit'),
		form: document.querySelector('#arc-add-form'),
	},
};

let arc_results = [];
let arc_page = 0;
let arc_query = '';
let current_arc_id = null;
let pending_arc_volumes = [];
let cached_api_key = null;

//
// Root folders
//
function fillRootFolders(api_key) {
	fetchAPI('/rootfolder', api_key)
	.then(json => {
		ArcEls.window.root_folder.innerHTML = '';
		json.result.forEach(folder => {
			const opt = document.createElement('option');
			opt.value = folder.id;
			opt.innerText = folder.folder;
			ArcEls.window.root_folder.appendChild(opt);
		});
	});
}

//
// Arc card builder
//
function buildArcCard(arc) {
	const card = ArcEls.pre_build.arc_card.cloneNode(true);
	card.dataset.arcId = arc.id;

	const cover_link = card.querySelector('.arc-card-cover');
	cover_link.href = arc.site_url || '';

	const img = card.querySelector('img');
	if (arc.cover_link) {
		img.src = arc.cover_link;
		img.alt = arc.name;
	} else {
		img.remove();
	}

	card.querySelector('.arc-card-name').innerText = arc.name;
	card.querySelector('.arc-card-deck').innerText = arc.deck || '';

	const info_parts = [];
	if (arc.issue_count) info_parts.push(`${arc.issue_count} issue${arc.issue_count !== 1 ? 's' : ''}`);
	if (arc.publisher) info_parts.push(arc.publisher);
	card.querySelector('.arc-card-issues').innerText = info_parts.join(' · ');

	card.querySelector('.arc-view-btn').onclick = e => {
		e.preventDefault();
		openArcDetail(arc.id);
	};
	return card;
}

//
// Arc detail window
//
function openArcDetail(arc_id) {
	current_arc_id = arc_id;
	pending_arc_volumes = [];
	ArcEls.detail.load_msg.innerText = 'Loading volumes…';
	ArcEls.detail.load_msg.classList.remove('hidden');
	ArcEls.detail.vol_list.innerHTML = '';
	ArcEls.detail.cover.src = '';
	ArcEls.detail.name.innerText = '';
	ArcEls.detail.deck.innerText = '';
	ArcEls.detail.add_all.disabled = true;
	ArcEls.detail.add_all.innerText = 'Add All Unowned';
	document.querySelector('#arc-detail-window h2').innerText = 'Story Arc';
	showWindow('arc-detail-window');

	fetchAPI(`/discovery/story-arc/${arc_id}`, cached_api_key)
	.then(json => {
		ArcEls.detail.load_msg.classList.add('hidden');
		renderArcDetail(json.result);
	})
	.catch(() => {
		ArcEls.detail.load_msg.innerText = 'Failed to load arc volumes.';
	});
}

function renderArcDetail(arc_data) {
	const { arc, volumes } = arc_data;

	document.querySelector('#arc-detail-window h2').innerText = arc.name;
	ArcEls.detail.cover.src = arc.cover_link || '';
	ArcEls.detail.cover.style.display = arc.cover_link ? '' : 'none';
	ArcEls.detail.name.innerText = arc.name;
	ArcEls.detail.deck.innerText = arc.deck || '';

	if (!volumes.length) {
		ArcEls.detail.load_msg.innerText = 'No English-language volumes found in this arc.';
		ArcEls.detail.load_msg.classList.remove('hidden');
		return;
	}

	const listEl = ArcEls.detail.vol_list;
	listEl.innerHTML = '';
	pending_arc_volumes = [];

	volumes.forEach(vol => {
		const row = ArcEls.pre_build.arc_vol_row.cloneNode(true);
		row.dataset.cvId = vol.comicvine_id;

		const thumb = row.querySelector('.arc-vol-thumb');
		thumb.href = vol.site_url || '';

		const img = row.querySelector('img');
		if (vol.cover_link) {
			img.src = vol.cover_link;
			img.alt = vol.title;
		} else {
			img.remove();
		}

		if (vol.already_added !== null && vol.already_added !== undefined) {
			row.querySelector('.arc-in-library').classList.remove('hidden');
		}

		row.querySelector('.arc-vol-title').innerText = vol.title;

		const meta_parts = [];
		if (vol.year) meta_parts.push(vol.year);
		if (vol.publisher) meta_parts.push(vol.publisher);
		if (vol.issue_count) meta_parts.push(`${vol.issue_count} issue${vol.issue_count !== 1 ? 's' : ''}`);
		row.querySelector('.arc-vol-meta').innerText = meta_parts.join(' · ');

		const btn = row.querySelector('.arc-vol-add');
		if (vol.already_added !== null && vol.already_added !== undefined) {
			btn.innerText = 'In Library';
			btn.disabled = true;
		} else {
			pending_arc_volumes.push(vol);
			btn.onclick = () => openAddWindow(vol);
		}

		listEl.appendChild(row);
	});

	if (pending_arc_volumes.length > 0) {
		ArcEls.detail.add_all.disabled = false;
		ArcEls.detail.add_all.innerText = `Add All Unowned (${pending_arc_volumes.length})`;
	} else {
		ArcEls.detail.add_all.innerText = 'All In Library';
	}
}

function markAddedInArcDetail(cv_id) {
	ArcEls.detail.vol_list.querySelectorAll('.arc-vol-row').forEach(row => {
		if (parseInt(row.dataset.cvId) === cv_id) {
			row.querySelector('.arc-in-library').classList.remove('hidden');
			const btn = row.querySelector('.arc-vol-add');
			btn.innerText = 'In Library';
			btn.disabled = true;
			btn.onclick = null;
		}
	});
	pending_arc_volumes = pending_arc_volumes.filter(v => v.comicvine_id !== cv_id);
	const add_all = ArcEls.detail.add_all;
	if (pending_arc_volumes.length > 0) {
		add_all.innerText = `Add All Unowned (${pending_arc_volumes.length})`;
	} else {
		add_all.disabled = true;
		add_all.innerText = 'All In Library';
	}
}

//
// Pagination
//
function renderPage() {
	const start = arc_page * PAGE_SIZE;
	const slice = arc_results.slice(start, start + PAGE_SIZE);

	ArcEls.grid.innerHTML = '';
	slice.forEach(arc => ArcEls.grid.appendChild(buildArcCard(arc)));

	const total_pages = Math.ceil(arc_results.length / PAGE_SIZE);
	if (total_pages > 1) {
		ArcEls.pagination.querySelector('.arc-page-indicator').innerText =
			`Page ${arc_page + 1} of ${total_pages}`;
		ArcEls.pagination.querySelector('.arc-page-prev').disabled = arc_page === 0;
		ArcEls.pagination.querySelector('.arc-page-next').disabled = arc_page === total_pages - 1;
		ArcEls.pagination.classList.remove('hidden');
	} else {
		ArcEls.pagination.classList.add('hidden');
	}
}

//
// Search
//
function loadArcs(query) {
	const q = (query || '').trim();

	if (!q) {
		hide(
			[ArcEls.grid, ArcEls.pagination, ArcEls.msgs.error, ArcEls.msgs.no_cv, ArcEls.msgs.empty],
			[ArcEls.msgs.hint]
		);
		return;
	}

	hide(
		[ArcEls.msgs.error, ArcEls.msgs.empty, ArcEls.msgs.no_cv, ArcEls.msgs.hint,
		 ArcEls.grid, ArcEls.pagination]
	);
	showWindow('arc-loading-window');

	fetchAPI('/discovery', cached_api_key, { type: 'story-arcs', query: q })
	.then(json => {
		arc_query = q;
		arc_results = json.result;
		arc_page = 0;
		closeWindow();
		if (!json.result.length) {
			hide([ArcEls.grid], [ArcEls.msgs.empty]);
			return;
		}
		hide([ArcEls.msgs.empty, ArcEls.msgs.error, ArcEls.msgs.hint]);
		renderPage();
		ArcEls.grid.classList.remove('hidden');
	})
	.catch(e => {
		arc_query = q;
		closeWindow();
		const showNoCV = () => hide([ArcEls.grid, ArcEls.msgs.empty, ArcEls.msgs.error], [ArcEls.msgs.no_cv]);
		const showErr  = () => hide([ArcEls.grid, ArcEls.msgs.empty], [ArcEls.msgs.error]);
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

//
// Add window
//
function openAddWindow(volume) {
	ArcEls.window.cover.src = volume.cover_link || '';
	ArcEls.window.title.innerText = volume.title;
	ArcEls.window.cv_id.value = volume.comicvine_id;

	const prefs = getLocalStorage('monitor_new_volume', 'monitoring_scheme', 'arc_auto_search');
	ArcEls.window.monitor.value = prefs.monitor_new_volume ? 'true' : 'false';
	ArcEls.window.scheme.value = prefs.monitoring_scheme || 'all';
	ArcEls.window.auto_search.checked = prefs.arc_auto_search !== false;

	showWindow('arc-add-window');
}

function openAddAllWindow(arc_name) {
	if (!pending_arc_volumes.length) return;
	ArcEls.window.cover.src = pending_arc_volumes[0]?.cover_link || '';
	ArcEls.window.title.innerText =
		`Add ${pending_arc_volumes.length} volume${pending_arc_volumes.length !== 1 ? 's' : ''} from "${arc_name}"`;
	ArcEls.window.cv_id.value = '';

	const prefs = getLocalStorage('monitor_new_volume', 'monitoring_scheme', 'arc_auto_search');
	ArcEls.window.monitor.value = prefs.monitor_new_volume ? 'true' : 'false';
	ArcEls.window.scheme.value = prefs.monitoring_scheme || 'all';
	ArcEls.window.auto_search.checked = prefs.arc_auto_search !== false;

	showWindow('arc-add-window');
}

function submitAdd() {
	showLoadWindow('arc-add-window');

	const base_data = {
		root_folder_id: parseInt(ArcEls.window.root_folder.value),
		monitor: ArcEls.window.monitor.value === 'true',
		monitoring_scheme: ArcEls.window.scheme.value,
		monitor_new_issues: ArcEls.window.monitor.value === 'true',
		volume_folder: '',
		auto_search: ArcEls.window.auto_search.checked,
	};

	setLocalStorage({
		monitor_new_volume: base_data.monitor,
		monitoring_scheme: base_data.monitoring_scheme,
		arc_auto_search: base_data.auto_search,
	});

	if (pending_arc_volumes.length > 0) {
		const to_add = [...pending_arc_volumes];
		addVolumesSequential(to_add, base_data);
		return;
	}

	const data = { ...base_data, comicvine_id: parseInt(ArcEls.window.cv_id.value) };
	sendAPI('POST', '/volumes', cached_api_key, {}, data)
	.then(r => r.json())
	.then(json => {
		markAddedInArcDetail(data.comicvine_id);
		closeWindow();
	})
	.catch(e => {
		if (e.status === 509) {
			ArcEls.window.submit.innerText = 'ComicVine rate limit reached';
			showWindow('arc-add-window');
		} else if (e.status === 400) {
			ArcEls.window.submit.innerText = 'Volume folder conflict';
			showWindow('arc-add-window');
		} else {
			closeWindow();
		}
	});
}

async function addVolumesSequential(volumes, base_data) {
	for (const vol of volumes) {
		try {
			const r = await sendAPI('POST', '/volumes', cached_api_key, {}, {
				...base_data,
				comicvine_id: vol.comicvine_id,
			});
			const json = await r.json();
			markAddedInArcDetail(vol.comicvine_id);
		} catch {
			// continue with next volume
		}
	}
	closeWindow();
}

// code run on load

usingApiKey()
.then(api_key => {
	cached_api_key = api_key;
	fillRootFolders(api_key);

	ArcEls.search.btn.onclick = () => loadArcs(ArcEls.search.input.value);
	ArcEls.search.input.onkeydown = e => {
		if (e.key === 'Enter') loadArcs(ArcEls.search.input.value);
	};

	ArcEls.detail.add_all.onclick = () => {
		openAddAllWindow(ArcEls.detail.name.innerText);
	};

	ArcEls.msgs.retry.onclick = () => loadArcs(arc_query);
});

ArcEls.pagination.querySelector('.arc-page-prev').onclick = () => {
	if (arc_page > 0) {
		arc_page--;
		renderPage();
		ArcEls.grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
};

ArcEls.pagination.querySelector('.arc-page-next').onclick = () => {
	const max = Math.ceil(arc_results.length / PAGE_SIZE) - 1;
	if (arc_page < max) {
		arc_page++;
		renderPage();
		ArcEls.grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
};

ArcEls.window.form.action = 'javascript:submitAdd();';
