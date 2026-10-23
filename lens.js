'use strict';
// Which lens is making a camera's picture, and its zoom (lenses.now on the manager): a small chip for the camera card
// (app.js) and the Operate page's tiles (operate.js). The colour says the lens: ultrawide, main or telephoto.
window.lensChip = now => {
  const chip = document.createElement('span');
  const name = { ultrawide: 'Ultrawide', main: 'Main', telephoto: 'Telephoto' }[now.kind] || 'Lens';
  const crop = now.digital > 1.05 ? ` (${now.digital.toFixed(1)}× crop)` : '';
  chip.className = `lens-chip ${now.kind}`;
  chip.textContent = `${name} ${now.times.toFixed(1)}× lens · zoom ${now.zoom.toFixed(1)}×${crop}`;
  chip.title = now.reported ? 'As the phone reports it this moment: it hands over between its lenses by itself as it zooms (app 0.9.38).'
    : 'The lens chosen for it (the phone reports the lens serving each moment from app 0.9.38).';
  return chip;
};
