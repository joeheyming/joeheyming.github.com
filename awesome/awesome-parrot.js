// 🦜 PARTY PARROT MODULE 🦜
// Because every awesome experience needs dancing birds!
// 182 verified working HD parrots from cultofthepartyparrot.com!

/**
 * @fileoverview Party Parrot spawning module
 * @requires awesome-config.js
 * @requires awesome-animations.js
 */

var partyParrotNamespace = (function () {
  'use strict';

  var namespace = {};
  var config = window.awesomeConfig || {};

  // 🦜 All 182 verified working HD party parrots! 🦜
  var partyParrots = [
    'https://cultofthepartyparrot.com/parrots/hd/6-7parrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/60fpsparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/accessibleparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/angelparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/angryparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/astronautparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/aussiecongaparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/aussieparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/aussiereversecongaparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/autonomousparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/backwardsparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/badparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/balconyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/beerparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/beretparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/bikerparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/biparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/birthdaypartyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/bluntparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/blurryparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/bobaparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/boomparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/bootlegparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/boredparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/bouncingparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/braveheartparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/brazilianfanparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/brazilianplayerparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/bunnyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/cakeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/calvinist_parrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/ceilingparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/chefkissparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/chefparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/chicoparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/christmasparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/clownparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/coffeeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/confusedparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/congaparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/congapartyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/copparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/covid19parrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/croissantparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/dadparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/daftpunkparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/dailyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/darkmodeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/dealwithitnowparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/dealwithitparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/deletedparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/discoparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/docparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/donutparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/everythingsfineparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/evilparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/exceptionallyfastparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/fastparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/fasttwinsparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/flowerparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/flyingmoneyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/footballparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/frenchparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/gentlemanparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/githubparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/glimpseparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/googlyeyesparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/gothparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/grouchoparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/hackerparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/hanamiparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/hardhatparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/harpoparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/hdrparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/headbangingparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/headingparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/headsetparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/hmmparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/horizontalparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/hypnoparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/hypnoparrotdark.gif',
    'https://cultofthepartyparrot.com/parrots/hd/hypnoparrotlight.gif',
    'https://cultofthepartyparrot.com/parrots/hd/illuminatiparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/imposterparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/innersourceparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/inverseparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/invisibleparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/jediparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/jumpingparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/jumpingparrotjr.gif',
    'https://cultofthepartyparrot.com/parrots/hd/kindasusparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/laptop_parrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/levitationparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/mailparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/maracasparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/mardigrasparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/marshmallowparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/maskparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/mateparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/meldparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/mergeconflictparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/mergeimmediatelyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/mergetrainparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/michaeljacksonparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/middleparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/moonparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/moonwalkingparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/mustacheparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/nodeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/norwegianblueparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/opensourceparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/originalparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/parrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/parrotnotfound.gif',
    'https://cultofthepartyparrot.com/parrots/hd/partyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/phparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/picassoparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/pingpongparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/pirateparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/playcatchleftparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/playcatchrightparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/pokeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/popcornparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/portalblueparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/portalorangeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/pumpkinparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/quadparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/quantumparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/raceconditionparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/reactparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/redbullparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/redenvelopeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/redhatparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/resonatingredparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/reversecongaparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/reverseparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/reverseportalblueparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/reverseportalorangeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/revolutionparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/ripparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/rubyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/rythmicalparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/sadparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/sassyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/scienceparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/sherlockholmesparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/shortparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/shuffleparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/sidewaysparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/sintparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/sithparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/sleepingparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/slowparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/sneezyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/soccerparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/spinningparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/spyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/stableparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/stayhomeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/stayhomeparrotcloser.gif',
    'https://cultofthepartyparrot.com/parrots/hd/stayhomeparrotwindow.gif',
    'https://cultofthepartyparrot.com/parrots/hd/staytfhomeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/sushiparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/svelteparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/temporaltableparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/tennisparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/thankyouparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/thefastestparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/thumbsupparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/tiedyeparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/tinfoilhatparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/tpparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/transparront.gif',
    'https://cultofthepartyparrot.com/parrots/hd/turndownforwatchparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/twinsparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/ultrafastparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/unicornparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/vacationparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/vaccineparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/verticalparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/vikingparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/vueparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/wendyparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/wfhparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/whitewalkerparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/wineparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/yeetparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/yosemitesamparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/zombieparrot.gif',
    'https://cultofthepartyparrot.com/parrots/hd/zoukparrot.gif'
  ];

  // 🎲 Get a random parrot URL
  namespace.getRandomParrot = function () {
    return partyParrots[Math.floor(Math.random() * partyParrots.length)];
  };

  /**
   * Spawn a party parrot on the screen
   * @param {Object} [options] - Spawn options
   * @param {number} [options.chance] - Spawn chance (0-1)
   * @param {string} [options.size] - Size in CSS units
   * @param {number} [options.duration] - Display duration in ms
   * @returns {HTMLElement|null} The spawned parrot element or null
   */
  namespace.spawn = function (options) {
    options = options || {};
    var defaultChance = (config.timing && config.timing.spawnChance) || 0.02;
    var chance = options.chance || defaultChance;

    // 🎲 Roll for parrot!
    if (Math.random() > chance) return null;

    // Size from CSS variable or option override
    var sizeNum = options.size ? parseInt(options.size, 10) : 80;

    var parrot = document.createElement('img');
    parrot.src = namespace.getRandomParrot();
    parrot.alt = 'Party Parrot!';
    parrot.className = 'party-parrot';
    // Dynamic position only (size comes from CSS)
    parrot.style.left = Math.random() * (window.innerWidth - sizeNum) + 'px';
    parrot.style.top = Math.random() * (window.innerHeight - sizeNum) + 'px';
    if (options.size) {
      parrot.style.width = options.size;
      parrot.style.height = options.size;
    }
    document.body.appendChild(parrot);

    // 🎬 Fade in the parrot!
    setTimeout(function () {
      parrot.style.opacity = '1';
    }, 50);

    // 🎲 Apply a random awesome animation!
    var duration = options.duration || (config.durations && config.durations.parrot) || 4000;
    if (typeof animationsNamespace !== 'undefined') {
      animationsNamespace.applyRandom(parrot, { delay: 500, duration: duration - 1000 });
    } else {
      // 💃 Fallback: Make it dance around a bit!
      setTimeout(function () {
        parrot.style.transform = 'rotate(' + (Math.random() * 20 - 10) + 'deg) scale(1.1)';
      }, 500);
    }

    // 👋 Parrot flies away after partying!
    setTimeout(function () {
      parrot.style.transition = 'opacity 0.5s ease-out';
      parrot.style.opacity = '0';
      setTimeout(function () {
        if (parrot.parentNode) {
          parrot.parentNode.removeChild(parrot);
        }
      }, 500);
    }, duration);

    return parrot;
  };

  // 🦜 Force spawn a parrot (100% chance)!
  namespace.forceSpawn = function (options) {
    options = options || {};
    options.chance = 1;
    return namespace.spawn(options);
  };

  // 🎉 Spawn a whole flock of parrots!
  namespace.flock = function (count) {
    count = count || 5;
    var parrots = [];
    for (var i = 0; i < count; i++) {
      (function (index) {
        setTimeout(function () {
          parrots.push(namespace.forceSpawn());
        }, index * 200); // 🐦 Stagger the arrivals!
      })(i);
    }
    return parrots;
  };

  // 🦜 How many parrots do we have?
  namespace.count = function () {
    return partyParrots.length;
  };

  // 📋 Get all parrot URLs
  namespace.all = function () {
    return partyParrots.slice();
  };

  // 🤘 Return the namespace to the world!
  return namespace;
})();

// 🌍 Expose globally
window.partyParrotNamespace = partyParrotNamespace;
window.parrot = partyParrotNamespace; // Alias for easy access
