/**
 * The memory card.
 *
 * This is the emotional core of the whole project, not a UI detail: the product is reading your
 * own words back to yourself months later. So the card shows the user's exact text, unedited and
 * unsummarised, and the date it happened — nothing else competing with it.
 */

import { CATEGORY_BY_ID } from '../data/types';
import type { Category } from '../data/types';
import { formatLongDate } from '../data/dates';
import type { PickTarget } from '../scene/city';

export class MemoryCard {
  private el: HTMLDivElement;
  private visible = false;

  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.className = 'memory-card';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    parent.appendChild(this.el);
  }

  show(target: PickTarget, screenX: number, screenY: number): void {
    const isTower = target.kind === 'tower';
    const meta = !isTower ? categoryOf(target) : null;

    this.el.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'memory-card__label';
    label.textContent = isTower
      ? target.subtitle
      : `${formatLongDate(target.subtitle)}${meta ? ` · ${meta.label}` : ''}`;

    const text = document.createElement('div');
    text.className = 'memory-card__text';
    text.textContent = target.text;

    if (meta) this.el.style.setProperty('--accent', meta.color);
    else this.el.style.setProperty('--accent', isTower ? '#ffd9a0' : '#ffffff');

    this.el.append(label, text);
    this.place(screenX, screenY);

    if (!this.visible) {
      this.visible = true;
      this.el.classList.add('is-visible');
    }
  }

  move(screenX: number, screenY: number): void {
    if (this.visible) this.place(screenX, screenY);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.classList.remove('is-visible');
  }

  /** Keep the card on screen and out from under the butterfly. */
  private place(screenX: number, screenY: number): void {
    const rect = this.el.getBoundingClientRect();
    const pad = 16;
    const width = rect.width || 260;
    const height = rect.height || 90;

    let x = screenX + 26;
    let y = screenY - height - 18;
    if (x + width + pad > window.innerWidth) x = screenX - width - 26;
    if (y < pad) y = screenY + 26;

    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  dispose(): void {
    this.el.remove();
  }
}

function categoryOf(target: PickTarget) {
  const category = target.category as Category | undefined;
  return category ? CATEGORY_BY_ID[category] : null;
}
