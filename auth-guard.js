/**
 * Obsidian - Authentication Guard
 *
 * Ensures users can only access protected pages if they navigated
 * from the login page (index.html) or already have an auth token
 * in sessionStorage. Redirects unauthorized visitors to index.html.
 *
 * Include this script in the <head> of every protected page
 * (main, settings, media, proxy, credits, etc.).
 */
(function () {
    var referrer = document.referrer;
    var hasAuth = sessionStorage.getItem('obsidian_auth');
    var isFromSite = referrer.includes('index.html') || referrer.includes(window.location.origin);

    if (!hasAuth && !isFromSite) {
        window.location.href = 'index.html';
        return;
    }

    sessionStorage.setItem('obsidian_auth', 'true');
})();
