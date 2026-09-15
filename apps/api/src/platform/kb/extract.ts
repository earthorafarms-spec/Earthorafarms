/** Content extraction for uploaded files and crawled pages. */
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

export function htmlToText(html: string, url?: string): { title: string; text: string } {
  const dom = new JSDOM(html, { url });
  try {
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article?.content) {
      const md = turndown.turndown(article.content);
      return { title: (article.title || dom.window.document.title || '').trim(), text: md.trim() };
    }
  } catch { /* fall through */ }
  const body = dom.window.document.body?.textContent || '';
  return { title: (dom.window.document.title || '').trim(), text: body.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() };
}

export async function extractFile(buf: Buffer, mime: string, filename: string): Promise<{ title: string; text: string }> {
  const name = filename.replace(/\.[a-z0-9]+$/i, '');
  if (mime.includes('pdf') || filename.endsWith('.pdf')) {
    const pdf = (await import('pdf-parse')).default as (b: Buffer) => Promise<{ text: string }>;
    const res = await pdf(buf);
    return { title: name, text: res.text.replace(/\n{3,}/g, '\n\n').trim() };
  }
  if (mime.includes('word') || filename.endsWith('.docx')) {
    const mammoth: any = await import('mammoth');
    const res = await (mammoth.convertToMarkdown ? mammoth.convertToMarkdown({ buffer: buf }) : mammoth.default.convertToHtml({ buffer: buf }));
    return { title: name, text: res.value.trim() };
  }
  if (mime.includes('sheet') || filename.endsWith('.xlsx') || filename.endsWith('.csv')) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const parts: string[] = [];
    for (const sheet of wb.SheetNames) parts.push(`## ${sheet}\n\n${XLSX.utils.sheet_to_csv(wb.Sheets[sheet])}`);
    return { title: name, text: parts.join('\n\n') };
  }
  if (mime.includes('html') || filename.endsWith('.html')) return htmlToText(buf.toString('utf8'));
  return { title: name, text: buf.toString('utf8').trim() };
}
