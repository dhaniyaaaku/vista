/**
 * The "how it works" panel.
 *
 * Exists so the landing page can be almost wordless. Anyone who wants the explanation can ask for
 * it; nobody has to read a paragraph to get through the door.
 */

import { Panel } from './panel';

const RULES: { icon: string; title: string; body: string }[] = [
  {
    icon: '◆',
    title: 'A win becomes a building',
    body: 'Write one line about something you did. It gets a plot in the city and keeps your exact words, so you can read them back months later.',
  },
  {
    icon: '▲',
    title: 'A commitment becomes a tower',
    body: 'Name something you mean to keep doing and say how often. Every time you do it, its tower downtown gains a floor.',
  },
  {
    icon: '○',
    title: 'Outward is time',
    body: 'The city grows in rings, one per month. Busy months make thick rings, so it ends up with growth rings like a tree.',
  },
  {
    icon: '✦',
    title: 'Nothing is ever demolished',
    body: 'Skip a month and it becomes parkland, not a gap. Drop a habit and its tower keeps every floor it earned. It just turns its lights off until you come back.',
  },
];

export function openHowItWorks(): void {
  const panel = new Panel({ title: 'How it works' });

  const list = document.createElement('div');
  list.className = 'rules';

  for (const rule of RULES) {
    const item = document.createElement('div');
    item.className = 'rule';

    const icon = document.createElement('div');
    icon.className = 'rule__icon';
    icon.textContent = rule.icon;
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'rule__title';
    title.textContent = rule.title;
    const body = document.createElement('p');
    body.className = 'rule__body';
    body.textContent = rule.body;
    text.append(title, body);

    item.append(icon, text);
    list.appendChild(item);
  }

  const privacy = document.createElement('p');
  privacy.className = 'rule__foot';
  privacy.textContent =
    'Your city is stored in your own browser. Signing in only means it can follow you to another device.';

  panel.body.append(list, privacy);
}
