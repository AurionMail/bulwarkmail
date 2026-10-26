import type { FileNode } from '@/lib/jmap/types';
import { demoDate } from '../demo-utils';
import { DEMO_ASSETS, type DemoBlobId } from './assets';

const FOLDER = {
  documents: 'demo-file-documents',
  beacon: 'demo-file-beacon',
  photos: 'demo-file-photos',
  travel: 'demo-file-travel',
} as const;

function folder(id: string, name: string, parentId: string | null, createdDays: number, modifiedDays: number): FileNode {
  return { id, parentId, name, type: 'd', blobId: null, size: 0, created: demoDate(-createdDays), modified: demoDate(-modifiedDays) };
}

/** A file backed by one of the demo assets; name and size come from the asset. */
function file(id: string, parentId: string | null, blobId: DemoBlobId, createdDays: number, modifiedDays = createdDays, name?: string): FileNode {
  const asset = DEMO_ASSETS[blobId];
  return { id, parentId, name: name ?? asset.name, type: asset.type, blobId, size: asset.size, created: demoDate(-createdDays), modified: demoDate(-modifiedDays) };
}

export function createDemoFileNodes(): FileNode[] {
  return [
    folder(FOLDER.documents, 'Documents', null, 400, 1),
    folder(FOLDER.beacon, 'Beacon', FOLDER.documents, 60, 1),
    folder(FOLDER.photos, 'Photos', null, 400, 5),
    folder(FOLDER.travel, 'Travel', null, 24, 2),

    // Documents
    file('demo-file-meeting-notes', FOLDER.documents, 'demo-blob-meeting-notes', 7, 1),
    file('demo-file-todo', FOLDER.documents, 'demo-blob-todo', 3, 0),
    file('demo-file-quarterly-report', FOLDER.documents, 'demo-blob-quarterly-report', 3, 2),
    file('demo-file-service-agreement', FOLDER.documents, 'demo-blob-service-agreement', 9, 1),
    file('demo-file-budget', FOLDER.documents, 'demo-blob-budget', 40, 4),

    // Documents / Beacon
    file('demo-file-launch-plan', FOLDER.beacon, 'demo-blob-launch-plan', 2),
    file('demo-file-runbook', FOLDER.beacon, 'demo-blob-runbook', 1, 1),
    file('demo-file-soak-metrics', FOLDER.beacon, 'demo-blob-soak-metrics', 1),
    file('demo-file-soak-dashboard', FOLDER.beacon, 'demo-blob-soak-dashboard', 1),
    file('demo-file-launch-deck', FOLDER.beacon, 'demo-blob-launch-deck', 5, 2),

    // Photos
    file('demo-file-team-photo', FOLDER.photos, 'demo-blob-team-photo', 120),
    file('demo-file-lake', FOLDER.photos, 'demo-blob-vacation', 95),
    file('demo-file-wedding-1', FOLDER.photos, 'demo-blob-wedding-1', 1),
    file('demo-file-wedding-2', FOLDER.photos, 'demo-blob-wedding-2', 1),
    file('demo-file-wedding-3', FOLDER.photos, 'demo-blob-wedding-3', 1),

    // Travel
    file('demo-file-eticket', FOLDER.travel, 'demo-blob-boarding-pass', 3, 3, 'E-ticket-E7KQ2R.pdf'),
    file('demo-file-hotel', FOLDER.travel, 'demo-blob-hotel-voucher', 3),
    file('demo-file-summit-ticket', FOLDER.travel, 'demo-blob-summit-ticket', 2),

    // Root
    file('demo-file-prototype', null, 'demo-blob-prototype', 1),
  ];
}
