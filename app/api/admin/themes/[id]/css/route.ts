import { NextRequest } from 'next/server';
import { serveThemeAsset } from '@/lib/admin/theme-asset';

/**
 * GET /api/admin/themes/[id]/css - Serve a theme's CSS to clients
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return serveThemeAsset(id, 'css');
}
