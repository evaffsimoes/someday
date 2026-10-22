/**
 * cue — City and venue suggestions for the event form: known places in Portugal plus the ones
 * used in your own events, matched ignoring accents and case, shown in an in-app list.
 */

const KNOWN_CITIES = [
  'Lisboa', 'Porto', 'Vila Nova de Gaia', 'Matosinhos', 'Braga', 'Coimbra', 'Aveiro', 'Faro',
  'Cascais', 'Oeiras', 'Sintra', 'Almada', 'Guimarães', 'Leiria', 'Setúbal', 'Viseu', 'Évora',
  'Funchal', 'Ponta Delgada', 'Viana do Castelo', 'Vila do Conde', 'Póvoa de Varzim',
  'Paredes de Coura', 'Albufeira', 'Portimão', 'Sines', 'Odemira'
];

// Venues with their city; `aka` holds former or informal names that should still find them
const KNOWN_VENUES = [
  { name: 'MEO Arena', city: 'Lisboa', aka: ['Altice Arena', 'Pavilhão Atlântico'] },
  { name: 'Coliseu dos Recreios', city: 'Lisboa', aka: ['Coliseu de Lisboa'] },
  { name: 'LAV - Lisboa ao Vivo', city: 'Lisboa', aka: ['LAV', 'Lisboa ao Vivo'] },
  { name: 'Lux Frágil', city: 'Lisboa', aka: ['Lux'] },
  { name: 'Musicbox', city: 'Lisboa' },
  { name: 'RCA Club', city: 'Lisboa', aka: ['RCA'] },
  { name: 'Teatro Tivoli BBVA', city: 'Lisboa', aka: ['Tivoli'] },
  { name: 'Centro Cultural de Belém', city: 'Lisboa', aka: ['CCB'] },
  { name: 'Estádio da Luz', city: 'Lisboa' },
  { name: 'Parque Tejo', city: 'Lisboa', aka: ['Parque Papa Francisco'] },
  { name: 'Parque Eduardo VII', city: 'Lisboa' },
  { name: 'Passeio Marítimo de Algés', city: 'Oeiras', aka: ['Algés'] },
  { name: 'Coliseu do Porto', city: 'Porto', aka: ['Coliseu Porto Ageas'] },
  { name: 'Super Bock Arena', city: 'Porto', aka: ['Pavilhão Rosa Mota'] },
  { name: 'Casa da Música', city: 'Porto' },
  { name: 'Hard Club', city: 'Porto' },
  { name: 'Hot Five Jazz & Blues Club', city: 'Porto', aka: ['Hot Five'] },
  { name: 'Maus Hábitos', city: 'Porto' },
  { name: 'Hotel Mouco', city: 'Porto' },
  { name: 'Jardins do Palácio de Cristal', city: 'Porto', aka: ['Palácio de Cristal'] },
  { name: 'Parque da Cidade', city: 'Porto' },
  { name: 'Estádio do Dragão', city: 'Porto' },
  { name: 'Theatro Circo', city: 'Braga' },
  { name: 'Altice Forum Braga', city: 'Braga' },
  { name: 'Salão Brazil', city: 'Coimbra' },
  { name: 'Convento São Francisco', city: 'Coimbra' },
  { name: 'Teatro Aveirense', city: 'Aveiro' }
];

const MAX_SUGGESTIONS = 6;

// "Évora" and "evora" compare equal
function normalizePlace(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Known places merged with the ones in your events; duplicates (any case or accents) collapse into
// one entry. Your own spelling only wins for places that aren't in the known lists.
function placeIndex() {
  const cities = new Map();
  KNOWN_CITIES.forEach(name => cities.set(normalizePlace(name), { name, uses: 0 }));

  const venues = new Map();
  KNOWN_VENUES.forEach(venue => venues.set(normalizePlace(venue.name), { ...venue, aka: venue.aka || [], uses: 0 }));
  const venueByAlias = new Map();
  venues.forEach(venue => venue.aka.forEach(alias => venueByAlias.set(normalizePlace(alias), venue)));

  state.events.forEach(event => {
    const city = String(event.city || '').trim();
    if (city) {
      const key = normalizePlace(city);
      if (!cities.has(key)) cities.set(key, { name: city, uses: 0 });
      cities.get(key).uses++;
    }
    const venueName = String(event.venue || '').trim();
    if (venueName) {
      const key = normalizePlace(venueName);
      const known = venues.get(key) || venueByAlias.get(key);
      if (known) {
        known.uses++;
      } else {
        venues.set(key, { name: venueName, city, aka: [], uses: 1 });
      }
    }
  });

  return { cities: [...cities.values()], venues: [...venues.values()] };
}

// How well a place matches what was typed: start of the name, start of a word, anywhere, or not
function matchScore(names, query) {
  if (!query) return 1;
  let best = 0;
  names.forEach(name => {
    const text = normalizePlace(name);
    if (text.startsWith(query)) best = Math.max(best, 3);
    else if (text.split(/[\s\-/]+/).some(word => word.startsWith(query))) best = Math.max(best, 2);
    // Inside a word only from 3 letters, or "co" would match half the list
    else if (query.length >= 3 && text.includes(query)) best = Math.max(best, 1);
  });
  return best;
}

// Suggestions for the city or venue field. Venues in the chosen city come first.
function suggestPlaces(kind, typed, cityContext = '') {
  const query = normalizePlace(typed);
  const index = placeIndex();
  const sameCity = normalizePlace(cityContext);

  const items = (kind === 'city' ? index.cities : index.venues)
    .map(place => {
      const score = matchScore([place.name, ...(place.aka || [])], query);
      const inCity = kind === 'venue' && sameCity && normalizePlace(place.city) === sameCity ? 1 : 0;
      return { place, score, inCity };
    })
    // Hide only what's already typed exactly; "evora" still offers "Évora"
    .filter(item => item.score > 0 && item.place.name !== String(typed || '').trim())
    // Names that merely contain the text ("co" in "Mouco") go after the real matches from anywhere
    .sort((a, b) => (b.score > 1) - (a.score > 1) || b.inCity - a.inCity || b.score - a.score || b.place.uses - a.place.uses
      || a.place.name.length - b.place.name.length || a.place.name.localeCompare(b.place.name));

  return items.slice(0, MAX_SUGGESTIONS).map(({ place }) => ({
    value: place.name,
    detail: kind === 'venue' ? place.city || '' : ''
  }));
}

// The city of a venue name (known list or your past events), or ''
function cityOfVenue(venueName) {
  const key = normalizePlace(venueName);
  const venue = placeIndex().venues.find(place => normalizePlace(place.name) === key
    || (place.aka || []).some(alias => normalizePlace(alias) === key));
  return venue ? venue.city : '';
}

// Shows a suggestion list under an input. `options()` returns [{ value, detail }];
// `onPick(option)` runs after the value is filled in.
function attachPlaceSuggestions(input, { options, onPick } = {}) {
  const field = input.closest('.field');
  const list = document.createElement('div');
  list.className = 'place-suggestions';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  field.classList.add('has-suggestions');
  field.appendChild(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  let current = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
  };

  const pick = option => {
    input.value = option.value;
    // Same events as typing, so other listeners (like the "Not found" flags) react
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    if (onPick) onPick(option);
  };

  const render = () => {
    current = options();
    if (!current.length) {
      close();
      return;
    }
    list.innerHTML = current.map((option, i) => `
      <button type="button" class="place-option${i === active ? ' active' : ''}" role="option" aria-selected="${i === active}" data-index="${i}">
        <span>${escapeHtml(option.value)}</span>${option.detail ? `<small>${escapeHtml(option.detail)}</small>` : ''}
      </button>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  // pointerdown + preventDefault keeps the keyboard open and the input focused while picking
  list.addEventListener('pointerdown', event => {
    const button = event.target.closest('.place-option');
    if (!button) return;
    event.preventDefault();
    pick(current[Number(button.dataset.index)]);
  });
  // Keyboard users (and screen readers) activate the buttons with click
  list.addEventListener('click', event => {
    const button = event.target.closest('.place-option');
    if (button && !list.hidden) pick(current[Number(button.dataset.index)]);
  });

  input.addEventListener('focus', () => {
    render();
    // Keep the field and its list above the on-screen keyboard
    setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
  });
  input.addEventListener('input', () => {
    active = -1;
    // Filled in by code (a picked venue sets the city) shouldn't pop the list open
    if (document.activeElement === input) render();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', event => {
    if (list.hidden) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + current.length) % current.length;
      render();
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      pick(current[active]);
    } else if (event.key === 'Escape') {
      close();
    }
  });
}
