let currentPage = 0;

function formatDate(timestamp) {
	return new Date(timestamp * 1000).toLocaleDateString(undefined, {
		year: 'numeric', month: 'short', day: 'numeric'
	});
}

function deleteEntry(id, row) {
	usingApiKey().then(api_key =>
		sendAPI('DELETE', `/blocklist/${id}`, api_key)
		.then(() => {
			row.remove();
			if (!document.querySelector('#blocklist-body tr'))
				loadPage(currentPage);
		})
		.catch(() => {})
	);
}

function renderEntries(entries) {
	const tbody = document.querySelector('#blocklist-body');
	tbody.innerHTML = '';

	const noEntries = document.querySelector('#no-entries-row');
	if (!entries.length) {
		noEntries.classList.remove('hidden');
		return;
	}
	noEntries.classList.add('hidden');

	entries.forEach(entry => {
		const tr = document.createElement('tr');
		tr.dataset.id = entry.id;

		const titleCell = document.createElement('td');
		titleCell.classList.add('blocklist-title');
		const mainTitle = entry.web_title || entry.download_link || '(unknown)';
		titleCell.textContent = mainTitle;
		if (entry.web_sub_title) {
			const sub = document.createElement('span');
			sub.classList.add('blocklist-subtitle');
			sub.textContent = entry.web_sub_title;
			titleCell.appendChild(sub);
		}

		const sourceCell = document.createElement('td');
		sourceCell.textContent = entry.source || '—';

		const reasonCell = document.createElement('td');
		reasonCell.textContent = entry.reason;

		const dateCell = document.createElement('td');
		dateCell.textContent = formatDate(entry.added_at);

		const actionCell = document.createElement('td');
		actionCell.classList.add('action-column');
		const deleteBtn = document.createElement('button');
		deleteBtn.type = 'button';
		deleteBtn.title = 'Remove from blocklist';
		deleteBtn.innerHTML = `<img src="${url_base}/static/img/delete.svg" alt="">`;
		deleteBtn.addEventListener('click', () => deleteEntry(entry.id, tr));
		actionCell.appendChild(deleteBtn);

		tr.append(titleCell, sourceCell, reasonCell, dateCell, actionCell);
		tbody.appendChild(tr);
	});
}

function loadPage(page) {
	usingApiKey().then(api_key =>
		fetchAPI('/blocklist', api_key, { offset: page })
		.then(json => {
			currentPage = page;
			document.querySelector('#page-indicator').textContent = `Page ${page + 1}`;
			document.querySelector('#prev-page').disabled = page === 0;
			document.querySelector('#next-page').disabled = json.result.length < 50;
			renderEntries(json.result);
		})
		.catch(() => {})
	);
}

function clearBlocklist() {
	if (!confirm('Remove all blocklist entries? This cannot be undone.'))
		return;
	usingApiKey().then(api_key =>
		sendAPI('DELETE', '/blocklist', api_key)
		.then(() => loadPage(0))
		.catch(() => {})
	);
}

document.querySelector('#clear-blocklist').addEventListener('click', clearBlocklist);
document.querySelector('#prev-page').addEventListener('click', () => loadPage(currentPage - 1));
document.querySelector('#next-page').addEventListener('click', () => loadPage(currentPage + 1));

loadPage(0);
