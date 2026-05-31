// Unit tests for the HTML parsers in doom/moddb-browser-parsers.js and
// helpers from moddb-browser-net.js.
//
// We can't fetch live moddb pages from a test environment (no network,
// CORS, brittle), so each test feeds a small constructed fixture HTML
// snippet that follows the structure assumed by the SELECTORS table at
// the top of moddb-browser-parsers.js. When moddb's DOM drifts and a real
// listing stops parsing, the fix is two-step:
//   1. Update the relevant fixture below to match a captured page.
//   2. Update the selector or parser branch to make the test pass.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parsers } from '../doom/moddb-browser-parsers.js';

let internal;

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.moddb.com/mods'
  });
  const w = dom.window;
  globalThis.window = w;
  globalThis.DOMParser = w.DOMParser;
  globalThis.localStorage = w.localStorage;
  const net = await import('../doom/moddb-browser-net.js');
  internal = net.internal;
});

const LISTING_HTML = `
<!doctype html><html><body>
  <div class="rowcontent">
    <a class="image" href="/mods/brutal-doom"><img src="/cache/images/mods/1/12/11000/thumb_620x2000/1.png"></a>
    <a href="/games/doom" title="Doom"><img src="/icon.gif"></a>
    <h4><a href="/mods/brutal-doom">Brutal Doom</a></h4>
    <p class="summary">A gore-soaked overhaul of classic Doom with new weapons, enemies, and effects.</p>
  </div>
  <div class="rowcontent">
    <a class="image" href="/mods/project-brutality"><img src="/p.png"></a>
    <a href="/games/doom-ii" title="Doom II"><img src="/icon.gif"></a>
    <h4><a href="/mods/project-brutality">Project Brutality</a></h4>
    <p class="summary">Standalone fork of Brutal Doom with deeper customization.</p>
  </div>
  <div class="rowcontent">
    <a class="image" href="/mods/brutal-doom"><img src="/dup.png"></a>
    <h4><a href="/mods/brutal-doom">Brutal Doom (duplicate row should dedupe)</a></h4>
    <p class="summary">dup</p>
  </div>
  <div class="pagination">
    <a href="?game=26&page=1" class="current">1</a>
    <a href="?game=26&page=2">2</a>
    <a href="?game=26&page=3">3</a>
    <a href="?game=26&page=10">10</a>
  </div>
</body></html>
`;

const MOD_PAGE_HTML = `
<!doctype html><html><body>
  <h1>Brutal Doom</h1>
  <div id="profiledescription">
    Brutal Doom is a gameplay overhaul for the Doom franchise that introduces
    new weapons, gore effects, and a punchier combat feel. Requires doom2.wad.
  </div>
  <div class="imagebox"><img src="/screens/1.jpg"></div>
  <div class="row"><img src="/screens/2.jpg"></div>
  <a href="/mods/brutal-doom/downloads">All downloads</a>
  <a href="/mods/some-other/downloads">Other downloads (should be ignored)</a>
</body></html>
`;

const DOWNLOADS_LIST_HTML = `
<!doctype html><html><body>
  <div class="rowcontent">
    <a href="/downloads/brutal-doom-v22-full">Brutal Doom v22 Full Version (zip, 280 MB)</a>
    <span>Full Version</span>
  </div>
  <div class="rowcontent">
    <a href="/downloads/brutal-doom-v22-patch">Brutal Doom v22 Patch (zip)</a>
    <span>Patch</span>
  </div>
  <div class="rowcontent">
    <a href="/downloads/brutal-doom-v21-full">Brutal Doom v21 Full Version (zip)</a>
    <span>Full Version</span>
  </div>
  <div class="rowcontent">
    <a href="/downloads/brutal-doom-demo">Brutal Doom Demo</a>
    <span>Demo</span>
  </div>
  <div class="rowcontent">
    <a href="/mods/brutal-doom/downloads">Back to mod (should be ignored)</a>
  </div>
</body></html>
`;

const DOWNLOAD_PAGE_HTML = `
<!doctype html><html><body>
  <a class="mirror" href="/start/usa-1?file=brutal-doom-v22.zip">USA Mirror 1</a>
  <a class="mirror" href="/start/eu-1?file=brutal-doom-v22.zip">EU Mirror</a>
  <a class="mirror" href="/start/usa-1?file=brutal-doom-v22.zip">USA Mirror 1 (dup)</a>
  <div class="filename">brutal-doom-v22.zip</div>
  <div class="size">280.4 MB</div>
</body></html>
`;

const CLOUDFLARE_HTML = `
<!doctype html><html><head><title>Just a moment...</title></head><body>
  <div>Checking your browser before accessing moddb.com.</div>
  <div id="cf-browser-verification"></div>
</body></html>
`;

const MODDB_GLOBAL_KW_LEGEND_OF_DOOM_HTML = `
<!doctype html>
<html><body>
<title>Mods for Games - ModDB</title>
<div class="mods-listing">
<div class="row rowcontent rowreleased1 rowgenre16 rowgenre14 rowtheme10 rowplayers1 rowtimeframe5 rowgame99 clear">
				<a href="/mods/empires-total-war" title="Empires Total War" class="image"><img src="https://media.moddb.com/cache/images/mods/1/48/47086/crop_120x90/splash.jpg" alt="Empires Total War" /></a>
				<div class="content">
			 
			<a href="/games/rome-total-war" title="Rome: Total War"><img src="https://media.moddb.com/images/games/1/1/99/icon.gif" alt="Rome: Total War" width="32" height="32" style="float: right; padding-left: 4px;" /></a>
			 
			<h4><a href="/mods/empires-total-war">Empires Total War</a></h4>
			<span class="date">
				<time datetime="2026-05-04T03:17:52+00:00">2mins ago</time>			</span>
			<span class="subheading">
				<time datetime="2020-08-14">Released 2020</time> Turn Based Strategy  			</span>
			<p>Empires: a modification for Rome Total War dedicated to European and colonial wars in XVIII-XIX centuries. Previously named New Time Total Wars</p>		</div>
	</div>
			<div class="row rowcontent rowreleased3 rowgenre3 rowgenre1 rowtheme9 rowplayers1 rowtimeframe5 rowgame1 clear">
				<a href="/mods/fps1" title="Half-Life-Walter" class="image"><img src="https://media.moddb.com/cache/images/mods/1/58/57356/crop_120x90/walterthumb.2.png" alt="Half-Life-Walter" /></a>
				<div class="content">
			 
			<a href="/games/half-life" title="Half-Life"><img src="https://media.moddb.com/images/games/1/1/1/half-life.png" alt="Half-Life" width="32" height="32" style="float: right; padding-left: 4px;" /></a>
			 
			<h4><a href="/mods/fps1">Half-Life-Walter</a></h4>
			<span class="date">
				<time datetime="2026-05-04T02:59:50+00:00">20mins ago</time>			</span>
			<span class="subheading">
				<time>TBD</time> First Person Shooter  			</span>
			<p>Half-Life: Walter puts in the role of a scientist working at the Black Mesa research facility during the Black Mesa incident. Being one of the survivors...</p>		</div>
	</div>
			<div class="row rowcontent rowreleased1 rowgenre39 rowgenre1 rowtheme18 rowplayers1 rowtimeframe5 rowgame47754 clear">
				<a href="/mods/playmore" title="Playmore -Modding Concepts-" class="image"><img src="https://media.moddb.com/cache/images/mods/1/50/49419/crop_120x90/0-Playmore.png" alt="Playmore -Modding Concepts-" /></a>
				<div class="content">
			 
			<a href="/games/ace-combat-7" title="Ace Combat 7: Skies Unknown"><img src="https://media.moddb.com/images/games/1/48/47754/Icon_Ac7.png" alt="Ace Combat 7: Skies Unknown" width="32" height="32" style="float: right; padding-left: 4px;" /></a>
			 
			<h4><a href="/mods/playmore">Playmore -Modding Concepts-</a></h4>
			<span class="date">
				<time datetime="2026-05-04T02:48:43+00:00">32mins ago</time>			</span>
			<span class="subheading">
				<time datetime="2025-08-16">Released Aug 16, 2025</time> Arcade  			</span>
			<p>A branch project focused at works featuring advanced modding techniques, also the host of Enhanced Gunplay A5, and UEVR/Pre-campaign</p>		</div>
	</div>
			<div class="row rowcontent rowreleased1 rowgenre11 rowgenre10 rowtheme9 rowplayers1 rowtimeframe5 rowgame237 clear">
				<a href="/mods/kotor-omega" title="Knights Of The Old Republic: Edge Of Darkness" class="image"><img src="https://media.moddb.com/cache/images/mods/1/55/54697/crop_120x90/EdgeOfDarkness_Logo.png" alt="Knights Of The Old Republic: Edge Of Darkness" /></a>
				<div class="content">
			 
			<a href="/games/star-wars-knights-of-the-old-republic-ii" title="Star Wars: Knights of the Old Republic II"><img src="https://media.moddb.com/images/games/1/1/237/icon.png" alt="Star Wars: Knights of the Old Republic II" width="32" height="32" style="float: right; padding-left: 4px;" /></a>
			 
			<h4><a href="/mods/kotor-omega">Knights Of The Old Republic: Edge Of Darkness</a></h4>
			<span class="date">
				<time datetime="2026-05-04T02:28:35+00:00">52mins ago</time>			</span>
			<span class="subheading">
				<time datetime="2023-11-15">Released 2023</time> Role Playing  			</span>
			<p>Travel the ancient Star Wars Galaxy in an Ebon Hawk rebuilt by Sith StealthOps for a secret mission. </p>		</div>
	</div>
			<div class="row rowcontent rowreleased1 rowgenre2 rowgenre5 rowtheme9 rowplayers1 rowtimeframe1 rowgame15273 clear">
				<a href="/mods/star-wars-the-force-unleashed-ii-dlc-unlocked-cinematics-fmv-fix" title="STAR_WARS_The_Force_Unleashed_II_DLC_Unlocked_Cinematics_FMV-Fix" class="image"><img src="https://media.moddb.com/cache/images/mods/1/71/70925/crop_120x90/Star_Wars_The_Force_Unleashed_I.png" alt="STAR_WARS_The_Force_Unleashed_II_DLC_Unlocked_Cinematics_FMV-Fix" /></a>
				<div class="content">
			 
			<a href="/games/star-wars-the-force-unleashed-2" title="Star Wars: The Force Unleashed 2"><img src="https://media.moddb.com/images/games/1/16/15273/SWTFU2_003.png" alt="Star Wars: The Force Unleashed 2" width="32" height="32" style="float: right; padding-left: 4px;" /></a>
			 
			<h4><a href="/mods/star-wars-the-force-unleashed-ii-dlc-unlocked-cinematics-fmv-fix">STAR_WARS_The_Force_Unleashed_II_DLC_Unlocked_Cinematics_FMV-Fix</a></h4>
			<span class="date">
				<time datetime="2026-05-04T02:25:25+00:00">55mins ago</time>			</span>
			<span class="subheading">
				<time datetime="2026-05-03">Released May 3, 2026</time> Adventure  			</span>
			<p>Mod made by DenisNinja: I fixed all the cinematic FMV videos in the game, which always caused the game to crash for everyone. The original FMVs in this...</p>		</div>
	</div>
			<div class="row rowcontent rowreleased3 rowgenre4 rowgenre1 rowtheme4 rowplayers1 rowtimeframe5 rowgame71 clear">
				<a href="/mods/the-clone-wars-recreated-total-conversion" title="The Clone Wars Recreated Total Conversion (v1.0)" class="image"><img src="https://media.moddb.com/cache/images/mods/1/58/57396/crop_120x90/recreated_2026_logomoddb.7.jpg" alt="The Clone Wars Recreated Total Conversion (v1.0)" /></a>
				<div class="content">
			 
			<a href="/games/star-wars-jedi-academy" title="Star Wars: Jedi Academy"><img src="https://media.moddb.com/images/games/1/1/71/icon.gif" alt="Star Wars: Jedi Academy" width="32" height="32" style="float: right; padding-left: 4px;" /></a>
			 
			<h4><a href="/mods/the-clone-wars-recreated-total-conversion">The Clone Wars Recreated Total Conversion (v1.0)</a></h4>
			<span class="date">
				<time datetime="2026-05-04T02:24:50+00:00">55mins ago</time>			</span>
			<span class="subheading">
				<time>TBD</time> Tactical Shooter  			</span>
			<p>The Clone Wars Recreated is the modification for Jedi Academy, which is made from scratch and allows you to play ALL Seven Seasons from TV Show. The idea...</p>		</div>
	</div>
			<div class="row rowcontent rowreleased3 rowgenre15 rowgenre14 rowtheme9 rowplayers1 rowplayers2 rowtimeframe5 rowgame14342 clear">
				<a href="/mods/halo-sins-of-the-prophets" title="Sins of the Prophets" class="image"><img src="https://media.moddb.com/cache/images/mods/1/12/11043/crop_120x90/moddb_icon.1.png" alt="Sins of the Prophets" /></a>
				<div class="content">
			 
			<a href="/games/sins-of-a-solar-empire-rebellion" title="Sins of a Solar Empire: Rebellion"><img src="https://media.moddb.com/images/games/1/15/14342/icon.png" alt="Sins of a Solar Empire: Rebellion" width="32" height="32" style="float: right; padding-left: 4px;" /></a>
			 
			<h4><a href="/mods/halo-sins-of-the-prophets">Sins of the Prophets</a></h4>
			<span class="date">
				<time datetime="2026-05-04T01:09:32+00:00">2hours ago</time>			</span>
			<span class="subheading">
				<time>TBD</time> Real Time Strategy  			</span>
			<p>A Halo mod for the critically acclaimed Sins of a Solar Empire, that aims to capture the fast paced intensity of the Halo series.</p>		</div>
	</div>
			<div class="row rowcontent rowreleased1 rowgenre15 rowgenre14 rowtheme9 rowplayers1 rowplayers2 rowtimeframe5 rowgame35 clear">
				<a href="/mods/fleet-ops-roots" title="Fleet Ops: Roots" class="image"><img src="https://media.moddb.com/cache/images/mods/1/44/43052/crop_120x90/S1.3.png" alt="Fleet Ops: Roots" /></a>
				<div class="content">
			 
			<a href="/games/star-trek-armada-ii" title="Star Trek: Armada II"><img src="https://media.moddb.com/images/games/1/1/35/armada2ei8.gif" alt="Star Trek: Armada II" width="32" height="32" style="float: right; padding-left: 4px;" /></a>
			 
			<h4><a href="/mods/fleet-ops-roots">Fleet Ops: Roots</a></h4>
			<span class="date">
				<time datetime="2026-05-04T00:24:35+00:00">2hours ago</time>			</span>
			<span class="subheading">
				<time datetime="2019-06-27">Released 2019</time> Real Time Strategy  			</span>
			<p>Fleet Operations: Roots is a total conversion of the popular space-based RTS game Star Trek Armada II. To celebrate the re-release of Star Trek Armada...</p>		</div>
	</div>
			
</div>
</body></html>
`;

const MODDB_BRUTAL_DOOM_DOWNLOADS_HTML = `
<!doctype html>
<html><body>
<aside>
  <a href="/downloads/top">Top downloads</a>
  <a href="/downloads/popular">Popular this week</a>
</aside>
<div class="downloads-list">
<div class="row rowcontent rowcategory3 rowcategory1 rowcategoryaddon3 rowtimeframe5 clear">
				<a href="/mods/brutal-doom/downloads/brutal-doom-v22-beta-test" title="Brutal Doom v22 Beta Test 6" class="image"><img src="https://media.moddb.com/cache/images/downloads/1/266/265147/crop_120x90/COVER.jpg" alt="Brutal Doom v22 Beta Test 6" /></a>
				<div class="content">
			 
			<h4><a href="/mods/brutal-doom/downloads/brutal-doom-v22-beta-test">Brutal Doom v22 Beta Test 6</a></h4>
			<span class="date">
				<time datetime="2026-04-01T04:39:42+00:00">Mar 31 2026</time>			</span>
			<span class="subheading">
				Demo <a href="/mods/brutal-doom/downloads/brutal-doom-v22-beta-test" class="commenticon">298 comments</a>  			</span>
			<p>Latest bleeding edge version under development Requires Zandronum 3.2 or more modern to work. Probably any version of GZDoom can run this. Zandronum 3.3...</p>		</div>
	</div>
			<div class="row rowcontent rowcategory2 rowcategory1 rowcategoryaddon2 rowtimeframe5 clear">
				<a href="/mods/brutal-doom/downloads/brutal-doom-v21-beta" title="Brutal Doom v21" class="image"><img src="https://media.moddb.com/cache/images/downloads/1/96/95667/crop_120x90/moddb_reader.jpg" alt="Brutal Doom v21" /></a>
				<div class="content">
			 
			<h4><a href="/mods/brutal-doom/downloads/brutal-doom-v21-beta">Brutal Doom v21</a></h4>
			<span class="date">
				<time datetime="2019-05-18T00:40:03+00:00">May 17 2019</time>			</span>
			<span class="subheading">
				Full Version <a href="/mods/brutal-doom/downloads/brutal-doom-v21-beta" class="commenticon">1389 comments</a>  			</span>
			<p>Version 21 Gold.
READ THE MANUAL INCLUDED IN THE DOWNLOAD FILE.</p>		</div>
	</div>
			<div class="row rowcontent rowcategory2 rowcategory1 rowcategoryaddon2 rowtimeframe5 clear">
				<a href="/mods/brutal-doom/downloads/doom-metal-soundtrack-mod-volume-5" title="Doom Metal Soundtrack Mod - Volume 5" class="image"><img src="https://media.moddb.com/cache/images/downloads/1/180/179574/crop_120x90/Doom_Metal.jpg" alt="Doom Metal Soundtrack Mod - Volume 5" /></a>
				<div class="content">
			 
			<h4><a href="/mods/brutal-doom/downloads/doom-metal-soundtrack-mod-volume-5">Doom Metal Soundtrack Mod - Volume 5</a></h4>
			<span class="date">
				<time datetime="2019-06-14T20:57:42+00:00">Jun 14 2019</time>			</span>
			<span class="subheading">
				Full Version <a href="/mods/brutal-doom/downloads/doom-metal-soundtrack-mod-volume-5" class="commenticon">38 comments</a>  			</span>
			<p>This is a compilation with rock/metal remixes of doom's original songs composed by many community artists.</p>		</div>
	</div>
			<div class="row rowcontent rowcategory4 rowcategory1 rowcategoryaddon4 rowtimeframe5 clear">
				<a href="/mods/brutal-doom/downloads/bdv21-monsters-only-version" title="BDv21 Monsters Only Version" class="image"><img src="https://media.moddb.com/cache/images/downloads/1/180/179866/crop_120x90/2019-06-21_21_43_37-ZANDRONUM_3.png" alt="BDv21 Monsters Only Version" /></a>
				<div class="content">
			 
			<h4><a href="/mods/brutal-doom/downloads/bdv21-monsters-only-version">BDv21 Monsters Only Version</a></h4>
			<span class="date">
				<time datetime="2019-06-22T04:05:18+00:00">Jun 21 2019</time>			</span>
			<span class="subheading">
				Patch <a href="/mods/brutal-doom/downloads/bdv21-monsters-only-version" class="commenticon">72 comments</a>  			</span>
			<p>This version only features the monsters, and is meant to be used with other weapon mods, so you can play other mods and all have all the gore with full...</p>		</div>
	</div>
			<div class="row rowcontent rowcategory9 rowcategory6 rowcategoryaddon9 rowtimeframe3 clear">
				<a href="/mods/brutal-doom/downloads/idfka-reimagined" title="IDFKA Reimagined" class="image"><img src="https://media.moddb.com/cache/images/downloads/1/309/308397/crop_120x90/You_Doodle_2026-04-11T13_37_45Z.jpg" alt="IDFKA Reimagined" /></a>
				<div class="content">
			 
			<h4><a href="/mods/brutal-doom/downloads/idfka-reimagined">IDFKA Reimagined</a></h4>
			<span class="date">
				<time datetime="2026-04-25T20:33:02+00:00">Apr 25 2026</time>			</span>
			<span class="subheading">
				Music <a href="/mods/brutal-doom/downloads/idfka-reimagined" class="commenticon">2 comments</a>  			</span>
			<p>Listen for reimagine doom music on your doom vanilla game</p>		</div>
	</div>
			<div class="row rowcontent rowcategory2 rowcategory1 rowcategoryaddon2 rowtimeframe3 clear">
				<a href="/mods/brutal-doom/downloads/bd22test6beta-with-xvmemonsters" title="BDv22 Beta Test 6 with XVME Monster Expansion NEW UPDATE" class="image"><img src="https://media.moddb.com/cache/images/downloads/1/308/307385/crop_120x90/add-image-to-image-2026-04-09T20.2.png" alt="BDv22 Beta Test 6 with XVME Monster Expansion NEW UPDATE" /></a>
				<div class="content">
			 
			<h4><a href="/mods/brutal-doom/downloads/bd22test6beta-with-xvmemonsters">BDv22 Beta Test 6 with XVME Monster Expansion NEW UPDATE</a></h4>
			<span class="date">
				<time datetime="2026-04-16T05:04:07+00:00">Apr 16 2026</time>			</span>
			<span class="subheading">
				Full Version <a href="/mods/brutal-doom/downloads/bd22test6beta-with-xvmemonsters" class="commenticon">4 comments</a>  			</span>
			<p>so in April 9th, 2026, I wanted to make a doom fork for the first time ever. so I made my idea true, it's basic, its brutal doom v22 test 6 with xvme...</p>		</div>
	</div>
			
</div>
<a href="/mods/some-other-mod/downloads/some-other-release-v1">Other mod (cross-link, must drop)</a>
</body></html>
`;

// ---- parseListing ------------------------------------------------------

describe('parseListing', () => {
  it('extracts mod cards with title, slug, url, thumb, summary, gameSlug', () => {
    const result = parsers.parseListing(LISTING_HTML, 'https://www.moddb.com/mods');
    assert.equal(result.mods.length, 2, 'expected 2 unique mods (dedup)');
    const m = result.mods[0];
    assert.equal(m.slug, 'brutal-doom');
    assert.equal(m.title, 'Brutal Doom');
    assert.equal(m.url, 'https://www.moddb.com/mods/brutal-doom');
    assert.match(m.thumbUrl, /^https:\/\/www\.moddb\.com\//);
    assert.match(m.summary, /gore-soaked overhaul/);
    assert.equal(m.gameSlug, 'doom');
    assert.equal(m.gameTitle, 'Doom');
    assert.equal(result.mods[1].gameSlug, 'doom-ii');
  });

  it('extracts gameSlug from real captured global keyword-search HTML', () => {
    // Regression for the user-reported bug: searching "legend of doom"
    // returned no results in our app despite the mod existing on moddb.
    // Root cause: moddb's kw= search ignores game= and returns matches
    // across all games. We need to filter client-side using each row's
    // gameSlug. This fixture is real HTML captured from
    //   https://www.moddb.com/mods?game=26&kw=legend+of+doom
    // via api.allorigins.win — every card is from a non-Doom game
    // (Half-Life, Rome: Total War, Star Wars, etc.).
    const html = MODDB_GLOBAL_KW_LEGEND_OF_DOOM_HTML;
    const r = parsers.parseListing(html, 'https://www.moddb.com/mods');
    assert.ok(r.mods.length >= 5, `expected several rows, got ${r.mods.length}`);

    // Every parsed mod has SOME gameSlug — moddb always renders one.
    for (const m of r.mods) {
      assert.ok(m.gameSlug, `mod ${m.slug} missing gameSlug`);
    }

    // None of these are Doom mods, so client-side filtering against
    // ALLOWED_GAME_SLUGS would correctly leave the result empty.
    const doomish = r.mods.filter((m) => m.gameSlug === 'doom' || m.gameSlug === 'doom-ii');
    assert.equal(doomish.length, 0, 'global kw= results should not be classified as Doom games');

    // Spot-check: at least one of the well-known game slugs is present.
    const slugs = new Set(r.mods.map((m) => m.gameSlug));
    assert.ok(
      slugs.has('half-life') || slugs.has('rome-total-war'),
      `expected a non-Doom game in the captured fixture; got ${[...slugs].join(', ')}`
    );
  });

  it('skips /games/ nav links (add, latest, top, etc.)', () => {
    // Real moddb pages link to /games/add, /games/latest, /games/top in
    // the header; those are global moddb pages, not actual games.
    const html = `
      <!doctype html><html><body>
        <div class="rowcontent">
          <a class="image" href="/mods/some-mod"><img src="/x.png"></a>
          <a href="/games/add">Add a game</a>
          <a href="/games/latest">Latest</a>
          <a href="/games/doom" title="Doom"><img src="/i.gif"></a>
          <h4><a href="/mods/some-mod">Some Mod</a></h4>
          <p class="summary">x</p>
        </div>
      </body></html>
    `;
    const r = parsers.parseListing(html, 'https://www.moddb.com/mods');
    assert.equal(r.mods.length, 1);
    assert.equal(r.mods[0].gameSlug, 'doom', 'must skip nav and pick the real game link');
  });

  it('dedupes by slug', () => {
    const r = parsers.parseListing(LISTING_HTML, 'https://www.moddb.com/mods');
    const slugs = r.mods.map((m) => m.slug);
    const unique = new Set(slugs);
    assert.equal(slugs.length, unique.size);
  });

  it('parses pagination current and last page', () => {
    const r = parsers.parseListing(LISTING_HTML, 'https://www.moddb.com/mods');
    assert.equal(r.pagination.current, 1);
    assert.equal(r.pagination.last, 10);
  });

  it('returns empty mods array on empty body', () => {
    const r = parsers.parseListing(
      '<!doctype html><html><body></body></html>',
      'https://www.moddb.com/mods'
    );
    assert.equal(r.mods.length, 0);
  });
});

// ---- parseModPage ------------------------------------------------------

describe('parseModPage', () => {
  it('extracts title, summary, screenshots, downloads url', () => {
    const r = parsers.parseModPage(MOD_PAGE_HTML, 'https://www.moddb.com/mods/brutal-doom');
    assert.equal(r.title, 'Brutal Doom');
    assert.match(r.summary, /Brutal Doom is a gameplay overhaul/);
    assert.ok(r.screenshots.length >= 2);
    assert.match(r.screenshots[0], /^https:\/\//);
    assert.equal(
      r.downloadsUrl,
      'https://www.moddb.com/mods/brutal-doom/downloads',
      'downloads url should resolve to the same mod, not another mod'
    );
  });

  it('falls back to deriving downloads url from the mod url', () => {
    const html = `<!doctype html><html><body>
      <h1>Foo Mod</h1><div id="profiledescription">x</div>
    </body></html>`;
    const r = parsers.parseModPage(html, 'https://www.moddb.com/mods/foo-mod');
    assert.equal(r.downloadsUrl, 'https://www.moddb.com/mods/foo-mod/downloads');
  });
});

// ---- parseDownloadsList ------------------------------------------------

describe('parseDownloadsList + pickBestDownload', () => {
  it('parses entries and tags isFull / isPatch / isDemo', () => {
    const list = parsers.parseDownloadsList(
      DOWNLOADS_LIST_HTML,
      'https://www.moddb.com/mods/brutal-doom/downloads'
    );
    assert.ok(list.length >= 4);
    const v22 = list.find((d) => /v22 Full/.test(d.title));
    assert.ok(v22);
    assert.equal(v22.isFull, true);
    assert.equal(v22.isPatch, false);
    assert.equal(v22.version, '22');
    assert.equal(v22.ext, 'zip');

    const patch = list.find((d) => /Patch/.test(d.title));
    assert.ok(patch);
    assert.equal(patch.isPatch, true);

    const demo = list.find((d) => /Demo/.test(d.title));
    assert.ok(demo);
    assert.equal(demo.isDemo, true);

    // The "back to mod" link must be filtered out.
    assert.equal(
      list.find((d) => /\/mods\/.+\/downloads$/.test(d.url)),
      undefined
    );
  });

  it('picks newest full release, .zip preferred over patches and demos', () => {
    const list = parsers.parseDownloadsList(
      DOWNLOADS_LIST_HTML,
      'https://www.moddb.com/mods/brutal-doom/downloads'
    );
    const best = parsers.pickBestDownload(list);
    assert.ok(best);
    assert.match(best.title, /v22/);
    assert.equal(best.isFull, true);
    assert.equal(best.isPatch, false);
  });

  it('returns null on empty list', () => {
    assert.equal(parsers.pickBestDownload([]), null);
    assert.equal(parsers.pickBestDownload(null), null);
  });

  it('drops sidebar nav links like /downloads/top', () => {
    // Regression: real moddb downloads pages contain a "popular this
    // week" sidebar with links to /downloads/top, /downloads/popular,
    // etc. Those slugs are global moddb indexes, not mod releases. v1
    // ranked /downloads/top above the actual brutal-doom releases and
    // tried to "play" the moddb top-downloads page.
    const html = `
      <!doctype html><html><body>
        <aside>
          <a href="/downloads/top">Top</a>
          <a href="/downloads/popular">Popular this week</a>
          <a href="/downloads/new">New</a>
        </aside>
        <table><tbody>
          <tr>
            <td><a href="/downloads/brutal-doom-v22-full-version">
              <img alt="Brutal Doom v22 Full Version" src="/x.png">
            </a></td>
            <td>Full Version</td>
          </tr>
        </tbody></table>
      </body></html>
    `;
    const list = parsers.parseDownloadsList(
      html,
      'https://www.moddb.com/mods/brutal-doom/downloads'
    );
    assert.equal(list.length, 1, 'sidebar nav links must be filtered out');
    assert.match(list[0].url, /brutal-doom-v22-full-version/);
    // Title fallback: link text was empty but the nested <img alt="..."> wins.
    assert.match(list[0].title, /Brutal Doom v22/);
  });

  it('drops cross-mod sidebar links (different mod slug)', () => {
    // moddb pages for mod A often link to "popular this week" downloads
    // belonging to mods B/C/D. These would otherwise pollute ranking.
    const html = `
      <!doctype html><html><body>
        <a href="/downloads/some-other-mod-v1">Other mod release</a>
        <a href="/downloads/yet-another-mod">Yet another</a>
        <a href="/downloads/brutal-doom-v22-full">Brutal Doom v22</a>
      </body></html>
    `;
    const list = parsers.parseDownloadsList(
      html,
      'https://www.moddb.com/mods/brutal-doom/downloads'
    );
    assert.equal(list.length, 1, 'only links containing mod slug should pass');
    assert.equal(list[0].slug, 'brutal-doom-v22-full');
  });

  it('still works without baseUrl (no slug filter)', () => {
    // When called without a baseUrl (e.g. from a test harness or future
    // call site), the slug-match filter should be a no-op.
    const html = `
      <!doctype html><html><body>
        <a href="/downloads/some-mod-v1">Some Mod</a>
      </body></html>
    `;
    const list = parsers.parseDownloadsList(html, '');
    assert.equal(list.length, 1);
  });

  it('parses real captured moddb /mods/<slug>/downloads page', () => {
    // Regression for the v1 bug where parseDownloadsList silently dropped
    // every real release because its slug regex only matched the legacy
    // /downloads/<slug> form. Real moddb pages use
    // /mods/<mod-slug>/downloads/<release-slug>, captured via
    // api.allorigins.win/raw?url= against
    // https://www.moddb.com/mods/brutal-doom/downloads.
    //
    // The fixture also contains:
    //   - global nav links (/downloads/top, /downloads/popular) — must drop
    //   - a cross-mod link (/mods/some-other-mod/downloads/...) — must drop
    const html = MODDB_BRUTAL_DOOM_DOWNLOADS_HTML;
    const list = parsers.parseDownloadsList(
      html,
      'https://www.moddb.com/mods/brutal-doom/downloads'
    );
    assert.ok(list.length >= 4, `expected >= 4 releases, got ${list.length}`);

    // Every entry must belong to brutal-doom.
    for (const d of list) {
      assert.match(
        d.url,
        /\/mods\/brutal-doom\/downloads\//,
        `cross-mod or nav link leaked through: ${d.url}`
      );
    }

    // The "Brutal Doom v22 Beta Test 6" release uses the real moddb
    // pattern of an <a class="image" title="..."> wrapping a thumbnail.
    // Title MUST come from the title attribute, not the empty link text.
    const v22 = list.find((d) => d.slug === 'brutal-doom-v22-beta-test');
    assert.ok(v22, 'expected to find brutal-doom-v22-beta-test');
    assert.match(v22.title, /Brutal Doom v22/i);
    assert.equal(v22.isDemo, true, 'subheading "Demo" must classify as demo');

    // No nav-blacklist or cross-mod links survived.
    assert.equal(
      list.find((d) => /\/downloads\/(top|popular)$/.test(d.url)),
      undefined
    );
    assert.equal(
      list.find((d) => /\/mods\/some-other-mod\//.test(d.url)),
      undefined
    );
  });

  it('handles markup with <table>/<tr> rows (no .rowcontent)', () => {
    // Regression: real moddb pages wrap downloads in tables that don't
    // match the .rowcontent selector. The flat-scan strategy must still
    // find the entries via document-wide a[href*="/downloads/"] queries.
    const html = `
      <!doctype html><html><body>
        <table><tbody>
          <tr>
            <td><a href="/downloads/some-mod-v3-full">Some Mod v3 Full Version (zip, 12 MB)</a></td>
            <td>Full Version</td>
          </tr>
          <tr>
            <td><a href="/downloads/some-mod-v3-patch">Some Mod v3 Patch (zip)</a></td>
            <td>Patch</td>
          </tr>
        </tbody></table>
        <a href="/mods/some-mod/downloads">Back to mod (must NOT appear)</a>
        <a href="/downloads/" title="all downloads (no slug, must NOT appear)">All</a>
      </body></html>
    `;
    const list = parsers.parseDownloadsList(html, 'https://www.moddb.com/mods/some-mod/downloads');
    const titles = list.map((d) => d.title);
    assert.ok(
      titles.some((t) => /v3 Full/.test(t)),
      'should find full release'
    );
    assert.ok(
      titles.some((t) => /v3 Patch/.test(t)),
      'should find patch'
    );
    assert.ok(!titles.some((t) => /Back to mod/.test(t)), 'must filter out the mod-tab back-link');
    assert.ok(!titles.some((t) => t === 'All'), 'must filter out slug-less /downloads/');

    const best = parsers.pickBestDownload(list);
    assert.match(best.title, /Full/);
  });
});

// ---- parseDownloadPage -------------------------------------------------

describe('parseDownloadPage', () => {
  it('extracts unique mirror URLs in document order', () => {
    const r = parsers.parseDownloadPage(
      DOWNLOAD_PAGE_HTML,
      'https://www.moddb.com/downloads/brutal-doom-v22-full'
    );
    assert.equal(r.mirrors.length, 2, 'duplicate USA Mirror 1 should dedupe');
    assert.match(r.mirrors[0].url, /usa-1/);
    assert.match(r.mirrors[1].url, /eu-1/);
    assert.equal(r.filename, 'brutal-doom-v22.zip');
    assert.ok(r.sizeBytes && r.sizeBytes > 200 * 1024 * 1024);
  });

  it('returns empty mirrors when page has none', () => {
    const r = parsers.parseDownloadPage(
      '<!doctype html><html><body>no mirrors here</body></html>',
      'https://www.moddb.com/downloads/x'
    );
    assert.equal(r.mirrors.length, 0);
  });
});

// ---- isCloudflareBlocked -----------------------------------------------

describe('isCloudflareBlocked', () => {
  it('detects the Cloudflare interstitial', () => {
    assert.equal(parsers.isCloudflareBlocked(CLOUDFLARE_HTML), true);
  });
  it('does not false-positive on normal HTML', () => {
    assert.equal(parsers.isCloudflareBlocked(LISTING_HTML), false);
    assert.equal(parsers.isCloudflareBlocked(''), false);
    assert.equal(parsers.isCloudflareBlocked(null), false);
  });
});

// ---- buildListingUrl + helpers ----------------------------------------

describe('internal helpers', () => {
  it('buildListingUrl defaults to game=26 with filter=t when no kw', () => {
    const url = internal.buildListingUrl({});
    assert.match(url, /game=26/);
    assert.match(url, /filter=t/, 'moddb canonical filter form requires filter=t');
  });

  it('buildListingUrl honors gameId override (multi-game fan-out)', () => {
    const url = internal.buildListingUrl({ gameId: 172 });
    assert.match(url, /game=172/);
    assert.ok(!/game=26/.test(url));
  });

  it('buildListingUrl drops game= when kw is set (moddb makes kw global)', () => {
    // Regression: when the user types into the search box, moddb's kw=
    // search ignores game= and returns results across all games. The
    // page even retitles to "Mods for Games". Sending game= alongside
    // kw= still works but is misleading; we strip it and rely on
    // client-side filtering via parseListing's gameSlug.
    const url = internal.buildListingUrl({ kw: 'legend of doom' });
    assert.match(url, /kw=legend\+of\+doom/);
    assert.ok(!/game=/.test(url), 'game= should be omitted on kw= queries');
    assert.ok(!/filter=t/.test(url), 'filter=t is not used on global kw= search');
  });

  it('buildListingUrl includes optional pagination/sort params', () => {
    const url = internal.buildListingUrl({
      page: 3,
      sort: 'visitstotal-desc'
    });
    assert.match(url, /page=3/);
    assert.match(url, /sort=visitstotal-desc/);
  });

  it('exposes MODDB_GAMES with Doom AND Doom II', () => {
    // Regression: v1 only included game id 26 (Doom 1993). Mods like
    // "Legend of Doom" are catalogued under Doom II (id 172) on moddb;
    // a single-game scope silently dropped them from the browser.
    const slugs = internal.MODDB_GAMES.map((g) => g.slug);
    assert.ok(slugs.includes('doom'), 'must include Doom (game id 26)');
    assert.ok(slugs.includes('doom-ii'), 'must include Doom II (game id 172)');
    assert.ok(internal.ALLOWED_GAME_SLUGS.has('doom'));
    assert.ok(internal.ALLOWED_GAME_SLUGS.has('doom-ii'));
  });

  it('parseSizeText handles MB/GB/KB', () => {
    assert.equal(internal.parseSizeText('12 MB'), 12 * 1024 * 1024);
    assert.equal(internal.parseSizeText('1.5 GB'), Math.round(1.5 * 1024 * 1024 * 1024));
    assert.equal(internal.parseSizeText('500 KB'), 500 * 1024);
    assert.equal(internal.parseSizeText('garbage'), null);
  });

  it('parseVersion sorts higher versions higher', () => {
    assert.ok(internal.parseVersion('22.0') > internal.parseVersion('21.5'));
    assert.ok(internal.parseVersion('1.0.1') > internal.parseVersion('1.0.0'));
    assert.equal(internal.parseVersion(null), 0);
  });

  it('extractModSlug pulls the slug out of any moddb URL', () => {
    assert.equal(internal.extractModSlug('https://www.moddb.com/mods/brutal-doom'), 'brutal-doom');
    assert.equal(internal.extractModSlug('/mods/foo-bar/downloads'), 'foo-bar');
    assert.equal(internal.extractModSlug('https://example.com/other'), null);
  });

  it('absolutize resolves relative against base', () => {
    assert.equal(
      internal.absolutize('/mods/x', 'https://www.moddb.com/mods'),
      'https://www.moddb.com/mods/x'
    );
    assert.equal(
      internal.absolutize('https://other.com/y', 'https://www.moddb.com/mods'),
      'https://other.com/y'
    );
  });
});
