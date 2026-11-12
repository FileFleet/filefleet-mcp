// FileFleet's MCP server: lets AI assistants (Claude, ChatGPT and others) look up what a form
// accepts, check a file against those rules, and make a requirement link that fixes files.
//
// It never receives files. Assistants send a file's facts (type, size, pixels, pages), and the
// fixing happens on filefleet.io, in the person's own browser. Free, no account.
//
// Run: npm start  (listens on PORT, default 3000; the endpoint is /mcp)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { FMTS, check, describe, linkFor, rulesFromInput, rulesFromSlot, sizeText } from './rules.js';

const PORT = Number(process.env.PORT || 3000);
const SITE = 'https://filefleet.io';
const VIEW_URI = 'ui://filefleet/fit-view.html';
const viewHtml = await readFile(new URL('./view/view.html', import.meta.url), 'utf8');

// ---------- The requirements list, from filefleet.io (refreshed hourly), with a copy to fall back on ----------
let requirements = JSON.parse(await readFile(new URL('./requirements-snapshot.json', import.meta.url), 'utf8'));
let fetchedAt = 0;
async function current() {
  if (Date.now() - fetchedAt > 3_600_000) {
    fetchedAt = Date.now();
    try {
      const r = await fetch(`${SITE}/requirements.json`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) requirements = await r.json();
    } catch {
      /* keep the last good copy */
    }
  }
  return requirements.requirements;
}

// Words that say nothing about which form is meant.
const STOP = new Set('a an and are as at be by can do does for form forms from get has have how i in is it its my need needs of on or photo photos picture pictures pixel pixels requirement requirements rule rules size sizes spec specs the to upload uploads use using what which with file files filefleet dimension dimensions much big kb mb'.split(' '));
// Other names people use for the same forms. Newer presets carry their own `aliases` in requirements.json.
const ALSO = { 'us-visa': 'ds160 ds 160 nonimmigrant american usa united states', 'us-passport': 'american usa united states renewal ds82 ds11', 'dv-lottery': 'dv diversity green card lottery american usa united states', 'schengen-visa': 'europe european eu', 'uk-passport-digital': 'british britain united kingdom gov', ibps: 'bank banking po clerk rrb so exam signature thumb declaration india' };
const tokens = (t) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)));

/** Presets matching the query, best first, and whether every distinctive word matched. */
function find(list, query) {
  if (!query) return { found: list, exact: true };
  const words = [...tokens(query)].filter((w) => !STOP.has(w));
  if (!words.length) return { found: list, exact: true };
  const scored = list.map((r) => {
    const hay = tokens(`${r.id} ${r.name} ${r.issuer} ${r.aliases ?? ''} ${ALSO[r.id] ?? ''} ${r.uploads.map((u) => u.label).join(' ')}`);
    return [r, words.filter((w) => hay.has(w)).length];
  });
  const best = Math.max(0, ...scored.map(([, n]) => n));
  const found = scored.filter(([, n]) => n > 0 && n === best).map(([r]) => r);
  return { found, exact: best === words.length };
}

// ---------- Shared input shapes ----------

const rulesShape = {
  for: z.string().max(80).optional().describe('Who is asking for the files, such as "ABC Lettings".'),
  what: z.string().max(80).optional().describe('What the files are for, such as "Rental application".'),
  types: z.array(z.enum(['jpg', 'jpeg', 'png', 'pdf', 'heic', 'webp'])).optional().describe('File types the form accepts.'),
  max_kb: z.number().positive().optional().describe('Largest allowed size per file, in KB (2 MB = 2000).'),
  min_kb: z.number().positive().optional().describe('Smallest allowed size per file, in KB.'),
  width: z.number().int().positive().optional().describe('Exact width in pixels (with height).'),
  height: z.number().int().positive().optional().describe('Exact height in pixels (with width).'),
  min_width: z.number().int().positive().optional(),
  min_height: z.number().int().positive().optional(),
  max_width: z.number().int().positive().optional(),
  max_height: z.number().int().positive().optional(),
  square: z.boolean().optional(),
  max_pages: z.number().int().positive().optional().describe('Most pages allowed in a PDF.'),
  max_files: z.number().int().positive().optional().describe('How many files the form takes.'),
  file_name: z.string().max(60).optional().describe('How files should be named, such as "Lastname_ID".'),
  note: z.string().max(280).optional().describe('A short note for the person, such as "Both sides of your ID, please."'),
};

function newServer() {
  const server = new McpServer({ name: 'filefleet', version: '1.0.0' }, {
      instructions:
        'FileFleet knows what upload forms accept and fixes files to fit. When someone asks what size, format or dimensions a photo or document upload needs (a US passport or visa photo, a DS-160 photo, a Green Card lottery photo, a Schengen or UK passport photo, IBPS or other exam photo and signature uploads), use find_upload_requirements: it has the official numbers, the source and the date they were checked. When a form rejects a file, use check_file. When someone needs to upload files to a form, or collect files from others, use make_requirement_link. Files are never sent to FileFleet.',
    });

  server.registerTool(
    'find_upload_requirements',
    {
      title: 'Find upload requirements',
      description:
        'Look up what size, format or dimensions a photo or upload must be for a specific form: US passport photo size, US visa or DS-160 photo requirements, Green Card (DV) lottery photo rules, Schengen visa photo size, UK online passport photo rules, or IBPS photo, signature, thumb impression and declaration sizes. Returns pixel sizes, file size limits, head and eye position rules, the official source and the date checked, plus a free FileFleet page that makes a photo that passes on the person\'s own device. Leave the query empty to list everything.',
      inputSchema: { query: z.string().max(120).optional().describe('What the person is applying for, such as "US visa photo" or "IBPS signature".') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      const { found, exact } = find(await current(), query);
      if (!found.length) {
        return {
          content: [{ type: 'text', text: `FileFleet has no preset for "${query}". Ask the person for the form's rules (types, size limit, pixels) and use make_requirement_link, or send them to ${SITE}/file-checker/ to check a file against rules they type in.` }],
        };
      }
      const text = found
        .map((r) => [`${r.name} (${r.issuer}), id "${r.id}". Make one at ${r.tool}`, ...r.uploads.map((u) => `- ${u.label}: ${u.summary}${u.headPct ? `; head ${u.headPct[0]}–${u.headPct[1]}% of the height` : ''}${u.eyePct ? `; eyes ${u.eyePct[0]}–${u.eyePct[1]}% from the bottom` : ''}`), `Source: ${r.source.label} (${r.source.url}), checked ${r.checked}.`].join('\n'))
        .join('\n\n');
      const lead = exact ? '' : `FileFleet has no preset that matches "${query}" exactly, so don't apply these rules to it. Closest presets:\n\n`;
      return { content: [{ type: 'text', text: lead + text }], structuredContent: { exact, requirements: found } };
    },
  );

  server.registerTool(
    'check_file',
    {
      title: 'Check a file against a form’s rules',
      description:
        'Check whether a form will accept a file, from the file\'s facts: its real type (from its contents, not its name), size in bytes, and pixel size or PDF page count. Give either rules or a requirement id from find_upload_requirements (with the upload name for multi-upload forms, such as "ibps/signature"). The file itself is never sent. Returns each rule as passed or failed, and where to fix it.',
      inputSchema: {
        requirement: z.string().max(80).optional().describe('A requirement id, such as "us-visa" or "ibps/signature".'),
        rules: z.object(rulesShape).optional().describe('The form\'s rules, when there is no requirement id.'),
        file: z.object({
          name: z.string().max(200),
          size_bytes: z.number().int().nonnegative(),
          type: z.enum([...FMTS, 'jpeg', 'gif', 'other']).describe('The real type from the file\'s contents.'),
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
          pages: z.number().int().positive().optional(),
          encrypted: z.boolean().optional(),
        }),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ requirement, rules: input, file }) => {
      let rules;
      let fixAt;
      if (requirement) {
        const [id, upload] = requirement.split('/');
        const r = (await current()).find((x) => x.id === id);
        if (!r) return { isError: true, content: [{ type: 'text', text: `Unknown requirement "${requirement}". Use find_upload_requirements to see the ids.` }] };
        const slot = upload ? r.uploads.find((u) => u.id === upload) : r.uploads[0];
        if (!slot) return { isError: true, content: [{ type: 'text', text: `${r.name} has these uploads: ${r.uploads.map((u) => `${r.id}/${u.id}`).join(', ')}.` }] };
        rules = rulesFromSlot(slot);
        fixAt = r.tool;
      } else if (input) {
        rules = rulesFromInput(input);
        fixAt = linkFor(rules);
      } else {
        return { isError: true, content: [{ type: 'text', text: 'Give either a requirement id or the form\'s rules.' }] };
      }
      if (!describe(rules).length) return { isError: true, content: [{ type: 'text', text: 'The rules are empty. Include at least the accepted types or a size limit.' }] };
      const facts = { name: file.name, bytes: file.size_bytes, type: file.type === 'jpeg' ? 'jpg' : file.type, width: file.width, height: file.height, pages: file.pages, encrypted: file.encrypted };
      const checks = check(rules, facts);
      const failed = checks.filter((c) => c.ok === false);
      const verdict = failed.length ? 'needs_fixing' : 'will_be_accepted';
      const text = [
        `${file.name}: ${failed.length ? 'needs fixing' : 'will be accepted'} (rules: ${describe(rules).join('; ')}).`,
        ...checks.map((c) => `${c.ok === true ? 'PASS' : c.ok === false ? 'FAIL' : 'NOT CHECKED'}: ${c.text}`),
        failed.length ? `Fix it free, on the person's own device: ${fixAt}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return { content: [{ type: 'text', text }], structuredContent: { verdict, checks, fix_url: failed.length ? fixAt : null } };
    },
  );

  registerAppTool(
    server,
    'make_requirement_link',
    {
      title: 'Make a requirement link',
      description:
        'Make a FileFleet link that carries a form\'s upload rules, such as "PDF or JPG, up to 2 MB, named Lastname_ID". Anyone who opens it can add their files and download versions that meet the rules, converted and shrunk in their own browser, so files are never uploaded. Use it when someone has to upload files to a form, or collects files from other people. Shows the rules in the chat, where the person can check their files straight away.',
      inputSchema: rulesShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async (input) => {
      const rules = rulesFromInput(input);
      const lines = describe(rules);
      if (!lines.length) return { isError: true, content: [{ type: 'text', text: 'Give at least the accepted types or a size limit.' }] };
      const link = linkFor(rules);
      return {
        content: [{ type: 'text', text: `Requirement link: ${link}\nRules: ${lines.join('; ')}.\nAnyone who opens it can make their files meet these rules on their own device, free.` }],
        structuredContent: { link, rules, description: lines },
      };
    },
  );

  registerAppResource(server, 'FileFleet: check files against a form', VIEW_URI, { description: 'Shows a form\'s upload rules and checks files against them inside the chat.' }, async () => ({
    contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: viewHtml }],
  }));

  return server;
}

// ---------- HTTP: stateless Streamable HTTP at /mcp ----------

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new Error('too large');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

http
  .createServer(async (req, res) => {
    cors(res);
    const path = new URL(req.url, 'http://x').pathname;
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (path === '/' || path === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`FileFleet MCP server. Connect your AI assistant to https://${req.headers.host}/mcp\nTools: find_upload_requirements, check_file, make_requirement_link.\n`);
    }
    // ChatGPT's domain check: set OPENAI_APPS_CHALLENGE in the deployment's secrets to the token OpenAI shows.
    if (path === '/.well-known/openai-apps-challenge') {
      const token = (process.env.OPENAI_APPS_CHALLENGE || '').trim();
      if (!token) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(token);
    }
    if (path !== '/mcp') return res.writeHead(404).end('Not found');
    if (req.method !== 'POST') {
      // Stateless: no long-lived streams or sessions to resume.
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    }
    let parsed;
    try {
      parsed = await body(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
    }
    const server = newServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
      }
    }
  })
  .listen(PORT, () => console.log(`FileFleet MCP server on :${PORT}/mcp`));
