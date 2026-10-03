/** Form filling and signature placement. */
import { store, emit, commit } from '../../core/store.js';
import { h, toast, pickFiles, readAsBytes, confirmDialog } from '../../core/util.js';
import { apply, ops, bake } from '../../core/app.js';
import { render } from '../reader.js';
import { head, field, button, divider, note, checkbox, textInput, select, chips } from './common.js';

let fields = [];
let loadedFor = null;

async function ensureFields() {
  if (loadedFor === store.bytes) return fields;
  fields = await ops.readForm(store.bytes);
  loadedFor = store.bytes;
  return fields;
}

function signaturePad(onsave) {
  const canvas = h('canvas', { class: 'sigpad', width: 600, height: 200, style: { height: '120px' } });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 3.5; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#12224a';
  let drawing = false; let empty = true;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true; empty = false; canvas.setPointerCapture(e.pointerId);
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
  canvas.addEventListener('pointerup', () => { drawing = false; });

  const clear = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#12224a'; empty = true; };

  return h('div', {},
    canvas,
    h('div', { class: 'btn-row', style: { marginTop: '6px' } },
      h('button', { class: 'btn sm', onclick: clear }, 'Clear'),
      h('button', {
        class: 'btn sm primary',
        onclick: () => {
          if (empty) return toast('Draw a signature first.', 'err');
          // Trim the white margin so the placed signature sits tight.
          onsave(trimWhite(canvas));
        },
      }, 'Save signature')));
}

/** Crop surrounding white and return a transparent PNG data URL. */
function trimWhite(source) {
  const { width, height } = source;
  const ctx = source.getContext('2d');
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) {
        found = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return source.toDataURL('image/png');
  const pad = 8;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  const octx = out.getContext('2d');
  octx.drawImage(source, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  // Knock out the white background so the signature sits on the page cleanly.
  const img = octx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    if (lum > 225) img.data[i + 3] = 0;
    else img.data[i + 3] = Math.min(255, Math.round(255 * (1 - lum / 255) * 1.6));
  }
  octx.putImageData(img, 0, 0);
  return out.toDataURL('image/png');
}

export default {
  id: 'fillsign',
  label: 'Fill & sign',
  group: 'Edit',
  icon: '✍',
  needsReader: true,
  render() {
    const list = h('div', {}, h('p', { class: 'hint' }, 'Reading form fields…'));
    const flatten = { on: true };

    ensureFields().then((fs) => {
      list.textContent = '';
      if (!fs.length) {
        list.append(h('p', { class: 'hint' },
          'This document has no interactive form fields. Use the Text tool in Markup to type anywhere on the page.'));
        return;
      }
      fs.forEach((f) => {
        const current = store.formValues[f.name] ?? f.value;
        let control;
        if (f.type === 'PDFCheckBox') {
          control = checkbox('Checked', !!current, (v) => { store.formValues[f.name] = v; });
        } else if (f.options) {
          control = select([['', '—'], ...f.options], String(current || ''), (v) => { store.formValues[f.name] = v; });
        } else {
          control = textInput(String(current || ''), (v) => { store.formValues[f.name] = v; });
        }
        list.append(h('div', { class: 'formfield' },
          h('div', { class: 'fname' }, f.name + (f.readOnly ? ' (read-only)' : '')),
          control));
      });
    });

    return h('div', {},
      ...head('Fill & sign', null),
      h('h3', {}, 'Form fields'),
      list,
      h('div', { style: { height: '8px' } }),
      checkbox('Flatten when applying (recommended)', flatten.on, (v) => { flatten.on = v; }),
      button('Apply form values', async () => {
        if (!Object.keys(store.formValues).length) return toast('No field values have been changed.', 'err');
        const ok = await apply((b) => ops.fillForm(b, store.formValues, { flatten: flatten.on }), 'fill form', { busyLabel: 'Filling…' });
        if (ok) { store.formValues = {}; loadedFor = null; commit('fill form'); emit('doc'); render(); }
      }, 'btn primary wide'),
      note('Flattening writes the values into the page so every viewer shows them and nobody can change them back.'),
      divider(),

      h('h3', {}, 'Create form fields'),
      note('Turn a flat document into a fillable form. Pick a field type, then drag (or click, for a checkbox) on the page. '
        + 'Fields become real, fillable form fields when you save.'),
      chips([['field-text', 'Text'], ['field-check', 'Checkbox'], ['field-dropdown', 'Dropdown']], store.draw, (v) => {
        store.draw = v; store.view = 'read'; emit('view');
      }),
      h('div', { style: { height: '8px' } }),
      field('Field name', textInput(store.fieldName || '', (v) => { store.fieldName = v; }, { placeholder: 'e.g. customer.name' }),
        'Leave blank to auto-name. Duplicate names get a number added.'),
      field('Dropdown choices', textInput((store.fieldOptions || []).join(', '), (v) => {
        store.fieldOptions = v.split(',').map((o) => o.trim()).filter(Boolean);
      }, { placeholder: 'Yes, No, N/A' })),
      checkbox('Text fields allow several lines', !!store.fieldMultiline, (v) => { store.fieldMultiline = v; }),
      divider(),

      h('h3', {}, 'Signature'),
      store.signature
        ? h('div', {},
          h('img', { src: store.signature, style: { width: '100%', background: '#fff', borderRadius: '6px', padding: '6px' } }),
          h('div', { class: 'btn-row', style: { marginTop: '6px' } },
            button('Place on page', () => {
              store.draw = 'signature';
              store.view = 'read';
              emit('view');
              toast('Click on the page to place your signature.');
            }, 'btn primary'),
            button('Redo', () => { store.signature = null; emit('panel-refresh'); }, 'btn')))
        : signaturePad((dataUrl) => { store.signature = dataUrl; emit('panel-refresh'); toast('Signature saved.', 'ok'); }),
      h('div', { style: { height: '8px' } }),
      button('Use an image of my signature…', async () => {
        const [file] = await pickFiles({ accept: 'image/png,image/jpeg' });
        if (!file) return;
        const bytes = await readAsBytes(file);
        const blob = new Blob([bytes], { type: file.type });
        const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          store.signature = /png/i.test(file.type) ? url : trimWhite(c);
          emit('panel-refresh');
          toast('Signature loaded.', 'ok');
        };
        img.src = url;
      }, 'btn wide'),
      divider(),

      h('h3', {}, 'Stamps'),
      note('Place a dated approval mark, or any image, anywhere on the page.'),
      h('div', { class: 'btn-row' },
        button('Approved', () => stamp('APPROVED', '#2c8a55'), 'btn sm'),
        button('Reviewed', () => stamp('REVIEWED', '#3d6fd4'), 'btn sm'),
        button('Void', () => stamp('VOID', '#c23b2c'), 'btn sm')),
      h('div', { style: { height: '6px' } }),
      button('Use an image as a stamp…', async () => {
        const [file] = await pickFiles({ accept: 'image/png,image/jpeg' });
        if (!file) return;
        const blob = new Blob([await readAsBytes(file)], { type: file.type });
        store.stampImage = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
        store.draw = 'stamp';
        store.view = 'read';
        emit('view');
        toast('Click on the page to place the image.');
      }, 'btn wide'),
      divider(),
      button('Flatten everything and save into the document', async () => {
        const ok = await confirmDialog('Flatten document?',
          'Form values, markup, signatures and stamps all become permanent page content.', 'Flatten');
        if (ok) { await bake('flatten'); loadedFor = null; render(); }
      }, 'btn wide'),
    );
  },
};

function stamp(text, color) {
  const c = document.createElement('canvas');
  const scale = 3;
  c.width = 340 * scale / 2; c.height = 92 * scale / 2;
  const ctx = c.getContext('2d');
  ctx.scale(scale / 2, scale / 2);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 334, 86);
  ctx.font = 'bold 40px Helvetica, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 18, 36);
  ctx.font = '15px Helvetica, Arial, sans-serif';
  ctx.fillText(new Date().toLocaleDateString(), 18, 68);
  store.stampImage = c.toDataURL('image/png');
  store.draw = 'stamp';
  store.view = 'read';
  emit('view');
  toast('Click on the page to place the stamp.');
}
