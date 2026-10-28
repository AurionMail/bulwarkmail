// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';

// #1393: "New file" offers the formats the WOPI editor can edit and has a
// blank template for, and serves that template.

const config = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));

vi.mock('@/lib/logger', () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: async () => {},
    get: (key: string, fallback: unknown) => config.values[key] ?? fallback,
  },
}));
vi.mock('@/lib/stalwart/credentials', () => ({ getStalwartCredentials: vi.fn() }));

import { GET as status } from '@/app/api/wopi/status/route';
import { GET as template } from '@/app/api/wopi/template/route';
import { getBlankTemplate, getNewFileFormats, parseFormatList } from '@/lib/wopi/new-file';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import type { WopiActions } from '@/lib/wopi/discovery';

const action = (name: string, ext: string) =>
  `<action name="${name}" ext="${ext}" urlsrc="https://office.example/edit?"/>`;

// What Collabora advertises: PDF can be viewed and commented, not edited.
const COLLABORA = `<wopi-discovery><net-zone><app name="x">${[
  action('edit', 'docx'), action('editnew', 'docx'), action('edit', 'xlsx'), action('edit', 'pptx'),
  action('edit', 'odt'), action('edit', 'ods'), action('edit', 'odp'), action('edit', 'txt'),
  action('edit', 'rtf'), action('view', 'pdf'), action('view_comment', 'pdf'),
].join('')}</app></net-zone></wopi-discovery>`;

const actions = (edit: string[], view: string[] = []): WopiActions => ({
  edit: Object.fromEntries(edit.map((ext) => [ext, 'https://office.example/edit?'])),
  view: Object.fromEntries(view.map((ext) => [ext, 'https://office.example/view?'])),
});

let editorSeq = 0;
function useEditor(xml: string) {
  // A fresh editor URL each time: discovery is cached per URL.
  config.values.wopiClientUrl = `https://office${++editorSeq}.example`;
  (globalThis.fetch as Mock).mockResolvedValue(new Response(xml, { status: 200 }));
}

const request = (url: string) => new NextRequest(`https://mail.example${url}`);

beforeEach(() => {
  config.values = {};
  vi.stubGlobal('fetch', vi.fn());
  (getStalwartCredentials as Mock).mockResolvedValue({ serverUrl: 'https://jmap.example', username: 'u', authHeader: 'Basic x' });
});
afterEach(() => vi.unstubAllGlobals());

describe('new file formats (#1393)', () => {
  it('offers the formats the editor can edit and has a template for', async () => {
    // rtf has no template and txt needs none, pdf is view-only.
    expect(await getNewFileFormats(actions(['txt', 'rtf', 'odt', 'docx', 'pptx', 'xlsx'], ['pdf'])))
      .toEqual(['docx', 'xlsx', 'pptx', 'odt']);
    expect(await getNewFileFormats(actions(['pdf', 'docx']))).toEqual(['docx', 'pdf']);
  });

  it('takes the admin list instead of discovery, still only with a template', async () => {
    config.values.wopiNewFileFormats = ' .DOCX, ods ; vsdx';
    expect(await getNewFileFormats(actions(['docx', 'xlsx', 'pptx']))).toEqual(['docx', 'ods']);
    expect(parseFormatList('docx,,docx, ../x, .odt')).toEqual(['docx', 'odt']);
  });

  it('adds and replaces templates from the template directory', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bw-wopi-tpl-'));
    writeFileSync(path.join(dir, 'new.vsdx'), 'visio');
    writeFileSync(path.join(dir, 'new.docx'), 'letterhead');
    writeFileSync(path.join(dir, 'other.odg'), 'not a template name');
    config.values.wopiTemplateDir = dir;

    expect(await getNewFileFormats(actions(['docx', 'vsdx', 'odg']))).toEqual(['docx', 'vsdx']);
    const docx = await getBlankTemplate('docx');
    expect(Buffer.from(docx!.data).toString()).toBe('letterhead');
    expect(docx!.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(Buffer.from((await getBlankTemplate('vsdx'))!.data).toString()).toBe('visio');
    // Formats the directory doesn't have still come from the shipped set.
    expect((await getBlankTemplate('xlsx'))!.data.length).toBeGreaterThan(1000);
    expect(await getBlankTemplate('../new')).toBeNull();
  });

  it('ships blank templates the editors can open', async () => {
    const parts: Record<string, string> = {
      docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml',
      odt: 'content.xml', ods: 'content.xml', odp: 'content.xml',
    };
    for (const [ext, part] of Object.entries(parts)) {
      const zip = await JSZip.loadAsync((await getBlankTemplate(ext))!.data);
      expect(zip.file(part), `${ext} has ${part}`).not.toBeNull();
      if (ext.startsWith('od')) {
        // ODF: an uncompressed mimetype entry first.
        expect(Object.keys(zip.files)[0]).toBe('mimetype');
        expect(await zip.file('mimetype')!.async('string')).toBe(`application/vnd.oasis.opendocument.${{ odt: 'text', ods: 'spreadsheet', odp: 'presentation' }[ext]}`);
      }
      // No language of their own: a new document takes the editor's.
      for (const file of Object.values(zip.files).filter((f) => f.name.endsWith('.xml'))) {
        expect(await file.async('string'), `${ext} ${file.name}`).not.toMatch(/en-GB|en-US|fo:language=|<w:lang\b/);
      }
    }
    expect(Buffer.from((await getBlankTemplate('pdf'))!.data).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('lists the creatable formats in /api/wopi/status', async () => {
    useEditor(COLLABORA);
    const body = await (await status(request('/api/wopi/status'))).json();
    expect(body.newExtensions).toEqual(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);
  });

  it('serves a template only for a format it offers', async () => {
    useEditor(COLLABORA);
    const res = await template(request('/api/wopi/template?ext=DOCX'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect((await JSZip.loadAsync(await res.arrayBuffer())).file('word/document.xml')).not.toBeNull();

    expect((await template(request('/api/wopi/template?ext=pdf'))).status).toBe(404);
    expect((await template(request('/api/wopi/template?ext=rtf'))).status).toBe(404);
  });

  it('serves nothing without a session or an editor', async () => {
    useEditor(COLLABORA);
    (getStalwartCredentials as Mock).mockResolvedValueOnce(null);
    expect((await template(request('/api/wopi/template?ext=docx'))).status).toBe(401);

    config.values.wopiClientUrl = '';
    expect((await template(request('/api/wopi/template?ext=docx'))).status).toBe(404);
    expect((await (await status(request('/api/wopi/status'))).json()).newExtensions).toEqual([]);
  });
});
