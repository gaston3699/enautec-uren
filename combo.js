// Zoekbare keuzelijsten: elke <select> in de app krijgt een tekstveld waarin je kan beginnen typen;
// de lijst met voorstellen wordt dan kleiner. De echte <select> blijft (onzichtbaar) bestaan, zodat
// alle bestaande code (value, change-events, formulieren) gewoon blijft werken.

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const proto = HTMLSelectElement.prototype;
const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
const indexDesc = Object.getOwnPropertyDescriptor(proto, 'selectedIndex');

function enhance(sel) {
  if (sel.dataset.combo || sel.multiple || 'native' in sel.dataset || !sel.parentNode) return;
  sel.dataset.combo = '1';
  const wrap = document.createElement('div');
  sel.parentNode.insertBefore(wrap, sel);
  wrap.append(sel);
  sel.classList.add('combo-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'combo-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  const lbl = sel.getAttribute('aria-label');
  if (lbl) input.setAttribute('aria-label', lbl);
  const list = document.createElement('div');
  list.className = 'combo-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(input, list);

  let items = [];
  let active = -1;
  let open = false;
  const label = () => sel.selectedOptions[0]?.textContent.trim() ?? '';

  /** Tekst en klassen overnemen van de echte keuzelijst */
  const sync = () => {
    wrap.className = `combo ${[...sel.classList].filter((c) => c !== 'combo-native').join(' ')}`;
    input.disabled = sel.disabled;
    if (!open) input.value = label();
    input.placeholder = label() || 'Kies of typ om te zoeken…';
  };

  const render = (q) => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const match = (o) => !words.length || words.every((w) => norm(o.textContent).includes(w));
    list.innerHTML = '';
    items = [];
    const addOpt = (o) => {
      if (o.hidden || (o.disabled && o.value === '')) return;
      if (words.length && o.value === '') return; // "— geen —" enkel zonder zoekterm
      if (!match(o)) return;
      const div = document.createElement('div');
      div.className = `combo-opt${o.selected ? ' sel' : ''}${o.value === '__new' ? ' new' : ''}`;
      div.setAttribute('role', 'option');
      div.textContent = o.textContent;
      div.dataset.i = String(items.length);
      items.push({ o, div });
      list.append(div);
    };
    for (const n of sel.children) {
      if (n.tagName === 'OPTGROUP') {
        const before = items.length;
        const head = document.createElement('div');
        head.className = 'combo-head';
        head.textContent = n.label;
        list.append(head);
        for (const o of n.children) addOpt(o);
        if (items.length === before) head.remove();
      } else if (n.tagName === 'OPTION') addOpt(n);
    }
    // "+ Nieuw project…" en dergelijke altijd bereikbaar, ook als de zoekterm niets vindt
    if (words.length) for (const o of sel.options) if (o.value === '__new' && !items.some((x) => x.o === o)) { addOpt2(o); }
    if (!items.length) {
      const none = document.createElement('div');
      none.className = 'combo-none';
      none.textContent = 'Niets gevonden';
      list.append(none);
    }
    setActive(words.length ? 0 : Math.max(0, items.findIndex((x) => x.o.selected)));
  };
  function addOpt2(o) {
    const div = document.createElement('div');
    div.className = 'combo-opt new';
    div.textContent = o.textContent;
    div.dataset.i = String(items.length);
    items.push({ o, div });
    list.append(div);
  }

  const setActive = (i) => {
    items[active]?.div.classList.remove('act');
    active = Math.max(-1, Math.min(items.length - 1, i));
    const it = items[active];
    if (it) { it.div.classList.add('act'); it.div.scrollIntoView({ block: 'nearest' }); }
  };

  const show = (keep = false) => {
    if (open || sel.disabled) return;
    open = true;
    input.setAttribute('aria-expanded', 'true');
    wrap.classList.add('open');
    if (!keep) input.value = '';
    render(keep ? input.value : '');
    list.hidden = false;
    // genoeg plaats onder? anders boven openen
    const r = input.getBoundingClientRect();
    wrap.classList.toggle('up', r.bottom + 260 > window.innerHeight && r.top > 280);
  };
  const hide = () => {
    if (!open) return;
    open = false;
    input.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('open', 'up');
    list.hidden = true;
    input.value = label();
  };
  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    hide();
    if (sel.value !== it.o.value) {
      valueDesc.set.call(sel, it.o.value);
      input.value = label();
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    input.value = label();
  };

  input.addEventListener('focus', () => show());
  input.addEventListener('click', () => show());
  input.addEventListener('input', () => { if (!open) show(true); else render(input.value); });
  input.addEventListener('blur', () => setTimeout(hide, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); else setActive(active + 1); return; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { if (open) { e.preventDefault(); choose(active); } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); hide(); } }
    else if (e.key === 'Tab') hide();
  });
  // mousedown: kiezen vóór het tekstveld de focus verliest
  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const d = e.target.closest('.combo-opt');
    if (d) choose(Number(d.dataset.i));
  });

  // waarde die de code zelf instelt (sel.value = …) ook tonen
  Object.defineProperty(sel, 'value', { configurable: true, get() { return valueDesc.get.call(this); }, set(v) { valueDesc.set.call(this, v); sync(); } });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return indexDesc.get.call(this); }, set(v) { indexDesc.set.call(this, v); sync(); } });
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
  sel.addEventListener('change', sync);
  sync();
}

/** Alle keuzelijsten (ook later toegevoegde) zoekbaar maken. Uitzondering: <select data-native>. */
export function initCombos(root = document.body) {
  root.querySelectorAll('select').forEach(enhance);
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'SELECT') enhance(n);
        else n.querySelectorAll?.('select').forEach(enhance);
      }
    }
  }).observe(root, { childList: true, subtree: true });
}
