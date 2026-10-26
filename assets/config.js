/* ShowFuse website: the settings. This is the ONE place to change them.

   APP_URL        the web app. While it is empty, the "Sign in" and "Open on web" buttons stay hidden, so this site can go live
                  before the app host does. When app.showfuseapp.com is live, set it to 'https://app.showfuseapp.com'.
   APP_STORE_URL  the App Store page. While it is empty, "Get the app" stays hidden and the page keeps its closed-beta wording.
                  When the app is on the App Store, set it to the App Store link (https://apps.apple.com/...).

   Only https:// addresses are used; anything else is ignored and the buttons stay hidden. */
window.SF_CONFIG = {
  APP_URL: '',
  APP_STORE_URL: ''
};
