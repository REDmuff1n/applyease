// Runs in job websites opened inside ApplyEase. Gives them nothing from the app.
//
// Some sign-in pages (LinkedIn, for one) ask for a passkey the moment they load, as
// "autofill". In Electron on Windows that pops up the system passkey dialog
// ("use your iPhone, iPad or Android device") before the user has done anything.
// This keeps that automatic request waiting quietly, so email + password sign-in
// works. Choosing "Sign in with a passkey" on the page still works as normal.
const { webFrame } = require('electron');

webFrame.executeJavaScript(`(() => {
  const c = navigator.credentials;
  if (!c || typeof c.get !== 'function') return;
  const get = c.get.bind(c);
  c.get = (options) => {
    if (!(options && options.mediation === 'conditional' && options.publicKey)) return get(options);
    // Autofill-style passkey request: shows no dialog, ends when the page cancels it.
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      if (signal) signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
    });
  };
})()`);
