import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChatText, maskProfanity } from '../live-chat/moderation.js';
import { validateMessageShape } from '../live-chat/moderate.js';
import { validateNick } from '../live-chat/nick.js';

describe('live chat moderation', () => {
  it('allows ordinary chat, peacock names, and Nigeria', () => {
    const allowed = [
      'hello',
      'maaaaaaaan',
      'lets go doooooooooom',
      'soooooooooooonic',
      'ddr ddr ddr ddr ddr',
      '67',
      'you are gay',
      'go on',
      'How do we explain Doom to a very angry parent?',
      'wdym "vertical axis"? Turn off free look in settings.',
      'I got the wordle in 3 guesses!!',
      'peacock',
      'cocktail',
      'Nigeria',
      'finger',
      'night',
      'niggle',
      'fagin',
      'grape',
      'dragoon',
      'scalpel',
      'pneumoultramicroscopicossilicovulcanoconiotico'
    ];
    for (const text of allowed) {
      assert.equal(classifyChatText(text, 'message'), null, text);
    }
    for (const nick of [
      'bigpeacock588',
      'blackpeacock910',
      'DoomSlayer',
      'cheeseboy69',
      'Marine'
    ]) {
      assert.equal(classifyChatText(nick, 'nick'), null, nick);
    }
  });

  it('rejects slur evasions that posted', () => {
    const slurs = [
      'nigger',
      'nigga',
      'nig0er',
      'n i g g a',
      'N GG ER',
      'NGGA KLLER',
      'Nggabruh',
      'niger',
      'nigg',
      'orangenigger256',
      'blacknigger123',
      'f a g',
      'faggot',
      'honky',
      'f4ggot'
    ];
    for (const text of slurs) {
      assert.equal(classifyChatText(text, 'message'), 'slur', text);
      assert.equal(classifyChatText(text, 'nick'), 'slur', text);
    }
  });

  it('rejects threats and sexual spam that posted', () => {
    assert.equal(classifyChatText('kys', 'message'), 'threat');
    assert.equal(classifyChatText('Kys', 'message'), 'threat');
    assert.equal(classifyChatText('k y s', 'message'), 'threat');
    assert.equal(classifyChatText('kill yourself', 'message'), 'threat');
    assert.equal(
      classifyChatText(
        'nilla if you dont respond im gonna take you and make shure the only way you can eat is through a feeding tube',
        'message'
      ),
      'threat'
    );
    assert.equal(classifyChatText('take the scalp of Joe', 'message'), 'threat');

    for (const text of [
      'dildo',
      'goon',
      'goooooooon',
      'goonin',
      'cocksucker',
      'goldcocknga3',
      'lesbianpussylover69',
      'Barry McCockiner',
      'i goon to jackals',
      'gaygreenraper'
    ]) {
      assert.equal(classifyChatText(text, 'message'), 'sexual', text);
    }
  });

  it('rejects junk and still allows a stretched doom cheer', () => {
    assert.equal(classifyChatText('.', 'message'), 'spam');
    assert.equal(classifyChatText(',', 'message'), 'spam');
    assert.equal(classifyChatText('ddddddddddd', 'message'), 'spam');
    assert.equal(classifyChatText('www'.repeat(8), 'message'), 'spam');
    assert.equal(classifyChatText('أنا أسمع أصواتاً غريبة في الظلام', 'message'), null);
    assert.equal(
      classifyChatText('Yall should play GRAND DAD\n\n                    siivagunner', 'message'),
      null
    );
    assert.equal(
      classifyChatText('According to all known laws of aviation, a bee should not', 'message'),
      null
    );
    assert.equal(classifyChatText('THE ANTS ARE IN MY SKIN', 'message'), null);
    assert.equal(classifyChatText('kys', 'nick'), 'threat');
    assert.equal(classifyChatText('....', 'nick'), null);
  });

  it('masks ordinary swears, including spaced and dotted forms, and leaves peacock', () => {
    assert.equal(maskProfanity('fuck'), 'f***');
    assert.equal(maskProfanity('fucking'), 'f***ing');
    assert.equal(maskProfanity('RETARDS'), 'R*****S');
    assert.equal(maskProfanity('shit'), 's***');
    assert.equal(maskProfanity('sh1t'), 's***');
    assert.equal(maskProfanity('s h i t'), 's***');
    assert.equal(maskProfanity('s.h.i.t'), 's***');
    assert.equal(maskProfanity('SALTY A S S H O L E'), 'SALTY A******');
    assert.equal(maskProfanity('SALTY BASSHOLE'), 'SALTY BA******');
    assert.equal(maskProfanity('amk'), 'a**');
    assert.equal(maskProfanity('a m k'), 'a**');
    assert.equal(maskProfanity('peacock'), 'peacock');
    assert.equal(maskProfanity('f***'), 'f***');
    assert.equal(classifyChatText('shit', 'message'), null);
    assert.equal(classifyChatText('s h i t', 'message'), null);
    assert.equal(classifyChatText('n*****', 'message'), 'slur');
    assert.equal(classifyChatText('dih', 'message'), 'sexual');
    assert.equal(classifyChatText('comedor de bumbum 24', 'nick'), 'sexual');
    assert.equal(classifyChatText('ill fuck ur mom', 'message'), 'sexual');
  });

  it('shows the same block on the client nick and message gates', () => {
    assert.equal(validateNick('N GG ER'), 'Name not allowed');
    assert.equal(validateNick('bigpeacock588'), null);
    assert.equal(validateMessageShape('kys'), 'Message not allowed');
    assert.equal(validateMessageShape('hello'), null);
    assert.equal(validateMessageShape('a'.repeat(131)), 'Max 130 characters');
    assert.equal(validateMessageShape('a'.repeat(121)), 'Message not allowed');
    assert.equal(validateMessageShape(`${'hello '.repeat(20)}there`.slice(0, 121)), null);
  });
});
