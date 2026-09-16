export function submitGate() {
  let busy = false;
  return {
    claim() { if (busy) return false; busy = true; return true; },
    release() { busy = false; },
  };
}
