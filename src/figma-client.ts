import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { FigmaFile } from './types.ts';

/** Accept file keys and canonical Figma links without accepting arbitrary remote hosts. */
export function parseFigmaFileKey(input: string): string {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{8,}$/.test(value)) return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Provide a Figma file key or a Figma file URL.'); }
  if (url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.hostname)) {
    throw new Error('Only https://figma.com file URLs are accepted.');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (!['file', 'design', 'proto'].includes(segments[0]) || !segments[1] || !/^[A-Za-z0-9_-]{8,}$/.test(segments[1])) {
    throw new Error('Not a supported Figma file URL.');
  }
  return segments[1];
}

export function parseFigmaNodeId(input: string): string {
  const id = input.trim();
  if (/^\d+:\d+$/.test(id)) return id;
  if (/^\d+-\d+$/.test(id)) return id.replace('-', ':');
  throw new Error('Invalid Figma node ID; expected 12:345.');
}

export class FigmaClient {
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly fixturePath: string;
  constructor(token: string, fetcher: typeof fetch = fetch, fixturePath = '') {
    this.token = token;
    this.fetcher = fetcher;
    this.fixturePath = fixturePath;
  }

  async getFile(fileKeyOrUrl: string): Promise<FigmaFile> {
    // Explicit opt-in offline mode. Read from one local, operator-selected fixture.
    // No Figma token or network access is used in this mode.
    if (this.fixturePath) {
      if (!isAbsolute(this.fixturePath)) throw new Error('FIGMA_FIXTURE_PATH must be an absolute path.');
      let fixture: unknown;
      try { fixture = JSON.parse(await readFile(this.fixturePath, 'utf8')); }
      catch { throw new Error('Cannot read or parse FIGMA_FIXTURE_PATH JSON fixture.'); }
      return validateFigmaFile(fixture);
    }
    if (!this.token.trim()) throw new Error('Missing FIGMA_TOKEN. Set a personal access token with file_content:read.');
    const key = parseFigmaFileKey(fileKeyOrUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.fetcher(`https://api.figma.com/v1/files/${encodeURIComponent(key)}`, {
        headers: { 'X-Figma-Token': this.token, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403
          ? 'Invalid token or insufficient Figma permissions (file_content:read).'
          : response.status === 404 ? 'Figma file not found or inaccessible.'
          : response.status === 429 ? 'Figma API rate limit exceeded. Retry later.'
          : `Figma API returned HTTP ${response.status}.`;
        throw new Error(message);
      }
      const result: unknown = await response.json();
      return validateFigmaFile(result);
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Figma API request timed out after 30 seconds.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateFigmaFile(value: unknown): FigmaFile {
  if (!value || typeof value !== 'object' || !('document' in value) || !('name' in value)
      || typeof value.name !== 'string' || !value.document || typeof value.document !== 'object'
      || !('type' in value.document) || value.document.type !== 'DOCUMENT') {
    throw new Error('Unexpected Figma file JSON: expected a file name and a DOCUMENT root node.');
  }
  return value as FigmaFile;
}
