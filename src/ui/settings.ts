/**
 * Settings: the example city, backup, and starting over.
 *
 * Export exists because the honest cost of keeping data on-device is that clearing your browser
 * loses it. Until accounts land, a JSON file is the whole safety net, so it is given real weight
 * here rather than buried.
 */

import { exportCity, importCity, wipeCity } from '../data/store';
import { Panel } from './panel';

export interface SettingsActions {
  isDemo(): boolean;
  setDemo(demo: boolean): Promise<void>;
  reload(): Promise<void>;
}

export function openSettings(actions: SettingsActions): void {
  const panel = new Panel({
    title: 'Settings',
    subtitle: 'Your city is stored in this browser and never uploaded.',
  });

  const sections = document.createElement('div');
  sections.className = 'settings';

  // --- example city -----------------------------------------------------

  const demoRow = row(
    'Example city',
    'Eighteen months of invented entries, so you can see what a grown city looks like. It is never mixed with your own.',
  );

  const demoToggle = document.createElement('button');
  demoToggle.type = 'button';
  demoToggle.className = 'btn';
  const paintToggle = () => {
    demoToggle.textContent = actions.isDemo() ? 'Back to my city' : 'Show the example';
    demoToggle.setAttribute('aria-pressed', String(actions.isDemo()));
  };
  paintToggle();
  demoToggle.addEventListener('click', async () => {
    demoToggle.disabled = true;
    await actions.setDemo(!actions.isDemo());
    paintToggle();
    demoToggle.disabled = false;
  });
  demoRow.appendChild(demoToggle);

  // --- backup -----------------------------------------------------------

  const backupRow = row(
    'Back up your city',
    'Browser storage is per-device and clearing it loses everything. A JSON file is your only copy until accounts arrive.',
  );

  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn';
  download.textContent = 'Download JSON';
  download.addEventListener('click', async () => {
    const json = await exportCity();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vista-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  const upload = document.createElement('label');
  upload.className = 'btn';
  upload.textContent = 'Restore from file';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json';
  file.hidden = true;
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    try {
      await importCity(await chosen.text());
      await actions.reload();
      note.textContent = 'Restored.';
    } catch {
      note.textContent = 'That file could not be read as a Vista backup.';
    }
  });
  upload.appendChild(file);

  backupRow.append(download, upload);

  // --- start over -------------------------------------------------------

  const resetRow = row('Start over', 'Deletes every win and commitment in this browser. Permanent.');

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn--danger';
  reset.textContent = 'Delete my city';
  reset.addEventListener('click', async () => {
    if (!window.confirm('Delete every win and commitment in this browser? This cannot be undone.')) {
      return;
    }
    await wipeCity();
    await actions.reload();
    note.textContent = 'Your city has been cleared.';
  });
  resetRow.appendChild(reset);

  const note = document.createElement('p');
  note.className = 'settings__note';
  note.setAttribute('role', 'status');

  sections.append(demoRow, backupRow, resetRow, note);
  panel.body.appendChild(sections);
}

function row(title: string, description: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'settings__row';

  const heading = document.createElement('div');
  heading.className = 'settings__heading';
  heading.textContent = title;

  const body = document.createElement('p');
  body.className = 'settings__desc';
  body.textContent = description;

  el.append(heading, body);
  return el;
}
