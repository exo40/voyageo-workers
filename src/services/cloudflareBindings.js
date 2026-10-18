'use strict';

let assets = null;
let photos = null;

function setBindings(bindings) {
  assets = bindings.assets || null;
  photos = bindings.photos || null;
}

function getAssets() {
  if (!assets) throw new Error('Binding Cloudflare ASSETS indisponible.');
  return assets;
}

function getPhotos() {
  if (!photos) throw new Error('Binding Cloudflare R2 indisponible.');
  return photos;
}

async function getAssetText(path, requestUrl) {
  const url = new URL(path, requestUrl);
  const response = await getAssets().fetch(new Request(url));
  if (!response.ok) throw new Error(`Asset introuvable : ${path}`);
  return response.text();
}

module.exports = { setBindings, getAssets, getPhotos, getAssetText };
