'use strict';

// All 118 elements: [atomic number, symbol, name, atomic mass, category]
var ELEMENTS = [
  [1, 'H', 'Hydrogen', 1.008, 'nonmetal'],
  [2, 'He', 'Helium', 4.003, 'noble gas'],
  [3, 'Li', 'Lithium', 6.941, 'alkali metal'],
  [4, 'Be', 'Beryllium', 9.012, 'alkaline earth metal'],
  [5, 'B', 'Boron', 10.81, 'metalloid'],
  [6, 'C', 'Carbon', 12.011, 'nonmetal'],
  [7, 'N', 'Nitrogen', 14.007, 'nonmetal'],
  [8, 'O', 'Oxygen', 15.999, 'nonmetal'],
  [9, 'F', 'Fluorine', 18.998, 'halogen'],
  [10, 'Ne', 'Neon', 20.18, 'noble gas'],
  [11, 'Na', 'Sodium', 22.99, 'alkali metal'],
  [12, 'Mg', 'Magnesium', 24.305, 'alkaline earth metal'],
  [13, 'Al', 'Aluminum', 26.982, 'post-transition metal'],
  [14, 'Si', 'Silicon', 28.086, 'metalloid'],
  [15, 'P', 'Phosphorus', 30.974, 'nonmetal'],
  [16, 'S', 'Sulfur', 32.06, 'nonmetal'],
  [17, 'Cl', 'Chlorine', 35.45, 'halogen'],
  [18, 'Ar', 'Argon', 39.948, 'noble gas'],
  [19, 'K', 'Potassium', 39.098, 'alkali metal'],
  [20, 'Ca', 'Calcium', 40.078, 'alkaline earth metal'],
  [21, 'Sc', 'Scandium', 44.956, 'transition metal'],
  [22, 'Ti', 'Titanium', 47.867, 'transition metal'],
  [23, 'V', 'Vanadium', 50.942, 'transition metal'],
  [24, 'Cr', 'Chromium', 51.996, 'transition metal'],
  [25, 'Mn', 'Manganese', 54.938, 'transition metal'],
  [26, 'Fe', 'Iron', 56.845, 'transition metal'],
  [27, 'Co', 'Cobalt', 58.933, 'transition metal'],
  [28, 'Ni', 'Nickel', 58.693, 'transition metal'],
  [29, 'Cu', 'Copper', 63.546, 'transition metal'],
  [30, 'Zn', 'Zinc', 65.38, 'transition metal'],
  [31, 'Ga', 'Gallium', 69.723, 'post-transition metal'],
  [32, 'Ge', 'Germanium', 72.63, 'metalloid'],
  [33, 'As', 'Arsenic', 74.922, 'metalloid'],
  [34, 'Se', 'Selenium', 78.971, 'nonmetal'],
  [35, 'Br', 'Bromine', 79.904, 'halogen'],
  [36, 'Kr', 'Krypton', 83.798, 'noble gas'],
  [37, 'Rb', 'Rubidium', 85.468, 'alkali metal'],
  [38, 'Sr', 'Strontium', 87.62, 'alkaline earth metal'],
  [39, 'Y', 'Yttrium', 88.906, 'transition metal'],
  [40, 'Zr', 'Zirconium', 91.224, 'transition metal'],
  [41, 'Nb', 'Niobium', 92.906, 'transition metal'],
  [42, 'Mo', 'Molybdenum', 95.95, 'transition metal'],
  [43, 'Tc', 'Technetium', 98, 'transition metal'],
  [44, 'Ru', 'Ruthenium', 101.07, 'transition metal'],
  [45, 'Rh', 'Rhodium', 102.906, 'transition metal'],
  [46, 'Pd', 'Palladium', 106.42, 'transition metal'],
  [47, 'Ag', 'Silver', 107.868, 'transition metal'],
  [48, 'Cd', 'Cadmium', 112.414, 'transition metal'],
  [49, 'In', 'Indium', 114.818, 'post-transition metal'],
  [50, 'Sn', 'Tin', 118.711, 'post-transition metal'],
  [51, 'Sb', 'Antimony', 121.76, 'metalloid'],
  [52, 'Te', 'Tellurium', 127.6, 'metalloid'],
  [53, 'I', 'Iodine', 126.904, 'halogen'],
  [54, 'Xe', 'Xenon', 131.294, 'noble gas'],
  [55, 'Cs', 'Cesium', 132.905, 'alkali metal'],
  [56, 'Ba', 'Barium', 137.328, 'alkaline earth metal'],
  [57, 'La', 'Lanthanum', 138.905, 'lanthanide'],
  [58, 'Ce', 'Cerium', 140.116, 'lanthanide'],
  [59, 'Pr', 'Praseodymium', 140.908, 'lanthanide'],
  [60, 'Nd', 'Neodymium', 144.242, 'lanthanide'],
  [61, 'Pm', 'Promethium', 145, 'lanthanide'],
  [62, 'Sm', 'Samarium', 150.36, 'lanthanide'],
  [63, 'Eu', 'Europium', 151.964, 'lanthanide'],
  [64, 'Gd', 'Gadolinium', 157.25, 'lanthanide'],
  [65, 'Tb', 'Terbium', 158.925, 'lanthanide'],
  [66, 'Dy', 'Dysprosium', 162.5, 'lanthanide'],
  [67, 'Ho', 'Holmium', 164.93, 'lanthanide'],
  [68, 'Er', 'Erbium', 167.259, 'lanthanide'],
  [69, 'Tm', 'Thulium', 168.934, 'lanthanide'],
  [70, 'Yb', 'Ytterbium', 173.045, 'lanthanide'],
  [71, 'Lu', 'Lutetium', 174.967, 'lanthanide'],
  [72, 'Hf', 'Hafnium', 178.49, 'transition metal'],
  [73, 'Ta', 'Tantalum', 180.948, 'transition metal'],
  [74, 'W', 'Tungsten', 183.84, 'transition metal'],
  [75, 'Re', 'Rhenium', 186.207, 'transition metal'],
  [76, 'Os', 'Osmium', 190.23, 'transition metal'],
  [77, 'Ir', 'Iridium', 192.217, 'transition metal'],
  [78, 'Pt', 'Platinum', 195.084, 'transition metal'],
  [79, 'Au', 'Gold', 196.967, 'transition metal'],
  [80, 'Hg', 'Mercury', 200.592, 'transition metal'],
  [81, 'Tl', 'Thallium', 204.383, 'post-transition metal'],
  [82, 'Pb', 'Lead', 207.2, 'post-transition metal'],
  [83, 'Bi', 'Bismuth', 208.98, 'post-transition metal'],
  [84, 'Po', 'Polonium', 209, 'post-transition metal'],
  [85, 'At', 'Astatine', 210, 'halogen'],
  [86, 'Rn', 'Radon', 222, 'noble gas'],
  [87, 'Fr', 'Francium', 223, 'alkali metal'],
  [88, 'Ra', 'Radium', 226, 'alkaline earth metal'],
  [89, 'Ac', 'Actinium', 227, 'actinide'],
  [90, 'Th', 'Thorium', 232.038, 'actinide'],
  [91, 'Pa', 'Protactinium', 231.036, 'actinide'],
  [92, 'U', 'Uranium', 238.029, 'actinide'],
  [93, 'Np', 'Neptunium', 237, 'actinide'],
  [94, 'Pu', 'Plutonium', 244, 'actinide'],
  [95, 'Am', 'Americium', 243, 'actinide'],
  [96, 'Cm', 'Curium', 247, 'actinide'],
  [97, 'Bk', 'Berkelium', 247, 'actinide'],
  [98, 'Cf', 'Californium', 251, 'actinide'],
  [99, 'Es', 'Einsteinium', 252, 'actinide'],
  [100, 'Fm', 'Fermium', 257, 'actinide'],
  [101, 'Md', 'Mendelevium', 258, 'actinide'],
  [102, 'No', 'Nobelium', 259, 'actinide'],
  [103, 'Lr', 'Lawrencium', 266, 'actinide'],
  [104, 'Rf', 'Rutherfordium', 267, 'transition metal'],
  [105, 'Db', 'Dubnium', 268, 'transition metal'],
  [106, 'Sg', 'Seaborgium', 269, 'transition metal'],
  [107, 'Bh', 'Bohrium', 270, 'transition metal'],
  [108, 'Hs', 'Hassium', 277, 'transition metal'],
  [109, 'Mt', 'Meitnerium', 278, 'transition metal'],
  [110, 'Ds', 'Darmstadtium', 281, 'transition metal'],
  [111, 'Rg', 'Roentgenium', 282, 'transition metal'],
  [112, 'Cn', 'Copernicium', 285, 'transition metal'],
  [113, 'Nh', 'Nihonium', 286, 'post-transition metal'],
  [114, 'Fl', 'Flerovium', 289, 'post-transition metal'],
  [115, 'Mc', 'Moscovium', 290, 'post-transition metal'],
  [116, 'Lv', 'Livermorium', 293, 'post-transition metal'],
  [117, 'Ts', 'Tennessine', 294, 'halogen'],
  [118, 'Og', 'Oganesson', 294, 'noble gas']
];

var bySymbol = {};
ELEMENTS.forEach(function (el) {
  bySymbol[el[1].toLowerCase()] = {
    number: el[0],
    symbol: el[1],
    name: el[2],
    mass: el[3],
    category: el[4]
  };
});

// --- Custom (fake) elements ---

var CUSTOM_STORAGE_KEY = 'periodic-speller-custom-elements';

function loadCustomElements() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveCustomElements(customs) {
  localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customs));
}

function fakeMass(number) {
  var base = number * 2.2 + (number * number) / 500;
  var variance = (Math.random() - 0.5) * number * 0.06;
  return (base + variance).toFixed(1);
}

function registerCustomElement(symbol, name, number, onDone) {
  var key = symbol.toLowerCase();
  var entry = {
    number: number,
    symbol: symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase(),
    name: name,
    mass: fakeMass(number),
    category: 'custom',
    custom: true
  };
  bySymbol[key] = entry;
  var customs = loadCustomElements();
  customs[key] = entry;
  saveCustomElements(customs);
  if (onDone) onDone();
}

function removeCustomElement(key, onDone) {
  delete bySymbol[key];
  var customs = loadCustomElements();
  delete customs[key];
  saveCustomElements(customs);
  if (onDone) onDone();
}

function clearAllCustomElements(onDone) {
  var customs = loadCustomElements();
  Object.keys(customs).forEach(function (key) {
    delete bySymbol[key];
  });
  saveCustomElements({});
  if (onDone) onDone();
}

// Restore saved custom elements into bySymbol on load
(function restoreCustom() {
  var customs = loadCustomElements();
  Object.keys(customs).forEach(function (key) {
    bySymbol[key] = customs[key];
  });
})();

export {
  ELEMENTS,
  bySymbol,
  loadCustomElements,
  saveCustomElements,
  registerCustomElement,
  removeCustomElement,
  clearAllCustomElements
};
