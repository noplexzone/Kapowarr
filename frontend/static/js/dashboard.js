//
// Dashboard — fetches data from existing APIs
//

function loadDashboard(api_key) {
	// Active downloads
	fetchAPI('/activity/queue', api_key)
	.then(json => {
		const count = json.result.length;
		document.getElementById('stat-active').textContent = count;
		if (count > 0) {
			document.getElementById('stat-active').style.color = 'var(--accent-color)';
		}
	});

	// Recent downloads (last 7 days)
	const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
	fetchAPI('/activity/history', api_key, {after: sevenDaysAgo})
	.then(json => {
		const successful = json.result.filter(r => r.success).length;
		document.getElementById('stat-recent').textContent = successful;
	});

	// Library stats — reuse the LibraryEntry pattern
	fetchAPI('/volumes', api_key)
	.then(json => {
		const volumes = json.result;
		let totalIssues = 0;
		let downloaded = 0;
		let wanted = 0;

		volumes.forEach(v => {
			const issues = v.issues || [];
			totalIssues += issues.length;
			issues.forEach(i => {
				if (i.monitored && !i.downloaded) wanted++;
				if (i.downloaded) downloaded++;
			});
		});

		document.getElementById('stat-volumes').textContent = volumes.length;
		document.getElementById('stat-issues').textContent = totalIssues;
		document.getElementById('stat-downloaded').textContent = downloaded;
		document.getElementById('stat-wanted').textContent = wanted;
		if (wanted > 0) {
			document.getElementById('stat-wanted').style.color = 'var(--error-color)';
		}
	});

	// Recently added
	fetchAPI('/volumes', api_key, {sort: 'recently_added', limit: 6})
	.then(json => {
		const list = document.getElementById('recent-list');
		const volumes = json.result.slice(0, 6);

		if (!volumes.length) {
			list.innerHTML = '<p class="empty-state">No volumes yet</p>';
			return;
		}

		list.innerHTML = '';
		volumes.forEach(v => {
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
			link.href = `${url_base}/volumes/${v.id}`;
			link.textContent = v.title;
			title.appendChild(link);
			info.appendChild(title);

			const meta = document.createElement('div');
			meta.className = 'dash-list-meta';
			const parts = [];
			if (v.year) parts.push(v.year);
			if (v.publisher) parts.push(v.publisher);
			meta.textContent = parts.join(' · ');
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
