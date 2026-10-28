// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// R11: directional icons flip only through the global list in globals.css; a
// local rtl: flip on top of it turns them back the wrong way (the phone
// search's back arrow pointed into the content in Arabic). Offsets use
// logical properties so subfolders indent on the reading side.

const root = path.resolve(__dirname, '../../..');
const mailFiles = [
  'components/mail/mail-app.tsx',
  'components/email/email-viewer.tsx',
  'components/email/email-composer.tsx',
  'components/email/plugin-search-results.tsx',
  'components/email/thread-list-item.tsx',
  'components/layout/sidebar.tsx',
  'components/templates/template-picker.tsx',
  'components/templates/template-manager-modal.tsx',
];
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf-8');

describe('Mail in right-to-left languages', () => {
  it.each(mailFiles)('%s adds no local flip to directional icons', (file) => {
    expect(read(file)).not.toMatch(/rtl:(-scale-x-100|rotate-180)/);
  });

  it.each(mailFiles)('%s uses no physical left offsets', (file) => {
    const code = read(file).replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/paddingLeft:|\bleft-[03]\b|\btext-left\b|-right-1\b/);
  });

  it('isolates subjects in the list, so an English subject reads right in Arabic', () => {
    const source = read('components/email/thread-list-item.tsx');
    expect(source.match(/<bdi>\{subjectSnippet/g)).toHaveLength(4);
  });
});

// R2: one icon per action. Edit is Pencil, Compose PenSquare, Refresh
// RefreshCw (RotateCcw means reset or undo), the star amber.
describe('Mail icons', () => {
  const iconFiles = [
    'components/mail/mail-app.tsx',
    'components/email/email-viewer.tsx',
    'components/email/email-context-menu.tsx',
    'components/email/mv-list-toolbar.tsx',
    'components/email/reader-plugin-surfaces.tsx',
  ];
  it.each(iconFiles)('%s uses the agreed icons', (file) => {
    const code = read(file);
    expect(code).not.toMatch(/\bEditIcon\b|\bPenLine\b|yellow-400|icon=\{RotateCcw\}|<MoreHorizontal/);
    expect(code).not.toMatch(/<RotateCcw className=\{cn\("w-4 h-4", isManualRefreshing/);
  });
});
