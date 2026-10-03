/** Encryption, permissions, sanitising, true redaction and integrity checks. */
import { store } from '../../core/store.js';
import { h, toast, busy, download, bytesLabel, confirmDialog } from '../../core/util.js';
import { apply, composed, reload, makePermanent, sensitivePages } from '../../core/app.js';
import * as sec from '../../core/security.js';
import { commit } from '../../core/store.js';
import { head, field, select, button, divider, note, checkbox } from './common.js';

const state = {
  userPassword: '', ownerPassword: '', algorithm: 'AES-256',
  perms: { ...sec.DEFAULT_PERMISSIONS },
  sanitize: { javascript: true, actions: true, attachments: true, media: true, externalLinks: false, metadata: false },
  redactDpi: 200,
};

function passwordBox(label, get, set) {
  const meter = h('div', { class: 'hint' }, ' ');
  const input = h('input', {
    type: 'password', value: get(), placeholder: 'leave blank for none',
    oninput: (e) => {
      set(e.target.value);
      const s = sec.passwordStrength(e.target.value);
      meter.textContent = e.target.value ? `${s.label} — about ${s.bits} bits of entropy` : ' ';
      meter.style.color = s.score > 0.6 ? 'var(--ok)' : s.score > 0.35 ? 'var(--warn)' : 'var(--fg-mute)';
    },
  });
  return h('div', { class: 'field' }, h('label', {}, label), input, meter);
}

export default {
  id: 'security',
  label: 'Security',
  group: 'Output',
  icon: '⛊',
  render() {
    const report = h('div', { class: 'hint' }, 'Not scanned yet.');
    const hashOut = h('div', { class: 'hint', style: { wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace' } }, '—');

    const permRows = [
      ['printing', 'Allow printing'],
      ['modifying', 'Allow editing the content'],
      ['copying', 'Allow copying text and images'],
      ['annotating', 'Allow adding comments'],
      ['fillingForms', 'Allow filling in form fields'],
      ['contentAccessibility', 'Allow screen readers'],
      ['documentAssembly', 'Allow inserting and reordering pages'],
    ].map(([key, label]) => checkbox(label, !!state.perms[key], (v) => {
      state.perms[key] = key === 'printing' ? (v ? 'highResolution' : false) : v;
    }));

    const sanitizeRows = [
      ['javascript', 'Embedded JavaScript'],
      ['actions', 'Auto-run, launch and submit actions'],
      ['attachments', 'Attached files'],
      ['media', 'Embedded media objects'],
      ['externalLinks', 'External web links'],
      ['metadata', 'Author, title and XMP metadata'],
    ].map(([key, label]) => checkbox(label, state.sanitize[key], (v) => { state.sanitize[key] = v; }));

    return h('div', {},
      ...head('Security', null),

      h('h3', {}, 'Scan this document'),
      note('Reports the active content a PDF can carry — the parts that make PDFs a delivery method for malware.'),
      button('Scan for active content', async () => {
        const job = busy('Scanning…');
        try {
          const info = await sec.inspect(store.bytes);
          report.textContent = '';
          if (!info.risks.length) {
            report.append(h('div', { style: { color: 'var(--ok)' } }, '✓ No scripts, actions, attachments or media found.'));
          } else {
            report.append(h('div', { class: 'list' },
              ...info.risks.map((r) => h('div', { class: 'row' },
                h('span', { style: { flex: '1' } }, r.label),
                h('span', { class: 'chip' }, String(r.count))))));
          }
        } catch (err) { toast(err.message, 'err'); } finally { job.done(); }
      }),
      h('div', { style: { height: '8px' } }),
      report,
      divider(),

      h('h3', {}, 'Strip active content'),
      ...sanitizeRows,
      button('Sanitise document', async () => {
        const job = busy('Sanitising…');
        try {
          const { bytes, removed } = await sec.sanitize(store.bytes, undefined, state.sanitize);
          store.bytes = bytes;
          await reload();
          commit('sanitise');
          toast(removed.length ? 'Removed: ' + removed.join(', ') : 'Nothing needed removing.', 'ok');
        } catch (err) { toast(err.message, 'err'); } finally { job.done(); }
      }, 'btn primary wide'),
      note('Text, images, links to pages and form fields are left alone.'),
      divider(),

      h('h3', {}, 'True redaction'),
      note('Black boxes drawn with the Redact tool, and text you have edited, only cover what was there — it is still in the file. '
        + 'This flattens the affected pages to images so the covered content stops existing. Other pages keep their text.'),
      checkbox('Flatten every page, not just pages with redaction boxes or edited text', !!state.redactAll, (v) => { state.redactAll = v; }),
      field('Output resolution', select([[150, '150 dpi'], [200, '200 dpi — recommended'], [300, '300 dpi']].map(([v, l]) => [String(v), l]), String(state.redactDpi), (v) => { state.redactDpi = +v; })),
      button('Burn redactions and remove covered content', async () => {
        const hot = sensitivePages();
        const scope = state.redactAll || !hot.length ? 'every page' : `page${hot.length === 1 ? '' : 's'} ${hot.map((i) => i + 1).join(', ')}`;
        const ok = await confirmDialog('Remove covered content?',
          `${scope.charAt(0).toUpperCase() + scope.slice(1)} will become ${state.redactAll || !hot.length ? 'images' : 'flat images'}. `
          + 'Redacted content is destroyed, and so is selectable text, form fields and bookmarks on those pages. '
          + 'The saved file cannot be recovered; Undo works only until you save.', 'Remove it');
        if (!ok) return;
        const res = await makePermanent({ dpi: state.redactDpi, all: state.redactAll || !hot.length });
        if (res) toast(`Done — ${res.pages} page${res.pages === 1 ? '' : 's'} flattened. The covered content no longer exists.`, 'ok');
      }, 'btn primary wide'),
      divider(),

      h('h3', {}, 'Password protection'),
      note('AES-256 encryption. A user password is needed to open the file at all; an owner password only unlocks the permissions below.'),
      passwordBox('User password (to open)', () => state.userPassword, (v) => { state.userPassword = v; }),
      passwordBox('Owner password (to change permissions)', () => state.ownerPassword, (v) => { state.ownerPassword = v; }),
      field('Cipher', select(sec.CIPHERS, state.algorithm, (v) => { state.algorithm = v; })),
      h('div', { style: { height: '4px' } }),
      h('label', { class: 'hint' }, 'Permissions for anyone opening with the user password'),
      ...permRows,
      button('Encrypt and save a copy', async () => {
        if (!state.userPassword && !state.ownerPassword) return toast('Set at least one password.', 'err');
        const job = busy('Encrypting…');
        try {
          const source = await composed({ flattenForm: true });
          const bytes = await sec.encrypt(source, {
            userPassword: state.userPassword,
            ownerPassword: state.ownerPassword,
            permissions: state.perms,
            algorithm: state.algorithm,
          });
          download(bytes, (store.fileName || 'document').replace(/\.pdf$/i, '') + '-protected.pdf');
          toast('Encrypted copy saved. Keep the password safe — it cannot be recovered.', 'ok');
        } catch (err) { toast(err.message, 'err'); } finally { job.done(); }
      }, 'btn primary wide'),
      note('Permission flags are honoured by viewers by agreement, not enforced by cryptography — that is how the PDF format works. '
        + 'A user password is the only setting that actually keeps a file shut.'),
      divider(),

      h('h3', {}, 'Remove protection'),
      button('Decrypt (needs the open password)', async () => {
        const pw = prompt('Password for this document:');
        if (pw == null) return;
        await apply((b) => sec.decrypt(b, pw), 'decrypt', { busyLabel: 'Decrypting…' });
      }),
      divider(),

      h('h3', {}, 'Integrity'),
      note('A SHA-256 fingerprint of exactly what you are about to save. Send it alongside the file and the recipient can prove nothing changed on the way.'),
      button('Fingerprint the current document', async () => {
        const job = busy('Hashing…');
        try {
          const bytes = await composed({ flattenForm: false });
          const hash = await sec.sha256(bytes);
          hashOut.textContent = hash;
          await navigator.clipboard?.writeText(hash).catch(() => {});
          toast('SHA-256 copied to the clipboard. ' + bytesLabel(bytes.length), 'ok');
        } finally { job.done(); }
      }),
      h('div', { style: { height: '6px' } }),
      hashOut,
    );
  },
};
