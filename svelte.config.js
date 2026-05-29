import preprocess from 'svelte-preprocess';

export default {
  // aktiviert TypeScript in .svelte-Dateien
  preprocess: preprocess({
    typescript: true
  })
};
