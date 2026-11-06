import type { Plan } from './types'

// A made-up example: two neighbouring flats joined with an opening in the
// wall between them, kitchen in flat B removed, a radiator moved. Not real
// geometry for any address — used for development and tests.
export function demoPlan(id = 'demo'): Plan {
  return {
    id,
    name: 'Exempel – sammanbyggnad av två lägenheter',
    sheet: {
      paper: 'A3',
      orientation: 'landscape',
      scale: 50,
      northAngle: 0,
      titleBlock: {
        project: 'Exempel: väggöppning mellan lgh A och B',
        property: 'Stockholm Exempel 1',
        address: 'Exempelgatan 1',
        apartments: 'Lgh 1101, 1102',
        floor: 'Plan 1 tr',
        drawingNumber: 'A-01',
        author: 'Exempel',
        date: '2026-10-22',
        revision: '',
      },
    },
    walls: [
      { id: 'yt-n', a: { x: 0, y: 0 }, b: { x: 12000, y: 0 }, thickness: 450, phase: 'existing', loadBearing: true },
      { id: 'yt-o', a: { x: 12000, y: 0 }, b: { x: 12000, y: 7000 }, thickness: 450, phase: 'existing', loadBearing: true },
      { id: 'yt-s', a: { x: 12000, y: 7000 }, b: { x: 0, y: 7000 }, thickness: 450, phase: 'existing', loadBearing: true },
      { id: 'yt-v', a: { x: 0, y: 7000 }, b: { x: 0, y: 0 }, thickness: 450, phase: 'existing', loadBearing: true },
      { id: 'lgh-grans', a: { x: 6000, y: 0 }, b: { x: 6000, y: 7000 }, thickness: 250, phase: 'existing', fireRating: 'EI60', fireRatingAfter: '', apartmentBoundary: true },
      { id: 'a-hall', a: { x: 0, y: 3500 }, b: { x: 3500, y: 3500 }, thickness: 100, phase: 'existing' },
      { id: 'a-kok', a: { x: 3500, y: 0 }, b: { x: 3500, y: 3500 }, thickness: 100, phase: 'demolish' },
      { id: 'a-kok-hall', a: { x: 3500, y: 3500 }, b: { x: 6000, y: 3500 }, thickness: 100, phase: 'existing' },
      { id: 'b-kok', a: { x: 6000, y: 4000 }, b: { x: 12000, y: 4000 }, thickness: 100, phase: 'existing' },
    ],
    openings: [
      { id: 'f1', wallId: 'yt-n', kind: 'window', offset: 1200, width: 1200, phase: 'existing' },
      { id: 'f2', wallId: 'yt-n', kind: 'window', offset: 4200, width: 1200, phase: 'existing' },
      { id: 'f3', wallId: 'yt-n', kind: 'window', offset: 7300, width: 1200, phase: 'existing' },
      { id: 'f4', wallId: 'yt-n', kind: 'window', offset: 10000, width: 1200, phase: 'existing' },
      { id: 'd-a-hall', wallId: 'a-hall', kind: 'door', offset: 2000, width: 800, phase: 'existing', hinge: 'a', swing: 'left' },
      { id: 'd-a-kok', wallId: 'a-kok-hall', kind: 'door', offset: 900, width: 800, phase: 'existing', hinge: 'b', swing: 'left' },
      { id: 'd-b-kok', wallId: 'b-kok', kind: 'door', offset: 1800, width: 800, phase: 'existing', hinge: 'b', swing: 'right' },
      { id: 'ny-oppning', wallId: 'lgh-grans', kind: 'opening', offset: 4600, width: 900, height: 2100, phase: 'new' },
    ],
    fixtures: [
      { id: 'kok-b', kind: 'kitchen', x: 7500, y: 6450, w: 2400, d: 600, phase: 'demolish', label: 'Kök' },
      { id: 'flakt-b', kind: 'exhaust', x: 8900, y: 6450, w: 250, d: 250, phase: 'demolish' },
      { id: 'franluft-b', kind: 'exhaust', x: 8900, y: 5600, w: 250, d: 250, phase: 'new' },
      { id: 'propp-b', kind: 'plug', x: 6450, y: 6550, w: 250, d: 250, phase: 'new' },
      { id: 'rad-b', kind: 'radiator', x: 10000, y: 350, w: 1000, d: 100, phase: 'demolish' },
      { id: 'rad-b-ny', kind: 'radiator', x: 11000, y: 350, w: 1000, d: 100, phase: 'new' },
      { id: 'schakt', kind: 'shaft', x: 6375, y: 4300, w: 500, d: 400, phase: 'existing' },
    ],
    rooms: [
      { id: 'r-a-rum', name: 'Rum', at: { x: 1750, y: 1750 }, apartment: 'A' },
      { id: 'r-a-kok', name: 'Kök', at: { x: 4750, y: 1750 }, apartment: 'A' },
      { id: 'r-a-hall', name: 'Hall', at: { x: 3000, y: 5300 }, apartment: 'A' },
      { id: 'r-b-rum', name: 'Rum', at: { x: 9000, y: 2000 }, apartment: 'B' },
      { id: 'r-b-kok', name: 'Kök', renamed: 'Rum', at: { x: 7600, y: 5400 }, apartment: 'B' },
    ],
    dimensions: [{ id: 'dm-total', a: { x: -225, y: 7225 }, b: { x: 12225, y: 7225 }, offset: -600 }],
    notes: [],
  }
}
