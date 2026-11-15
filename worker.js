// Hub Worker: serves the static hub from public/ through the ASSETS binding.
// The club gate (workers/club-gate) reaches the hub through a service binding, so the hub needs a script.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
