#!/usr/bin/env node
/**
 * after_prepare hook for cordova-plugin-starl-splash.
 *
 * cordova-android regenerates res/values/cdv_themes.xml on every prepare,
 * restoring windowSplashScreenAnimatedIcon -> @drawable/ic_cdv_splashscreen
 * (the gray cordova logo). Our config-file edit appends a second item
 * pointing at @drawable/ic_starl_splashscreen, but AAPT2 keeps BOTH and the
 * platform reads the FIRST, so the cordova logo wins.
 *
 * This hook removes the cordova default line, leaving only the starl icon.
 */
const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    const themePath = path.join(
        context.opts.projectRoot,
        'platforms', 'android', 'app', 'src', 'main', 'res', 'values', 'cdv_themes.xml'
    );

    if (!fs.existsSync(themePath)) return;

    let xml = fs.readFileSync(themePath, 'utf8');

    // Drop the cordova-default animated-icon line if our starl line is present.
    const hasStarl = xml.includes('@drawable/ic_starl_splashscreen');
    if (hasStarl) {
        const before = xml;
        xml = xml.replace(
            /^[ \t]*<item name="windowSplashScreenAnimatedIcon">@drawable\/ic_cdv_splashscreen<\/item>[ \t]*\r?\n/m,
            ''
        );
        if (xml !== before) {
            fs.writeFileSync(themePath, xml, 'utf8');
            console.log('[starl-splash] splash icon set to ic_starl_splashscreen');
        }
    }
};
