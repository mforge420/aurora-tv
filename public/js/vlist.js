import { clamp } from './util.js';

/**
 * Virtualised, remote-friendly vertical list.
 * Only visible rows exist in the DOM; arrow keys move a "current" index.
 */
export class VList {
  constructor({ rowHeight = 64, render, onFocus, onActivate, className = '', keys, empty = 'Nothing here' }) {
    this.rowH = rowHeight; this.render = render; this.onFocus = onFocus; this.onActivate = onActivate; this.extraKeys = keys;
    this.items = []; this.index = 0; this.rows = new Map(); this.emptyText = empty;
    this.el = document.createElement('div');
    this.el.className = 'vlist ' + className;
    this.el.dataset.navgroup = '';
    this.spacer = document.createElement('div');
    this.spacer.className = 'vlist-spacer';
    this.el.append(this.spacer);
    this.el._entry = () => this.rowEl(this.index) || null;
    this.el.addEventListener('scroll', () => this.#schedule(), { passive: true });
    this.el.__keys = (k, e) => this.#keys(k, e);
    this.el.addEventListener('focusin', (e) => {
      const r = e.target.closest('.vrow');
      if (!r) return;
      const i = +r.dataset.i;
      if (i !== this.index) { this.index = i; this.#markCurrent(); }
      this.onFocus?.(this.items[i], i);
    });
    this.el.addEventListener('click', (e) => {
      const r = e.target.closest('.vrow');
      if (!r) return;
      const i = +r.dataset.i;
      this.index = i; this.#markCurrent();
      this.onActivate?.(this.items[i], i, e);
    });
    new ResizeObserver(() => this.#schedule()).observe(this.el);
  }
  setItems(items, index = 0) {
    this.items = items;
    this.index = clamp(index, 0, Math.max(0, items.length - 1));
    this.spacer.style.height = items.length * this.rowH + 'px';
    for (const r of this.rows.values()) r.remove();
    this.rows.clear();
    this.el.classList.toggle('is-empty', !items.length);
    this.el.dataset.empty = this.emptyText;
    this.scrollTo(this.index, 'center', true);
    this.#draw();
  }
  refresh() { for (const [i, r] of this.rows) this.render(this.items[i], i, r); }
  rowEl(i) { return this.rows.get(i); }
  get current() { return this.items[this.index]; }

  scrollTo(i, align = 'nearest', instant = false) {
    const h = this.el.clientHeight || 600, top = i * this.rowH;
    let st = this.el.scrollTop;
    if (align === 'center') st = top - h / 2 + this.rowH / 2;
    else if (top < st + this.rowH * 0.5) st = top - this.rowH * 1;
    else if (top + this.rowH > st + h - this.rowH * 0.5) st = top + this.rowH * 2 - h;
    st = clamp(st, 0, Math.max(0, this.items.length * this.rowH - h));
    if (Math.abs(st - this.el.scrollTop) > 1) this.el.scrollTo({ top: st, behavior: instant ? 'instant' : 'auto' });
  }
  focusIndex(i, align) {
    if (!this.items.length) return;
    this.index = clamp(i, 0, this.items.length - 1);
    this.scrollTo(this.index, align);
    this.#draw();
    this.#markCurrent();
    this.rows.get(this.index)?.focus({ preventScroll: true });
  }
  focus() { this.focusIndex(this.index); }

  #keys(k, e) {
    if (this.extraKeys?.(k, e, this.current, this.index)) return true;
    const pageN = Math.max(1, Math.floor(this.el.clientHeight / this.rowH) - 1);
    if (k === 'down') { if (this.index >= this.items.length - 1) return false; this.focusIndex(this.index + 1); return true; }
    if (k === 'up') { if (this.index <= 0) return false; this.focusIndex(this.index - 1); return true; }
    if (k === 'chdown') { this.focusIndex(this.index + pageN); return true; }
    if (k === 'chup') { this.focusIndex(this.index - pageN); return true; }
    if (k === 'ok') { this.onActivate?.(this.current, this.index, e); return true; }
    return false;
  }
  #raf = 0;
  #schedule() { if (!this.#raf) this.#raf = requestAnimationFrame(() => { this.#raf = 0; this.#draw(); }); }
  #draw() {
    const h = this.el.clientHeight || 800, st = this.el.scrollTop;
    const from = Math.max(0, Math.floor(st / this.rowH) - 4);
    const to = Math.min(this.items.length - 1, Math.ceil((st + h) / this.rowH) + 4);
    for (const [i, r] of this.rows) {
      if (i < from || i > to) { if (r === document.activeElement) continue; r.remove(); this.rows.delete(i); }
    }
    for (let i = from; i <= to; i++) {
      if (this.rows.has(i)) continue;
      const r = document.createElement('div');
      r.className = 'vrow';
      r.tabIndex = -1;
      r.dataset.f = '';
      r.dataset.i = i;
      r.style.transform = `translateY(${i * this.rowH}px)`;
      r.style.height = this.rowH + 'px';
      if (i === this.index) r.classList.add('current');
      this.render(this.items[i], i, r);
      this.el.append(r);
      this.rows.set(i, r);
    }
  }
  #markCurrent() {
    for (const [i, r] of this.rows) r.classList.toggle('current', i === this.index);
  }
}
