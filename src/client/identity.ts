// A random secret kept in this browser. It is what lets you come back to your seat
// after a reload — there are no accounts.

const TOKEN_KEY = 'kolo.token';

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let memoryToken: string | null = null;

export function getToken(): string {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      t = randomToken();
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch {
    // Storage blocked (private mode): the seat lasts until the tab is closed.
    memoryToken ??= randomToken();
    return memoryToken;
  }
}
