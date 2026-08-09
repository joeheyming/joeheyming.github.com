// @ts-check
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
async function dropPngOn(page, selector) {
  await page.locator(selector).evaluate((el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    const file = new File([bytes], 'screenshot.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      el.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt
        })
      );
    }
  }, TINY_PNG_BASE64);
}

test.describe('Posts', () => {
  test('board and add-note button mount', async ({ page }) => {
    await page.goto('/posts/');
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible();
    await expect(page.getByRole('main', { name: 'Message board' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a note' })).toBeVisible();
    expect(await page.locator('#board-empty').evaluate((el) => el.textContent || '')).toMatch(
      /tap \+ to add/i
    );
  });

  test('plus creates an editable draft note', async ({ page }) => {
    await page.goto('/posts/');
    await page.getByRole('button', { name: 'Add a note' }).click();
    await expect(page.locator('.post.draft')).toHaveCount(1);
    await page.locator('.post.draft textarea').click();
    await page.locator('.post.draft textarea').fill('Kilroy was here');
    await page.locator('.post.draft input[type="text"]').fill('Kilroy');
    await expect(page.getByRole('button', { name: 'Pin' })).toBeVisible();
  });

  test('tapping blank board space pans instead of placing a note', async ({ page }) => {
    await page.goto('/posts/');
    await expect(page.locator('.board-surface')).toHaveAttribute('style', /translate\(/);
    const board = page.locator('#board');
    const box = await board.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.28);
    await expect(page.locator('.post.draft')).toHaveCount(0);
  });

  test('plus drops a note inside the current view', async ({ page }) => {
    await page.goto('/posts/');
    await page.getByRole('button', { name: 'Add a note' }).click();
    const note = page.locator('.post.draft');
    await expect(note).toHaveCount(1);
    const inView = await note.evaluate((el) => {
      const boardEl = document.getElementById('board');
      if (!boardEl) return false;
      const noteRect = el.getBoundingClientRect();
      const boardRect = boardEl.getBoundingClientRect();
      const cx = noteRect.left + noteRect.width / 2;
      const cy = noteRect.top + noteRect.height / 2;
      return (
        cx >= boardRect.left &&
        cx <= boardRect.right &&
        cy >= boardRect.top &&
        cy <= boardRect.bottom
      );
    });
    expect(inView).toBe(true);
  });

  test('board uses grab cursor and grabbing while panning', async ({ page }) => {
    await page.goto('/posts/');
    const board = page.locator('#board');
    await expect(board).toHaveCSS('cursor', 'grab');
    const box = await board.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await expect(board).toHaveClass(/is-panning/);
    await expect(board).toHaveCSS('cursor', 'grabbing');
    await page.mouse.move(box.x + box.width * 0.5 + 40, box.y + box.height * 0.5 + 20, {
      steps: 4
    });
    await page.mouse.up();
    await expect(board).not.toHaveClass(/is-panning/);
    await expect(board).toHaveCSS('cursor', 'grab');
  });

  test('dragging empty cork pans the camera', async ({ page }) => {
    await page.goto('/posts/');
    const board = page.locator('#board');
    const box = await board.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const before = await page.locator('.board-surface').getAttribute('style');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5 + 120, box.y + box.height * 0.5 + 80, {
      steps: 8
    });
    await page.mouse.up();
    const after = await page.locator('.board-surface').getAttribute('style');
    expect(after).not.toEqual(before);
    await expect(page.locator('.post.draft')).toHaveCount(0);
  });

  test('hydrates a cross-app share as a prefilled draft note', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'posts-draft-v1',
        JSON.stringify({
          text: 'Shared from another app',
          email: 'optional@example.com',
          attachments: [],
          createdAt: Date.now()
        })
      );
    });
    await page.goto('/posts/?compose=1');
    await expect(page.locator('#setup-banner')).toBeHidden();
    await expect(page.locator('.post.draft textarea')).toHaveValue('Shared from another app');
    await expect(page.locator('.post.draft input[type="text"]')).toHaveValue(
      'optional@example.com'
    );
  });

  test('attaches a file inside a draft note', async ({ page }) => {
    await page.goto('/posts/');
    await page.getByRole('button', { name: 'Add a note' }).click();
    const tmp = path.join(os.tmpdir(), `posts-e2e-${Date.now()}.png`);
    fs.writeFileSync(
      tmp,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      )
    );
    try {
      await page.locator('#note-file').setInputFiles(tmp);
      await expect(page.locator('.note-thumb img')).toHaveCount(1);
      await expect(page.locator('#board-status')).toHaveText('Attachment added');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('preserves an original PNG when it fits the image budget', async ({ page }) => {
    let formBody = '';
    await page.route('https://docs.google.com/forms/**', async (route) => {
      formBody = route.request().postData() || '';
      await route.fulfill({ status: 204, body: '' });
    });
    await page.goto('/posts/');
    await page.getByRole('button', { name: 'Add a note' }).click();
    await page.locator('#note-file').setInputFiles({
      name: 'screenshot.png',
      mimeType: 'image/png',
      buffer: Buffer.from(TINY_PNG_BASE64, 'base64')
    });
    await page.getByRole('button', { name: 'Pin' }).click();
    await expect(page.locator('#board-status')).toContainText('Pinned');
    expect(new URLSearchParams(formBody).get('entry.103900252')).toBe(
      `data:image/png;base64,${TINY_PNG_BASE64}`
    );
  });

  test('drops a screenshot onto a draft note', async ({ page }) => {
    await page.goto('/posts/');
    await page.getByRole('button', { name: 'Add a note' }).click();
    await dropPngOn(page, '.post.draft');
    await expect(page.locator('.note-thumb img')).toHaveCount(1);
    await expect(page.locator('#board-status')).toHaveText('Attachment added');
  });

  test('drops a screenshot onto the board to start a note', async ({ page }) => {
    await page.goto('/posts/');
    await dropPngOn(page, '#board');
    await expect(page.locator('.post.draft')).toHaveCount(1);
    await expect(page.locator('.note-thumb img')).toHaveCount(1);
    await expect(page.locator('#board-status')).toHaveText('Dropped onto a new note');
  });

  test('previews an audio attachment with playback controls', async ({ page }) => {
    await page.goto('/posts/');
    await page.getByRole('button', { name: 'Add a note' }).click();
    await page.locator('#note-file').setInputFiles({
      name: 'theremin.webm',
      mimeType: 'audio/webm',
      buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
    });
    await expect(page.locator('.note-thumb audio[controls]')).toHaveCount(1);
    await expect(page.locator('#board-status')).toHaveText('Attachment added');
  });

  test('splits large audio across Form responses', async ({ page }) => {
    const formBodies = [];
    await page.route('https://docs.google.com/forms/**', async (route) => {
      formBodies.push(route.request().postData() || '');
      await route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/posts/');
    await page.getByRole('button', { name: 'Add a note' }).click();
    await page.locator('.post.draft textarea').fill('Complete Theremin recording');
    await page.locator('#note-file').setInputFiles({
      name: 'theremin.webm',
      mimeType: 'audio/webm',
      buffer: Buffer.alloc(9000, 0x42)
    });
    await page.getByRole('button', { name: 'Pin' }).click();
    await expect(page.locator('#board-status')).toContainText('Pinned');

    const pinBodies = formBodies.filter((body) =>
      Boolean(new URLSearchParams(body).get('entry.103900252'))
    );
    expect(pinBodies.length).toBeGreaterThan(1);
    const attachmentValues = pinBodies.map(
      (body) => new URLSearchParams(body).get('entry.103900252') || ''
    );
    expect(attachmentValues.every((value) => value.startsWith('posts-attachment-chunk-v1|'))).toBe(
      true
    );
    expect(new URLSearchParams(pinBodies[0]).get('entry.947783301')).toBe(
      'Complete Theremin recording'
    );
    const metadata = JSON.parse(new URLSearchParams(pinBodies[0]).get('entry.53437001') || '{}');
    expect(metadata.action).toBe('post');
    expect(metadata.id).toMatch(/^post-/);
    expect(metadata.x).toBeGreaterThan(0);
    expect(metadata.y).toBeGreaterThan(0);
  });

  test('keeps a higher-quality image and splits it across Form responses', async ({ page }) => {
    const formBodies = [];
    await page.route('https://docs.google.com/forms/**', async (route) => {
      formBodies.push(route.request().postData() || '');
      await route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/posts/');
    await page.getByRole('button', { name: 'Add a note' }).click();
    await page.locator('#note-file').evaluate(async (input) => {
      if (!(input instanceof HTMLInputElement)) throw new Error('file input missing');
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 640;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas context missing');
      const pixels = ctx.createImageData(canvas.width, canvas.height);
      let seed = 123456789;
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        pixels.data[i] = seed & 255;
        pixels.data[i + 1] = (seed >>> 8) & 255;
        pixels.data[i + 2] = (seed >>> 16) & 255;
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG failed'))));
      });
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'photo.png', { type: 'image/png' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('.note-thumb img')).toHaveCount(1);
    await page.locator('.post.draft textarea').fill('Detailed image');
    await page.getByRole('button', { name: 'Pin' }).click();
    await expect(page.locator('#board-status')).toContainText('Pinned');

    const pinBodies = formBodies.filter((body) =>
      Boolean(new URLSearchParams(body).get('entry.103900252'))
    );
    expect(pinBodies.length).toBeGreaterThan(1);
    const attachmentValues = pinBodies.map(
      (body) => new URLSearchParams(body).get('entry.103900252') || ''
    );
    expect(attachmentValues.every((value) => value.startsWith('posts-attachment-chunk-v1|'))).toBe(
      true
    );
    const reconstructed = attachmentValues
      .map((value) => value.split('|').slice(4).join('|'))
      .join('');
    expect(reconstructed).toMatch(/^data:image\/(?:webp|jpeg);base64,/);
    expect(reconstructed.length).toBeGreaterThan(10000);
  });

  test('reassembles audio chunks from Sheet rows', async ({ page }) => {
    const dataUrl = `data:audio/webm;base64,${Buffer.alloc(9000, 0x42).toString('base64')}`;
    const pieces = [];
    for (let offset = 0; offset < dataUrl.length; offset += 5000) {
      pieces.push(dataUrl.slice(offset, offset + 5000));
    }
    const rows = pieces.map((piece, index) => ({
      c: [
        { v: `Date(2026,6,23,20,0,${index})` },
        { v: index === 0 ? 'Complete Theremin recording' : '' },
        { v: `posts-attachment-chunk-v1|test-audio|${index}|${pieces.length}|${piece}` },
        { v: '' },
        { v: '' }
      ]
    }));
    const response = {
      table: {
        cols: ['Timestamp', 'Text', 'Attachment', 'Email', 'Honeypot'].map((label) => ({ label })),
        rows
      }
    };
    await page.route('https://docs.google.com/spreadsheets/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `google.visualization.Query.setResponse(${JSON.stringify(response)});`
      });
    });

    await page.goto('/posts/');
    await expect(page.locator('.post audio')).toHaveAttribute('src', dataUrl);
    await expect(page.locator('.post-body')).toContainText('Complete Theremin recording');
    await expect(page.locator('.post')).toHaveCSS('position', 'absolute');
  });

  test('anyone can take a note down through a removal action', async ({ page }) => {
    const response = {
      table: {
        cols: ['Timestamp', 'Text', 'Attachment', 'Name', 'Metadata', 'Honeypot'].map((label) => ({
          label
        })),
        rows: [
          {
            c: [
              { v: 'Date(2026,6,23,20,0,0)' },
              { v: 'Lost dog — call if found' },
              { v: '' },
              { v: 'Kilroy' },
              { v: JSON.stringify({ id: 'post-lost-dog', action: 'post', x: 0.3, y: 0.4 }) },
              { v: '' }
            ]
          }
        ]
      }
    };
    await page.route('https://docs.google.com/spreadsheets/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `google.visualization.Query.setResponse(${JSON.stringify(response)});`
      });
    });
    let removalMetadata = '';
    await page.route('https://docs.google.com/forms/**', async (route) => {
      removalMetadata =
        new URLSearchParams(route.request().postData() || '').get('entry.53437001') || '';
      await route.fulfill({ status: 204, body: '' });
    });
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/posts/');
    await expect(page.locator('.post')).toContainText('Lost dog');
    await page.getByRole('button', { name: 'Take this note down' }).click();
    await expect(page.locator('.post')).toHaveCount(0);
    expect(JSON.parse(removalMetadata)).toEqual({
      action: 'remove',
      targetId: 'post-lost-dog'
    });
  });

  test('pointer and keyboard moves persist public move actions', async ({ page }) => {
    const response = {
      table: {
        cols: ['Timestamp', 'Text', 'Attachment', 'Name', 'Metadata', 'Honeypot'].map((label) => ({
          label
        })),
        rows: [
          {
            c: [
              { v: 'Date(2026,6,23,20,0,0)' },
              { v: 'Move me' },
              { v: '' },
              { v: 'Kilroy' },
              { v: JSON.stringify({ id: 'post-move-me', action: 'post', x: 0.2, y: 0.25 }) },
              { v: '' }
            ]
          },
          {
            c: [
              { v: 'Date(2026,6,23,20,1,0)' },
              { v: '' },
              { v: '' },
              { v: '' },
              {
                v: JSON.stringify({
                  action: 'move',
                  targetId: 'post-move-me',
                  x: 0.65,
                  y: 0.7
                })
              },
              { v: '' }
            ]
          }
        ]
      }
    };
    await page.route('https://docs.google.com/spreadsheets/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `google.visualization.Query.setResponse(${JSON.stringify(response)});`
      });
    });
    let moveMetadata = '';
    await page.route('https://docs.google.com/forms/**', async (route) => {
      moveMetadata =
        new URLSearchParams(route.request().postData() || '').get('entry.53437001') || '';
      await route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/posts/');
    const note = page.locator('[data-post-id="post-move-me"]');
    await expect(note).toHaveAttribute('style', /left: 65%;/);
    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 60, {
      steps: 5
    });
    await page.mouse.up();

    await expect(page.locator('#board-status')).toHaveText('Note moved');
    const metadata = JSON.parse(moveMetadata);
    expect(metadata.action).toBe('move');
    expect(metadata.targetId).toBe('post-move-me');
    expect(metadata.x).toBeLessThan(0.65);
    expect(metadata.y).toBeLessThan(0.7);

    moveMetadata = '';
    await expect(note).toHaveAttribute('tabindex', '0');
    await note.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => moveMetadata).not.toBe('');
    const keyboardMetadata = JSON.parse(moveMetadata);
    expect(keyboardMetadata.action).toBe('move');
    expect(keyboardMetadata.targetId).toBe('post-move-me');
    expect(keyboardMetadata.x).toBeGreaterThan(metadata.x);
  });

  test('keeps newest notes on the board and archives the rest', async ({ page }) => {
    const cols = ['Timestamp', 'Text', 'Attachment', 'Name', 'Metadata', 'Honeypot'].map(
      (label) => ({ label })
    );
    const rows = Array.from({ length: 26 }, (_, index) => ({
      c: [
        { v: `Date(2026,7,8,12,0,${index})` },
        { v: `Note number ${index + 1}` },
        { v: '' },
        { v: '' },
        {
          v: JSON.stringify({
            id: `post-scale-${index + 1}`,
            action: 'post',
            x: 0.2 + (index % 5) * 0.12,
            y: 0.2 + Math.floor(index / 5) * 0.12
          })
        },
        { v: '' }
      ]
    }));
    await page.route('https://docs.google.com/spreadsheets/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `google.visualization.Query.setResponse(${JSON.stringify({
          table: { cols, rows }
        })});`
      });
    });

    await page.goto('/posts/');
    await expect(page.locator('#board .post')).toHaveCount(24);
    await expect(page.getByRole('button', { name: 'Older (2)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Newest' })).toBeVisible();

    await page.getByRole('button', { name: 'Older (2)' }).click();
    await expect(page.locator('#archive-panel')).toBeVisible();
    await expect(page.locator('.archive-item')).toHaveCount(2);
    await expect(page.locator('[data-archive-id="post-scale-1"]')).toContainText('Note number 1');

    await page.getByRole('button', { name: 'Newest' }).click();
    await expect(page.locator('#archive-panel')).toBeHidden();
    const newest = page.locator('[data-post-id="post-scale-26"]');
    await expect(newest).toBeVisible();
    await expect(newest).toHaveClass(/is-flash/);
  });
});
