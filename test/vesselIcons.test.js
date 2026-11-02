import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASS_STYLES, boatColor, boatIconHtml } from '../src/vesselIcons.js';

test('Chaque classe a une couleur propre et une silhouette adaptée', () => {
    const styles = Object.values(CLASS_STYLES);
    assert.equal(new Set(styles.map(style => style.color)).size, styles.length);
    assert.equal(CLASS_STYLES['Ocean Fifty'].kind, 'trimaran');
    assert.equal(CLASS_STYLES.Ultim.kind, 'trimaran');
    assert.equal(CLASS_STYLES['Vintage Multi'].kind, 'multihull');
    for (const className of ['IMOCA', 'Class40', 'Vintage Mono']) assert.equal(CLASS_STYLES[className].kind, 'monohull');
});

test('Le cap est horaire depuis le nord, et seuls les nombres finis entrent dans le SVG', () => {
    assert.match(boatIconHtml({ heading: 90 }), /rotate\(90 20 20\)/);
    assert.match(boatIconHtml({ heading: -90 }), /rotate\(270 20 20\)/);
    for (const heading of ['90\" onload=\"alert(1)', Infinity, NaN, null]) {
        const html = boatIconHtml({ heading, className: '<script>alert(1)</script>', id: '\" onload=\"alert(1)' });
        assert.match(html, /rotate\(0 20 20\)/);
        assert.doesNotMatch(html, /onload|<script|NaN|Infinity/);
    }
});

test('La couleur individuelle est reproductible et indépendante de la classe', () => {
    assert.equal(boatColor({ id: 5, className: 'IMOCA' }, 'boat'), boatColor({ id: 5, className: 'Ultim' }, 'boat'));
    assert.notEqual(boatColor({ id: 5 }, 'boat'), boatColor({ id: 6 }, 'boat'));
    assert.equal(boatColor({ id: '<script>', className: 'Ultim' }, 'boat'), CLASS_STYLES.Ultim.color);
    assert.equal(boatColor(null), CLASS_STYLES['Non renseignée'].color);
    assert.equal(boatColor({ className: '__proto__' }), CLASS_STYLES['Non renseignée'].color);
});

test('Sélection et position ancienne restent visibles avec toutes les silhouettes', () => {
    for (const className of Object.keys(CLASS_STYLES)) {
        const html = boatIconHtml({ id: 12, className, heading: 248 }, { selected: true, stale: true });
        assert.match(html, /<circle/);
        assert.match(html, /opacity:0.5/);
        assert.match(html, /rotate\(248 20 20\)/);
    }
});
