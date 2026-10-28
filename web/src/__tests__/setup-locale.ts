// Built-in chart text defaults to the browser language (`navigator.language`, which Node derives
// from the OS locale). Pin it so text assertions do not depend on the machine running the tests.
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
}
