import { useState } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Button } from '@/components/primitives';
import { SettingsField as Field, ToggleField } from './settings-field';
import styles from './settings-page.module.css';
import { addNzbIndexer, updateNzbIndexer, deleteNzbIndexer, testNzbIndexer, nzbIndexersQueryOptions, NZB_INDEXERS_KEY, externalClientsQueryOptions, clientOptionsQueryOptions, CLIENTS_KEY, CLIENT_OPTIONS_KEY, addExternalClient, updateExternalClient, deleteExternalClient, testExternalClient, remoteMappingsQueryOptions, REMOTE_MAPPINGS_KEY, addRemoteMapping, updateRemoteMapping, deleteRemoteMapping, rootFoldersQueryOptions, ROOT_FOLDERS_KEY, addRootFolder, deleteRootFolder } from '../-settings.api';
import type { NZBIndexer, ExternalClient, RemoteMapping } from '../-settings.types';

function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className={styles.testFailure}>{error instanceof Error ? error.message : 'The settings change failed.'}</p>;
}

/* ---------- NZB Indexers Section ---------- */

export function NZBIndexersSection() {
  const queryClient = useQueryClient();
  const { data: indexers } = useSuspenseQuery(nzbIndexersQueryOptions());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', base_url: '', api_key: '', categories: '', enabled: true });
  const [testResult, setTestResult] = useState<{success: boolean; description: string | null} | null>(null);
  const [testPending, setTestPending] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const addMutation = useMutation({
    mutationFn: (data: Partial<NZBIndexer>) => addNzbIndexer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NZB_INDEXERS_KEY });
      resetForm();
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<NZBIndexer> }) => updateNzbIndexer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NZB_INDEXERS_KEY });
      resetForm();
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => deleteNzbIndexer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NZB_INDEXERS_KEY });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ name: '', base_url: '', api_key: '', categories: '', enabled: true });
    setTestResult(null);
    setShowSecret(false);
  };

  const startEdit = (idx: NZBIndexer) => {
    setEditingId(idx.id);
    setFormData({ name: idx.name, base_url: idx.base_url, api_key: idx.api_key, categories: idx.categories, enabled: idx.enabled });
    setShowForm(true);
    setTestResult(null);
  };

  const handleTest = async () => {
    setTestPending(true);
    try {
      const result = await testNzbIndexer(formData.base_url, formData.api_key);
      setTestResult(result);
    } catch {
      setTestResult({ success: false, description: 'Test request failed' });
    } finally {
      setTestPending(false);
    }
  };

  const handleSave = () => {
    if (editingId !== null) {
      editMutation.mutate({ id: editingId, data: formData });
    } else {
      addMutation.mutate(formData);
    }
  };

  return (
    <div>
      {indexers.length === 0 && !showForm && (
        <p className={styles.emptyList}>No NZB indexers configured.</p>
      )}
      {indexers.map(idx => (
        <div key={idx.id} className={styles.indexerRow}>
          <div className={styles.clientHeader}>
            <span><strong>{idx.name}</strong></span>
            <span className={styles.disabledLabel}>{idx.enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div className={styles.clientMeta}>{idx.base_url}</div>
          <div className={styles.actionBtns}>
            <button className={styles.smallBtn} type="button" onClick={() => startEdit(idx)}>Edit</button>
            <button className={styles.smallBtn} type="button" onClick={() => {
              if (window.confirm(`Delete NZB indexer “${idx.name}” (${idx.base_url})?`)) delMutation.mutate(idx.id);
            }} disabled={delMutation.isPending}>Delete</button>
          </div>
        </div>
      ))}
      <MutationError error={delMutation.error} />
      {showForm && (
        <div className={styles.inlineForm}>
          <Field label="Name">
            <input className={styles.input} value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} />
          </Field>
          <Field label="URL">
            <input className={styles.input} value={formData.base_url} onChange={e => setFormData(prev => ({ ...prev, base_url: e.target.value }))} />
          </Field>
          <Field label="API Key">
            <div style={{display:'flex', gap:'0.25rem', alignItems:'center'}}>
              <input className={styles.input} type={showSecret ? 'text' : 'password'}
                value={formData.api_key}
                onChange={e => setFormData(prev => ({ ...prev, api_key: e.target.value }))} />
              <button type="button" className={styles.smallBtn} onClick={() => setShowSecret(s => !s)}
                title={showSecret ? 'Hide' : 'Show'}>{showSecret ? '🙈' : '👁️'}</button>
            </div>
          </Field>
          <Field label="Categories">
            <input className={styles.input} value={formData.categories} onChange={e => setFormData(prev => ({ ...prev, categories: e.target.value }))} />
          </Field>
          <ToggleField label="Enabled" checked={formData.enabled} onChange={v => setFormData(prev => ({ ...prev, enabled: v }))} />
          {testResult && (
            <div className={testResult.success ? styles.testSuccess : styles.testFailure}>
              {testResult.description || (testResult.success ? 'Connection successful' : 'Connection failed')}
            </div>
          )}
          <div className={styles.actionBtns}>
            <Button variant="secondary" onClick={handleTest} disabled={testPending}>
              {testPending ? 'Testing…' : 'Test'}
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={addMutation.isPending || editMutation.isPending}>
              {editingId !== null ? 'Update' : 'Add'}
            </Button>
            <Button variant="secondary" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}
      {!showForm && (
        <div className={styles.addBtnRow}>
          <Button variant="primary" onClick={() => { resetForm(); setShowForm(true); }}>Add NZB Indexer</Button>
        </div>
      )}
    </div>
  );
}

/* ---------- External Download Clients Section ---------- */

export function ExternalClientsSection() {
  const queryClient = useQueryClient();
  const { data: clients } = useSuspenseQuery(externalClientsQueryOptions());
  const { data: clientOptions } = useSuspenseQuery(clientOptionsQueryOptions());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    client_type: '',
    title: '',
    base_url: '',
    username: '',
    password: '',
    api_token: '',
    category: '',
  });
  const [testResult, setTestResult] = useState<{success: boolean; description: string | null} | null>(null);
  const [testPending, setTestPending] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  // Backend returns download_type as integer: 1=direct, 2=torrent, 3=usenet
  const downloadTypeName = (t: number | string): string => {
    if (typeof t === 'string') return t;
    return ({ 1: 'direct', 2: 'torrent', 3: 'usenet' })[t] ?? String(t);
  };
  const torrentClients = clients.filter(c => String(c.download_type) === '2' || c.download_type === 'torrent');
  const usenetClients = clients.filter(c => String(c.download_type) === '3' || c.download_type === 'usenet');
  const optionsEntries = Object.entries(clientOptions || {});

  const addMutation = useMutation({
    mutationFn: (data: Partial<ExternalClient> & {client_type: string}) => addExternalClient(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
      queryClient.invalidateQueries({ queryKey: CLIENT_OPTIONS_KEY });
      resetForm();
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExternalClient> }) => updateExternalClient(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
      resetForm();
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => deleteExternalClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ client_type: '', title: '', base_url: '', username: '', password: '', api_token: '', category: '' });
    setTestResult(null);
    setShowSecret(false);
  };

  const startEdit = (c: ExternalClient) => {
    setEditingId(c.id);
    setFormData({
      client_type: c.client_type,
      title: c.title,
      base_url: c.base_url,
      username: c.username || '',
      password: c.password || '',
      api_token: c.api_token || '',
      category: c.category || '',
    });
    setShowForm(true);
    setTestResult(null);
  };

  const handleTest = async () => {
    setTestPending(true);
    try {
      const result = await testExternalClient({
        client_type: formData.client_type,
        base_url: formData.base_url,
        username: formData.username || undefined,
        password: formData.password || undefined,
        api_token: formData.api_token || undefined,
      });
      setTestResult(result);
    } catch {
      setTestResult({ success: false, description: 'Test request failed' });
    } finally {
      setTestPending(false);
    }
  };

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    if (editingId !== null) {
      // On edit, only send fields that have values (omit empty strings for optional ones)
      payload.client_type = formData.client_type;
      payload.title = formData.title;
      payload.base_url = formData.base_url;
      if (formData.username) payload.username = formData.username;
      if (formData.password) payload.password = formData.password;
      if (formData.api_token) payload.api_token = formData.api_token;
      if (formData.category) payload.category = formData.category;
      editMutation.mutate({ id: editingId, data: payload as Partial<ExternalClient> });
    } else {
      payload.client_type = formData.client_type;
      payload.title = formData.title;
      payload.base_url = formData.base_url;
      if (formData.username) payload.username = formData.username;
      if (formData.password) payload.password = formData.password;
      if (formData.api_token) payload.api_token = formData.api_token;
      if (formData.category) payload.category = formData.category;
      addMutation.mutate(payload as Partial<ExternalClient> & {client_type: string});
    }
  };

  const renderClientList = (items: ExternalClient[], label: string) => (
    <div>
      <h4 className={styles.subSectionTitle}>{label}</h4>
      {items.length === 0 && <p className={styles.emptyList}>No {label.toLowerCase()} configured.</p>}
      {items.map(c => (
        <div key={c.id} className={styles.clientCard}>
          <div className={styles.clientHeader}>
            <span><strong>{c.title}</strong></span>
            <span className={styles.clientType}>{downloadTypeName(c.download_type)} — {c.client_type}</span>
          </div>
          <div className={styles.clientMeta}>{c.base_url}</div>
          {c.category && <div className={styles.clientMeta}>Category: {c.category}</div>}
          <div className={styles.actionBtns}>
            <button className={styles.smallBtn} type="button" onClick={() => startEdit(c)}>Edit</button>
            <button className={styles.smallBtn} type="button" onClick={() => {
              if (window.confirm(`Delete external client “${c.title}” (${c.base_url})?`)) delMutation.mutate(c.id);
            }} disabled={delMutation.isPending}>Delete</button>
          </div>
        </div>
      ))}
      <MutationError error={delMutation.error} />
    </div>
  );

  // Determine the download type filter for the form based on editing
  const filteredOptions = optionsEntries.filter(() => true);

  return (
    <div>
      {renderClientList(torrentClients, 'External Torrent Clients')}
      {renderClientList(usenetClients, 'External Usenet Clients')}

      {showForm && (
        <div className={styles.inlineForm}>
          <Field label="Client Type">
            <select className={styles.select} value={formData.client_type} onChange={e => setFormData(prev => ({ ...prev, client_type: e.target.value }))}>
              <option value="">Select client type…</option>
              {filteredOptions.map(([key, opt]) => (
                <option key={key} value={key}>{key} ({downloadTypeName(opt.download_type)})</option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input className={styles.input} value={formData.title} onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))} />
          </Field>
          <Field label="Base URL">
            <input className={styles.input} value={formData.base_url} onChange={e => setFormData(prev => ({ ...prev, base_url: e.target.value }))} />
          </Field>
          <Field label="Username">
            <input className={styles.input} value={formData.username} onChange={e => setFormData(prev => ({ ...prev, username: e.target.value }))} />
          </Field>
          <Field label="Password">
            <div style={{display:'flex', gap:'0.25rem', alignItems:'center'}}>
              <input className={styles.input} type={showSecret ? 'text' : 'password'}
                value={formData.password}
                onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))} />
              <button type="button" className={styles.smallBtn} onClick={() => setShowSecret(s => !s)}
                title={showSecret ? 'Hide' : 'Show'}>{showSecret ? '🙈' : '👁️'}</button>
            </div>
          </Field>
          <Field label="API Token">
            <div style={{display:'flex', gap:'0.25rem', alignItems:'center'}}>
              <input className={styles.input} type={showSecret ? 'text' : 'password'}
                value={formData.api_token}
                onChange={e => setFormData(prev => ({ ...prev, api_token: e.target.value }))} />
              <button type="button" className={styles.smallBtn} onClick={() => setShowSecret(s => !s)}
                title={showSecret ? 'Hide' : 'Show'}>{showSecret ? '🙈' : '👁️'}</button>
            </div>
          </Field>
          <Field label="Category">
            <input className={styles.input} value={formData.category} onChange={e => setFormData(prev => ({ ...prev, category: e.target.value }))} />
          </Field>
          {testResult && (
            <div className={testResult.success ? styles.testSuccess : styles.testFailure}>
              {testResult.description || (testResult.success ? 'Connection successful' : 'Connection failed')}
            </div>
          )}
          <div className={styles.actionBtns}>
            <Button variant="secondary" onClick={handleTest} disabled={testPending || !formData.client_type}>
              {testPending ? 'Testing…' : 'Test'}
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={addMutation.isPending || editMutation.isPending || !formData.client_type}>
              {editingId !== null ? 'Update' : 'Add'}
            </Button>
            <Button variant="secondary" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}
      {!showForm && (
        <div className={styles.addBtnRow}>
          <Button variant="primary" onClick={() => { resetForm(); setShowForm(true); }}>Add Download Client</Button>
        </div>
      )}
    </div>
  );
}

/* ---------- Remote Path Mappings Section ---------- */

export function RemoteMappingsSection() {
  const queryClient = useQueryClient();
  const { data: mappings } = useSuspenseQuery(remoteMappingsQueryOptions());
  const { data: clients } = useSuspenseQuery(externalClientsQueryOptions());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ external_download_client_id: 0, remote_path: '', local_path: '' });

  const clientLookup = new Map(clients.map(c => [c.id, c]));

  const addMutation = useMutation({
    mutationFn: (data: {external_download_client_id: number; remote_path: string; local_path: string}) => addRemoteMapping(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REMOTE_MAPPINGS_KEY });
      resetForm();
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<RemoteMapping> }) => updateRemoteMapping(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REMOTE_MAPPINGS_KEY });
      resetForm();
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => deleteRemoteMapping(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REMOTE_MAPPINGS_KEY });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ external_download_client_id: 0, remote_path: '', local_path: '' });
  };

  const startEdit = (m: RemoteMapping) => {
    setEditingId(m.id);
    setFormData({ external_download_client_id: m.external_download_client_id, remote_path: m.remote_path, local_path: m.local_path });
    setShowForm(true);
  };

  const handleSave = () => {
    if (editingId !== null) {
      editMutation.mutate({ id: editingId, data: formData });
    } else {
      addMutation.mutate(formData);
    }
  };

  return (
    <div>
      {mappings.length === 0 && !showForm && (
        <p className={styles.emptyList}>No remote path mappings configured.</p>
      )}
      {mappings.map(m => {
        const cl = clientLookup.get(m.external_download_client_id);
        return (
          <div key={m.id} className={styles.indexerRow}>
            <div className={styles.clientHeader}>
              <span><strong>{cl ? cl.title : `Client #${m.external_download_client_id}`}</strong></span>
            </div>
            <div className={styles.clientMeta}>{m.remote_path} → {m.local_path}</div>
            <div className={styles.actionBtns}>
              <button className={styles.smallBtn} type="button" onClick={() => startEdit(m)}>Edit</button>
              <button className={styles.smallBtn} type="button" onClick={() => {
                const clientName = cl ? cl.title : `Client #${m.external_download_client_id}`;
                if (window.confirm(`Delete remote mapping for “${clientName}”?\n\n${m.remote_path} → ${m.local_path}`)) delMutation.mutate(m.id);
              }} disabled={delMutation.isPending}>Delete</button>
            </div>
          </div>
        );
      })}
      <MutationError error={delMutation.error} />
      {showForm && (
        <div className={styles.inlineForm}>
          <Field label="External Client">
            <select className={styles.select}
              value={formData.external_download_client_id}
              onChange={e => setFormData(prev => ({ ...prev, external_download_client_id: Number(e.target.value) }))}>
              <option value={0}>Select client…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.title} ({c.client_type})</option>
              ))}
            </select>
          </Field>
          <Field label="Remote Path">
            <input className={styles.input} value={formData.remote_path} onChange={e => setFormData(prev => ({ ...prev, remote_path: e.target.value }))} />
          </Field>
          <Field label="Local Path">
            <input className={styles.input} value={formData.local_path} onChange={e => setFormData(prev => ({ ...prev, local_path: e.target.value }))} />
          </Field>
          <div className={styles.actionBtns}>
            <Button variant="primary" onClick={handleSave} disabled={addMutation.isPending || editMutation.isPending || formData.external_download_client_id === 0}>
              {editingId !== null ? 'Update' : 'Add'}
            </Button>
            <Button variant="secondary" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}
      {!showForm && (
        <div className={styles.addBtnRow}>
          <Button variant="primary" onClick={() => { resetForm(); setShowForm(true); }}>Add Remote Path Mapping</Button>
        </div>
      )}
    </div>
  );
}

/* ---------- Root Folders Section ---------- */

export function RootFoldersSection() {
  const queryClient = useQueryClient();
  const { data: folders } = useSuspenseQuery(rootFoldersQueryOptions());
  const [newPath, setNewPath] = useState('');
  const [newSection, setNewSection] = useState('comic');

  const addMutation = useMutation({
    mutationFn: ({ folder, section }: { folder: string; section: string }) => addRootFolder(folder, section),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROOT_FOLDERS_KEY });
      setNewPath('');
    },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => deleteRootFolder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROOT_FOLDERS_KEY });
    },
  });

  const formatBytes = (bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(1)} ${units[i]}`;
  };

  return (
    <div>
      {folders.length === 0 && <p className={styles.emptyList}>No root folders configured.</p>}
      {folders.map(rf => (
        <div key={rf.id} className={styles.indexerRow}>
          <div className={styles.clientHeader}>
            <span><strong>{rf.folder}</strong></span>
            <span className={styles.clientType}>{rf.section}</span>
          </div>
          <div className={styles.clientMeta}>
            Free: {formatBytes(rf.free_space)} / Total: {formatBytes(rf.total_space)}
          </div>
          <div className={styles.actionBtns}>
            <button className={styles.smallBtn} type="button" onClick={() => {
              if (window.confirm(
                `Remove root folder configuration “${rf.folder}”?\n\nKapowarr will stop managing this location. Media files on disk are not deleted.`,
              )) delMutation.mutate(rf.id);
            }} disabled={delMutation.isPending}>Delete</button>
          </div>
        </div>
      ))}
      <MutationError error={delMutation.error} />
      <div className={styles.inlineForm}>
        <Field label="Path">
          <input className={styles.input} value={newPath} onChange={e => setNewPath(e.target.value)} placeholder="/path/to/comics" />
        </Field>
        <Field label="Section">
          <select className={styles.select} value={newSection} onChange={e => setNewSection(e.target.value)}>
            <option value="comic">Comics</option>
            <option value="manga">Manga</option>
          </select>
        </Field>
        <div className={styles.actionBtns}>
          <Button variant="primary" onClick={() => addMutation.mutate({ folder: newPath, section: newSection })}
            disabled={addMutation.isPending || !newPath.trim()}>
            {addMutation.isPending ? 'Adding…' : 'Add Root Folder'}
          </Button>
        </div>
      </div>
    </div>
  );
}

