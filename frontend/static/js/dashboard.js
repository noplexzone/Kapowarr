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

	// Recent downloads (last 7 days, both sections)
	const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
	Promise.all([
		fetchAPI('/activity/history', api_key, {after: sevenDaysAgo}),
		fetchAPI('/volumes', api_key),
		fetchAPI('/volumes', api_key, {section: 'manga'})
	])
	.then(([history, comics, manga]) => {
		// Recent downloads
		const successful = history.result.filter(r => r.success).length;
		document.getElementById('stat-recent').textContent = successful;

		// Wanted — sum across both sections
		let wanted = 0;
		[comics.result, manga.result].forEach(volumes => {
			volumes.forEach(v => {
				(v.issues || []).forEach(i => {
					if (i.monitored && !i.downloaded) wanted++;
				});
			});
		});
		const wantedEl = document.getElementById('stat-wanted');
		wantedEl.textContent = wanted;
		wantedEl.style.color = wanted > 0 ? 'var(--error-color)' : '';

		// Library stats
		document.getElementById('stat-comic-volumes').textContent = comics.result.length;
		document.getElementById('stat-manga-volumes').textContent = manga.result.length;

		let comicIssues = 0, mangaIssues = 0;
		comics.result.forEach(v => { comicIssues += (v.issues || []).length; });
		manga.result.forEach(v => { mangaIssues += (v.issues || []).length; });
		document.getElementById('stat-comic-issues').textContent = comicIssues;
		document.getElementById('stat-manga-issues').textContent = mangaIssues;
	});

	// Recently added — both sections, interleaved
	Promise.all([
		fetchAPI('/volumes', api_key, {sort: 'recently_added', limit: 4}),
		fetchAPI('/volumes', api_key, {sort: 'recently_added', limit: 4, section: 'manga'})
	])
	.then(([comics, manga]) => {
		const items = [];
		comics.result.slice(0, 4).forEach(v => items.push({...v, section: 'comics'}));
		manga.result.slice(0, 4).forEach(v => items.push({...v, section: 'manga'}));
		items.sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
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
			cover.src = v.cover || '';
			cover.alt = '';
			cover.loading = 'lazy';
			item.appendChild(cover);

			const info = document.createElement('div');
			info.className = 'dash-list-info';

			const title = document.createElement('div');
			title.className = 'dash-list-title';
			const link = document.createElement('a');
			link.href = v.section === 'manga'
				? `${url_base}/manga/volumes/${v.id}`
				: `${url_base}/volumes/${v.id}`;
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
