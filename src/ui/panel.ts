/**
 * A small modal panel primitive.
 *
 * Every dialogue in Vista is the same shape: a dimmed backdrop, a card, a title, and content.
 * Doing it once here keeps focus handling and dismissal consistent rather than reimplemented three
 * times with three different bugs.
 */

export interface PanelOptions {
  title: string;
  subtitle?: string;
  /** Called after the panel closes, whatever closed it. */
  onClose?: () => void;
}

export class Panel {
  readonly body = document.createElement('div');

  private root = document.createElement('div');
  private card = document.createElement('div');
  private onClose?: () => void;
  private previouslyFocused: HTMLElement | null = null;

  constructor(options: PanelOptions) {
    this.onClose = options.onClose;
    this.previouslyFocused = document.activeElement as HTMLElement | null;

    this.root.className = 'panel-backdrop';
    this.card.className = 'panel';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-label', options.title);

    const header = document.createElement('div');
    header.className = 'panel__header';

    const heading = document.createElement('div');
    const title = document.createElement('h2');
    title.className = 'panel__title';
    title.textContent = options.title;
    heading.appendChild(title);

    if (options.subtitle) {
      const subtitle = document.createElement('p');
      subtitle.className = 'panel__subtitle';
      subtitle.textContent = options.subtitle;
      heading.appendChild(subtitle);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel__close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', () => this.close());

    header.append(heading, close);
    this.body.className = 'panel__body';
    this.card.append(header, this.body);
    this.root.appendChild(this.card);

    // Clicking the backdrop dismisses; clicking inside the card must not.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });
    document.addEventListener('keydown', this.onKeydown);

    const parent = document.querySelector('#panel-root') ?? document.body;
    parent.appendChild(this.root);

    requestAnimationFrame(() => this.root.classList.add('is-open'));
  }

  /** Focus the first sensible control. Called after the caller has populated the body. */
  focusFirst(): void {
    const target = this.body.querySelector<HTMLElement>(
      'input, textarea, select, button, [tabindex]',
    );
    target?.focus();
  }

  close(): void {
    document.removeEventListener('keydown', this.onKeydown);
    this.root.classList.remove('is-open');
    const remove = () => {
      this.root.remove();
      this.previouslyFocused?.focus?.();
      this.onClose?.();
    };
    // Match the CSS transition, but never leave the panel stuck if the event does not fire.
    this.root.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 300);
  }

  private onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    }
  };
}
