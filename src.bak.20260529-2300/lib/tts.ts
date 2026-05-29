export function speak(text: string, lang = 'zh-CN') {
  if (!('speechSynthesis' in window)) {
    alert('Sprachausgabe wird von diesem Browser nicht unterstützt.');
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
