/**
 * The log-a-win form.
 *
 * Friction is the enemy here — a win that takes thirty seconds to record does not get recorded.
 * One line of text, one category chip, done. The date defaults to today but can be backdated,
 * because forgetting to log something is not cheating and the app is not scoring anyone.
 */

import { CATEGORIES, type Category } from '../data/types';
import { todayISO } from '../data/dates';
import { Panel } from './panel';

export interface LogFormResult {
  text: string;
  category: Category;
  date: string;
}

export function openLogForm(onSubmit: (result: LogFormResult) => Promise<void> | void): void {
  const panel = new Panel({
    title: 'Log a win',
    subtitle: 'One line, in your own words. You will read it back months from now.',
  });

  let category: Category = 'personal';

  const form = document.createElement('form');
  form.className = 'form';

  // --- the text itself --------------------------------------------------

  const field = document.createElement('div');
  field.className = 'field';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input input--lead';
  input.maxLength = 120;
  // Deliberately not `required`. Native validation would block submit and show a browser bubble,
  // which looks foreign here and skips our own message.
  input.placeholder = CATEGORIES[0].hint;
  input.setAttribute('aria-label', 'What did you do?');

  field.appendChild(input);

  // --- category chips ---------------------------------------------------

  const chips = document.createElement('div');
  chips.className = 'chips';
  chips.setAttribute('role', 'radiogroup');
  chips.setAttribute('aria-label', 'Category');

  const chipEls = CATEGORIES.map((meta) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.category = meta.id;
    chip.textContent = meta.label;
    chip.style.setProperty('--chip', meta.color);
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(meta.id === category));
    if (meta.id === category) chip.classList.add('is-selected');

    chip.addEventListener('click', () => {
      category = meta.id;
      for (const other of chipEls) {
        const selected = other.dataset.category === category;
        other.classList.toggle('is-selected', selected);
        other.setAttribute('aria-checked', String(selected));
      }
      // The placeholder doubles as a hint for what counts in this category.
      input.placeholder = meta.hint;
      input.focus();
    });

    chips.appendChild(chip);
    return chip;
  });

  // --- date -------------------------------------------------------------

  const dateRow = document.createElement('div');
  dateRow.className = 'row';

  const dateLabel = document.createElement('label');
  dateLabel.className = 'row__label';
  dateLabel.textContent = 'When';
  dateLabel.htmlFor = 'log-date';

  const date = document.createElement('input');
  date.type = 'date';
  date.id = 'log-date';
  date.className = 'input input--date';
  date.value = todayISO();
  date.max = todayISO();

  dateRow.append(dateLabel, date);

  // --- actions ----------------------------------------------------------

  const actions = document.createElement('div');
  actions.className = 'actions';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = 'Build it';

  const error = document.createElement('p');
  error.className = 'form__error';
  error.hidden = true;

  actions.append(error, submit);
  form.append(field, chips, dateRow, actions);
  panel.body.appendChild(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      error.textContent = 'Write a line first.';
      error.hidden = false;
      input.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Building…';
    try {
      await onSubmit({ text, category, date: date.value || todayISO() });
      panel.close();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Could not save that.';
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Build it';
    }
  });

  panel.focusFirst();
}
