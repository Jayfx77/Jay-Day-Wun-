// Neighbourhoods across Greater Accra, grouped for the search dropdown.
const NEIGHBOURHOODS = [
  'Abelemkpe', 'Abeka', 'Abokobi', 'Achimota', 'Adabraka', 'Adenta', 'Airport Residential',
  'Amasaman', 'Asylum Down', 'Ashaiman', 'Ashongman', 'Awoshie', 'Bubuashie', 'Burma Camp',
  'Cantonments', 'Dansoman', 'Dome', 'Dzorwulu', 'East Legon', 'East Legon Hills', 'Gbawe',
  'Haatso', 'Kaneshie', 'Kasoa', 'Kokomlemle', 'Kpone', 'Kwabenya', 'Labadi', 'Labone',
  'Lapaz', 'Lashibi', 'Legon', 'Madina', 'Mallam', 'McCarthy Hill', 'North Kaneshie',
  'North Legon', 'North Ridge', 'Nungua', 'Oyarifa', 'Osu', 'Pokuase', 'Ridge',
  'Roman Ridge', 'Sakumono', 'Sakaman', 'Spintex', 'Taifa', 'Teshie', 'Tema',
  'Tema Community 25', 'Tesano', 'Trasacco', 'Weija', 'West Legon', 'Ablekuma',
].sort();

const PROPERTY_TYPES = {
  single_room: 'Single room',
  chamber_hall: 'Chamber & hall',
  self_contained: 'Self-contained',
  studio: 'Studio apartment',
  apartment: 'Apartment / flat',
  townhouse: 'Townhouse',
  house: 'Detached house',
};

const FURNISHING = {
  unfurnished: 'Unfurnished',
  semi: 'Semi-furnished',
  furnished: 'Fully furnished',
};

const AMENITIES = {
  water_reliable: 'Reliable water (GWCL)',
  borehole: 'Borehole / poly tank',
  prepaid_meter: 'Own ECG prepaid meter',
  generator: 'Generator / solar backup',
  ac: 'Air conditioning',
  security: 'Security / gated',
  parking: 'Parking',
  wardrobe: 'Built-in wardrobes',
  kitchen: 'Private kitchen',
  porch: 'Porch / balcony',
  internet: 'Fibre internet ready',
  pool: 'Swimming pool',
  gym: 'Gym',
  pets: 'Pets allowed',
};

const REPORT_REASONS = {
  scam: 'Suspected scam / fake listing',
  agent: 'Poster is an agent, not the owner',
  unavailable: 'Property no longer available',
  wrong_info: 'Wrong price or details',
  offensive: 'Offensive content',
  other: 'Other',
};

// Viewing time windows (Ghana time = GMT all year). `short` is for SMS, so plain ASCII only
// (characters like en dashes force the more expensive Unicode SMS encoding).
const TIME_WINDOWS = {
  morning: { label: 'Morning (8am – 12pm)', short: '8am-12pm', start: 8, end: 12 },
  afternoon: { label: 'Afternoon (12pm – 4pm)', short: '12-4pm', start: 12, end: 16 },
  evening: { label: 'Evening (4pm – 7pm)', short: '4-7pm', start: 16, end: 19 },
};

module.exports = { TIME_WINDOWS, NEIGHBOURHOODS, PROPERTY_TYPES, FURNISHING, AMENITIES, REPORT_REASONS };
