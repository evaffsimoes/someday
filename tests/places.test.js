/**
 * cue — City and venue suggestions in the event form (js/places.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { loadAppScripts } = require('./helpers/load');

const app = loadAppScripts(['core', 'places']);
const setEvents = events => vm.runInContext(`state.events = ${JSON.stringify(events)}`, app);
const values = list => Array.from(list, option => option.value);

test('ignores accents and case', () => {
  setEvents([]);
  assert.equal(values(app.suggestPlaces('city', 'evora'))[0], 'Évora');
  assert.equal(values(app.suggestPlaces('city', 'GUIMA'))[0], 'Guimarães');
  assert.equal(values(app.suggestPlaces('venue', 'maus habitos'))[0], 'Maus Hábitos');
});

test('names that start with the text come before names that only contain it', () => {
  setEvents([]);
  const cities = values(app.suggestPlaces('city', 'por'));
  assert.equal(cities[0], 'Porto');
  assert.ok(cities.indexOf('Portimão') < cities.indexOf('Póvoa de Varzim') || !cities.includes('Póvoa de Varzim'));
  // "Coura" is a word inside "Paredes de Coura"
  assert.deepEqual(values(app.suggestPlaces('city', 'coura')), ['Paredes de Coura']);
});

test('venues in the chosen city come first, with their city shown', () => {
  setEvents([]);
  const inPorto = app.suggestPlaces('venue', 'coliseu', 'porto');
  assert.deepEqual(values(inPorto), ['Coliseu do Porto', 'Coliseu dos Recreios']);
  assert.equal(inPorto[0].detail, 'Porto');
  assert.equal(values(app.suggestPlaces('venue', 'coliseu', 'Lisboa'))[0], 'Coliseu dos Recreios');
});

test('former names find the venue, without listing it twice', () => {
  setEvents([{ id: 'a', venue: 'Altice Arena', city: 'Lisboa' }, { id: 'b', venue: 'altice arena', city: 'Lisboa' }]);
  assert.deepEqual(values(app.suggestPlaces('venue', 'altice')), ['MEO Arena', 'Altice Forum Braga']);
  assert.equal(values(app.suggestPlaces('venue', 'rosa mota'))[0], 'Super Bock Arena');
});

test('festivals are not offered as venues', () => {
  setEvents([]);
  for (const festival of ['NOS Alive', 'Primavera Sound', 'Rock in Rio', 'Super Bock Super Rock']) {
    assert.ok(!values(app.suggestPlaces('venue', festival)).includes(festival), festival);
  }
});

test('your own cities and venues are suggested, once each', () => {
  setEvents([
    { id: 'a', venue: 'Musicbox', city: 'lisboa' },
    { id: 'b', venue: 'Stereogun', city: 'Leiria' },
    { id: 'c', venue: 'stereogun', city: 'Leiria' },
    { id: 'd', city: 'Tomar' }
  ]);
  assert.deepEqual(values(app.suggestPlaces('venue', 'stereo')), ['Stereogun']);
  assert.equal(app.suggestPlaces('venue', 'stereo')[0].detail, 'Leiria');
  assert.deepEqual(values(app.suggestPlaces('city', 'tom')), ['Tomar']);
  assert.equal(values(app.suggestPlaces('city', 'lis')).filter(city => city.toLowerCase() === 'lisboa').length, 1);
});

test('a venue tells its city', () => {
  setEvents([{ id: 'a', venue: 'Stereogun', city: 'Leiria' }]);
  assert.equal(app.cityOfVenue('hard club'), 'Porto');
  assert.equal(app.cityOfVenue('Altice Arena'), 'Lisboa');
  assert.equal(app.cityOfVenue('Stereogun'), 'Leiria');
  assert.equal(app.cityOfVenue('Nowhere'), '');
});

test('the exact value already typed is not suggested again, and the list is short', () => {
  setEvents([]);
  assert.ok(!values(app.suggestPlaces('city', 'Porto')).includes('Porto'));
  assert.ok(app.suggestPlaces('city', '').length <= 6);
});
