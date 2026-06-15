const QEls = {
	queue: document.querySelector('#queue'),
	queue_entry: document.querySelector('.pre-build-els .queue-entry'),
	tool_bar: {
		remove_all: document.querySelector('#removeall-button')
	}
};

//
// Filling data
//
function addQueueEntry(api_key, obj) {
	const entry = QEls.queue_entry.cloneNode(true);
	entry.dataset.id = obj.id;
	QEls.queue.appendChild(entry);

	const title = entry.querySelector('a:first-of-type');
	title.innerText = obj.title;
	title.href = `${url_base}/volumes/${obj.volume_id}`;

	const source = entry.querySelector('td:nth-child(3) a')
	source.innerText =
		obj.source_name.charAt(0).toUpperCase() + obj.source_name.slice(1);
	source.href = obj.web_link;
	source.title = `Page Title:\n${obj.web_title}`;
	if (obj.web_sub_title !== null)
		source.title += `\n\nSub Section:\n${obj.web_sub_title}`;

	const index = [...QEls.queue.children].indexOf(entry);
	entry.querySelector('.move-up-dl').onclick = e => moveEntry(
		obj.id, index - 1, api_key
	);
	entry.querySelector('.move-down-dl').onclick = e => moveEntry(
		obj.id, index + 1, api_key
	);
	entry.querySelector('.remove-dl').onclick = e => deleteEntry(
		obj.id, api_key
	);
	entry.querySelector('.blocklist-dl').onclick = e => deleteEntry(
		obj.id,
		api_key,
		blocklist=true
	);

	updateQueueEntry(obj);
};

function updateQueueEntry(obj) {
	const tr = document.querySelector(`#queue > tr[data-id="${obj.id}"]`);
	if (!tr) return;
	tr.dataset.status = obj.status;

	const statusText = obj.status.charAt(0).toUpperCase() + obj.status.slice(1);
	const taskLabel = obj.task_label || '';
	const statusCell = tr.querySelector('td:nth-child(1)');

	// Status with optional task label chip
	if (taskLabel) {
		let chipClass = 'chip';
		if (obj.status === 'downloading') chipClass += ' chip--accent';
		else if (obj.status === 'completed') chipClass += ' chip--success';
		else if (obj.status === 'failed') chipClass += ' chip--error';
		statusCell.innerHTML = `${statusText} <span class="${chipClass}">${taskLabel}</span>`;
	} else {
		statusCell.innerText = statusText;
	}

	// Size
	tr.querySelector('td:nth-child(4)').innerText =
		obj.size === -1 ? '—' : convertSize(obj.size);

	// Speed
	tr.querySelector('td:nth-child(5)').innerText =
		obj.speed > 0
			? twoDigits(Math.round(obj.speed / 100000) / 10) + 'MB/s'
			: '—';

	// Progress — use bar when downloading, text otherwise
	const progressIsPercent = obj.size !== -1 || obj.progress_is_percent ||
		['suwayomi', 'suwayomi_volume'].includes(obj.type);
	const progressText = progressIsPercent
		? twoDigits(Math.round((obj.progress || 0) * 10) / 10) + '%'
		: convertSize(obj.progress || 0);

	const progressCell = tr.querySelector('td:nth-child(6)');
	const progressBar = tr.querySelector('.queue-progress');

	if (obj.status === 'downloading' && progressBar) {
		progressBar.style.display = '';
		const fill = progressBar.querySelector('.queue-progress-fill');
		const label = progressBar.querySelector('.queue-progress-label');
		const pct = progressIsPercent ? (obj.progress || 0) : 0;
		if (fill) fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
		if (label) label.textContent = progressText;
	} else if (progressBar) {
		progressBar.style.display = 'none';
	}

	// Keep the text column too for the number-column display
	if (progressCell) progressCell.innerText = progressText;
};

function removeQueueEntry(id) {
	const el = document.querySelector(`#queue > tr[data-id="${id}"]`);
	if (el) el.remove();
};

function fillQueue(api_key) {
	fetchAPI('/activity/queue', api_key)
	.then(json => {
		QEls.queue.innerHTML = '';
		json.result.forEach(obj => addQueueEntry(api_key, obj));
	})
};

//
// Actions
//
function deleteAll(api_key) {
	sendAPI('DELETE', '/activity/queue', api_key);
};

function moveEntry(id, index, api_key) {
	sendAPI('PUT', `/activity/queue/${id}`, api_key, {
		index: index
	}, {})
	.then(response => {
		if (!response.ok)
			return;

		fillQueue(api_key);
	});
}

function deleteEntry(id, api_key, blocklist=false) {
	sendAPI('DELETE', `/activity/queue/${id}`, api_key, {}, {
		blocklist: blocklist
	});
};

// code run on load

usingApiKey()
.then(api_key => {
	fillQueue(api_key);
	socket.on('queue_added', data => addQueueEntry(api_key, data));
	socket.on('queue_status', updateQueueEntry);
	socket.on('queue_ended', data => removeQueueEntry(data.id));
	QEls.tool_bar.remove_all.onclick = e => deleteAll(api_key);
});
