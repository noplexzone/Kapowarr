const ViewEls = {
	views: {
		loading: document.querySelector('#loading-screen'),
		main: document.querySelector('main')
	},
	pre_build: {
		issue_entry: document.querySelector('.pre-build-els .issue-entry'),
		manual_search: document.querySelector('.pre-build-els .search-entry'),
		rename_before: document.querySelector('.pre-build-els .rename-before'),
		rename_after: document.querySelector('.pre-build-els .rename-after'),
		manage: document.querySelector('.pre-build-els .manage-entry'),
		match: document.querySelector('.pre-build-els .match-entry'),
		files_entry: document.querySelector('.pre-build-els .files-entry'),
		general_files_entry: document.querySelector('.pre-build-els .general-files-entry'),
		fix_match_result: document.querySelector('.pre-build-els .fix-match-result')
	},
	vol_data: {
		monitor: document.querySelector('#volume-monitor'),
		title: document.querySelector('.volume-title-monitored > h2'),
		cover: document.querySelector('.volume-info > img'),
		tags: document.querySelector('#volume-tags'),
		path: document.querySelector('#volume-path'),
		description: document.querySelector('#volume-description'),
		mobile_description: document.querySelector('#volume-description-mobile')
	},
	vol_edit: {
		monitor: document.querySelector('#monitored-input'),
		monitor_new_issues: document.querySelector('#monitor-issues-input'),
		monitoring_scheme: document.querySelector('#monitoring-scheme-input'),
		root_folder: document.querySelector('#root-folder-input'),
		volume_folder: document.querySelector('#volumefolder-input'),
		special_version: document.querySelector('#specialoverride-input')
	},
	tool_bar: {
		refresh: document.querySelector('#refresh-button'),
		auto_search: document.querySelector('#autosearch-button'),
		manual_search: document.querySelector('#manualsearch-button'),
		import: document.querySelector('#import-button'),
		rename: document.querySelector('#rename-button'),
		convert: document.querySelector('#convert-button'),
		manage: document.querySelector('#manage-button'),
		files: document.querySelector('#files-button'),
		fix_match: document.querySelector('#fix-match-button'),
		edit: document.querySelector('#edit-button'),
		delete: document.querySelector('#delete-button')
	},
	issues_list: document.querySelector('#issues-list')
};

//
// Filling data
//
class IssueEntry {
	constructor(id, api_key, row_entry=null) {
		this.id = id;
		this.api_key = api_key;
		if (row_entry !== null)
			this.entry = row_entry;
		else
			this.entry = ViewEls.issues_list.querySelector(`tr[data-id="${id}"]`);

		this.monitored = this.entry.querySelector('.issue-monitored button');
		this.issue_number = this.entry.querySelector('.issue-number');
		this.title = this.entry.querySelector('.issue-title');
		this.date = this.entry.querySelector('.issue-date');
		this.status = this.entry.querySelector('.issue-status');
		this.auto_search = this.entry.querySelector('.action-column :nth-child(1)');
		this.manual_search = this.entry.querySelector('.action-column :nth-child(2)');
		this.convert = this.entry.querySelector('.action-column :nth-child(3)');
	};

	setMonitorIcon() {
		if (this.monitored.dataset.monitored === 'true') {
			setIcon(
				this.monitored,
				icons.monitored,
				'Issue is monitored. Click to unmonitor.'
			);
		} else {
			setIcon(
				this.monitored,
				icons.unmonitored,
				'Issue is umonitored. Click to monitor.'
			);
		};
	};

	toggleMonitored() {
		const monitored = this.monitored.dataset.monitored !== 'true';
		sendAPI('PUT', `/issues/${this.id}`, this.api_key, {}, {
			'monitored': monitored
		})
		.then(response => {
			this.monitored.dataset.monitored = monitored;
			this.setMonitorIcon();
		});
	};

	setDownloaded(downloaded) {
		if (downloaded) {
			// Downloaded
			setImage(this.status, images.check, 'Issue is downloaded');
            this.status.classList.remove('error');
            this.status.classList.add('success');
		} else {
			// Not downloaded
			setImage(this.status, images.cancel, 'Issue is not downloaded');
            this.status.classList.remove('success');
            this.status.classList.add('error');
		};
	};
};

function fillTable(issues, api_key) {
	ViewEls.issues_list.innerHTML = '';

	for (i = issues.length - 1; i >= 0; i--) {
		const obj = issues[i];

		const entry = ViewEls.pre_build.issue_entry.cloneNode(true);
		entry.dataset.id = obj.id;
		ViewEls.issues_list.appendChild(entry);

		const inst = new IssueEntry(obj.id, api_key, entry);

		// ARIA
		inst.entry.ariaLabel = `Issue ${obj.issue_number}`;

		// Monitored
		inst.monitored.dataset.monitored = obj.monitored;
		inst.monitored.dataset.id = obj.id;
		inst.monitored.onclick = e => inst.toggleMonitored();
		inst.setMonitorIcon();

		// Issue number
		inst.issue_number.innerText = obj.issue_number;

		// Title
		inst.title.innerText = obj.title;
		inst.title.onclick = e => showIssueInfo(obj.id, api_key);

		// Release date
		inst.date.innerText = obj.date;

		// Download status
		inst.setDownloaded(obj.files.length);

		// Actions
		inst.auto_search.onclick = e => autosearchIssue(obj.id, api_key);
		inst.manual_search.onclick = e => showManualSearch(api_key, obj.id);
		inst.convert.onclick = e => showConvert(api_key, obj.id);
	};
};

function fillPage(data, api_key) {
	if (data.special_version_locked)
		ViewEls.vol_edit.special_version.value = data.special_version || '';
	else {
		ViewEls.vol_edit.special_version.value = 'auto';
		const sv_name = ViewEls.vol_edit.special_version
			.querySelector(`option[value='${data.special_version || ''}']`)
			.innerText;
		ViewEls.vol_edit.special_version
			.querySelector("option[value='auto']")
			.innerText += ` (${sv_name})`;
	};

	// Cover
	ViewEls.vol_data.cover.src = `${url_base}/api/volumes/${data.id}/cover?api_key=${api_key}`;

	// Monitored state
	ViewEls.vol_edit.monitor_new_issues.value = data.monitor_new_issues;
	const monitor = ViewEls.vol_data.monitor;
	monitor.dataset.monitored = data.monitored;
	monitor.onclick = e => toggleMonitored(api_key);
	if (data.monitored)
		// Volume is monitored
		setIcon(monitor, icons.monitored, 'Volume is monitored. Click to unmonitor.');
	else
		// Volume is unmonitored
		setIcon(monitor, icons.unmonitored, 'Volume is unmonitored. Click to monitor.');

	// Title
	ViewEls.vol_data.title.innerText = data.title;

	// Tags
	const tags = ViewEls.vol_data.tags;
	if (data.year !== null) {
		const year = document.createElement('p');
		year.innerText = data.year;
		tags.appendChild(year);
	}
	const volume_number = document.createElement('p');
	volume_number.innerText = `Volume ${data.volume_number || 1}`;
	tags.appendChild(volume_number);
	if (data.publisher) {
		const publisher = document.createElement('p');
		publisher.innerText = data.publisher;
		tags.appendChild(publisher);
	}
	const special_version = document.createElement('p');
	special_version.innerText = data.special_version?.toUpperCase() || 'Normal volume';
	tags.appendChild(special_version);
	const total_size = document.createElement('p');
	total_size.innerText = data.total_size > 0 ? convertSize(data.total_size) : '0MB';
	tags.appendChild(total_size);
	if (data.site_url !== "") {
		const link = document.createElement('a');
		link.href = data.site_url;
		link.innerText = "link";
		tags.appendChild(link);
	};
	
	// Path
	const path = ViewEls.vol_data.path;
	path.innerText = data.folder;
	path.dataset.root_folder = data.root_folder;
	path.dataset.volume_folder = data.volume_folder;

	// Descriptions
	ViewEls.vol_data.description.innerHTML = data.description;
	ViewEls.vol_data.mobile_description.innerHTML = data.description;

	// fill issue lists
	fillTable(data.issues, api_key);
	fillIssueMatchTable(data.issues);

	mapButtons(volume_id);

	hide([ViewEls.views.loading], [ViewEls.views.main]);

	const table = document.querySelector('#files-window tbody');
	table.innerHTML = '';
	data.general_files.forEach(gf => {
		const entry = ViewEls.pre_build.general_files_entry.cloneNode(true);

        const short_f = gf.filepath.slice(
			gf.filepath.indexOf(data.volume_folder)
			+ data.volume_folder.length
			+ 1
		);
		const file_name = entry.querySelector('.gf-filepath');
		file_name.innerText = short_f;
		file_name.title = gf.filepath;

        entry.querySelector('.gf-type').innerText = gf.file_type;
        entry.querySelector('.gf-size').innerText = convertSize(gf.size);
        entry.querySelector('.gf-delete button').onclick = e =>
            sendAPI("DELETE", `/files/${gf.id}`, api_key)
            .then(response => entry.remove());

        table.appendChild(entry);
	});
};

//
// Actions
//
function toggleMonitored(api_key) {
	const monitored = ViewEls.vol_data.monitor.dataset.monitored !== 'true';
	sendAPI('PUT', `/volumes/${volume_id}`, api_key, {}, {
		monitored: monitored
	})
	.then(response => {
		ViewEls.vol_data.monitor.dataset.monitored = monitored;
		if (monitored)
			setIcon(
				ViewEls.vol_data.monitor,
				icons.monitored,
				'Volume is monitored. Click to unmonitor.'
			);
		else
			setIcon(
				ViewEls.vol_data.monitor,
				icons.unmonitored,
				'Volume is unmonitored. Click to monitor.'
			);
	});
};

//
// Tasks
//
function importFiles(api_key) {
	const file_input = document.querySelector('#import-file-input');
	file_input.onchange = e => {
		if (!e.target.files.length) return;

		const button = ViewEls.tool_bar.import;
		const label = button.querySelector('p');
		const original_text = label.innerText;
		label.innerText = 'Uploading...';
		button.disabled = true;

		const form_data = new FormData();
		for (const file of e.target.files)
			form_data.append('files', file);

		fetch(`${url_base}/api/volumes/${volume_id}/import`, {
			method: 'POST',
			headers: {'x-api-key': api_key},
			body: form_data
		})
		.then(r => {
			if (!r.ok) throw r;
			label.innerText = 'Queued!';
		})
		.catch(() => {
			label.innerText = 'Failed';
		})
		.finally(() => {
			setTimeout(() => {
				label.innerText = original_text;
				button.disabled = false;
			}, 2000);
			e.target.value = '';
		});
	};
	file_input.click();
};

function refreshVolume(api_key) {
	const button_info = task_to_button[`refresh_and_scan#${volume_id}`];
	const icon = button_info.button.querySelector('img');
	icon.src = button_info.loading_icon;
	icon.classList.add('spinning');

	sendAPI('POST', '/system/tasks', api_key, {}, {
		cmd: 'refresh_and_scan',
		volume_id: volume_id
	});
};

function autosearchVolume(api_key) {
	const button_info = task_to_button[`auto_search#${volume_id}`];
	const icon = button_info.button.querySelector('img');
	icon.src = button_info.loading_icon;
	icon.classList.add('spinning');

	sendAPI('POST', '/system/tasks', api_key, {}, {
		cmd: 'auto_search',
		volume_id: volume_id
	});
};

function autosearchIssue(issue_id, api_key) {
	const button_info = task_to_button[`auto_search_issue#${volume_id}#${issue_id}`];
	const icon = button_info.button.querySelector('img');
	icon.src = button_info.loading_icon;
	icon.classList.add('spinning');

	sendAPI('POST', '/system/tasks', api_key, {}, {
		cmd: 'auto_search_issue',
		volume_id: volume_id,
		issue_id: issue_id
	});
};

//
// Manual search
//
function showManualSearch(api_key, issue_id=null) {
	// Display searching message
	const message = document.querySelector('#searching-message');
	const table = document.querySelector('#search-result-table');
	const tbody = table.querySelector('tbody');

	hide([table], [message]);

	// Show window
	showWindow('manual-search-window');

	// Start search
	tbody.innerHTML = '';
	const url = issue_id
			? `/issues/${issue_id}/manualsearch`
			: `/volumes/${volume_id}/manualsearch`;

	fetchAPI(url, api_key)
	.then(json => {
		json.result.forEach(result => {
			const entry = ViewEls.pre_build.manual_search.cloneNode(true);
			tbody.appendChild(entry);

			const match = entry.querySelector('.match-column');
			if (result.match)
				setImage(
					match,
					images.check,
					'Search result matches'
				);
			else
				setImage(
					match,
					images.cancel,
					result.match_issue
				);

			const title = entry.querySelector('a');
			title.href = result.link;
			title.innerText = result.display_title;

			entry.querySelector('.source-column').innerText = result.source;

			const download_button = entry.querySelector('.search-action-column :nth-child(1)');
			download_button.classList.add('icon-text-color');
			download_button.onclick =
				e => addManualSearch(result.link, false, download_button, api_key, issue_id, result.display_title || '');

			const force_download_button = entry.querySelector('.search-action-column :nth-child(2)');
			force_download_button.classList.add('icon-text-color');
			force_download_button.onclick =
				e => addManualSearch(result.link, true, force_download_button, api_key, issue_id, result.display_title || '');

			const blocklist_button = entry.querySelector('.search-action-column :nth-child(3)')
			if (result.match_issue === null || !result.match_issue.includes('blocklist'))
				// Show blocklist button
				blocklist_button.onclick =
					e => blockManualSearch(
                        result.link, result.display_title,
                        volume_id, issue_id,
						blocklist_button,
						match,
						api_key
					);
			else
				// No blocklist button
				blocklist_button.remove()
		});

		hide([message], [table]);
	});
};

function addManualSearch(link, force, button, api_key, issue_id=null, display_title='') {
	button.classList.remove('error');
	button.title = 'Download';
	const img = button.querySelector('img');
	img.src = `${url_base}/static/img/loading.svg`;
	img.classList.add('spinning');

	const url = issue_id
		? `/issues/${issue_id}/download`
		: `/volumes/${volume_id}/download`;

	sendAPI('POST', url, api_key, {link: link, force_match: force, display_title: display_title})
	.then(response => response.json())
	.then(json => {
		img.classList.remove('spinning');
		if (json.result.fail_reason === null)
			img.src = `${url_base}/static/img/check.svg`;
		else {
			img.src = `${url_base}/static/img/download.svg`;
			button.classList.add('error');
			button.title = json.result.fail_reason;
		};
	});
};

function blockManualSearch(
    web_link, web_title,
    volume_id, issue_id,
    button, match,
    api_key
) {
	sendAPI('POST', '/blocklist', api_key, {}, {
        web_link: web_link,
        web_title: web_title,
        volume_id: volume_id,
        issue_id: issue_id,
		reason_id: 4
	})
	.then(response => {
        console.log(button, match);
		button.querySelector('img').src = `${url_base}/static/img/check.svg`;
        setImage(
            match,
            'cancel.svg',
            'Link is blocklisted'
        );
	});
};

//
// Renaming
//
function showRename(api_key, issue_id=null) {
	document.querySelector('#selectall-input').checked = true;

	const rename_button = document.querySelector('#submit-rename');
	let url;
	if (issue_id === null) {
		// Preview volume rename
		url = `/volumes/${volume_id}/rename`;
		rename_button.dataset.issue_id = '';
	} else {
		// Preview issue rename
		url = `/issues/${issue_id}/rename`;
		rename_button.dataset.issue_id = issue_id;
	};
	fetchAPI(url, api_key)
	.then(json => {
		const empty_message = document.querySelector('#rename-window .empty-rename-message'),
			table_container = document.querySelector('#rename-window .rename-preview'),
			table = table_container.querySelector('tbody');
		table.innerHTML = '';

		if (!Object.keys(json.result).length) {
			hide([table_container, rename_button], [empty_message]);
		} else {
			hide([empty_message], [table_container, rename_button]);
			Object.entries(json.result).forEach(mapping => {
				const before_row = ViewEls.pre_build.rename_before.cloneNode(true);
				table.appendChild(before_row);
				const after_row = ViewEls.pre_build.rename_after.cloneNode(true);
				table.appendChild(after_row);

				before_row.querySelector('td:last-child').innerText = mapping[0];
				after_row.querySelector('td:last-child').innerText = mapping[1];
			});
		};
		showWindow('rename-window');
	});
};

function toggleAllRenames() {
	const checked = document.querySelector('#selectall-input').checked;
	document.querySelectorAll(
		'#rename-window tbody input[type="checkbox"]'
	).forEach(e => e.checked = checked);
};

function renameVolume(api_key, issue_id=null) {
	const checkboxes = [...document.querySelectorAll(
		'#rename-window tbody input[type="checkbox"]'
	)];

	if (checkboxes.every(e => !e.checked)) {
		closeWindow();
		return;
	};

	const data = {
		cmd: 'mass_rename',
		volume_id: volume_id,
		filepath_filter:
			checkboxes
				.filter(e => e.checked)
				.map(e => e
					.parentNode
					.parentNode
					.querySelector('td:last-child')
					.innerText
				)
	};
	if (issue_id !== null) {
		data.cmd = 'mass_rename_issue';
		data.issue_id = issue_id;
	};

	sendAPI('POST', '/system/tasks', api_key, {}, data)
	.then(response => closeWindow());
};

//
// Converting
//
function loadConvertPreference(api_key) {
	const el = document.querySelector('#convert-preference');
	if (el.innerHTML !== '')
		return;

	fetchAPI('/settings', api_key)
	.then(json => {
		const pref = [
			'source',
			...json.result.format_preference,
			'no conversion'
		].join(' - ');
		el.innerHTML = pref;
		el.ariaLabel = `The format preference is the following: ${pref}`
	});
};

function showConvert(api_key, issue_id=null) {
	document.querySelector('#selectall-convert-input').checked = true;
	loadConvertPreference(api_key);

	const convert_button = document.querySelector('#submit-convert');
	let url;
	if (issue_id === null) {
		// Preview issue conversion
		url = `/volumes/${volume_id}/convert`;
		convert_button.dataset.issue_id = '';
	} else {
		// Preview issue conversion
		url = `/issues/${issue_id}/convert`;
		convert_button.dataset.issue_id = issue_id;
	};

	fetchAPI(url, api_key)
	.then(json => {
		const empty_rename = document.querySelector('#convert-window .empty-rename-message'),
			table_container = document.querySelector('#convert-window table');
		const table = table_container.querySelector('tbody');
		table.innerHTML = '';

		if (!Object.keys(json.result).length) {
			hide([table_container, convert_button], [empty_rename]);

		} else {
			hide([empty_rename], [table_container, convert_button]);
			Object.entries(json.result).forEach(mapping => {
				const before_row = ViewEls.pre_build.rename_before.cloneNode(true);
				table.appendChild(before_row);
				const after_row = ViewEls.pre_build.rename_after.cloneNode(true);
				table.appendChild(after_row);

				before_row.querySelector('td:last-child').innerText = mapping[0];
				after_row.querySelector('td:last-child').innerText = mapping[1];
			});
		};
		showWindow('convert-window');
	});
};

function toggleAllConverts() {
	const checked = document.querySelector('#selectall-convert-input').checked;
	document.querySelectorAll(
		'#convert-window tbody input[type="checkbox"]'
	).forEach(e => e.checked = checked);
};

function convertVolume(api_key, issue_id=null) {
	const checkboxes = [...document.querySelectorAll(
		'#convert-window tbody input[type="checkbox"]'
	)];

	if (checkboxes.every(e => !e.checked)) {
		closeWindow();
		return;
	};

	const data = {
		cmd: 'mass_convert',
		volume_id: volume_id,
		filepath_filter:
			checkboxes
				.filter(e => e.checked)
				.map(e => e
					.parentNode
					.parentNode
					.querySelector('td:last-child')
					.innerText
				)
	};
	if (issue_id !== null) {
		data.cmd = 'mass_convert_issue';
		data.issue_id = issue_id;
	};

	sendAPI('POST', '/system/tasks', api_key, {}, data)
	.then(response => closeWindow());
};

//
// Manage Issues
//
const manageIdToFilepath = {};
let managed_issues = [];
let managed_issues_changes = {};

function _issuesCoveredByMapping(mapping, no_match_is_tbd=false) {
	let mapping_value = '';
	if (mapping.general_file)
		mapping_value += 'General File';

	else if (mapping.issue_ids.length >= 1)
		mapping_value += document.querySelector(
			`#issue-match-table tr[data-issue_id="${mapping.issue_ids[0]}"] td:nth-child(2)`
		).innerText;

	if (mapping.issue_ids.length > 1)
		mapping_value += ' - ' + document.querySelector(
			`#issue-match-table tr[data-issue_id="${mapping.issue_ids[mapping.issue_ids.length - 1]}"] td:nth-child(2)`
		).innerText;

	if (no_match_is_tbd && !mapping_value)
		mapping_value += 'TBD';

	if (mapping.forced_match)
		mapping_value += ' (Forced)';

	return mapping_value;
}

function showManageIssues(api_key) {
	managed_issues_changes = {};
	managed_issues = [];
	document.querySelector('#selectall-manage-input').checked = false;
	const table = document.querySelector('#manage-issues-table tbody'),
		volume_folder = ViewEls.vol_data.path.dataset.volume_folder;
	table.querySelectorAll('tr:not(:first-child)').forEach(e => e.remove());

	fetchAPI(`/volumes/${volume_id}/manualmatch`, api_key)
	.then(json => {
		json.result.sort((a, b) => {
			const aNum = parseFloat(_issuesCoveredByMapping(a)) || Infinity;
			const bNum = parseFloat(_issuesCoveredByMapping(b)) || Infinity;
			return aNum - bNum;
		});
		json.result.forEach((mapping, idx) => {
			const entry = ViewEls.pre_build.manage.cloneNode(true);
			entry.dataset.manage_id = idx;
			entry.dataset.file_id = mapping.file_id || '';
			manageIdToFilepath[idx] = mapping.filepath;

            const short_f = mapping.filepath.slice(
                mapping.filepath.indexOf(volume_folder)
                + volume_folder.length
                + 1
            );
			entry.querySelector('.mi-filepath').innerText = short_f;
			entry.querySelector('.mi-filepath').title = mapping.filepath;
			entry.querySelector('.mi-matched').innerText = _issuesCoveredByMapping(mapping);

			// Keep select-all in sync when individual boxes are toggled
			entry.querySelector('input[type="checkbox"]').onchange = () => {
				const allBoxes = [...document.querySelectorAll(
					'#manage-window tbody input[type="checkbox"]'
				)];
				document.querySelector('#selectall-manage-input').checked =
					allBoxes.length > 0 && allBoxes.every(cb => cb.checked);
			};

			table.appendChild(entry);
		});
	});

	showWindow('manage-window');
};

function toggleAllManages() {
	const checked = document.querySelector('#selectall-manage-input').checked;
	document.querySelectorAll(
		'#manage-window tbody input[type="checkbox"]'
	).forEach(e => e.checked = checked);
};

function submitManagedIssues(api_key) {
	sendAPI('PUT', `/volumes/${volume_id}/manualmatch`, api_key, {},
		Object.values(managed_issues_changes)
	)
	.then(response => window.location.reload());
};

function fillIssueMatchTable(issues) {
	const table = document.querySelector('#issue-match-table tbody');
	issues.forEach(issue => {
		const entry = ViewEls.pre_build.match.cloneNode(true);

		entry.dataset.issue_id = issue.id;
		entry.querySelector('input').onchange = e => handleIssueMatchCheckboxes(e);
		entry.querySelector('td:nth-child(2)').innerText = issue.issue_number;
		entry.querySelector('td:nth-child(3)').innerText = issue.title;
		entry.querySelector('td:nth-child(4)').innerText = issue.date;

		table.appendChild(entry);
	});
};

function showMatchIssue() {
	managed_issues = [...document.querySelectorAll(
		'#manage-issues-table tbody tr:has(input[type="checkbox"]:checked)'
	)].map(el => parseInt(el.dataset.manage_id));

	if (!managed_issues.length)
		return;

	setIssueMatchCheckboxes(false);
	showWindow('match-window');
};

function setIssueMatchCheckboxes(checked) {
	document.querySelector('#selectall-match-input').checked = checked;
	document.querySelectorAll(
		'#match-window tbody > tr:nth-child(n + 4) input[type="checkbox"]'
	).forEach(e => e.checked = checked);
}

function handleIssueMatchCheckboxes(e) {
	const checkbox = e.target;

	if (checkbox !== document.activeElement)
		// Checkbox is not being altered by user
		return;

	const row = checkbox.parentElement.parentElement,
		autoMatch = document.querySelector('#auto-match-entry input'),
		generalFileMatch = document.querySelector('#general-file-match-entry input');

	if (checkbox.id === "selectall-match-input") {
		// Select All toggled
		setIssueMatchCheckboxes(checkbox.checked);
		autoMatch.checked = false;
		generalFileMatch.checked = false;
	}
	else if (row.dataset.issue_id === "") {
		// Auto match
		setIssueMatchCheckboxes(false);
		generalFileMatch.checked = false;
	}
	else if (row.dataset.issue_id === "-1") {
		// General match
		setIssueMatchCheckboxes(false);
		autoMatch.checked = false;
	}
	else {
		// Issue match
		autoMatch.checked = false;
		generalFileMatch.checked = false;
	}
};

function processIssueMatch() {
	const selectedIssues = [...document.querySelectorAll(
		'#issue-match-table tbody > tr:has(input[type="checkbox"]:checked)'
	)].map(row => row.dataset.issue_id)

	if (!selectedIssues.length)
		return;
	
	managed_issues.forEach(manageId => {
		let data;
		if (selectedIssues[0] == "") {
			// Auto match
			data = {
				filepath: manageIdToFilepath[manageId],
				issue_ids: [],
				general_file: false,
				forced_match: false
			};
		}
		else if (selectedIssues[0] == "-1") {
			// General file
			data = {
				filepath: manageIdToFilepath[manageId],
				issue_ids: [],
				general_file: true,
				forced_match: true
			};
		} 
		else {
			// Issue match
			data = {
				filepath: manageIdToFilepath[manageId],
				issue_ids: selectedIssues.map(i => parseInt(i)),
				general_file: false,
				forced_match: true
			};
		};

		managed_issues_changes[manageId] = data;
		document.querySelector(
			`#manage-issues-table tbody > tr[data-manage_id="${manageId}"] .mi-matched`
		).innerText = _issuesCoveredByMapping(data, no_match_is_tbd=true);
	});
	document.querySelector('#selectall-manage-input').checked = false;
	showWindow('manage-window');
};

//
// Fix Match
//
function showFixMatch() {
	const folderPath = ViewEls.vol_data.path.innerText || '';
	const parts = folderPath.replace(/\\/g, '/').split('/');
	const folderBase = parts[parts.length - 1] || parts[parts.length - 2] || '';
	document.querySelector('#fix-match-input').value = folderBase.replace(/\s*\(\d{4}\)\s*$/, '').trim();
	document.querySelector('#fix-match-message').innerText = '';
	document.querySelector('#fix-match-result-table').classList.add('hidden');
	document.querySelector('#fix-match-result-table tbody').innerHTML = '';
	showWindow('fix-match-window');
};

let fmResults = [];
let fmSortState = { key: null, dir: 1 };

function inferType(title, description) {
	const tmp = document.createElement('div');
	tmp.innerHTML = description || '';
	const plain = tmp.innerText.trim().toLowerCase();
	if (/trade\s*paperback/.test(plain)) return 'TPB';
	if (/\bhardcover\b/.test(plain)) return 'HC';
	if (/\bomnibus\b/.test(plain) || /\bomnibus\b/i.test(title || '')) return 'Omnibus';
	if (/one[- ]shot/.test(plain)) return 'One-Shot';
	return 'Standard';
}

function renderFmSearchResults(api_key) {
	const tbody = document.querySelector('#fix-match-result-table tbody');
	tbody.innerHTML = '';

	let sorted = [...fmResults];
	if (fmSortState.key) {
		sorted.sort((a, b) => {
			let va = a[fmSortState.key] ?? '';
			let vb = b[fmSortState.key] ?? '';
			if (typeof va === 'string') va = va.toLowerCase();
			if (typeof vb === 'string') vb = vb.toLowerCase();
			return va < vb ? -fmSortState.dir : va > vb ? fmSortState.dir : 0;
		});
	}

	sorted.forEach(r => {
		const row = ViewEls.pre_build.fix_match_result.cloneNode(true);
		row.dataset.cv_id = r.comicvine_id;
		row.querySelector('.fm-title').innerText = r.title;
		row.querySelector('.fm-year').innerText = r.year ?? '—';
		row.querySelector('.fm-issues').innerText = r.issue_count ?? '—';
		row.querySelector('.fm-publisher').innerText = r.publisher ?? '—';
		row.querySelector('.fm-type').innerText = r._type;
		row.querySelector('.select-match-button').onclick =
			() => applyFixMatch(api_key, r.comicvine_id, r.title);
		tbody.appendChild(row);
	});

	document.querySelectorAll('#fix-match-result-table thead th[data-sort-key]').forEach(th => {
		const key = th.dataset.sortKey;
		const label = th.dataset.baseLabel || th.innerText.replace(/\s*[▲▼]$/, '').trim();
		th.dataset.baseLabel = label;
		th.innerText = label + (key === fmSortState.key ? (fmSortState.dir === 1 ? ' ▲' : ' ▼') : '');
	});
}

function searchFixMatch(api_key) {
	const query = document.querySelector('#fix-match-input').value.trim();
	if (!query) return;

	const msgEl = document.querySelector('#fix-match-message');
	const tableEl = document.querySelector('#fix-match-result-table');

	msgEl.innerText = 'Searching...';
	tableEl.classList.add('hidden');
	fmResults = [];
	fmSortState = { key: null, dir: 1 };

	fetchAPI('/volumes/search', api_key, {query})
	.then(json => {
		if (!json.result.length) {
			msgEl.innerText = 'No results found.';
			return;
		}
		msgEl.innerText = '';
		fmResults = json.result.map(r => ({ ...r, _type: inferType(r.title, r.description) }));
		renderFmSearchResults(api_key);
		tableEl.classList.remove('hidden');
	})
	.catch(() => {
		msgEl.innerText = 'Search failed.';
	});
};

function applyFixMatch(api_key, cv_id, new_title) {
	if (!confirm(`Re-match this volume to "${new_title || cv_id}"?\n\nAll existing issues will be deleted and re-fetched.`))
		return;
	sendAPI('PUT', `/volumes/${volume_id}/rematch`, api_key, {}, {comicvine_id: cv_id, new_title: new_title || null})
	.then(r => r.json())
	.then(() => {
		document.querySelector('#fix-match-search-bar').classList.add('hidden');
		document.querySelector('#fix-match-result-table').classList.add('hidden');
		document.querySelector('#fix-match-message').innerText =
			'Rematching… fetching new metadata from ComicVine. The page will refresh when complete.';
		document.querySelectorAll('#fix-match-window button').forEach(b => b.disabled = true);
		pollVolumeReadyThenReload(api_key);
	});
};

function pollVolumeReadyThenReload(api_key, attempts = 0) {
	if (attempts >= 60) {
		window.location.reload();
		return;
	}
	fetchAPI(`/volumes/${volume_id}`, api_key)
	.then(json => {
		if (json.result.issue_count > 0) {
			window.location.reload();
		} else {
			setTimeout(() => pollVolumeReadyThenReload(api_key, attempts + 1), 1000);
		}
	})
	.catch(() => {
		setTimeout(() => pollVolumeReadyThenReload(api_key, attempts + 1), 1000);
	});
}

//
// Editing
//
function showEdit(api_key) {
	const volume_root_folder = parseInt(ViewEls.vol_data.path.dataset.root_folder),
	volume_folder = ViewEls.vol_data.path.dataset.volume_folder;
	
	fetchAPI('/rootfolder', api_key)
	.then(json => {
		ViewEls.vol_edit.root_folder.innerHTML = '';
		json.result.forEach(root_folder => {
			const entry = document.createElement('option');
			entry.value = root_folder.id;
			entry.innerText = root_folder.folder;
			if (root_folder.id === volume_root_folder) {
				entry.setAttribute('selected', 'true');
			};
			ViewEls.vol_edit.root_folder.appendChild(entry);
		});
		showWindow('edit-window');
	});
	ViewEls.vol_edit.monitor.value = ViewEls.vol_data.monitor.dataset.monitored;
	ViewEls.vol_edit.monitoring_scheme.value = '';
	ViewEls.vol_edit.volume_folder.value = volume_folder;
};

function editVolume() {
	showLoadWindow('edit-window');

	const data = {
		'monitored': ViewEls.vol_edit.monitor.value === 'true',
		'monitor_new_issues': ViewEls.vol_edit.monitor_new_issues.value === 'true',
		'root_folder': parseInt(ViewEls.vol_edit.root_folder.value),
		'volume_folder': ViewEls.vol_edit.volume_folder.value
	};
	
	if (ViewEls.vol_edit.monitoring_scheme.value !== '')
		data['monitoring_scheme'] = ViewEls.vol_edit.monitoring_scheme.value;

	const so = document.querySelector('#specialoverride-input').value;

	data['special_version_locked'] = so !== 'auto';
	if (so !== 'auto')
		data['special_version'] = so || null;

	usingApiKey()
	.then(api_key => {
		sendAPI('PUT', `/volumes/${volume_id}`, api_key, {}, data)
		.then(response => window.location.reload());
	});
};

//
// Deleting
//
function deleteVolume() {
	const downloading_error = document.querySelector('#volume-downloading-error'),
		tasking_error = document.querySelector('#volume-tasking-error'),
		delete_folder = document.querySelector('#delete-folder-input').value;
		
	hide([downloading_error, tasking_error]);
	usingApiKey()
	.then(api_key => {
		sendAPI('DELETE', `/volumes/${volume_id}`, api_key, {delete_folder: delete_folder})
		.then(response => {
			window.location.href = `${url_base}/`;
		})
		.catch(e => e.json().then(j => {
			if (j.error === "TaskForVolumeRunning")
				hide([downloading_error], [tasking_error]);
			else if (j.error === "VolumeDownloadedFor")
				hide([tasking_error], [downloading_error]);
			else
				console.log(j);			
		}));
	});
};

//
// Issue info
//
function showIssueInfo(issue_id, api_key) {
	document.querySelector('#issue-rename-selector').dataset.issue_id = issue_id;
	fetchAPI(`/issues/${issue_id}`, api_key)
	.then(json => {
		document.querySelector('#issue-info-title').innerText =
			`${json.result.title} - #${json.result.issue_number} - ${json.result.date}`;
		document.querySelector('#issue-info-desc').innerHTML = json.result.description;
		const files_table = document.querySelector('#issue-files-list');
		files_table.innerHTML = '';
		json.result.files.forEach(f => {
            const entry = ViewEls.pre_build.files_entry.cloneNode(true);

            const vf = ViewEls.vol_data.path.dataset.volume_folder;
            const short_f = f.filepath.slice(
                f.filepath.indexOf(vf)
                + vf.length
                + 1
            );
            entry.querySelector('.f-filepath').innerText = short_f;
            entry.querySelector('.f-filepath').title = f.filepath;
            
            entry.querySelector('.f-size').innerText = convertSize(f.size);
            entry.querySelector('.f-delete button').onclick = e =>
                sendAPI("DELETE", `/files/${f.id}`, api_key)
                .then(response => entry.remove());

            files_table.appendChild(entry);
		});
		showWindow('issue-info-window');
	});
};

function showInfoWindow(window) {
	hide(
		[...document.querySelectorAll(
			`#issue-info-window > div:nth-child(2) > div:not(#issue-info-selectors)`
		)],
		[document.querySelector(`#${window}`)]
	);
};

// code run on load

usingApiKey()
.then(api_key => {
	fetchAPI(`/volumes/${volume_id}`, api_key)
	.then(json => fillPage(json.result, api_key))
	.catch(e => {
		if (e.status === 404)
			window.location.href = `${url_base}/`
		else
			console.log(e);
	});

	ViewEls.tool_bar.refresh.onclick = e => refreshVolume(api_key);
	ViewEls.tool_bar.auto_search.onclick = e => autosearchVolume(api_key);
	ViewEls.tool_bar.manual_search.onclick = e => showManualSearch(api_key);
	ViewEls.tool_bar.import.onclick = e => importFiles(api_key);
	ViewEls.tool_bar.rename.onclick = e => showRename(api_key);
	ViewEls.tool_bar.convert.onclick = e => showConvert(api_key);
	ViewEls.tool_bar.manage.onclick = e => showManageIssues(api_key);
	ViewEls.tool_bar.fix_match.onclick = e => showFixMatch();
	ViewEls.tool_bar.edit.onclick = e => showEdit(api_key);

	document.querySelector('#fix-match-search-button').onclick = e => searchFixMatch(api_key);
	document.querySelector('#fix-match-input').onkeydown = e => {
		if (e.key === 'Enter') searchFixMatch(api_key);
	};

	document.querySelectorAll('#fix-match-result-table thead th[data-sort-key]').forEach(th => {
		th.style.cursor = 'pointer';
		th.onclick = () => {
			const key = th.dataset.sortKey;
			if (fmSortState.key === key) {
				fmSortState.dir *= -1;
			} else {
				fmSortState.key = key;
				fmSortState.dir = 1;
			}
			if (fmResults.length) renderFmSearchResults(api_key);
		};
	});

	document.querySelector('#submit-rename').onclick =
	e => renameVolume(api_key, parseInt(e.target.dataset.issue_id) || null);

	document.querySelector('#submit-convert').onclick =
	e => convertVolume(api_key, parseInt(e.target.dataset.issue_id) || null);

	document.querySelector('#issue-rename-selector').onclick =
	e => showRename(api_key, parseInt(e.target.dataset.issue_id));

	document.querySelector('#submit-manage-issues').onclick =
	e => submitManagedIssues(api_key);

	document.querySelector('#delete-manage-files').onclick = () => {
		const checked = [...document.querySelectorAll(
			'#manage-issues-table tbody tr[data-manage_id]:has(input[type="checkbox"]:checked)'
		)];
		if (!checked.length) return;

		const names = checked.map(r => r.querySelector('.mi-filepath').innerText).join('\n');
		if (!confirm(`Delete ${checked.length} file(s) from disk?\n\n${names}`)) return;

		Promise.all(checked.map(row => {
			const fid = row.dataset.file_id;
			if (!fid) return Promise.resolve();
			return sendAPI('DELETE', `/files/${fid}`, api_key).then(() => row.remove());
		})).then(() => {
			const allBoxes = [...document.querySelectorAll(
				'#manage-window tbody input[type="checkbox"]'
			)];
			document.querySelector('#selectall-manage-input').checked =
				allBoxes.length > 0 && allBoxes.every(cb => cb.checked);
		});
	};

	socket.on(
		'downloaded_status',
		data => {
			if (data.volume_id !== volume_id)
				return;
			data.downloaded_issues.forEach(
				issue_id => new IssueEntry(issue_id, api_key).setDownloaded(true)
			);
			data.not_downloaded_issues.forEach(
				issue_id => new IssueEntry(issue_id, api_key).setDownloaded(false)
			);
		}
	);
});

ViewEls.tool_bar.files.onclick = e => showWindow('files-window');
ViewEls.tool_bar.delete.onclick = e => showWindow('delete-window');

document.querySelector('#issue-info-selector').onclick = e => showInfoWindow('issue-info');
document.querySelector('#issue-files-selector').onclick = e => showInfoWindow('issue-files');
document.querySelector('#selectall-input').onchange = e => toggleAllRenames();
document.querySelector('#selectall-convert-input').onchange = e => toggleAllConverts();
document.querySelector('#selectall-manage-input').onchange = e => toggleAllManages();
document.querySelector('#show-issue-match').onclick = e => showMatchIssue();
document.querySelector('#selectall-match-input').onchange = e => handleIssueMatchCheckboxes(e);
document.querySelector('#auto-match-entry input').onchange = e => handleIssueMatchCheckboxes(e);
document.querySelector('#general-file-match-entry input').onchange = e => handleIssueMatchCheckboxes(e);
document.querySelector('#cancel-match-issues').onclick = e => showWindow('manage-window');
document.querySelector('#submit-match-issues').onclick = e => processIssueMatch();

document.querySelector('#edit-form').action = 'javascript:editVolume();';
document.querySelector('#delete-form').action = 'javascript:deleteVolume();';
