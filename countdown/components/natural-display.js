/**
 * Natural Language Display - Human-readable countdown
 * Uses Intl.RelativeTimeFormat for localization
 */
import { BaseCountdownDisplay } from './base-display.js';
import { localeService } from '../i18n/locale-service.js';
import { hostStyles, combineStyles } from './shared-styles.js';

class NaturalDisplay extends BaseCountdownDisplay {
  render() {
    this.shadowRoot.innerHTML = `
      <style>
        ${combineStyles(hostStyles(120))}

        :host {
          padding: 20px;
        }

        .natural-container {
          text-align: center;
          max-width: 500px;
          min-height: 120px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        .main-phrase {
          font-family: 'Outfit', sans-serif;
          font-size: clamp(1.5rem, 5vw, 2.2rem);
          font-weight: 300;
          color: #f8fafc;
          line-height: 1.4;
          margin-bottom: 16px;
          min-height: 2.5em;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        :host([dir="rtl"]) .main-phrase {
          font-family: 'Noto Sans Arabic', 'Noto Sans Hebrew', 'Outfit', sans-serif;
        }

        .highlight {
          color: #fbbf24;
          font-weight: 600;
        }

        .detail {
          font-family: 'Outfit', sans-serif;
          font-size: 1rem;
          color: #94a3b8;
        }

        .exact-time {
          font-family: 'Orbitron', monospace;
          font-size: 0.9rem;
          color: #64748b;
          margin-top: 12px;
          padding: 8px 16px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          display: inline-block;
        }

        .emoji {
          font-size: 1.5em;
          margin-right: 8px;
        }

        :host([dir="rtl"]) .emoji {
          margin-right: 0;
          margin-left: 8px;
        }

        .locale-badge {
          font-size: 0.75rem;
          color: #64748b;
          margin-top: 8px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
      </style>

      <div class="natural-container">
        <p class="main-phrase" id="mainPhrase"></p>
        <p class="detail" id="detail"></p>
        <div class="exact-time" id="exactTime"></div>
        <span class="locale-badge" id="localeBadge">${localeService.localeInfo.nativeName}</span>
      </div>
    `;

    // Cache element references
    this.mainPhraseEl = this.shadowRoot.getElementById('mainPhrase');
    this.detailEl = this.shadowRoot.getElementById('detail');
    this.exactTimeEl = this.shadowRoot.getElementById('exactTime');
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

  getEmoji(totalDays, hours, minutes) {
    const totalMinutes = totalDays * 24 * 60 + hours * 60 + minutes;

    if (totalMinutes < 1) return '🎉';
    if (totalMinutes < 5) return '⚡';
    if (totalMinutes < 60) return '🔜';
    if (totalDays < 1) return '🕐';
    if (totalDays === 1) return '🌅';
    if (totalDays < 7) return '📆';
    if (totalDays < 30) return '🗓️';
    if (totalDays < 365) return '📅';
    return '🚀';
  }

  getTimeDescription(totalDays, hours, minutes, seconds) {
    const result = localeService.formatRelativeTime(totalDays, hours, minutes, seconds);
    return result.text;
  }

  getDetailText(totalDays, hours, minutes, seconds) {
    const numberFormat = new Intl.NumberFormat(localeService.locale);

    if (totalDays > 30) {
      const daysWord = this.getUnit('day', totalDays);
      return `${numberFormat.format(totalDays)} ${daysWord}`;
    }
    if (totalDays > 0) {
      const daysWord = this.getUnit('day', totalDays);
      const hoursWord = this.getUnit('hour', hours);
      return `${totalDays} ${daysWord}, ${hours} ${hoursWord}`;
    }
    if (hours > 0) {
      const hoursWord = this.getUnit('hour', hours);
      const minutesWord = this.getUnit('minute', minutes);
      return `${hours} ${hoursWord}, ${minutes} ${minutesWord}`;
    }
    const minutesWord = this.getUnit('minute', minutes);
    const secondsWord = this.getUnit('second', seconds);
    return `${minutes} ${minutesWord}, ${seconds} ${secondsWord}`;
  }

  _onUpdate(data) {
    const { totalDays, hours, minutes, seconds } = data;

    const emoji = this.getEmoji(totalDays, hours, minutes);
    const text = this.getTimeDescription(totalDays, hours, minutes, seconds);
    const detail = this.getDetailText(totalDays, hours, minutes, seconds);

    if (this.mainPhraseEl) {
      this.mainPhraseEl.innerHTML = `<span class="emoji">${emoji}</span><span class="highlight">${text}</span>`;
    }
    if (this.detailEl) {
      this.detailEl.textContent = detail;
    }
    if (this.exactTimeEl) {
      const d = String(totalDays).padStart(3, '0');
      const h = String(hours).padStart(2, '0');
      const m = String(minutes).padStart(2, '0');
      const s = String(seconds).padStart(2, '0');
      this.exactTimeEl.textContent = `${d}d : ${h}h : ${m}m : ${s}s`;
    }
    if (this.localeBadgeEl) {
      this.localeBadgeEl.textContent = localeService.localeInfo.nativeName;
    }
  }

  // Override to update direction and badge on locale change
  updateLabels() {
    super.updateLabels();
    this.updateDirection();
    if (this.localeBadgeEl) {
      this.localeBadgeEl.textContent = localeService.localeInfo.nativeName;
    }
  }
}

customElements.define('natural-display', NaturalDisplay);
export default NaturalDisplay;
