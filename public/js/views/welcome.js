import { h } from '../util.js';
import { icon } from '../ui.js';
import { addSourceDialog } from './addsource.js';
import { isNative } from '../native.js';

export default function welcome(root, { go }) {
  const add = async () => { const s = await addSourceDialog(); if (s) go('live'); };
  root.append(h('div.welcome',
    h('div.welcome-card',
      h('img.welcome-logo', { src: '/icons/icon.svg', alt: '' }),
      h('h1', 'Welcome to ', h('span.grad', 'Lumora TV')),
      h('p.lead', 'A fast, beautiful home for your live TV, movies and series. Add your provider’s playlist to get started.'),
      h('div.row.center.gap',
        h('button.btn.primary.lg', { 'data-autofocus': true, onclick: add, html: `${icon('plus')}<span>Add playlist</span>` }),
        isNative ? h('button.btn.ghost.lg', { onclick: async () => { if (await addSourceDialog({ tab: 'phone' })) go('live'); }, html: `${icon('link')}<span>Add from phone</span>` }) : null,
        h('button.btn.ghost.lg', { onclick: () => go('settings'), html: `${icon('settings')}<span>Settings</span>` })),
      h('div.features',
        feat('guide', 'Full TV guide', 'Blazing fast XMLTV EPG with catch-up and reminders'),
        feat('grid', 'Multi-view', 'Watch up to four channels at once'),
        feat('movie', 'Movies & series', 'Posters, details, resume and auto-play next'),
        feat('sparkle', 'Remote-first', 'Designed for TV remotes, keyboards, mouse and touch')),
      h('p.muted.small', 'Lumora TV is a player only — it does not provide any channels or content.')),
  ));
  setTimeout(add, 400);
  return {};
}
const feat = (ic, t, d) => h('div.feature', { html: `${icon(ic)}<b>${t}</b><span>${d}</span>` });
