import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SwStatusService {

  swActive = signal(false);
  wasmCached = signal(false);
  online = signal(navigator.onLine);

  constructor() {
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }

  async checkServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      this.swActive.set(false);
      return;
    }

    const reg = await navigator.serviceWorker.getRegistration();
    this.swActive.set(!!reg);
  }

  async checkWasmCache(url: string) {
    if (!('caches' in window)) {
      this.wasmCached.set(false);
      return;
    }

    const names = await caches.keys();

    for (const name of names) {
      const cache = await caches.open(name);
      const match = await cache.match(url);

      if (match) {
        this.wasmCached.set(true);
        return;
      }
    }

    this.wasmCached.set(false);
  }
}
