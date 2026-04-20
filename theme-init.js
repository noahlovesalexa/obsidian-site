/**
 * Obsidian - Theme Initialization
 * 
 * Applies saved theme settings immediately on page load to prevent
 * a flash of unstyled content (FOUC). Include this script in the
 * <head> of every page, before any stylesheets finish rendering.
 *
 * Reads from: obsidian_settings, obsidian_admin_settings (localStorage)
 * Sets: data-theme, data-density, data-animations, data-font on <html>
 */
(function () {
    try {
        var settings = JSON.parse(localStorage.getItem('obsidian_settings'));
        if (settings) {
            if (settings.theme) document.documentElement.setAttribute('data-theme', settings.theme);
            if (settings.density) document.documentElement.setAttribute('data-density', settings.density);
            if (typeof settings.animations !== 'undefined') {
                document.documentElement.setAttribute('data-animations', settings.animations ? 'on' : 'off');
            }
            if (settings.font) document.documentElement.setAttribute('data-font', settings.font);
        }

        var adminSettings = JSON.parse(localStorage.getItem('obsidian_admin_settings') || '{}');
        if (adminSettings.forceTheme && adminSettings.forceTheme !== 'none') {
            document.documentElement.setAttribute('data-theme', adminSettings.forceTheme);
        }
    } catch (e) { /* silently fail */ }
})();
