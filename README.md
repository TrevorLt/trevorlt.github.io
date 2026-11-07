# Trevor Lin

Personal portfolio at **https://trevorlt.github.io/**.

A static site served by GitHub Pages from the repository root. The ReactBits Tech Text source is mounted on page headings and bundled to `assets/`; only the hero wordmark sweeps automatically, while other headings animate on hover. The rest of the site stays plain HTML, CSS and JavaScript. The BattleBot preview loads Model Viewer from its CDN, and the generator is drawn with inline SVG.

## Local preview

```sh
python3 -m http.server 4173
```

Open http://localhost:4173. Edit `index.html`, `styles.css` and `script.js`. To change the Tech Text widget, edit `src/tech-text.jsx` or `src/reactbits/TechText.jsx`, run `npm ci && npm run build:tech-text`, and commit the generated files in `assets/`. Fonts and images are hosted locally. The scan illustration is procedural and does not represent measured results. The generator preview switches between a rotor view and a hand-cranked assembly; its three-phase graph is an estimate scaled from the report's 2.72 V peak at 25 Hz. The Codex display study uses illustrative values and provides double-ring, large-readout and quota-state controls.

## Regression checks

With the preview server running, open http://localhost:4173/tests/browser.html. The page checks saved quota values, recharge and mode switching, both displays, interrupted animations, invalid URL values, rapid disclosure reversals, the BattleBot GLB structure, 2206 cross mount on the source upright plate's four-hole pattern, aligned motor and weapon pulleys with a direct belt, a weapon shaft ending inside the body side walls, replaceable-armor separation, rear motors and wheel motion, reversible exploded view, isometric camera, the generator's view switching, crank-driven 3:1 motion and estimated voltage, equal project preview widths, and drivetrain controls. It shows PASS or FAIL without local packages; the 3D preview loads Model Viewer from its CDN.

Run `npm run test:browser` to launch the same checks in headless Chrome. GitHub Actions runs this command on every pull request and push to `main`.

## Credits

- Codex Usage Status app icon: [TrevorLt/codex-usage-status](https://github.com/TrevorLt/codex-usage-status), MIT. The application continues the original work of [tollenceld](https://github.com/tollenceld/codex-usage-status).
- Anton by Vernon Adams and Work Sans by Wei Huang: SIL Open Font License; license files are in `assets/`.
- Tech Text by David Haz / ReactBits: source from [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits), used for the hero wordmark and hover-only section/project headings; license terms are in [`licenses/REACTBITS-LICENSE.md`](licenses/REACTBITS-LICENSE.md).
- Pico 2 reference photograph: “Macro photograph of the RP2350 microcontroller on a Raspberry Pi Pico 2 board” by Profpcde, [Wikimedia Commons](https://commons.wikimedia.org/w/index.php?curid=169801139), CC0. Displayed cropped, with credit in the footer. It is a platform reference image.
- Scanner illustration and portfolio implementation created with AI assistance.

Selected projects include BattleBot (CAD assembly), a three-phase AC generator, CryptScan (in development), and Codex Usage Status. The generator uses eight N52 magnets and eight 60-turn copper coils; its report records 2.72 V peak at 25 Hz, 0.49 A peak, and 1.33 W peak with 5.6 Ω internal resistance. The interactive generator drawing shows the rotor, coils, 3:1 hand-crank gearing, and an estimated three-phase waveform. The waveform is scaled from the report's single 25 Hz test point, so it is illustrative rather than a per-phase calibration. The BattleBot is an Antweight vertical spinner with replaceable 3D-printed ABS armor designed for quick swaps between matches or after damage. Its preview uses Google Model Viewer 4.4.0 with a local Onshape GLB export, an isometric default view, an exploded armor-removal animation, a 2206 brushless motor (22 mm diameter × 6 mm stator) cross-mounted to the source assembly's upright four-hole plate, a direct parallel-axis timing-belt weapon drive, an inset weapon shaft that stays within the body width, and two rear brushed motors that animate the original wheels. The project previews use the same width. The source assembly and native wheels are preserved; the added BattleBot hardware is a visualization and has not been physically fit-checked, and the linked Onshape document remains unchanged. Personal contact information is not included.
