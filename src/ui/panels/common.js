/** Shared form controls for the tool panels. */
import { h } from '../../core/util.js';

export const PALETTE = ['#d2503a', '#e2a03f', '#f2e14c', '#4caf6d', '#3d8bd4', '#7a5cd0', '#111111', '#ffffff'];

export function head(title, sub) {
  return [h('h3', {}, title), sub ? h('p', { class: 'sub' }, sub) : null];
}

export function field(label, control, hint) {
  return h('div', { class: 'field' }, h('label', {}, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function textInput(value = '', onchange, attrs = {}) {
  return h('input', { type: 'text', value, oninput: (e) => onchange(e.target.value), ...attrs });
}

export function numInput(value, onchange, attrs = {}) {
  return h('input', { type: 'number', value, oninput: (e) => onchange(+e.target.value), ...attrs });
}

export function select(options, value, onchange) {
  const el = h('select', { onchange: (e) => onchange(e.target.value) });
  options.forEach((o) => {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    el.append(h('option', { value: val, selected: val === value }, label));
  });
  return el;
}

export function checkbox(label, checked, onchange) {
  const input = h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) });
  return h('label', { class: 'field inline', style: { cursor: 'pointer' } }, input, h('span', { style: { flex: '1' } }, label));
}

export function slider(label, value, min, max, step, onchange, fmt = (v) => v) {
  const out = h('span', { class: 'hint' }, fmt(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => { out.textContent = fmt(+e.target.value); onchange(+e.target.value); },
  });
  return h('div', { class: 'field' },
    h('label', {}, h('span', {}, label), ' ', out), input);
}

export function swatches(current, onpick, colors = PALETTE) {
  const row = h('div', { class: 'swatches' });
  colors.forEach((c) => {
    const sw = h('button', {
      class: 'sw' + (c.toLowerCase() === String(current).toLowerCase() ? ' on' : ''),
      style: { background: c, boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #999' : '' },
      title: c,
      onclick: () => { [...row.children].forEach((n) => n.classList.remove('on')); sw.classList.add('on'); onpick(c); },
    });
    row.append(sw);
  });
  const custom = h('input', {
    type: 'color', value: current, style: { width: '26px', height: '22px', padding: 0, border: 0, background: 'none' },
    oninput: (e) => { [...row.children].forEach((n) => n.classList.remove('on')); onpick(e.target.value); },
  });
  row.append(custom);
  return row;
}

export function chips(options, value, onpick) {
  const row = h('div', { class: 'chips' });
  options.forEach((o) => {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    const chip = h('button', {
      class: 'chip' + (val === value ? ' on' : ''),
      onclick: () => { [...row.children].forEach((n) => n.classList.remove('on')); chip.classList.add('on'); onpick(val); },
    }, label);
    row.append(chip);
  });
  return row;
}

export function button(label, onclick, cls = 'btn wide') {
  return h('button', { class: cls, onclick }, label);
}

export function divider() { return h('div', { class: 'divider' }); }
export function note(text) { return h('p', { class: 'hint' }, text); }
