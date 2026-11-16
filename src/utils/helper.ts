
export function randomNumericString(length: number) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < length; i++) {
    s += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return s;
}