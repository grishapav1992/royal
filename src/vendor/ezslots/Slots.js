/**
 * EZSlotsJS by Botman64 (https://github.com/Botman64/EZSlotsJS).
 * Copyright Botman64. Licensed under the Apache License, Version 2.0.
 * License and attribution: /licenses/ezslots/LICENSE.txt and NOTICE.txt.
 * Modified for Royal on 2026-10-08: ES module, async server-result callback,
 * external wallet controls, instance-scoped theme, cancellation, accessibility,
 * deterministic decoration, and reduced motion. Original reel-strip animation retained.
 */
let nextInstance = 0;
class SlotMachine {
  constructor(container, options = {}) {
    this.container = (typeof container === 'string') ? document.querySelector(container) : container;
    if (!this.container) throw new Error('Parent container not found');
    this.config = {
      reelCount: options.reelCount || 5,
      maxBet: options.maxBet || 100,
      minBet: options.minBet || 1,
      betIncrement: options.betIncrement || 1,
      logoUrl: '',
      symbols: options.symbols || SlotMachine.defaultSymbols,
      theme: options.theme || SlotMachine.defaultThemes.cartoon,
      onLeave: options.onLeave || null,
      reducedMotion: options.reducedMotion || false
    };
    this.currentBet = this.config.minBet;
    this.allSymbols = Object.keys(this.config.symbols);
    this.spinCallback = null;
    this.spinFinishedCallback = null;
    this.instanceId = 'slots-' + (++nextInstance);
    this.destroyed = false;
    this.requestingSpin = false;
    this.spinEpoch = 0;
    this.timers = new Set();
    this.finishAnimation = null;

    this._createHTML();
    this._applyTheme();
    this._generateReels();
    this._initializeReels();
    this._bindEvents();
  }
  IncreaseBet() {
    if (this.currentBet < this.config.maxBet) {
      this.currentBet = Math.min(this.currentBet + this.config.betIncrement, this.config.maxBet);
      this._updateBetDisplay();
    }
  }
  DecreaseBet() {
    if (this.currentBet > this.config.minBet) {
      this.currentBet = Math.max(this.currentBet - this.config.betIncrement, this.config.minBet);
      this._updateBetDisplay();
    }
  }
  MaxBet() {
    this.currentBet = this.config.maxBet;
    this._updateBetDisplay();
  }
  async Spin() {
    if (this.destroyed || this.requestingSpin || this.isSpinning || !this.spinCallback) return false;
    const epoch = this.spinEpoch;
    this.requestingSpin = true;
    try {
      const results = await this.spinCallback(this.currentBet);
      if (this.destroyed || epoch !== this.spinEpoch || !Array.isArray(results)) return false;
      await this._spin(results);
      return !this.destroyed && epoch === this.spinEpoch;
    } finally {
      if (epoch === this.spinEpoch) this.requestingSpin = false;
    }
  }
  SetBet(amount) {
    if (this.requestingSpin || this.isSpinning) return;
    this.currentBet = amount;
    this._updateBetDisplay();
  }
  SetResult(results) {
    if (this.destroyed) return;
    const reels = this.container.querySelectorAll(`.${this.instanceId}-reel`);
    reels.forEach((reel, reelIndex) => {
      const strip = reel.querySelector(`.${this.instanceId}-reel-strip`);
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0px)';
      strip.innerHTML = results[reelIndex].map((symbol, row) => this._getSymbolHtml(symbol, undefined, row)).join('');
    });
  }
  Remove() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.CancelSpin();
    this.container.innerHTML = '';
    if (typeof this.config.onLeave === 'function') this.config.onLeave();
  }
  CancelSpin() {
    this.spinEpoch++;
    this.requestingSpin = false;
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    if (this.finishAnimation) this.finishAnimation();
    this.isSpinning = false;
    this.container.querySelectorAll(`.${this.instanceId}-reel`).forEach(reel => reel.classList.remove('spinning'));
    this.container.querySelectorAll(`.${this.instanceId}-win-line`).forEach(line => line.remove());
  }
  _schedule(callback, delay) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.destroyed) callback();
    }, delay);
    this.timers.add(timer);
  }
  _spin(results) {
    if (this.destroyed || this.isSpinning || !results) return Promise.resolve();
    if (this.config.reducedMotion) {
      this.SetResult(results);
      if (this.spinFinishedCallback) this.spinFinishedCallback();
      return Promise.resolve();
    }
    this.isSpinning = true;
    return new Promise(resolve => {
      this.finishAnimation = () => { this.isSpinning = false; this.finishAnimation = null; resolve(); };
      const reels = this.container.querySelectorAll(`.${this.instanceId}-reel`);
      reels.forEach((reel, reelIndex) => {
        const strip = reel.querySelector(`.${this.instanceId}-reel-strip`);
        const finalSymbols = results[reelIndex];
        reel.classList.add('spinning');
        const currentSymbols = [];
        const currentElements = strip.querySelectorAll(`.${this.instanceId}-symbol`);
        Array.from(currentElements).slice(-3).forEach(el => {
          currentSymbols.push(this._getSymbolHtml(el.dataset.symbol));
        });
        strip.innerHTML = '';
        currentSymbols.forEach(symbolHtml => strip.insertAdjacentHTML('beforeend', symbolHtml));
        const totalSpinSymbols = 20;
        for (let i = 0; i < totalSpinSymbols; i++) {
          // Intermediate symbols are decoration only. The server supplies all final symbols.
          const symbol = this.allSymbols[(i + reelIndex) % this.allSymbols.length];
          strip.insertAdjacentHTML('beforeend', this._getSymbolHtml(symbol, `${this.instanceId}-symbol spinning-symbol`));
        }
        finalSymbols.forEach((symbol, row) => strip.insertAdjacentHTML('beforeend', this._getSymbolHtml(symbol, `${this.instanceId}-symbol final-symbol`, row)));
        strip.offsetHeight;
        const symbolHeight = strip.querySelector(`.${this.instanceId}-symbol`)?.offsetHeight || 120;
        const totalSymbols = 3 + totalSpinSymbols + 3;
        const finalPosition = -((totalSymbols - 3) * symbolHeight);
        strip.style.transform = 'translateY(0px)';
        strip.style.transition = 'none';
        this._schedule(() => {
          const duration = 2 + reelIndex * 0.2;
          strip.style.transition = `transform ${duration}s cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
          strip.style.transform = `translateY(${finalPosition}px)`;
          this._schedule(() => {
            reel.classList.remove('spinning');
            strip.style.transform = `translateY(${finalPosition}px)`;
            strip.style.transition = 'none';
          }, duration * 1000 + 100);
          if (reelIndex === reels.length - 1) {
            this._schedule(() => {
              this.SetResult(results);
              this._checkForWins(results);
              if (this.spinFinishedCallback) this.spinFinishedCallback();
              if (this.finishAnimation) this.finishAnimation();
            }, duration * 1000 + 500);
          }
        }, 100 + reelIndex * 50);
      });
    });
  }
  _createHTML() {
    const instanceId = this.instanceId;

    const html = `
      <style>
        /* Fonts are provided locally by the Royal application. */

        .${instanceId}-container {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          height: 100%;
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          position: relative;
          overflow: hidden;
          background: transparent;
          container-type: size;
        }

        .${instanceId}-main-container {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          background: var(--surface-primary);
          border: 1px solid var(--border-primary);
          border-radius: 1.25em;
          backdrop-filter: blur(20px);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border-glow);
          z-index: 5;
        }

        .${instanceId}-header {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          padding: clamp(0.5em, 2.5vw, 2em) clamp(1em, 3vw, 2em);
          background: var(--surface-secondary);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid var(--border-primary);
          border-radius: 1.25em 1.25em 0 0;
          z-index: 10;
          position: relative;
          overflow: visible;
          min-height: calc(2.5em + 6vw); /* Ensures enough height for the logo */
          height: auto;
          gap: clamp(0.5em, 2vw, 1em);
        }

        .${instanceId}-logo-section {
          display: flex;
          align-items: center;
          justify-content: center;
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          z-index: 15;
          height: 100%;
          pointer-events: none;
        }

        .${instanceId}-logo {
          height: clamp(3em, 14vw, 8em);
          max-height: 95%;
          width: auto;
          position: relative;
          z-index: 15;
          filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
          transition: transform 0.3s ease;
        }

        .${instanceId}-logo:hover {
          transform: scale(1.05);
        }

        .${instanceId}-balance-section {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          flex: 0 0 auto;
        }

        .${instanceId}-balance {
          background: var(--accent-gradient);
          color: var(--text-on-accent);
          padding: clamp(0.5em, 1.2%, 1em) clamp(0.8em, 2%, 1.5em);
          border-radius: clamp(0.3em, 8%, 0.8em);
          font-weight: 600;
          font-size: clamp(0.7rem, 2cqw, 1.2rem);
          box-shadow: 0 4px 12px var(--accent-shadow);
          text-shadow: none;
          white-space: nowrap;
        }

        .${instanceId}-lobby-section {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex: 0 0 auto;
        }

        .${instanceId}-lobby-btn {
          padding: clamp(0.5em, 1.2%, 1em) clamp(0.8em, 2%, 1.5em);
          border: 1px solid var(--border-accent);
          border-radius: 0.5em !important;
          background: var(--surface-accent);
          color: var(--text-accent);
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          font-size: clamp(0.7rem, 2cqw, 1.2rem);
          cursor: pointer;
          transition: all 0.2s ease;
          text-transform: uppercase;
          backdrop-filter: blur(10px);
          box-shadow: 0 4px 12px var(--accent-shadow);
          white-space: nowrap;
        }

        .${instanceId}-lobby-btn:hover {
          background: var(--accent-color);
          color: var(--text-on-accent);
          transform: translateY(-1px);
          box-shadow: 0 8px 25px var(--accent-shadow);
        }

        .${instanceId}-main-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 2%;
          gap: 2%;
          position: relative;
          z-index: 5;
          height: 0;
        }

        .${instanceId}-reels-container {
          flex: 1;
          background: linear-gradient(145deg, #1a1a2e 0%, #16213e 100%);
          border: 2px solid var(--border-secondary);
          border-radius: 1em;
          padding: 2.5%;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: inset 0 4px 12px rgba(0, 0, 0, 0.3), 0 8px 32px rgba(0, 0, 0, 0.15);
          height: 70%;
        }

        .${instanceId}-reels {
          display: flex;
          justify-content: center;
          gap: 0.5%;
          height: 100%;
          width: 100%;
          align-items: center;
          background: rgba(0, 0, 0, 0.4);
          padding: 2%;
          border-radius: 0.75em;
          position: relative;
        }

        .${instanceId}-reel {
          background: var(--surface-tertiary);
          border: 1px solid var(--border-secondary);
          border-radius: 0.5em;
          overflow: hidden;
          position: relative;
          width: calc((100% - (0.5% * (var(--reel-count, 5) - 1))) / var(--reel-count, 5));
          height: 100%;
          aspect-ratio: 1 / 3;
          display: flex;
          flex-direction: column;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 var(--border-highlight);
        }

        .${instanceId}-reel:not(:last-child)::after {
          content: '';
          position: absolute;
          top: 0;
          right: -1px;
          width: 2px;
          height: 100%;
          background: linear-gradient(to bottom, transparent 0%, var(--border-primary) 50%, transparent 100%);
          z-index: 1;
        }

        .${instanceId}-reel-strip {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          transition: transform 0.1s ease-out;
        }

        .${instanceId}-symbol {
          height: calc(100% / 3);
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: clamp(1rem, 4cqw, 3rem);
          border-bottom: 1px solid var(--border-secondary);
          background: var(--symbol-gradient);
          position: relative;
          flex-shrink: 0;
        }

        .${instanceId}-symbol img {
          width: 80%;
          height: 80%;
          object-fit: contain;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
        }

        .${instanceId}-symbol:nth-child(odd) {
          background: var(--symbol-gradient-alt);
        }

        .${instanceId}-symbol:nth-child(2) {
          background: var(--symbol-gradient-highlight);
          border-top: 2px solid var(--accent-color);
          border-bottom: 2px solid var(--accent-color);
          box-shadow: 0 0 20px var(--accent-shadow);
          position: relative;
          z-index: 2;
        }

        .${instanceId}-controls {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          justify-content: center;
          align-items: center;
          background: var(--surface-secondary);
          border-top: 1px solid var(--border-primary);
          border-radius: 0 0 1.25em 1.25em;
          padding: clamp(0.3em, 1vw, 0.8em) clamp(1em, 3vw, 2em);
          backdrop-filter: blur(15px);
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.1);
          gap: clamp(0.8em, 3vw, 2em);
          min-height: clamp(2.5em, 6vw, 4em);
        }

        .${instanceId}-bet-section {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: clamp(0.3em, 1vw, 0.6em);
          margin-right: clamp(1em, 2vw, 2em);
        }

        .${instanceId}-spin-section {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: clamp(0.3em, 1vw, 0.6em);
        }

        .${instanceId}-bet-label {
          color: var(--text-secondary);
          font-size: clamp(0.5rem, 1.2cqw, 0.8rem);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: clamp(0.1em, 0.5%, 0.3em);
          white-space: nowrap;
        }

        .${instanceId}-bet-controls {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: clamp(0.5em, 2%, 1em);
        }

        .${instanceId}-bet-display {
          background: var(--surface-tertiary);
          color: var(--text-primary);
          padding: clamp(0.5em, 1.5%, 1em) clamp(0.8em, 2%, 1.2em);
          border-radius: 0.5em;
          border: 1px solid var(--border-secondary);
          font-weight: 600;
          font-size: clamp(0.7rem, 1.8cqw, 1.1rem);
          min-width: clamp(3em, 15%, 6em);
          text-align: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          white-space: nowrap;
        }

        .${instanceId}-bet-btn {
          background: var(--accent-gradient);
          color: var(--text-on-accent);
          border: none;
          padding: clamp(0.5em, 1.2%, 1em) clamp(0.8em, 2%, 1.2em);
          border-radius: 0.5em !important;
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          font-size: clamp(0.6rem, 1.5cqw, 1rem);
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px var(--accent-shadow);
          min-width: clamp(2em, 8%, 3em);
          aspect-ratio: 1;
        }

        .${instanceId}-bet-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px var(--accent-shadow);
        }

        .${instanceId}-spin-section {
          display: flex;
          align-items: center;
          gap: clamp(0.3em, 1%, 0.6em);
          flex-direction: column;
        }

        .${instanceId}-control-buttons {
          display: flex;
          flex-direction: row;
          gap: clamp(0.5em, 2%, 1em);
          align-items: center;
        }

        .${instanceId}-control-btn {
          padding: clamp(0.5em, 1.5%, 1em) clamp(1em, 2.5%, 1.5em);
          border: 1px solid var(--border-accent);
          border-radius: 0.5em !important;
          font-family: 'Inter', sans-serif;
          font-weight: 500;
          font-size: clamp(0.6rem, 1.5cqw, 1rem);
          cursor: pointer;
          transition: all 0.2s ease;
          text-transform: uppercase;
          background: var(--surface-accent);
          color: var(--text-accent);
          backdrop-filter: blur(10px);
          white-space: nowrap;
        }

        .${instanceId}-control-btn:hover {
          background: var(--accent-color);
          color: var(--text-on-accent);
          transform: translateY(-1px);
          box-shadow: 0 8px 25px var(--accent-shadow);
        }

        .${instanceId}-spin-btn {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          font-size: clamp(0.8rem, 2.2cqw, 1.4rem);
          font-weight: 600;
          padding: clamp(0.8em, 2%, 1.2em) clamp(1.5em, 4%, 2.5em);
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-radius: 0.75em !important;
          position: relative;
          overflow: hidden;
          transition: all 0.2s ease;
          box-shadow: 0 8px 25px rgba(16, 185, 129, 0.3);
          cursor: pointer;
          white-space: nowrap;
          min-width: 7em;
          padding-left: 2.5em;
          padding-right: 2.5em;
        }

        .${instanceId}-spin-btn:disabled {
          background: linear-gradient(135deg, #6b7280, #4b5563);
          border-color: #6b7280;
          cursor: not-allowed;
          opacity: 0.7;
          box-shadow: none;
        }

        .${instanceId}-spinning {
          animation: ${instanceId}-spin-glow 0.5s ease-in-out infinite alternate;
        }

        @keyframes ${instanceId}-spin-glow {
          from { box-shadow: 0 8px 25px rgba(16, 185, 129, 0.3); }
          to { box-shadow: 0 8px 35px rgba(16, 185, 129, 0.6); }
        }

        .${instanceId}-win-line {
          position: absolute;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(90deg, transparent, var(--accent-color), transparent);
          animation: ${instanceId}-win-pulse 1s ease-in-out infinite;
          z-index: 3;
          box-shadow: 0 0 15px var(--accent-color);
          border-radius: 2px;
        }

        @keyframes ${instanceId}-win-pulse {
          0%, 100% {
            opacity: 0.5;
            transform: scaleY(1);
          }
          50% {
            opacity: 1;
            transform: scaleY(1.5);
          }
        }

        @container (aspect-ratio < 1.2) {
          .${instanceId}-header {
            padding: clamp(0.2em, 1%, 0.6em) clamp(0.8em, 2%, 1.5em);
            gap: clamp(0.3em, 1.5%, 0.8em);
          }

          .${instanceId}-logo {
            height: clamp(1.8em, 4.5%, 3em);
          }

          .${instanceId}-balance, .${instanceId}-lobby-btn {
            font-size: clamp(0.6rem, 1.8cqw, 1rem);
            padding: clamp(0.4em, 1%, 0.8em) clamp(0.6em, 1.5%, 1.2em);
          }

          .${instanceId}-controls {
            flex-direction: column;
            align-items: stretch;
            gap: clamp(0.6em, 1.8%, 1.2em);
            padding: clamp(0.2em, 1%, 0.6em) clamp(0.8em, 2%, 1.5em);
            text-align: center;
          }

          .${instanceId}-reels {
            gap: 0.8%;
          }

          .${instanceId}-main-content {
            height: 65%;
          }

          .${instanceId}-reels-container {
            height: 60%;
          }
        }

        @container (aspect-ratio < 0.8) {
          .${instanceId}-main-container {
            border-width: 1px;
          }

          .${instanceId}-reels {
            gap: 1%;
          }

          .${instanceId}-header {
            padding: clamp(0.2em, 0.8%, 0.5em) clamp(0.6em, 1.8%, 1em);
            gap: clamp(0.2em, 1%, 0.5em);
            flex-wrap: wrap;
          }

          .${instanceId}-controls {
            padding: clamp(0.2em, 0.8%, 0.5em) clamp(0.6em, 1.8%, 1em);
            gap: clamp(0.4em, 1.2%, 0.8em);
          }

          .${instanceId}-logo {
            height: clamp(1.5em, 3.5%, 2.5em);
          }

          .${instanceId}-balance, .${instanceId}-lobby-btn {
            font-size: clamp(0.5rem, 1.5cqw, 0.9rem);
            padding: clamp(0.3em, 0.8%, 0.6em) clamp(0.5em, 1.2%, 1em);
          }

          .${instanceId}-main-content {
            height: 60%;
          }

          .${instanceId}-reels-container {
            height: 55%;
          }

          .${instanceId}-bet-section {
            flex-direction: row;
            gap: clamp(0.2em, 0.8%, 0.4em);
          }

          .${instanceId}-bet-label {
            margin-bottom: 0;
            margin-right: clamp(0.2em, 0.8%, 0.4em);
          }
        }
      </style>

      <div class="${instanceId}-container">
        <div class="${instanceId}-main-container">
          <div class="${instanceId}-main-content ezslots-main-content">
            <div class="${instanceId}-reels-container ezslots-reels-container">
              <div class="${instanceId}-reels" id="${instanceId}-reels-container"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.instanceId = instanceId;
    this.container.innerHTML = html;
  }
  _applyTheme() {
    const theme = this.config.theme;
    Object.entries(theme).forEach(([property, value]) => this.container.style.setProperty(property, value));
  }
  _generateReels() {
    const container = this.container.querySelector(`#${this.instanceId}-reels-container`);
    container.innerHTML = '';

    const reelsWrapper = this.container.querySelector(`.${this.instanceId}-reels`);
    if (reelsWrapper) {
      reelsWrapper.style.setProperty('--reel-count', this.config.reelCount);
    }

    for (let i = 0; i < this.config.reelCount; i++) {
      const reelHtml = `<div class="${this.instanceId}-reel ezslots-reel" data-reel="${i}" style="--reel-count: ${this.config.reelCount};"><div class="${this.instanceId}-reel-strip"></div></div>`;
      container.insertAdjacentHTML('beforeend', reelHtml);
    }
  }
  _initializeReels() {
    const reels = this.container.querySelectorAll(`.${this.instanceId}-reel`);
    reels.forEach((reel, reelIndex) => {
      const strip = reel.querySelector(`.${this.instanceId}-reel-strip`);
      strip.innerHTML = '';

      for (let i = 0; i < 3; i++) {
        const symbol = this.allSymbols[(i + reelIndex) % this.allSymbols.length];
        strip.insertAdjacentHTML('beforeend', this._getSymbolHtml(symbol, undefined, i));
      }
    });
  }
  _getSymbolHtml(symbolName, className = `${this.instanceId}-symbol`, row) {
    const symbolValue = this.config.symbols[symbolName];
    // Royal symbols are text. Treat even URL or HTML-looking values as inert text.
    const element = document.createElement('div');
    element.className = `${className} ezslots-symbol`;
    element.dataset.symbol = String(symbolName);
    if (row !== undefined) element.dataset.row = String(row);
    element.setAttribute('aria-hidden', 'true');
    element.textContent = typeof symbolValue === 'string' ? symbolValue : '';
    return element.outerHTML;
  }
  _bindEvents() {
    // Royal provides its own accessible wallet controls outside the reel stage.
  }
  _updateBetDisplay() {
    const betDisplay = this.container?.querySelector(`#${this.instanceId}-bet-amount`);
    if (betDisplay) betDisplay.textContent = this.currentBet.toLocaleString();
  }
  _checkForWins(results) {
    const middleRow = results.map(reel => reel[1]);
    if (middleRow.every(symbol => symbol === middleRow[0])) this._showWinAnimation();
  }
  _showWinAnimation() {
    const reelsContainer = this.container.querySelector(`.${this.instanceId}-reels-container`);
    const winLine = document.createElement('div');
    winLine.className = `${this.instanceId}-win-line`;
    winLine.style.top = '50%';
    reelsContainer.appendChild(winLine);

    this._schedule(() => {
      if (winLine.parentNode) winLine.parentNode.removeChild(winLine);
    }, 4000);
  }

  SpinPressed(callback) {
    this.spinCallback = callback;
    return this;
  }

  SpinFinished(callback) {
    this.spinFinishedCallback = callback;
    return this;
  }

  MachineLeft(callback) {
    this.config.onLeave = callback;
    return this;
  }
}

SlotMachine.defaultThemes = {
  cartoon: {
    '--background': 'linear-gradient(135deg, #2a2d3a 0%, #3d4159 50%, #4a5478 100%)',
    '--surface-primary': 'rgba(45, 52, 78, 0.95)',
    '--surface-secondary': 'rgba(55, 62, 88, 0.9)',
    '--surface-tertiary': 'rgba(65, 72, 98, 0.85)',
    '--surface-accent': 'rgba(255, 107, 107, 0.12)',
    '--text-primary': '#f1f3f5',
    '--text-secondary': '#c9cdd4',
    '--text-accent': '#ff6b8a',
    '--text-on-accent': '#1a1d23',
    '--accent-color': '#ff6b8a',
    '--accent-light': '#ff8fa3',
    '--accent-dark': '#e74c71',
    '--accent-gradient': 'linear-gradient(135deg, #ff6b8a, #ff8fa3)',
    '--accent-shadow': 'rgba(255, 107, 138, 0.25)',
    '--border-primary': 'rgba(241, 243, 245, 0.15)',
    '--border-secondary': 'rgba(241, 243, 245, 0.08)',
    '--border-accent': 'rgba(255, 107, 138, 0.3)',
    '--border-glow': 'rgba(255, 107, 138, 0.2)',
    '--border-highlight': 'rgba(241, 243, 245, 0.15)',
    '--symbol-gradient': 'linear-gradient(145deg, rgba(75, 82, 108, 0.8), rgba(65, 72, 98, 0.9))',
    '--symbol-gradient-alt': 'linear-gradient(145deg, rgba(85, 92, 118, 0.8), rgba(75, 82, 108, 0.9))',
    '--symbol-gradient-highlight': 'linear-gradient(145deg, rgba(95, 102, 128, 0.9), rgba(85, 92, 118, 0.95))',
  },
  neon: {
    '--background': 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%)',
    '--surface-primary': 'rgba(18, 18, 28, 0.95)',
    '--surface-secondary': 'rgba(28, 28, 38, 0.9)',
    '--surface-tertiary': 'rgba(38, 38, 48, 0.85)',
    '--surface-accent': 'rgba(0, 255, 255, 0.08)',
    '--text-primary': '#e8f4fd',
    '--text-secondary': '#b8c5d1',
    '--text-accent': '#00ffff',
    '--text-on-accent': '#0a0a0f',
    '--accent-color': '#00ffff',
    '--accent-light': '#4dffff',
    '--accent-dark': '#00cccc',
    '--accent-gradient': 'linear-gradient(135deg, #00ffff, #4dffff)',
    '--accent-shadow': 'rgba(0, 255, 255, 0.4)',
    '--border-primary': 'rgba(0, 255, 255, 0.2)',
    '--border-secondary': 'rgba(0, 255, 255, 0.1)',
    '--border-accent': 'rgba(0, 255, 255, 0.5)',
    '--border-glow': 'rgba(0, 255, 255, 0.6)',
    '--border-highlight': 'rgba(0, 255, 255, 0.3)',
    '--symbol-gradient': 'linear-gradient(145deg, rgba(28, 28, 38, 0.8), rgba(18, 18, 28, 0.9))',
    '--symbol-gradient-alt': 'linear-gradient(145deg, rgba(38, 38, 48, 0.8), rgba(28, 28, 38, 0.9))',
    '--symbol-gradient-highlight': 'linear-gradient(145deg, rgba(48, 48, 58, 0.9), rgba(38, 38, 48, 0.95))',
  },
  golden: {
    '--background': 'linear-gradient(135deg, #1a1612 0%, #2a241e 50%, #3a332b 100%)',
    '--surface-primary': 'rgba(35, 30, 25, 0.95)',
    '--surface-secondary': 'rgba(45, 40, 35, 0.9)',
    '--surface-tertiary': 'rgba(55, 50, 45, 0.85)',
    '--surface-accent': 'rgba(255, 193, 7, 0.1)',
    '--text-primary': '#f5f2e8',
    '--text-secondary': '#d4c5a9',
    '--text-accent': '#ffc107',
    '--text-on-accent': '#1a1612',
    '--accent-color': '#ffc107',
    '--accent-light': '#ffca2c',
    '--accent-dark': '#e0a800',
    '--accent-gradient': 'linear-gradient(135deg, #ffc107, #ffca2c)',
    '--accent-shadow': 'rgba(255, 193, 7, 0.3)',
    '--border-primary': 'rgba(245, 242, 232, 0.12)',
    '--border-secondary': 'rgba(245, 242, 232, 0.08)',
    '--border-accent': 'rgba(255, 193, 7, 0.3)',
    '--border-glow': 'rgba(255, 193, 7, 0.25)',
    '--border-highlight': 'rgba(245, 242, 232, 0.15)',
    '--symbol-gradient': 'linear-gradient(145deg, rgba(75, 70, 65, 0.8), rgba(55, 50, 45, 0.9))',
    '--symbol-gradient-alt': 'linear-gradient(145deg, rgba(85, 80, 75, 0.8), rgba(65, 60, 55, 0.9))',
    '--symbol-gradient-highlight': 'linear-gradient(145deg, rgba(95, 90, 85, 0.9), rgba(75, 70, 65, 0.95))',
  }
};

SlotMachine.defaultSymbols = {
  'apple': '🍎',
  'cherry': '🍒',
  'lemon': '🍋',
  'seven': '7️⃣',
  'bell': '🔔',
  'star': '⭐',
  'diamond': '💎',
  'coin': '🪙'
};

export default SlotMachine;
