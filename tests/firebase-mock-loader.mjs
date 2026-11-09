export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes("firebase.js?v=")) {
    return {
      url: new URL("./firebase-mock-runtime.mjs", import.meta.url).href,
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}
