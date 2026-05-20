const TaskEls = {
	pre_build: {
		task: document.querySelector('.pre-build-els .task-entry'),
		queue: document.querySelector('.pre-build-els .queue-entry'),
	},
	intervals: document.querySelector('#task-intervals'),
	queue: document.querySelector('#page-task-queue'),
	queue_empty: document.querySelector('#queue-empty'),
	buttons: {
		refresh: document.querySelector('#refresh-button'),
		clear: document.querySelector('#clear-button'),
		prevPage: document.querySelector('#prev-page-btn'),
		nextPage: document.querySelector('#next-page-btn'),
	},
	pagination: document.querySelector('#queue-pagination'),
	pageIndicator: document.querySelector('#page-indicator'),
};

let currentPage = 0;
const MAX_PAGE = 4;
const PAGE_SIZE = 20;

//
// Time helpers
//
function relativeTime(epoch) {
	if (epoch === null || epoch === undefined) return '—';
	const delta = Math.round(Math.abs(Date.now() / 1000 - epoch));
	if (delta < 5)   return 'just now';
	if (delta < 60)  return `${delta}s ago`;
	if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
	return `${Math.floor(delta / 3600)}h ago`;
}

function futureTime(epoch) {
	if (epoch === null || epoch === undefined) return '—';
	const delta = Math.round((epoch - Date.now() / 1000));
	if (delta <= 0)   return 'now';
	if (delta < 60)   return `in ${delta}s`;
	if (delta < 3600) return `in ${Math.floor(delta / 60)}m`;
	return `in ${Math.floor(delta / 3600)}h`;
}

function formatDuration(startEpoch, endEpoch) {
	if (startEpoch === null || startEpoch === undefined) return '—';
	const end = (endEpoch !== null && endEpoch !== undefined)
		? endEpoch
		: Math.round(Date.now() / 1000);
	const secs = Math.max(0, Math.round(end - startEpoch));
	const m = Math.floor(secs / 60);
	const s = secs % 60;
	return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function convertInterval(interval) {
	const hrs = Math.round(interval / 3600);
	if (hrs < 1) return `${Math.round(interval / 60)} minutes`;
	if (hrs === 1) return '1 hour';
	return `${hrs} hours`;
}

function formatIssueNumber(n) {
	if (n === null || n === undefined) return '?';
	const s = String(n);
	return s.endsWith('.0') ? s.slice(0, -2) : s;
}

//
// Scheduled tasks
//
function fillPlanning(api_key) {
	fetchAPI('/system/tasks/planning', api_key)
	.then(json => {
		TaskEls.intervals.innerHTML = '';
		json.result.forEach(task => {
			const entry = TaskEls.pre_build.task.cloneNode(true);
			entry.dataset.task_name = task.task_name;

			entry.querySelector('.name-column').innerText = task.display_name;
			entry.querySelector('.interval-column').innerText = convertInterval(task.interval);
			entry.querySelector('.prev-column').innerText =
				task.last_run ? relativeTime(task.last_run) : 'Never';
			entry.querySelector('.next-column').innerText = futureTime(task.next_run);
			entry.querySelector('button').onclick =
				() => sendAPI('POST', '/system/tasks', api_key, {}, { cmd: task.task_name });

			TaskEls.intervals.appendChild(entry);
		});
		mapButtons();
	});
}

//
// Detail row (expandable sub-table for search results)
//
function buildDetailRow(details) {
	// Download result entries have a 'results' array instead of search stats
	if (Array.isArray(details.results)) {
		return buildDownloadResultRow(details.results);
	}

	// Backward compat: old entries stored a plain array (per_issue only)
	if (Array.isArray(details)) {
		details = { per_issue: details, downloads: [] };
	}

	const tr = document.createElement('tr');
	tr.className = 'q-detail-row';

	const td = document.createElement('td');
	td.colSpan = 7;

	const wrap = document.createElement('div');
	wrap.className = 'q-detail-wrap';

	const per_issue = details.per_issue || [];
	const downloads = details.downloads || []; // volume-level only (packs with no per-issue entry)

	// Format issue_number for display: handles string ("1.MU"), float (5.0),
	// array range ([1.0, 42.0]), or null
	function issueLabel(n) {
		if (n === null || n === undefined) return '—';
		if (Array.isArray(n))
			return `#${formatIssueNumber(n[0])}–${formatIssueNumber(n[1])}`;
		return `#${formatIssueNumber(n)}`;
	}

	// Build rows with raw issue_number retained for sorting
	const rows = per_issue.map(pi => ({
		issue_number: pi.issue_number,
		issue_label: issueLabel(pi.issue_number),
		matched: pi.matched,
		display_title: pi.matched ? (pi.display_title || '') : null,
		source: pi.matched ? (pi.source || '') : null,
	}));

	// Volume-level downloads (packs / individually-found without a per-issue search)
	for (const dl of downloads) {
		rows.push({
			issue_number: dl.issue_number,
			issue_label: issueLabel(dl.issue_number),
			matched: true,
			display_title: dl.display_title || '',
			source: dl.source || '',
		});
	}

	// Sort ascending by issue number; packs (range arrays) sort by their start number
	function issueSort(n) {
		if (n === null || n === undefined) return Infinity;
		if (Array.isArray(n)) return n[0];
		const f = parseFloat(n);
		return isNaN(f) ? Infinity : f;
	}
	rows.sort((a, b) => issueSort(a.issue_number) - issueSort(b.issue_number));

	if (rows.length === 0) {
		td.appendChild(wrap);
		tr.appendChild(td);
		return tr;
	}

	const anyMatched = rows.some(r => r.matched);

	const table = document.createElement('table');
	table.className = 'q-detail-table';
	if (anyMatched) {
		table.innerHTML = `<thead><tr>
			<th>Issue</th><th>Matched</th><th>Title</th><th>Source</th>
		</tr></thead>`;
	} else {
		table.innerHTML = `<thead><tr>
			<th>Issue</th><th>Matched</th>
		</tr></thead>`;
	}

	const tbody = document.createElement('tbody');
	for (const r of rows) {
		const row = document.createElement('tr');
		if (anyMatched) {
			row.innerHTML = `
				<td>${r.issue_label}</td>
				<td class="${r.matched ? 'q-detail-matched' : 'q-detail-unmatched'}">${r.matched ? '✓' : '✗'}</td>
				<td>${r.display_title ?? ''}</td>
				<td>${r.source ?? ''}</td>
			`;
		} else {
			row.innerHTML = `
				<td>${r.issue_label}</td>
				<td class="${r.matched ? 'q-detail-matched' : 'q-detail-unmatched'}">${r.matched ? '✓' : '✗'}</td>
			`;
		}
		tbody.appendChild(row);
	}
	table.appendChild(tbody);
	wrap.appendChild(table);

	td.appendChild(wrap);
	tr.appendChild(td);
	return tr;
}

function hasDetails(obj) {
	const d = obj.details;
	if (!d) return false;
	if (Array.isArray(d)) return d.length > 0;
	return (
		(Array.isArray(d.downloads) && d.downloads.length > 0) ||
		(Array.isArray(d.per_issue) && d.per_issue.length > 0) ||
		(Array.isArray(d.results) && d.results.length > 0)
	);
}

function buildDownloadResultRow(results) {
	const tr = document.createElement('tr');
	tr.className = 'q-detail-row';
	const td = document.createElement('td');
	td.colSpan = 7;
	const wrap = document.createElement('div');
	wrap.className = 'q-detail-wrap';

	if (!results.length) {
		td.appendChild(wrap);
		tr.appendChild(td);
		return tr;
	}

	const anyFailed = results.some(r => !r.success);
	const table = document.createElement('table');
	table.className = 'q-detail-table';
	table.innerHTML = anyFailed
		? `<thead><tr><th>Title</th><th>Status</th><th>Reason</th></tr></thead>`
		: `<thead><tr><th>Title</th><th>Status</th></tr></thead>`;

	const tbody = document.createElement('tbody');
	for (const r of results) {
		const row = document.createElement('tr');
		const statusCell = `<td class="${r.success ? 'q-detail-matched' : 'q-detail-unmatched'}">${r.success ? '✓' : '✗'}</td>`;
		row.innerHTML = anyFailed
			? `<td>${r.title ?? ''}</td>${statusCell}<td>${r.failure_reason ?? ''}</td>`
			: `<td>${r.title ?? ''}</td>${statusCell}`;
		tbody.appendChild(row);
	}
	table.appendChild(tbody);
	wrap.appendChild(table);
	td.appendChild(wrap);
	tr.appendChild(td);
	return tr;
}

function toggleDetails(mainRow, details, btn) {
	const next = mainRow.nextElementSibling;
	if (next && next.classList.contains('q-detail-row')) {
		next.remove();
		btn.classList.remove('expanded');
	} else {
		const detailRow = buildDetailRow(details);
		mainRow.parentNode.insertBefore(detailRow, mainRow.nextSibling);
		btn.classList.add('expanded');
	}
}

//
// Queue row builder
//
function buildQueueRow(api_key, obj, is_history) {
	const entry = TaskEls.pre_build.queue.cloneNode(true);
	entry.dataset.id = is_history ? `h-${obj.run_at}` : obj.id;
	entry.dataset.status = is_history ? 'completed' : obj.status;

	// Status icon
	const icon = entry.querySelector('.q-status-icon');
	if (is_history) {
		const hasFailures = (
			obj.task_name === 'download_result' || obj.task_name === 'manual_download'
		) && (obj.details?.results || []).some(r => !r.success);
		icon.src = `${url_base}/static/img/check_circle.svg`;
		icon.alt = hasFailures ? 'Completed with failures' : 'Completed';
		if (hasFailures) icon.classList.add('q-status-warn');
	} else if (obj.status === 'running') {
		icon.src = `${url_base}/static/img/loading.svg`;
		icon.alt = 'Running';
		icon.classList.add('spinning');
	} else {
		icon.src = `${url_base}/static/img/loading.svg`;
		icon.alt = 'Queued';
		icon.classList.add('dim');
	}

	// Task type label
	entry.querySelector('.q-type').innerText = obj.display_title;

	// Volume link
	const vol_id = obj.volume_id;
	const vol_title = obj.volume_title;
	if (vol_id && vol_title) {
		const volEl = entry.querySelector('.q-volume');
		volEl.href = `${url_base}/volumes/${vol_id}`;
		volEl.innerText = vol_title;
		volEl.classList.remove('hidden');
	}

	// Issue number
	const issue_num = obj.issue_number;
	if (issue_num !== null && issue_num !== undefined) {
		const issueEl = entry.querySelector('.q-issue');
		issueEl.innerText = `#${issue_num}`;
		issueEl.classList.remove('hidden');
	}

	// Running message
	if (!is_history && obj.message) {
		const msgEl = entry.querySelector('.q-message');
		msgEl.innerText = obj.message;
		msgEl.classList.remove('hidden');
	}

	// Timestamps
	const queued_at = obj.queued_at;
	const started_at = obj.started_at;
	const ended_at = is_history ? obj.run_at : null;

	entry.querySelector('.q-queued').innerText =
		queued_at ? relativeTime(queued_at) : '—';
	entry.querySelector('.q-started').innerText =
		started_at ? relativeTime(started_at) : '—';
	entry.querySelector('.q-ended').innerText =
		ended_at ? relativeTime(ended_at) : '—';
	entry.querySelector('.q-duration').innerText =
		formatDuration(started_at, ended_at);

	// Action column: remove button for queued, expand button for history with details
	const removeBtn = entry.querySelector('.q-remove-btn');
	if (!is_history && obj.status === 'queued') {
		removeBtn.onclick = () => {
			sendAPI('DELETE', `/system/tasks/${obj.id}`, api_key, {}, {});
			entry.remove();
			checkQueueEmpty();
		};
	} else {
		removeBtn.remove();
		if (is_history && hasDetails(obj)) {
			const expandBtn = document.createElement('button');
			expandBtn.className = 'q-expand-btn';
			expandBtn.title = 'Show details';
			const expandImg = document.createElement('img');
			expandImg.src = `${url_base}/static/img/arrow_down.svg`;
			expandImg.alt = 'Expand';
			expandBtn.appendChild(expandImg);
			expandBtn.onclick = () => toggleDetails(entry, obj.details, expandBtn);
			entry.querySelector('.q-action-column').appendChild(expandBtn);
		}
	}

	return entry;
}

function checkQueueEmpty() {
	const has_rows = TaskEls.queue.querySelector('tr') !== null;
	TaskEls.queue_empty.classList.toggle('hidden', has_rows);
}

function updatePagination(historyCount) {
	const show = historyCount > 0 || currentPage > 0;
	TaskEls.pagination.classList.toggle('hidden', !show);
	TaskEls.buttons.prevPage.disabled = currentPage === 0;
	TaskEls.buttons.nextPage.disabled = historyCount < PAGE_SIZE || currentPage >= MAX_PAGE;
	TaskEls.pageIndicator.textContent = `Page ${currentPage + 1}`;
}

//
// Fill combined queue + history
//
function fillQueue(api_key) {
	Promise.all([
		fetchAPI('/system/tasks', api_key),
		fetchAPI('/system/tasks/history', api_key, { offset: currentPage }),
	])
	.then(([queueJson, historyJson]) => {
		TaskEls.queue.innerHTML = '';

		// Active tasks first (running before queued)
		const active = queueJson.result || [];
		active.sort((a, b) => {
			if (a.status === 'running' && b.status !== 'running') return -1;
			if (b.status === 'running' && a.status !== 'running') return 1;
			return 0;
		});
		active.forEach(obj => {
			TaskEls.queue.appendChild(buildQueueRow(api_key, obj, false));
		});

		// Then history (most recent first)
		const history = historyJson.result || [];
		history.forEach(obj => {
			TaskEls.queue.appendChild(buildQueueRow(api_key, obj, true));
		});

		checkQueueEmpty();
		updatePagination(history.length);
	});
}

//
// Clear history
//
function clearHistory(api_key) {
	sendAPI('DELETE', '/system/tasks/history', api_key);
	TaskEls.queue.querySelectorAll('tr[data-status="completed"], tr.q-detail-row').forEach(r => r.remove());
	currentPage = 0;
	checkQueueEmpty();
	updatePagination(0);
}

// code run on load

usingApiKey()
.then(api_key => {
	fillPlanning(api_key);
	fillQueue(api_key);

	TaskEls.buttons.refresh.onclick = () => {
		fillPlanning(api_key);
		fillQueue(api_key);
	};
	TaskEls.buttons.clear.onclick = () => clearHistory(api_key);

	TaskEls.buttons.prevPage.onclick = () => {
		if (currentPage > 0) {
			currentPage--;
			fillQueue(api_key);
		}
	};
	TaskEls.buttons.nextPage.onclick = () => {
		if (currentPage < MAX_PAGE) {
			currentPage++;
			fillQueue(api_key);
		}
	};

	// Live updates: refresh on any task event
	socket.on('task_added', () => fillQueue(api_key));
	socket.on('task_ended', () => fillQueue(api_key));
	socket.on('task_status', data => {
		// Update message on the running row without full refresh
		if (!data.notification) {
			const running = TaskEls.queue.querySelector('tr[data-status="running"]');
			if (running) {
				const msgEl = running.querySelector('.q-message');
				if (msgEl && data.message) {
					msgEl.innerText = data.message;
					msgEl.classList.remove('hidden');
				}
			}
		}
	});
});
