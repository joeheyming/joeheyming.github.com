import assert from 'node:assert/strict';
import { it } from 'node:test';
import { JSDOM } from 'jsdom';
import { dockEmulatorChat } from '../emulator/live-chat-mount.js';

it('places the chat chip immediately left of Share', () => {
  const { window } = new JSDOM(`
    <div class="share-overlay"><share-button></share-button></div>
    <div class="live-chat"></div>
  `);
  dockEmulatorChat(window.document);
  const overlay = window.document.querySelector('.share-overlay');
  assert.equal(overlay.firstElementChild.className, 'live-chat');
  assert.equal(overlay.children[1].tagName, 'SHARE-BUTTON');
});
