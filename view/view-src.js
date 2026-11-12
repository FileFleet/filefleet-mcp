// The in-chat view of FileFleet: shows a form's rules and checks files right there in the chat.
// Files are read inside this window only; nothing is sent to FileFleet or the AI company.
// Fixing opens filefleet.io, where the files are converted on the person's own device.
import { App } from '@modelcontextprotocol/ext-apps';
import { check, describe } from '../rules.js';

const $ = (sel) => document.querySelector(sel);
let rules = {};
let link = 'https://filefleet.io/';

async function factsOf(file) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const s = (o, n) => String.fromCharCode(...head.slice(o, o + n));
  let type = 'other';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) type = 'jpg';
  else if (head[0] === 0x89 && s(1, 3) === 'PNG') type = 'png';
  else if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') type = 'webp';
  else if (s(0, 3) === 'GIF') type = 'gif';
  else if (s(4, 4) === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(s(8, 4))) type = 'heic';
  else if (new TextDecoder('latin1').decode(head).includes('%PDF-')) type = 'pdf';
  const f = { name: file.name, bytes: file.size, type };
  if (['jpg', 'png', 'webp', 'gif'].includes(type)) {
    try {
      const b = await createImageBitmap(file);
      f.width = b.width;
      f.height = b.height;
      b.close();
    } catch {}
  }
  if (type === 'pdf' && file.size < 60_000_000) {
    const text = new TextDecoder('latin1').decode(await file.arrayBuffer());
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    if (pages) f.pages = pages;
    f.encrypted = /\/Encrypt\s/.test(text);
  }
  return f;
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
}

function showRules() {
  const lines = describe(rules);
  $('#title').textContent = rules.for ? `${rules.for} asks for${rules.what ? ` (${rules.what})` : ''}:` : 'Your files need to be:';
  $('#rules').replaceChildren(...lines.map((l) => el('li', {}, l)));
  $('#note').textContent = rules.note || '';
  $('#app').hidden = false;
}

async function checkFiles(files) {
  const out = $('#results');
  out.replaceChildren();
  let bad = 0;
  for (const file of files) {
    const f = await factsOf(file);
    const checks = check(rules, f).filter((c) => c.ok !== null);
    const failed = checks.filter((c) => !c.ok).length;
    if (failed) bad++;
    out.append(
      el(
        'li',
        { class: failed ? 'fail' : 'pass' },
        el('strong', {}, file.name),
        el('span', { class: 'verdict' }, failed ? 'Needs fixing' : 'Will be accepted'),
        el('ul', {}, checks.map((c) => el('li', { class: c.ok ? 'ok' : 'warn' }, (c.ok ? '✓ ' : '! ') + c.text))),
      ),
    );
  }
  $('#fix').textContent = bad ? 'Fix them on FileFleet' : 'Open on FileFleet';
  $('#fix-wrap').hidden = false;
}

const app = new App({ name: 'FileFleet', version: '1.0.0' });
app.ontoolresult = (result) => {
  const data = result.structuredContent || {};
  rules = data.rules || {};
  link = data.link || link;
  showRules();
};
$('#files').addEventListener('change', (e) => checkFiles([...e.target.files]));
$('#drop').addEventListener('dragover', (e) => e.preventDefault());
$('#drop').addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files.length) checkFiles([...e.dataTransfer.files]);
});
$('#fix').addEventListener('click', () => app.openLink({ url: link }));
app.connect();
