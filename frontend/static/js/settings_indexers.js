function loadIndexers(api_key) {
	fetchAPI('/nzbindexers', api_key)
	.then(json => {
		const list = document.querySelector('#indexer-list');
		document.querySelectorAll('#indexer-list > :not(:first-child)')
			.forEach(el => el.remove());

		json.result.forEach(indexer => {
			const entry = document.createElement('button');
			entry.onclick = () => loadEditIndexer(api_key, indexer.id);
			entry.innerText = indexer.name + (indexer.enabled ? '' : ' (disabled)');
			list.appendChild(entry);
		});
	});
};

function loadEditIndexer(api_key, id) {
	fetchAPI(`/nzbindexers/${id}`, api_key)
	.then(data => {
		const form = document.querySelector('#edit-indexer-form');
		form.dataset.id = id;
		hide([document.querySelector('#edit-indexer-error')]);
		document.querySelector('#test-indexer-edit').classList.remove('show-success', 'show-fail');

		document.querySelector('#edit-indexer-name').value = data.result.name || '';
		document.querySelector('#edit-indexer-url').value = data.result.base_url || '';
		document.querySelector('#edit-indexer-apikey').value = data.result.api_key || '';
		document.querySelector('#edit-indexer-categories').value = data.result.categories || '7030,7020';
		document.querySelector('#edit-indexer-enabled').checked = data.result.enabled;

		showWindow('edit-indexer-window');
	});
};

async function testIndexer(base_url, api_key_val, test_button, error_el) {
	hide([error_el]);
	test_button.classList.remove('show-success', 'show-fail');
	const api_key = await usingApiKey();
	return sendAPI('POST', '/nzbindexers/test', api_key, {}, {
		base_url: base_url,
		api_key: api_key_val
	})
	.then(r => r.json())
	.then(json => {
		if (json.result.success) {
			test_button.classList.add('show-success');
		} else {
			test_button.classList.add('show-fail');
			error_el.innerText = json.result.description || 'Connection failed';
			hide([], [error_el]);
		}
		return json.result.success;
	});
};

function saveAddIndexer() {
	usingApiKey()
	.then(async api_key => {
		const error = document.querySelector('#add-indexer-error');
		const base_url = document.querySelector('#add-indexer-url').value;
		const api_key_val = document.querySelector('#add-indexer-apikey').value;
		const test_button = document.querySelector('#test-indexer-add');

		const ok = await testIndexer(base_url, api_key_val, test_button, error);
		if (!ok) return;

		const data = {
			name: document.querySelector('#add-indexer-name').value,
			base_url: base_url,
			api_key: api_key_val,
			categories: document.querySelector('#add-indexer-categories').value,
			enabled: document.querySelector('#add-indexer-enabled').checked
		};
		sendAPI('POST', '/nzbindexers', api_key, {}, data)
		.then(() => {
			loadIndexers(api_key);
			closeWindow();
		})
		.catch(e => {
			e.json().then(json => {
				error.innerText = json.result?.reason_text || 'Failed to add indexer';
				hide([], [error]);
			});
		});
	});
};

function saveEditIndexer() {
	usingApiKey()
	.then(async api_key => {
		const form = document.querySelector('#edit-indexer-form');
		const id = form.dataset.id;
		const error = document.querySelector('#edit-indexer-error');
		const base_url = document.querySelector('#edit-indexer-url').value;
		const api_key_val = document.querySelector('#edit-indexer-apikey').value;
		const test_button = document.querySelector('#test-indexer-edit');

		const ok = await testIndexer(base_url, api_key_val, test_button, error);
		if (!ok) return;

		const data = {
			name: document.querySelector('#edit-indexer-name').value,
			base_url: base_url,
			api_key: api_key_val,
			categories: document.querySelector('#edit-indexer-categories').value,
			enabled: document.querySelector('#edit-indexer-enabled').checked
		};
		sendAPI('PUT', `/nzbindexers/${id}`, api_key, {}, data)
		.then(() => {
			loadIndexers(api_key);
			closeWindow();
		})
		.catch(e => {
			e.json().then(json => {
				error.innerText = json.result?.reason_text || 'Failed to save indexer';
				hide([], [error]);
			});
		});
	});
};

function deleteIndexer(api_key) {
	const id = document.querySelector('#edit-indexer-form').dataset.id;
	sendAPI('DELETE', `/nzbindexers/${id}`, api_key)
	.then(() => {
		loadIndexers(api_key);
		closeWindow();
	});
};


// code run on load

usingApiKey()
.then(api_key => {
	loadIndexers(api_key);

	document.querySelector('#add-indexer-client').onclick =
		() => showWindow('add-indexer-window');

	document.querySelector('#delete-indexer-edit').onclick =
		() => deleteIndexer(api_key);

	document.querySelector('#test-indexer-add').onclick = () => {
		const base_url = document.querySelector('#add-indexer-url').value;
		const api_key_val = document.querySelector('#add-indexer-apikey').value;
		testIndexer(
			base_url, api_key_val,
			document.querySelector('#test-indexer-add'),
			document.querySelector('#add-indexer-error')
		);
	};

	document.querySelector('#test-indexer-edit').onclick = () => {
		const base_url = document.querySelector('#edit-indexer-url').value;
		const api_key_val = document.querySelector('#edit-indexer-apikey').value;
		testIndexer(
			base_url, api_key_val,
			document.querySelector('#test-indexer-edit'),
			document.querySelector('#edit-indexer-error')
		);
	};
});

document.querySelector('#add-indexer-form').action = 'javascript:saveAddIndexer()';
document.querySelector('#edit-indexer-form').action = 'javascript:saveEditIndexer()';
