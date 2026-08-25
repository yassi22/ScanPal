# Fixture: echte esbuild-bundleroutput voor `extractBaasFingerprints`

Plan 74 (stap 1) vereist dat de minified/gebundelde fixture **echte bundler-output**
is, niet een handgeschreven "minified" string — anders test je de regex niet tegen
de mangling- en brace-eliminatievormen die esbuild/vite in productie emitten.

De string in `baas-security.test.ts` (`describe("extractBaasFingerprints")` →
"werkt op echte esbuild-bundleroutput") is de letterlijke output van onderstaand
bronsnippet, geminificeerd met esbuild. Regenereer als je hem wilt bijwerken.

## Bron (`baas-fixture-src.js`)

```js
// Representatieve app-init: Supabase createClient + Firebase initializeApp,
// met volledige key-literals zoals een echte config die bevat.
function createClient(url, key) {
  return { url, key, from: (t) => ({ t }) };
}
const firebase = {
  initializeApp(config) {
    return { config, name: "[DEFAULT]" };
  },
};

const supabase = createClient(
  "https://min.supabase.co",
  "sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd",
);

const firebaseConfig = {
  apiKey: "AIzaSyB1234567890abcdefghijklmnopqrstuv",
  authDomain: "minapp.firebaseapp.com",
  databaseURL: "https://minapp.firebaseio.com",
  projectId: "minapp",
  storageBucket: "minapp.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456",
};
const app = firebase.initializeApp(firebaseConfig);

// Voorkom dead-code-eliminatie van de config.
window.__app = app;
window.__db = supabase.from("users");
```

## Commando

```bash
npx esbuild baas-fixture-src.js --bundle --minify --format=iife
```

## Wat de fixture aantoont

esbuild mangelt de `firebaseConfig`-identifier weg (`t={apiKey:...}`), dus de
identifier-gebaseerde `FIREBASE_CONFIG_RE` matcht **niet** op productie-output.
De detectie leunt daarom op de **string-literals** die de minificatie overleven:
`https://min.supabase.co`, de `sb_publishable_`-key, de `AIza…`-apiKey,
`https://minapp.firebaseio.com` (uit `databaseURL`) en `minapp.appspot.com`.
Dat is precies het gedrag dat we in productie willen borgen.
