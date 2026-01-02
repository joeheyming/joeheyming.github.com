/**
 * Words Display - Shows countdown in written words
 * Supports multiple languages via locale service
 */
import { BaseCountdownDisplay } from './base-display.js';
import { localeService } from '../i18n/locale-service.js';
import { hostStyles, combineStyles } from './shared-styles.js';

class WordsDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(120))}

        :host {
          padding: 20px;
        }

        .words-container {
          text-align: center;
          max-width: 600px;
          min-height: 100px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .time-phrase {
          font-family: 'Playfair Display', Georgia, serif;
          font-size: clamp(1.4rem, 4vw, 2rem);
          font-weight: 400;
          line-height: 1.6;
          color: #f8fafc;
          letter-spacing: 0.02em;
          min-height: 3em;
        }

        :host([dir="rtl"]) .time-phrase {
          font-family: 'Noto Sans Arabic', 'Noto Sans Hebrew', Georgia, serif;
        }

        .number-word {
          color: #f59e0b;
          font-weight: 600;
          font-style: italic;
        }

        .unit-word {
          color: #94a3b8;
        }

        .separator {
          color: #64748b;
        }

        .and {
          color: #a78bfa;
          font-style: italic;
        }

        .locale-badge {
          font-size: 0.75rem;
          color: #64748b;
          margin-top: 8px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
      </style>

      <div class="words-container">
        <p class="time-phrase" id="timePhrase"></p>
        <span class="locale-badge" id="localeBadge">${localeService.localeInfo.nativeName}</span>
      </div>
    `;

    // Cache element references
    this.timePhraseEl = this.shadowRoot.getElementById('timePhrase');
    this.localeBadgeEl = this.shadowRoot.getElementById('localeBadge');

    // Update direction
    this.updateDirection();
  }

  updateDirection() {
    this.style.direction = localeService.isRTL ? 'rtl' : 'ltr';
  }

  // Get unit string with pluralization
  getUnit(unit, count) {
    const isPlural = count !== 1;
    const key = isPlural ? `${unit}s` : unit;
    return localeService.str(`units.${key}`);
  }

  // Get "and" conjunction
  getAnd() {
    return localeService.str('units.and');
  }

  _onUpdate(data) {
    const { years = 0, totalDays, hours, minutes, seconds } = data;
    const daysRemaining = this.getDaysRemaining(years, totalDays);

    const parts = [];
    const numberToWords = (n) => localeService.numberToWords(n);

    const makeSpan = (num, unit) => {
      const numWords = numberToWords(num);
      const unitWord = this.getUnit(unit, num);
      return `<span class="number-word">${numWords}</span> <span class="unit-word">${unitWord}</span>`;
    };

    if (years > 0) {
      parts.push(makeSpan(years, 'year'));
    }
    if (daysRemaining > 0) {
      parts.push(makeSpan(daysRemaining, 'day'));
    }
    if (hours > 0 || parts.length === 0) {
      parts.push(makeSpan(hours, 'hour'));
    }
    if (minutes > 0 || parts.length === 0) {
      parts.push(makeSpan(minutes, 'minute'));
    }
    parts.push(makeSpan(seconds, 'second'));

    // Join with commas and "and"
    let phrase;
    if (parts.length === 1) {
      phrase = parts[0];
    } else {
      const last = parts.pop();
      const separator = '<span class="separator">, </span>';
      const andWord = this.getAnd();
      const andSeparator = andWord ? `<span class="and"> ${andWord} </span>` : ' ';
      phrase = parts.join(separator) + andSeparator + last;
    }

    if (this.timePhraseEl) this.timePhraseEl.innerHTML = phrase;
    if (this.localeBadgeEl) this.localeBadgeEl.textContent = localeService.localeInfo.nativeName;
  }

  // Override to update direction on locale change
  updateLabels() {
    super.updateLabels();
    this.updateDirection();
    if (this.localeBadgeEl) {
      this.localeBadgeEl.textContent = localeService.localeInfo.nativeName;
    }
  }
}

customElements.define('words-display', WordsDisplay);
export default WordsDisplay;
