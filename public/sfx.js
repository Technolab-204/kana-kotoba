/* sfx.js — sons personnalisés. Remplace sfx() : lit public/sound/*.mp3, sinon le son d'origine. */
const SOUND_FILES = { ok: "sound/ok.mp3", ko: "sound/ko.mp3", tap: "sound/tap.mp3",
    buy: "sound/buy.mp3", fanfare: "sound/fanfare.mp3", whoosh: "sound/whoosh.mp3" };
const SOUND_BUF = {}, SOUND_TRIED = {};

async function loadSound(name) {
    if (SOUND_TRIED[name]) return SOUND_BUF[name] || null;
    SOUND_TRIED[name] = true;
    try {
        const c = audio(); if (!c) return null;
        const r = await fetch(SOUND_FILES[name]);
        if (r.ok) SOUND_BUF[name] = await c.decodeAudioData(await r.arrayBuffer());
    } catch (e) {}
    return SOUND_BUF[name] || null;
}

function synthSfx(name) {
    if (name === "ok") { tone(523, .12, "triangle", .2); tone(659, .12, "triangle", .2, .08); tone(784, .22, "triangle", .2, .16); }
    if (name === "ko") tone(220, .32, "sawtooth", .12, 0, 110);
    if (name === "tap") tone(900, .04, "square", .04);
    if (name === "buy") { tone(880, .1, "triangle", .15); tone(1320, .18, "triangle", .15, .09); }
    if (name === "fanfare") [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, .25, "triangle", .2, i * .11));
}

function sfx(name) {
    if (!data.sound) return;
    const c = audio(); if (!c) return;
    if (c.state === "suspended") c.resume();
    loadSound(name).then(buf => {
        if (buf) {
            const s = c.createBufferSource(), g = c.createGain();
            s.buffer = buf; g.gain.value = .8;
            s.connect(g).connect(c.destination); s.start();
        } else synthSfx(name);
    });
}

// Précharge les sons dès le démarrage
Object.keys(SOUND_FILES).forEach(loadSound);