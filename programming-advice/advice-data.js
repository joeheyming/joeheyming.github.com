// Programming Advice Database
// Compiled from multiple sources of developer wisdom

import { grugBrainAdvice } from './advice/grug-brain.js';
import { drunkSrEngineerAdvice } from './advice/drunk-sr-engineer.js';
import { bobMartinAdvice } from './advice/bob-martin.js';
import { donaldKnuthAdvice } from './advice/donald-knuth.js';
import { kentBeckAdvice } from './advice/kent-beck.js';
import { martinFowlerAdvice } from './advice/martin-fowler.js';
import { gangOfFourAdvice } from './advice/gang-of-four.js';
import { pragmaticProgrammerAdvice } from './advice/pragmatic-programmer.js';
import { codeCompleteAdvice } from './advice/code-complete.js';
import { legacyCodeAdvice } from './advice/legacy-code.js';
import { domainDrivenDesignAdvice } from './advice/domain-driven-design.js';
import { linusTorvaldsAdvice } from './advice/linus-torvalds.js';
import { richardStallmanAdvice } from './advice/richard-stallman.js';
import { brianKernighanAdvice } from './advice/brian-kernighan.js';
import { graceHopperAdvice } from './advice/grace-hopper.js';
import { johnCarmackAdvice } from './advice/john-carmack.js';
import { alanKayAdvice } from './advice/alan-kay.js';
import { dhhAdvice } from './advice/dhh.js';
import { richHickeyAdvice } from './advice/rich-hickey.js';
import { sandiMetzAdvice } from './advice/sandi-metz.js';
import { danAbramovAdvice } from './advice/dan-abramov.js';
import { kelseyHightowerAdvice } from './advice/kelsey-hightower.js';
import { jessitronAdvice } from './advice/jessitron.js';
import { famousQuotes } from './advice/famous-quotes.js';

export const adviceCategories = {
  complexity: {
    name: '🧠 Complexity',
    icon: '🧠',
    color: '#ef4444'
  },
  testing: {
    name: '🧪 Testing',
    icon: '🧪',
    color: '#10b981'
  },
  career: {
    name: '🚀 Career',
    icon: '🚀',
    color: '#3b82f6'
  },
  code: {
    name: '💻 Code Quality',
    icon: '💻',
    color: '#8b5cf6'
  },
  apis: {
    name: '🔌 APIs',
    icon: '🔌',
    color: '#f59e0b'
  },
  frontend: {
    name: '🎨 Frontend',
    icon: '🎨',
    color: '#ec4899'
  },
  mindset: {
    name: '🧘 Mindset',
    icon: '🧘',
    color: '#06b6d4'
  },
  debugging: {
    name: '🐛 Debugging',
    icon: '🐛',
    color: '#f97316'
  },
  optimization: {
    name: '⚡ Performance',
    icon: '⚡',
    color: '#eab308'
  }
};

// Combine all advice from different sources
export const advice = [
  ...grugBrainAdvice,
  ...drunkSrEngineerAdvice,
  ...bobMartinAdvice,
  ...donaldKnuthAdvice,
  ...kentBeckAdvice,
  ...martinFowlerAdvice,
  ...gangOfFourAdvice,
  ...pragmaticProgrammerAdvice,
  ...codeCompleteAdvice,
  ...legacyCodeAdvice,
  ...domainDrivenDesignAdvice,
  ...linusTorvaldsAdvice,
  ...richardStallmanAdvice,
  ...brianKernighanAdvice,
  ...graceHopperAdvice,
  ...johnCarmackAdvice,
  ...alanKayAdvice,
  ...dhhAdvice,
  ...richHickeyAdvice,
  ...sandiMetzAdvice,
  ...danAbramovAdvice,
  ...kelseyHightowerAdvice,
  ...jessitronAdvice,
  ...famousQuotes
];
