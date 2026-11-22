// Android lifecycle glue: hardware back button, pause/resume, splash hide.
//
//   import { native } from './lib/native.js';
//   await native.init();                       // once, at startup
//   native.onBack(() => { if (menuOpen) { closeMenu(); return true; } return false; });
//   native.onPause(() => game.pauseGame());    // app sent to background
//   native.onResume(() => {});
//   native.hideSplash();                       // when the first screen is drawn
//
// Back-button handlers form a stack: the most recently added handler runs first;
// return true to say "handled". If nothing handles it, the app asks to exit
// via `confirmExit` (default: a second press within 2s exits).
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

const isNative = Capacitor.isNativePlatform();
const backStack = [];
const pauseFns = [];
const resumeFns = [];
let lastBack = 0;

export const native = {
  isNative,
  confirmExit: null, // optional: () => Promise<boolean> to show your own "Quit?" dialog
  toast: null,       // optional: (msg) => void, used for "Press back again to exit"

  async init() {
    if (!isNative) {
      document.addEventListener('visibilitychange', () => (document.hidden ? pauseFns : resumeFns).forEach(f => f()));
      return;
    }
    App.addListener('backButton', () => this.handleBack());
    App.addListener('pause', () => pauseFns.forEach(f => f()));
    App.addListener('resume', () => resumeFns.forEach(f => f()));
  },

  // Runs the top back handler; returns true if something handled it.
  tryBack() {
    for (let i = backStack.length - 1; i >= 0; i--) if (backStack[i]()) return true;
    return false;
  },

  async handleBack() {
    for (let i = backStack.length - 1; i >= 0; i--) if (backStack[i]()) return;
    if (this.confirmExit) { if (await this.confirmExit()) App.exitApp(); return; }
    const now = Date.now();
    if (now - lastBack < 2000) { if (isNative) App.exitApp(); return; }
    lastBack = now;
    this.toast?.('Press back again to exit');
  },

  onBack(fn) { backStack.push(fn); return () => { const i = backStack.indexOf(fn); if (i >= 0) backStack.splice(i, 1); }; },
  onPause(fn) { pauseFns.push(fn); },
  onResume(fn) { resumeFns.push(fn); },
  hideSplash() { /* web build: no native splash */ }
};
