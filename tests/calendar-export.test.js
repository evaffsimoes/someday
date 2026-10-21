/**
 * cue — The .ics file behind "Add all to my calendar" (buildIcs in js/views.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppScripts } = require('./helpers/load');

const app = loadAppScripts(['core', 'views']);
const ics = app.buildIcs([
  { id: 'a', artist: 'Arctic Monkeys', startDate: '2026-10-28', endDate: '2026-10-28', time: '21:00', venue: 'Altice Arena', city: 'Lisboa', company: 'Rita, João', ticketStatus: 'going', description: 'Doors 19:30; bring ID' },
  { id: 'b', artist: 'NOS Alive', startDate: '2027-07-08', endDate: '2027-07-10', city: 'Oeiras', ticketStatus: 'need_ticket' },
  { id: 'c', artist: 'Primavera Sound — a very long festival name that needs folding across lines', startDate: '2027-06-03', endDate: '2027-06-06', time: '17:00', city: 'Porto' }
]);
const lines = ics.split('\r\n');

test('uses CRLF line endings throughout', () => {
  assert.ok(!/[^\r]\n/.test(ics));
});

test('folds lines at 75 bytes', () => {
  assert.deepEqual(lines.filter(line => Buffer.byteLength(line, 'utf8') > 75), []);
});

test('has one VEVENT per event, with stable UIDs', () => {
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.ok(ics.includes('UID:a@cue-app'));
});

test('events without a time are all-day across every day, end date exclusive', () => {
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20270708'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20270711'));
});

test('timed events last 3 hours; multi-day timed events run to the end of the last day', () => {
  const start = new Date(2026, 9, 28, 21, 0);
  const utc = date => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  assert.ok(ics.includes(`DTSTART:${utc(start)}`));
  assert.ok(ics.includes(`DTEND:${utc(new Date(start.getTime() + 3 * 3600 * 1000))}`));
  assert.ok(ics.includes(`DTEND:${utc(new Date(2027, 5, 6, 23, 59))}`));
});

test('escapes commas and semicolons and lists who, ticket and notes', () => {
  assert.ok(ics.includes('LOCATION:Altice Arena\\, Lisboa'));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('DESCRIPTION:With Rita\\, João\\nTicket: Going\\nDoors 19:30\\; bring ID\\nSaved in cue'));
});
