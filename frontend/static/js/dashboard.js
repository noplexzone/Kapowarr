//
// Dashboard — landing page with comics + manga overview
//

function loadDashboard(api_key) {
	// Active downloads
	fetchAPI('/activity/queue', api_key)
	.then(json => {
		const count = json.result.length;
		const el = document.getElementById('stat-active');
		el.textContent = count;
		el.style.color = count > 0 ? 'var(--accent-color)' : '';
	});

	// Recent downloads (last 7 days)
	const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
	fetchAPI('/activity/history', api_key, {after: sevenDaysAgo})
	.then(json => {
		const successful = json.result.filter(r => r.success).length;
		document.getElementById('stat-recent').textContent = successful;
	});

	// Wanted + library stats via /volumes/stats
	Promise.all([
		fetchAPI('/volumes/stats', api_key, {section: 'comic'}),
		fetchAPI('/volumes/stats', api_key, {section: 'manga'})
	])
	.then(([comicStats, mangaStats]) => {
		const cs = comicStats.result;
		const ms = mangaStats.result;

		// Wanted (monitored but not downloaded, across both sections)
		const wanted = (cs.wanted || 0) + (ms.wanted || 0);
		const wantedEl = document.getElementById('stat-wanted');
		wantedEl.textContent = wanted;
		wantedEl.style.color = wanted > 0 ? 'var(--error-color)' : '';

		// Library stats
		document.getElementById('stat-comic-volumes').textContent = cs.volumes || 0;
		document.getElementById('stat-manga-volumes').textContent = ms.volumes || 0;
		document.getElementById('stat-comic-issues').textContent = cs.issues || 0;
		document.getElementById('stat-manga-issues').textContent = ms.issues || 0;
	});

	// Recently added — both sections
	Promise.all([
		fetchAPI('/volumes', api_key, {sort: 'recently_added', limit: 4}),
		fetchAPI('/volumes', api_key, {sort: 'recently_added', limit: 4, section: 'manga'})
	])
	.then(([comics, manga]) => {
		const items = [];
		comics.result.slice(0, 4).forEach(v => items.push({...v, section: 'comics'}));
		manga.result.slice(0, 4).forEach(v => items.push({...v, section: 'manga'}));
		items.sort((a, b) => (b.id || 0) - (a.id || 0));
		const recent = items.slice(0, 6);

		const list = document.getElementById('recent-list');
		if (!recent.length) {
			list.innerHTML = '<p class="empty-state">No volumes yet</p>';
			return;
		}

		list.innerHTML = '';
		recent.forEach(v => {
			const item = document.createElement('div');
			item.className = 'dash-list-item';

			const cover = document.createElement('img');
			cover.className = 'dash-list-cover';
			cover.src = `${url_base}/api/volumes/${v.id}/cover?api_key=${api_key}`;
			cover.alt = '';
			cover.loading = 'lazy';
			item.appendChild(cover);

			const info = document.createElement('div');
			info.className = 'dash-list-info';

			const title = document.createElement('div');
			title.className = 'dash-list-title';
			const link = document.createElement('a');
			link.href = `${url_base}/volumes/${v.id}`;
			link.textContent = v.title;
			title.appendChild(link);
			info.appendChild(title);

			const meta = document.createElement('div');
			meta.className = 'dash-list-meta';
			const sectionBadge = v.section === 'manga'
				? '<span class="chip chip--accent">Manga</span> '
				: '<span class="chip">Comics</span> ';
			const parts = [];
			if (v.year) parts.push(v.year);
			if (v.publisher) parts.push(v.publisher);
			meta.innerHTML = sectionBadge + parts.join(' · ');
			info.appendChild(meta);

			item.appendChild(info);
			list.appendChild(item);
		});
	});
}

// code run on load

usingApiKey()
.then(api_key => {
	loadDashboard(api_key);
	document.getElementById('refresh-dashboard').onclick = () => loadDashboard(api_key);
});
