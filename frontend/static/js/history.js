const HistoryEls = {
	table: document.querySelector('#history'),
	page_turner: {
		container: document.querySelector('.page-turner'),
		previous: document.querySelector('#previous-page'),
		next: document.querySelector('#next-page'),
		number: document.querySelector('#page-number')
	},
	buttons: {
		refresh: document.querySelector('#refresh-button'),
		clear: document.querySelector('#clear-button')
	},
	entry: document.querySelector('.pre-build-els .history-entry')
};

var offset = 0;

function fillHistory(api_key) {
	fetchAPI('/activity/history', api_key, {offset: offset})
	.then(json => {
		HistoryEls.table.innerHTML = '';
		json.result.forEach(obj => {
			const entry = HistoryEls.entry.cloneNode(true);

			// Title — link + file
			const titleLink = entry.querySelector('a');
			titleLink.href = obj.web_link;
			// Never show raw web_link as display text
			const displayTitle = obj.web_title || obj.file_title || obj.web_sub_title || obj.source || 'Unknown';
			titleLink.innerText = displayTitle;
			titleLink.title = displayTitle;
			if (obj.web_sub_title && obj.web_sub_title !== displayTitle)
				titleLink.title += `\n\n${obj.web_sub_title}`;

			// Source chip
			const sourceChip = entry.querySelector('.source-chip');
			sourceChip.textContent = obj.source_name || obj.source || '';
			sourceChip.className = 'chip source-chip';

			// Downloaded date
			if (obj.downloaded_at) {
				const d = new Date(obj.downloaded_at * 1000);
				const formatted = d.toLocaleString('en-CA').slice(0,10) + ' ' + d.toTimeString().slice(0,5);
				entry.querySelector('td:nth-child(4)').innerText = formatted;
			}

			// State chip
			const stateChip = entry.querySelector('.state-chip');
			if (obj.success === true) {
				stateChip.textContent = 'Success';
				stateChip.className = 'chip state-chip chip--success';
			} else if (obj.success === false) {
				stateChip.textContent = 'Failed';
				stateChip.className = 'chip state-chip chip--error';
			} else {
				stateChip.textContent = 'Unknown';
				stateChip.className = 'chip state-chip';
			}

			HistoryEls.table.appendChild(entry);
		});
	});
}

function clearHistory(api_key) {
	sendAPI('DELETE', '/activity/history', api_key)
	offset = 0;
	HistoryEls.page_turner.number.innerText = 'Page 1';
	HistoryEls.table.innerHTML = '';
}

function reduceOffset(api_key) {
	if (offset === 0) return;
	offset--;
	HistoryEls.page_turner.number.innerText = `Page ${offset + 1}`;
	fillHistory(api_key);
}

function increaseOffset(api_key) {
	if (HistoryEls.table.innerHTML === '') return;
	offset++;
	HistoryEls.page_turner.number.innerText = `Page ${offset + 1}`;
	fillHistory(api_key);
}

// code run on load
usingApiKey()
.then(api_key => {
	fillHistory(api_key);
	HistoryEls.buttons.refresh.onclick = e => fillHistory(api_key);
	HistoryEls.buttons.clear.onclick = e => clearHistory(api_key);
	HistoryEls.page_turner.previous.onclick = e => reduceOffset(api_key);
	HistoryEls.page_turner.next.onclick = e => increaseOffset(api_key);
});
