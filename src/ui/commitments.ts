/**
 * The commitments panel.
 *
 * Commitments are the things you mean to keep doing, and each one is a tower downtown. The panel
 * has to make two things visible without ever scolding: how tall the tower has grown, and whether
 * the commitment is currently being kept.
 *
 * Wording matters here. A commitment that has gone quiet says "gone quiet", never "failed" or
 * "broken", and the floor count is always shown alongside so the record of what you did stays in
 * front of you.
 */

import type { Cadence, CityData, Commitment } from '../data/types';
import { CADENCE_PRESETS, cadenceLabel, floorsFor, isLit, lastLogDate } from '../data/cadence';
import { daysBetween, formatLongDate, todayISO } from '../data/dates';
import { Panel } from './panel';

export interface CommitmentActions {
  add(name: string, cadence: Cadence): Promise<void>;
  toggleToday(commitment: Commitment, done: boolean): Promise<void>;
  remove(commitment: Commitment): Promise<void>;
  reload(): Promise<CityData>;
}

export function openCommitments(city: CityData, actions: CommitmentActions): void {
  const panel = new Panel({
    title: 'Commitments',
    subtitle: 'Each one is a tower downtown. One completion is one floor, whatever the cadence.',
  });

  const list = document.createElement('div');
  list.className = 'commitments';
  panel.body.appendChild(list);

  const render = (data: CityData) => {
    list.innerHTML = '';
    const today = todayISO();

    if (data.commitments.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No commitments yet. Add one below and it becomes a tower at the centre.';
      list.appendChild(empty);
    }

    for (const commitment of data.commitments) {
      const floors = floorsFor(data.logs, commitment.id, today);
      const last = lastLogDate(data.logs, commitment.id);
      const lit = isLit(commitment.cadence, last, today);
      const doneToday = data.logs.some(
        (log) => log.commitmentId === commitment.id && log.date === today,
      );

      const row = document.createElement('div');
      row.className = 'commitment';

      const check = document.createElement('button');
      check.type = 'button';
      check.className = `commitment__check${doneToday ? ' is-done' : ''}`;
      check.setAttribute('aria-pressed', String(doneToday));
      check.setAttribute(
        'aria-label',
        doneToday ? `Undo ${commitment.name} for today` : `Mark ${commitment.name} done today`,
      );
      check.textContent = doneToday ? '✓' : '';
      check.addEventListener('click', async () => {
        check.disabled = true;
        await actions.toggleToday(commitment, !doneToday);
        render(await actions.reload());
      });

      const meta = document.createElement('div');
      meta.className = 'commitment__meta';

      const name = document.createElement('div');
      name.className = 'commitment__name';
      name.textContent = commitment.name;

      const detail = document.createElement('div');
      detail.className = 'commitment__detail';
      // Never "broken" or "failed". Dark windows mean quiet, and the height stays either way.
      const state = lit
        ? 'lights on'
        : last
          ? `gone quiet · last ${formatLongDate(last)}`
          : 'not started yet';
      detail.textContent = `${floors} floor${floors === 1 ? '' : 's'} · ${cadenceLabel(
        commitment.cadence,
      )} · ${state}`;

      const dot = document.createElement('span');
      dot.className = `commitment__dot${lit ? ' is-lit' : ''}`;
      dot.title = lit ? 'Being kept' : 'Quiet just now';

      meta.append(name, detail);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'commitment__remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${commitment.name}`);
      remove.addEventListener('click', async () => {
        const streak = last ? daysBetween(last, today) : null;
        const warning =
          floors > 0
            ? `Remove "${commitment.name}"? Its tower and all ${floors} floors go with it.${
                streak !== null && streak <= 1 ? ' You logged it today.' : ''
              }`
            : `Remove "${commitment.name}"?`;
        if (!window.confirm(warning)) return;
        await actions.remove(commitment);
        render(await actions.reload());
      });

      row.append(check, meta, dot, remove);
      list.appendChild(row);
    }
  };

  render(city);

  // --- add a commitment -------------------------------------------------

  const form = document.createElement('form');
  form.className = 'form form--inline';

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'input';
  name.placeholder = 'Move my body';
  name.maxLength = 60;
  name.required = true;
  name.setAttribute('aria-label', 'Commitment name');

  const cadence = document.createElement('select');
  cadence.className = 'input input--select';
  cadence.setAttribute('aria-label', 'How often');
  CADENCE_PRESETS.forEach((preset, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = preset.label;
    cadence.appendChild(option);
  });

  const add = document.createElement('button');
  add.type = 'submit';
  add.className = 'btn btn--primary';
  add.textContent = 'Add';

  form.append(name, cadence, add);
  panel.body.appendChild(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = name.value.trim();
    if (!value) return;
    add.disabled = true;
    await actions.add(value, CADENCE_PRESETS[Number(cadence.value)].cadence);
    name.value = '';
    add.disabled = false;
    render(await actions.reload());
    name.focus();
  });

  panel.focusFirst();
}
