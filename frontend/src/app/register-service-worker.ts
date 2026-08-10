if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/ui/sw.js', { scope: '/ui/' });
}
